/**
 * REFM-22 — самообновление APK: проводка кнопок и два решения под ней.
 *
 * Живёт только в упакованном APK: он несёт вшитый `window.__BUILD__`, поэтому в
 * браузере и dev-сборке `currentBuild()` возвращает `null` и весь модуль — no-op.
 * Само сравнение версий и разбор релиза давно лежат в `updater.ts`; здесь остаётся
 * DOM-проводка плюс ровно два решения, которые стоит проверять тестом, а не глазами:
 *
 *  · **что сказать игроку про исход проверки** — «ты на свежей версии» и «до GitHub не
 *    достучались» обязаны читаться по-разному, иначе ручная проверка бесполезна: она
 *    молчит одинаково и когда всё хорошо, и когда сеть отвалилась;
 *  · **когда вообще проверять** — приложение дёргает проверку на запуске, при каждом
 *    возврате в ПЕРЕДНИЙ план и раз в 4 часа. Возврат в передний план на телефоне
 *    случается десятки раз в час, поэтому без порога это стало бы стуком по API.
 */
import { t } from '../../localization/runtime';
import { buildChannel, buildLabel, checkForUpdateDetailed, currentBuild } from './updater';
import type { UpdateCheck, UpdateInfo } from './updater';
import { detach } from './detach';
import { initRuStoreUpdate, type RuStoreUpdateOptions } from './rustoreUpdate';

/** Минимальный зазор между молчаливыми проверками. */
export const CHECK_GAP_MS = 15 * 60_000;

/**
 * Читаемая строка на КАЖДЫЙ исход проверки — чтобы ручную проверку можно было
 * ПРОСЛЕДИТЬ. Свитч без `default`: новый вид исхода уронит сборку здесь, а не выйдет
 * к игроку пустой строкой.
 */
export function updateMessage(r: UpdateCheck): string {
  switch (r.kind) {
    case 'update':
      return t('upd.available', { v: r.info.versionCode });
    case 'current':
      return t('upd.current', { l: r.local, r: r.remote });
    case 'offline':
      return t('upd.no-network');
    case 'http':
      return t('upd.http-error', { s: r.status });
    case 'unparsable':
      return t('upd.bad-version');
    case 'dormant':
      return t('upd.apk-only');
  }
}

/**
 * Пора ли молчаливо проверить обновление. Офлайн — никогда (проверка всё равно
 * упрётся в сеть, а игрок увидит мигание диагностики на пустом месте); иначе — не чаще
 * зазора. Ручная проверка кнопкой это правило не спрашивает: её попросил игрок.
 */
export function shouldCheck(now: number, lastCheckAt: number, online: boolean): boolean {
  if (!online) return false;
  return now - lastCheckAt >= CHECK_GAP_MS;
}

const el = (id: string): HTMLElement | null => document.getElementById(id);

/**
 * Молчаливые перепроверки: на запуске, при каждом возврате в ПЕРЕДНИЙ план (телефонный
 * сценарий — запустил офлайн, открыл позже на Wi-Fi) и раз в 4 часа для долгой сессии.
 * С порогом, чтобы мигание переднего плана не долбило проверку. Расписание одно на оба
 * канала поставки: оно про телефон, а не про то, откуда приходит обновление.
 */
function scheduleChecks(check: () => void): void {
  let lastCheckAt = 0;
  const maybeCheck = (): void => {
    const now = Date.now();
    if (!shouldCheck(now, lastCheckAt, navigator.onLine !== false)) return;
    lastCheckAt = now;
    check();
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) maybeCheck();
  });
  window.setInterval(maybeCheck, 4 * 3_600_000);
  maybeCheck(); // проверка запуска (со штампом порога: передний план сразу после — бесплатно)
}

/**
 * Повесить всю проводку обновления. Вне APK (нет вшитой сборки) — тихо ничего не
 * делает: ни кнопок, ни таймеров, ни сетевых запросов. Стор-сборка (канал `rustore`,
 * RUS-3) обновляется через SDK магазина, и GitHub-полосы в ней нет вовсе.
 */
export function initApkUpdater(options: RuStoreUpdateOptions = {}): void {
  const channel = buildChannel();
  if (channel === 'rustore') {
    const store = initRuStoreUpdate(options);
    if (store) scheduleChecks(store.check);
    return;
  }
  const myBuild = currentBuild();
  if (channel !== 'github' || !myBuild) return;

  const cver = el('cver');
  if (cver) cver.textContent = t('upd.build', { b: buildLabel(myBuild) });
  const cupd = el('cupd');
  if (cupd) cupd.style.display = '';

  const showUpdate = (u: UpdateInfo): void => {
    const ver = el('ub-ver');
    if (ver) ver.textContent = buildLabel(u);
    const go = el('ub-go') as HTMLAnchorElement | null;
    if (go) go.href = u.apkUrl;
    const bar = el('updbar');
    if (bar) bar.style.display = 'block'; // override the stylesheet's display:none
  };

  let checking = false;
  const runCheck = async (manual: boolean, out?: HTMLElement | null): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const r = await checkForUpdateDetailed();
      if (r.kind === 'update') showUpdate(r.info);
      if (manual && out) {
        const prev = out.textContent;
        out.textContent = t('upd.checking', { msg: updateMessage(r) });
        out.style.color = r.kind === 'offline' || r.kind === 'http' ? 'var(--amber)' : '';
        window.setTimeout(() => {
          out.textContent = prev;
          out.style.color = '';
        }, 8000);
      }
    } finally {
      checking = false;
    }
  };

  // «Обновить» → open the APK in the system browser via the native bridge (downloads +
  // offers install, reliable everywhere). Falls back to the plain <a href> navigation
  // when the bridge is absent (a real browser / dev build).
  el('ub-go')?.addEventListener('click', (e) => {
    const native = (globalThis as { VoidNative?: { open?: (u: string) => void } }).VoidNative;
    const url = (el('ub-go') as HTMLAnchorElement | null)?.href;
    if (native?.open && url) {
      e.preventDefault();
      native.open(url);
    }
  });
  el('ub-later')?.addEventListener('click', () => {
    const bar = el('updbar');
    if (bar) bar.style.display = 'none';
  });
  cupd?.addEventListener('click', () =>
    detach('обновление APK: ручная проверка', runCheck(true, cver)),
  );
  // The hub carries its own manual check (the returning-player path never shows
  // #connect); diagnostics land in the hub's note line.
  const hubUpd = el('hub-upd');
  if (hubUpd) {
    hubUpd.style.display = '';
    hubUpd.addEventListener('click', () =>
      detach('обновление APK: ручная проверка из хаба', runCheck(true, el('hub-note'))),
    );
  }

  scheduleChecks(() => detach('обновление APK: фоновая проверка', runCheck(false)));
}
