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
import type { UpdateCheck } from './updater';
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
      return t('upd.available');
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
    case 'E_UPDATE_TIMEOUT':
      return t('upd.err-timeout');
    case 'E_UPDATE_DNS':
      return t('upd.err-dns');
    case 'E_UPDATE_TLS':
      return t('upd.err-tls');
    case 'E_UPDATE_HTTP':
      return t('upd.err-http');
    case 'E_UPDATE_STALE':
      return t('upd.err-stale');
    case 'E_UPDATE_INSTALL':
      return t('upd.err-install');
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

/** Re-check the signed manifest at the moment of download: banners can outlive
 * the host's bounded APK retention. Never reuse a captured, potentially removed URL. */
export async function beginVerifiedUpdate(deps: {
  check: () => Promise<UpdateCheck>;
  install: (url: string, sha256: string) => void;
  status: (text: string) => void;
}): Promise<void> {
  deps.status(t('upd.preparing'));
  try {
    const result = await deps.check();
    if (result.kind !== 'update') { deps.status(updateMessage(result)); return; }
    if (!isTrustedApkUrl(result.info.apkUrl)) { deps.status(installMessage(null)); return; }
    deps.install(result.info.apkUrl, result.info.apkSha256);
  } catch { deps.status(installMessage(null)); }
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

  let preparingDownload = false;
  const status = (text: string): void => {
    const line = el('ub-status');
    if (line) line.textContent = text;
  };
  const showUpdate = (): void => {
    status('');
    const bar = el('updbar');
    if (bar) bar.style.display = 'block'; // override the stylesheet's display:none
  };

  let checking = false;
  const runCheck = async (manual: boolean, out?: HTMLElement | null): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const r = await checkForUpdateDetailed();
      if (r.kind === 'update') showUpdate();
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
    if (preparingDownload) return;
    if (!native?.installVerified) {
      status(installMessage(null));
      return;
    }
    preparingDownload = true;
    detach('APK download', beginVerifiedUpdate({
      check: checkForUpdateDetailed,
      install: (url, hash) => native.installVerified!(url, hash),
      status,
    }).finally(() => { preparingDownload = false; }));
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
