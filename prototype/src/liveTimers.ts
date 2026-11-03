/**
 * Живые отсчёты в окнах, которые перерисовываются сравнением разметки.
 *
 * Лист, строка статуса и окна (технологии, «Хранитель», герои, шпионаж, постройки, ряд
 * приказов) собираются строкой и пересобираются, когда строка не совпала с нарисованной.
 * Цифра отсчёта, вписанная в строку, меняет её с каждым шагом часов: узел пересобирается
 * целиком, и кнопки под курсором пересоздаются — наведение мигает, а нажатие, чьи down/up
 * пришлись на разные кадры, теряется. Так мигали «Бомбардировать» и «Штурм» на высадке
 * (#1801); здесь то же лечение, одно на все окна.
 *
 * 1. **В разметке — момент, а не остаток.** Узел несёт срок (`data-at`) или начало
 *    (`data-since`, для «столько-то назад») и имя формата (`data-fmt`), а внутри — «…»:
 *    с цифрами внутри разметка менялась бы вместе с ними.
 * 2. **Цифры ставит {@link patchLiveTimers}** на месте и только сменившиеся. Окно зовёт его
 *    после своей перерисовки — и тогда, когда перерисовка не понадобилась.
 * 3. **Подсказка со временем** (`title` и `aria-label`) — шаблон в `data-tip` с местом
 *    {@link LIVE_SLOT} у узла `pn-tip` ({@link liveTipAttrs}).
 * 4. **Полоса** `pn-bar` растёт от `data-since` к `data-at`; **доля погрузки** `pn-pct` —
 *    целые проценты по окнам трюма (`holdProgress`).
 * 5. **Срок прошёл — ноль, а не минус.**
 */
import { holdProgress, type HoldWindow } from '../../decisions/fleetHolds';
import { countdownHMS, esc, fmtEta, fmtHrs } from './format';
import { HOUR } from './time';

/** Формат отсчёта: неотрицательный остаток (или прошедшее) в мс мира → текст. */
export type LiveFormats = Readonly<Record<string, (ms: number) => string>>;

/** Форматы, общие всем окнам; окно со своим форматом дописывает его к этим. */
export const LIVE_FORMATS: LiveFormats = {
  /** «2.5ч» / «40м» — как `timeLeft`. */
  eta: (ms) => fmtEta(ms / HOUR),
  /** «1:05:30». */
  hms: countdownHMS,
  /** «≈14ч» — кулдауны, считанные целыми часами. */
  hrs: (ms) => fmtHrs(ms / HOUR),
};

/** Место отсчёта в шаблоне подсказки (правило 3). */
export const LIVE_SLOT = '{t}';

const fmtAttr = (fmt: string): string => (fmt === 'eta' ? '' : ` data-fmt="${esc(fmt)}"`);

/** Отсчёт до `at` (правило 1). */
export function liveTimerHtml(at: number, fmt = 'eta'): string {
  return `<span class="pn-timer" data-at="${at}"${fmtAttr(fmt)}>…</span>`;
}

/** Сколько прошло с `since` — «столько-то назад» (правило 1). */
export function liveSinceHtml(since: number, fmt = 'eta'): string {
  return `<span class="pn-timer" data-since="${since}"${fmtAttr(fmt)}>…</span>`;
}

/** Атрибуты узла `pn-tip`: подсказка `tip` с {@link LIVE_SLOT}, где встанет отсчёт до `at`. */
export function liveTipAttrs(at: number, fmt: string, tip: string): string {
  return ` data-at="${at}"${fmtAttr(fmt)} data-tip="${esc(tip)}"`;
}

/** Полоса от `since` до `at`: ширина — пройденная доля (правило 4). */
export function liveBarHtml(since: number, at: number): string {
  return `<i class="pn-bar" data-since="${since}" data-at="${at}"></i>`;
}

/** Доля погрузки по окнам трюма, целые проценты (правило 4). */
export function livePctHtml(windows: readonly HoldWindow[]): string {
  return `<span class="pn-pct" data-win="${esc(JSON.stringify(windows))}">…</span>`;
}

/** Остаток до срока или прошедшее с начала, не меньше нуля (правило 5). */
function liveMs(el: HTMLElement, now: number): number {
  const since = el.dataset.since;
  return Math.max(0, since !== undefined ? now - Number(since) : Number(el.dataset.at) - now);
}

/** Текст узла: формат по имени; неизвестный формат — «—», а не чужие цифры. */
function liveText(el: HTMLElement, now: number, formats: LiveFormats): string {
  const fmt = formats[el.dataset.fmt ?? 'eta'];
  return fmt ? fmt(liveMs(el, now)) : '—';
}

/** Правило 2: поставить живые цифры в `root` к моменту `now`, не трогая разметку. */
export function patchLiveTimers(
  root: ParentNode,
  now: number,
  formats: LiveFormats = LIVE_FORMATS,
): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.pn-timer'))) {
    const text = liveText(el, now, formats);
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.pn-tip'))) {
    const tip = (el.dataset.tip ?? '').split(LIVE_SLOT).join(liveText(el, now, formats));
    if (el.title !== tip) {
      el.title = tip;
      el.setAttribute('aria-label', tip);
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.pn-bar'))) {
    const from = Number(el.dataset.since);
    const span = Number(el.dataset.at) - from;
    const pct = span > 0 ? Math.min(1, Math.max(0, (now - from) / span)) : 1;
    const width = `${Math.round(pct * 100)}%`;
    if (el.style.width !== width) el.style.width = width;
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.pn-pct'))) {
    const windows = JSON.parse(el.dataset.win ?? '[]') as HoldWindow[];
    const text = String(Math.floor(holdProgress(windows, now) * 100));
    if (el.textContent !== text) el.textContent = text;
  }
}
