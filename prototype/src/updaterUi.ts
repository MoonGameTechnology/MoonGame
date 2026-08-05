/**
 * Витрина авто-обновления АПК — баннер, кнопки проверки и дроссель тихих проверок (REFM-23).
 *
 * Разбор релиза, сравнение сборок и аллоулист адреса живут в `updater.ts`; здесь только
 * то, что видит и нажимает игрок. Модуль СПИТ в браузерной/дев-сборке: собственная
 * сборка есть только у упакованного АПК (`window.__BUILD__`), поэтому при `build() === null`
 * ни один элемент не показывается и ни одна проверка не уходит.
 *
 * Почему «Обновить» отдаёт ссылку системному браузеру: он скачивает APK и предлагает его
 * установить — это работает на любом устройстве. Нативного моста нет (настоящий браузер) —
 * остаётся обычный переход по `<a href>`.
 */
import { t } from '../../localization/runtime';
import { buildLabel, type BuildInfo, type UpdateCheck, type UpdateInfo } from './updater';

/** Не чаще одной тихой проверки в 15 минут: возврат на передний план может «мигать». */
export const CHECK_GAP_MS = 15 * 60_000;

/** Период фоновой перепроверки для долгой сессии. */
export const RECHECK_EVERY_MS = 4 * 3_600_000;

/** Сколько держится диагностика ручной проверки, прежде чем подпись вернётся на место. */
export const DIAG_HOLD_MS = 8000;

/**
 * Читаемая строка для КАЖДОГО исхода проверки: ручную проверку должно быть можно
 * проследить — «у вас последняя сборка» обязано отличаться от «проверка не дошла до
 * GitHub».
 */
export function diagMsg(r: UpdateCheck): string {
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

/** Проверка не дошла до ответа по существу — такую диагностику подсвечиваем тревожным. */
export function isCheckFailure(r: UpdateCheck): boolean {
  return r.kind === 'offline' || r.kind === 'http';
}

/** Что витрина берёт у клиента. Логика обновления ей не принадлежит — она её показывает. */
export interface UpdaterUiHost {
  /** Собственная сборка; `null` в браузере/дев-сборке — тогда модуль спит целиком. */
  build(): BuildInfo | null;
  /** Сходить за релизом (в клиенте — `checkForUpdateDetailed`). */
  check(): Promise<UpdateCheck>;
  /** Элемент разметки по id (`cver`, `cupd`, `updbar`, `ub-ver`, `ub-go`, `ub-later`, `hub-upd`). */
  el(id: string): HTMLElement | null;
  /** Часы дросселя. */
  now(): number;
  /** Есть ли сеть: `navigator.onLine === false` → тихую проверку не делаем. */
  online(): boolean;
  /** Отдать ссылку системному браузеру. `false` — моста нет, пусть работает `<a href>`. */
  openExternal(url: string): boolean;
  /** Отложенный вызов (в клиенте — `window.setTimeout`). */
  after(ms: number, fn: () => void): void;
}

export interface UpdaterUi {
  /** Тихая проверка с дросселем: старт, возврат на передний план, фоновый период. */
  maybeCheck(): void;
  /** Ручная проверка: диагностика уходит в `out` и через `DIAG_HOLD_MS` подпись вернётся. */
  manualCheck(out?: HTMLElement | null): void;
}

/** Собрать витрину. В дев-сборке возвращает пустышку — звать её методы безопасно. */
export function initUpdaterUi(host: UpdaterUiHost): UpdaterUi {
  const my = host.build();
  if (!my) return { maybeCheck: () => {}, manualCheck: () => {} }; // браузер/дев — обновлять нечего

  const cver = host.el('cver');
  if (cver) cver.textContent = t('upd.build', { b: buildLabel(my) });
  const cupd = host.el('cupd');
  if (cupd) cupd.style.display = '';

  const showUpdate = (u: UpdateInfo): void => {
    const ver = host.el('ub-ver');
    if (ver) ver.textContent = buildLabel(u);
    const go = host.el('ub-go') as HTMLAnchorElement | null;
    if (go) go.href = u.apkUrl;
    const bar = host.el('updbar');
    if (bar) bar.style.display = 'block'; // перебивает display:none из таблицы стилей
  };

  let checking = false;
  const runCheck = async (manual: boolean, out?: HTMLElement | null): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const r = await host.check();
      if (r.kind === 'update') showUpdate(r.info);
      if (manual && out) {
        const prev = out.textContent;
        out.textContent = t('upd.checking', { msg: diagMsg(r) });
        out.style.color = isCheckFailure(r) ? 'var(--amber)' : '';
        host.after(DIAG_HOLD_MS, () => {
          out.textContent = prev;
          out.style.color = '';
        });
      }
    } finally {
      checking = false;
    }
  };

  // «Обновить» → системный браузер через нативный мост (скачает и предложит установить).
  // Моста нет — не мешаем обычному переходу по ссылке.
  host.el('ub-go')?.addEventListener('click', (e) => {
    const url = (host.el('ub-go') as HTMLAnchorElement | null)?.href;
    if (url && host.openExternal(url)) e.preventDefault();
  });
  host.el('ub-later')?.addEventListener('click', () => {
    const bar = host.el('updbar');
    if (bar) bar.style.display = 'none';
  });
  cupd?.addEventListener('click', () => void runCheck(true, cver));
  // У хаба своя ручная проверка (возвращающийся игрок не видит окна подключения);
  // диагностика уходит в строку заметок хаба.
  const hubUpd = host.el('hub-upd');
  if (hubUpd) {
    hubUpd.style.display = '';
    hubUpd.addEventListener('click', () => void runCheck(true, host.el('hub-note')));
  }

  // `lastCheckAt = 0` означает «ещё ни разу», а не «проверял в эпоху»: иначе дроссель
  // зависел бы от того, насколько велики часы хозяина.
  let lastCheckAt = 0;
  const maybeCheck = (): void => {
    if (!host.online()) return;
    const now = host.now();
    if (lastCheckAt && now - lastCheckAt < CHECK_GAP_MS) return;
    lastCheckAt = now;
    void runCheck(false);
  };

  return { maybeCheck, manualCheck: (out) => void runCheck(true, out) };
}
