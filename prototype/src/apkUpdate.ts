/**
 * REFM-22 — самообновление APK: проводка кнопок и два решения под ней.
 *
 * Живёт только в упакованном APK: он несёт вшитый `window.__BUILD__`, поэтому в
 * браузере и dev-сборке `currentBuild()` возвращает `null` и весь модуль — no-op.
 * Само сравнение версий и разбор релиза давно лежат в `updater.ts`; здесь остаётся
 * DOM-проводка плюс ровно два решения, которые стоит проверять тестом, а не глазами:
 *
 *  · **что сказать игроку про исход проверки** — «ты на свежей версии» и «до сайта не
 *    достучались» обязаны читаться по-разному, иначе ручная проверка бесполезна: она
 *    молчит одинаково и когда всё хорошо, и когда сеть отвалилась;
 *  · **когда вообще проверять** — приложение дёргает проверку на запуске, при каждом
 *    возврате в ПЕРЕДНИЙ план и раз в 4 часа. Возврат в передний план на телефоне
 *    случается десятки раз в час, поэтому без порога это стало бы стуком по API.
 */
import { t } from '../../localization/runtime';
import { buildLabel, checkForUpdateDetailed, currentBuild, isRuStoreBuild, isTrustedApkUrl } from './updater';
import type { UpdateCheck, UpdateInfo } from './updater';
import { detach } from './detach';

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
    case 'unverified':
      return t('upd.unverified');
    case 'unsupported':
      return t('upd.unsupported');
    case 'dormant':
      return t('upd.apk-only');
  }
}

/**
 * Что сказать игроку на статус нативной установки (`void-apk-update`). Нативная сторона
 * шлёт только фиксированные коды; незнакомый код — отказ, а не тишина.
 */
export function installMessage(code: unknown): string {
  switch (code) {
    case 'downloading':
      return t('upd.downloading');
    case 'installing':
      return t('upd.installing');
    case 'E_UPDATE_PERMISSION':
      return t('upd.err-permission');
    case 'E_UPDATE_DIGEST':
      return t('upd.err-digest');
    case 'E_UPDATE_PACKAGE':
      return t('upd.err-package');
    default:
      return t('upd.err-download');
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
 * Повесить всю проводку обновления. Вне APK (нет вшитой сборки) — тихо ничего не
 * делает: ни кнопок, ни таймеров, ни сетевых запросов.
 */
export function initApkUpdater(): void {
  if (isRuStoreBuild()) return;
  const myBuild = currentBuild();
  if (!myBuild) return;

  const cver = el('cver');
  if (cver) cver.textContent = t('upd.build', { b: buildLabel(myBuild) });
  const cupd = el('cupd');
  if (cupd) cupd.style.display = '';

  let offered: UpdateInfo | null = null;
  const status = (text: string): void => {
    const line = el('ub-status');
    if (line) line.textContent = text;
  };
  const showUpdate = (u: UpdateInfo): void => {
    offered = u;
    status('');
    const ver = el('ub-ver');
    if (ver) ver.textContent = buildLabel(u);
    const notes = el('ub-notes');
    if (notes) notes.textContent = u.notes;
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

  // «Скачать обновление» → the native side downloads the APK itself, compares its SHA-256
  // with the SIGNED manifest and only then opens the system installer. There is no
  // plain-link fallback: a browser download would fetch bytes nobody checked.
  el('ub-go')?.addEventListener('click', (e) => {
    e.preventDefault();
    const native = (globalThis as { VoidNative?: { installVerified?: (url: string, sha256: string) => void } }).VoidNative;
    if (!offered || !isTrustedApkUrl(offered.apkUrl) || !native?.installVerified) {
      status(installMessage(null));
      return;
    }
    native.installVerified(offered.apkUrl, offered.apkSha256);
  });
  window.addEventListener('void-apk-update', (e) => status(installMessage((e as CustomEvent).detail)));
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

  // Silent re-checks: once at launch, whenever the app returns to the FOREGROUND
  // (the phone pattern — launch offline, open later on wifi), and every 4h for a
  // long-lived session. Throttled so foreground flapping can't hammer the API.
  let lastCheckAt = 0;
  const maybeCheck = (): void => {
    const now = Date.now();
    if (!shouldCheck(now, lastCheckAt, navigator.onLine !== false)) return;
    lastCheckAt = now;
    detach('обновление APK: фоновая проверка', runCheck(false));
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) maybeCheck();
  });
  window.setInterval(maybeCheck, 4 * 3_600_000);
  maybeCheck(); // launch check (throttle-stamped so a foreground right after boot is free)
}
