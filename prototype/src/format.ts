/**
 * Presentation formatters (REFM-2) — the pure text/HTML helpers every screen needs:
 * escaping, number shortening, resource glyphs + tinted cost strings, display names,
 * ETA wording. Extracted from `main.ts` first ON PURPOSE: they carry no state and no
 * DOM, so every later REFM brick can import them directly instead of threading the
 * same five helpers through a `deps` object (see the method note in the REFM block of
 * docs/backlog.md — `main.ts` has no export surface, so screen modules take their
 * host dependencies explicitly; these are the ones that never need to be passed).
 *
 * Locale-aware but state-free: `t`/`tData` read the chosen locale, nothing else.
 */
import { t, tData } from '../../localization/runtime';
import { RES_SVG } from './icons';
import { DAY, HOUR } from './time';

/** HTML-escape for text AND attribute values (CWE-79). Covers both quote styles: the
 *  file uses double-quoted attributes today, escaping `'` too keeps this complete if a
 *  single-quoted attribute is ever added. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Compact count: 1234 → «1.2k». Rounds first, drops a trailing «.0». */
export function kfmt(n: number): string {
  const v = Math.round(n);
  return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(v);
}

/** Grouped count for dossier/profile numbers: 1234 → «1 234». */
export function nfmt(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** One decimal — keeps a slow bleed visible instead of rounding it to a lying 0. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Highlight a value inside dossier prose. */
export const hl = (v: string | number): string => `<em class="hl">${v}</em>`;

/** Resource glyph family (mock 2026-07: coin stack / cube / sprout / bolt / chip).
 *  These TEXT glyphs serve PLAIN-TEXT contexts only — `title=` attributes, toasts,
 *  button labels built with `esc()` — where SVG can't ride along. Every innerHTML
 *  surface draws the shared `RES_SVG` line icons instead (one look everywhere). */
export const TECH_CUR: Record<string, string> = {
  credits: '⛁',
  food: '⚘',
  metal: '❒',
  energy: 'ϟ',
  microelectronics: '▣',
};

/** Resource token for innerHTML strings: the SAME inline-SVG line icon the top bar
 *  draws, tinted by the same stylesheet accent (`.rc-*`). A player who learned the
 *  bar reads costs, the market book and yield rows for free — one icon, one colour,
 *  every surface. Unknown resource (modded data) → its localized-name initial. */
export const curIc = (r: string): string =>
  `<span class="rc-${r} ri">${RES_SVG[r] ?? esc((tData(r)[0] ?? r[0] ?? '?').toUpperCase())}</span>`;

/**
 * A cost bag as HTML (icon + amount per resource) — callers feed innerHTML, don't esc().
 *
 * With `have` (the buyer's treasury) each unaffordable entry turns SHORT: the chip
 * reads red and carries the exact deficit («−N») — the player sees not just "can't",
 * but how far away the build is. No `have` → the neutral price tag, unchanged look.
 */
export function cost(
  bag: Record<string, number> | undefined,
  have?: Record<string, number>,
): string {
  const entries = Object.entries(bag ?? {});
  if (!entries.length) return `<span class="rcost-free">${t('cost.free')}</span>`;
  return entries
    .map(([r, n]) => {
      const lack = have ? Math.max(0, Math.ceil(n - (have[r] ?? 0))) : 0;
      const gap =
        lack > 0 ? `<em class="lack" title="${t('cost.short', { n: lack })}">−${lack}</em>` : '';
      return `<span class="rcost rc-${r}${lack > 0 ? ' short' : ''}">${curIc(r)}${n}${gap}</span>`;
    })
    .join(' ');
}

/**
 * ОДНО правило показа ресурса вне ценника: иконка + число в цвете ресурса.
 *
 * Ценник (`cost`) уже так и рисуется; всё остальное — добыча зданий, содержание,
 * доход мира, ряды кодекса — печатало ИМЯ ресурса словом («+12 металл/ч»), и
 * игроку приходилось читать текст там, где бар и цены он узнаёт по цвету. Теперь
 * поверхность одна: выучил бар — читаешь всё.
 *
 * `sign` ставит явный «+»/«−» (поток, а не запас), `per` дописывает локализованный
 * суффикс скорости. Неизвестный ресурс не ломается: `curIc` отдаёт букву имени.
 */
export function resChip(
  res: string,
  n: number | string,
  opts: { sign?: boolean; per?: 'h' | 'd' } = {},
): string {
  const num = typeof n === 'number' ? n : Number(n);
  // Минус — типографский «−» (U+2212), тот же знак, что у дефицита в ценнике:
  // дефисный «-» в моноширинном шрифте читается как перенос, а не как «минус».
  const shown =
    typeof n === 'number'
      ? `${opts.sign && num > 0 ? '+' : ''}${String(round1(num)).replace('-', '−')}`
      : String(n);
  const per = opts.per
    ? `<i class="rc-per">${t(opts.per === 'd' ? 'res.per.day' : 'res.per.hour')}</i>`
    : '';
  return `<span class="rcost rc-${res}">${curIc(res)}${shown}${per}</span>`;
}

/** Мешок ресурсов чипами через « · ». Нули опускаются: «+0 энергии» — шум, а не
 *  информация (то же правило, что у ценника: пустой мешок ничего не печатает). */
export function resLine(
  bag: Record<string, number> | undefined,
  opts: { sign?: boolean; per?: 'h' | 'd' } = {},
): string {
  return Object.entries(bag ?? {})
    .filter(([, n]) => (n ?? 0) !== 0)
    .map(([r, n]) => resChip(r, n ?? 0, opts))
    .join(' · ');
}

/** The same bag as PLAIN TEXT — for `title=` attributes and button labels built with
 *  `esc()`, where the HTML from `cost()` would show the player raw markup. */
export function costText(bag: Record<string, number> | undefined): string {
  const parts = Object.entries(bag ?? {}).map(([r, n]) => `${n}${TECH_CUR[r] ?? r[0]}`);
  return parts.length ? parts.join(' ') : t('cost.free');
}

/** Localized display name of a unit id. Ids are English-ish («scout_drone») — the
 *  space-joined id is the DATA name the RU locale translates; EN shows it as-is. */
export function displayUnit(unit: string): string {
  return tData(unit.replace(/_/g, ' '));
}

/** Localized display name of a building id (`data/*.json` names are English). */
export function buildingName(name: string | undefined, id: string): string {
  return tData(name ?? id);
}

/** «2.5 ч» / «40 мин» — an ETA in the wording the HUD uses. */
export function fmtEta(totalH: number): string {
  return totalH >= 1
    ? t('fmt.hours', { n: totalH.toFixed(1) })
    : t('fmt.minutes', { n: Math.ceil(totalH * 60) });
}

/** «≈14ч» / «≈2д 3ч» — plan durations are game-hours, like every duration in the UI. */
export function fmtHrs(h: number): string {
  const r = Math.max(0, Math.round(h));
  return r >= 48
    ? t('browser.left.days', { d: Math.floor(r / 24), h: r % 24 })
    : t('fmt.hours', { n: r });
}

/**
 * ЧАСЫ ИГРОВОГО ВРЕМЕНИ (REFM-136). Время мира — миллисекунды от нуля матча, а игрок
 * читает его как «день такой-то, столько-то часов». Перевод стоял четырьмя разными
 * выражениями по экрану: штамп журнала, строка разведки, часы в статусной полосе и
 * обратный отсчёт до конца суток — каждое со своим набором `%`, `/` и дополнений нулём.
 *
 * 1. **День игрока начинается с ЕДИНИЦЫ.** `+1` дописывался руками в каждом месте;
 *    забудь его в одном — и в журнале появится «D0», которого у игрока не бывает.
 * 2. **Часы и минуты — от ОСТАТКА суток и часа.** Без `% DAY` часы растут неограниченно
 *    (25:00, 300:00): это уже не время суток, а прожитые часы.
 * 3. **Минуты считаются в МИЛЛИСЕКУНДАХ**, потому что единица времени мира —
 *    миллисекунда: делить остаток часа на `HOUR` вместо 60000 значит получить долю часа
 *    вместо минут.
 * 4. **Время суток дополняется нулём до двух цифр** — `09:07`, а не `9:7`: строки стоят
 *    в колонках журнала и в статусной полосе, и прыгающая ширина дёргает всю строку.
 * 5. **Обратный отсчёт — НЕ время суток, и часы в нём без ведущего нуля** (`2:05:30`):
 *    это остаток, а не показание часов, и час там бывает однозначным по смыслу.
 */

/** Игровые сутки, как их читает игрок: с единицы (правило 1). */
export function gameDay(at: number): number {
  return Math.floor(at / DAY) + 1;
}

/** Час суток, 0–23 (правило 2). */
export function dayHour(at: number): number {
  return Math.floor((at % DAY) / HOUR);
}

/** Время суток «ЧЧ:ММ» (правила 2–4). */
export function clockHM(at: number): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(dayHour(at))}:${p2(Math.floor((at % HOUR) / 60000))}`;
}

/** Обратный отсчёт «Ч:ММ:СС» — остаток, а не показание часов (правило 5). */
export function countdownHMS(ms: number): string {
  const left = Math.max(0, ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(left / HOUR)}:${p2(Math.floor((left % HOUR) / 60000))}:${p2(Math.floor((left % 60000) / 1000))}`;
}
