/**
 * Окно флота на ПК и планшете — разметка консоли по макету владельца (2026-09-27).
 *
 * Консоль — это не новый экран, а новая РАСКЛАДКА старого окна выбора: ряд команд
 * (`#cmdbar`) и лист (`#side`) остаются своими хозяевами со своими обработчиками, а
 * окно раскладывает их детей сеткой (`holographic.css`, `.fleet-console`): шапка с
 * корпусом и щитом, «Приказы», «Состав», «Десант», низ окна. Здесь только куски разметки
 * листа; что в них положить, решает хозяин (`main.ts`), числа и цвет — модель надбавок
 * (`decisions/statModifiers.ts`).
 *
 * Параметры — кнопки с `data-stat`: тап открывает всплывашку «что двигает параметр»
 * (`statPopHtml`). Кнопка, а не подпись, чтобы до всплывашки доходили и с клавиатуры.
 */
import { t } from '../../localization/runtime';
import { pctText, type StatTone } from '../../decisions/statModifiers';
import { esc } from './format';
import { holoIcon, type HoloIcon } from './holographicIcons';
import { termTextHtml } from './termTip';

export type ConsoleStat = 'atk' | 'def' | 'cap' | 'spd' | 'hull' | 'shield';

/** Статья словаря у параметра (UIX-9.4): её текст — правило во всплывашке параметра. */
export const STAT_TERM: Record<ConsoleStat, string> = {
  atk: 'attack',
  def: 'defense',
  cap: 'fire-line',
  spd: 'speed',
  hull: 'hull',
  shield: 'shield',
};

const toneClass = (tone: StatTone): string => (tone === 'neutral' ? '' : ` ${tone}`);

/** Полоса корпуса или щита в шапке окна. Подпись и значение уже готовы. */
export interface VitalView {
  stat: 'hull' | 'shield';
  label: string;
  value: string;
  /** Заполнение полосы, 0..100; `null` — полосы нет (у флота нет щита). */
  pct: number | null;
  /** Корпус ниже порога хромоты — полоса красная. */
  low: boolean;
  tone: StatTone;
}

const VITAL_ICON: Record<VitalView['stat'], HoloIcon> = { hull: 'heart', shield: 'diamond' };

/** Корпус и щит; `extra` — кнопки ремонта хозяина, встают за полосами. */
export function vitalsHtml(rows: readonly VitalView[], extra = ''): string {
  return (
    `<div class="fc-vitals">` +
    rows
      .map(
        (v) =>
          `<button type="button" class="fc-vital ${v.stat}${v.low ? ' low' : ''}" data-stat="${v.stat}" aria-haspopup="dialog">` +
          `<span class="fc-vl">${holoIcon(VITAL_ICON[v.stat])}${esc(v.label)}</span>` +
          `<b class="fc-vv${toneClass(v.tone)}">${esc(v.value)}</b>` +
          (v.pct === null
            ? ''
            : `<span class="fc-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, v.pct))}%"></i></span>`) +
          `</button>`,
      )
      .join('') +
    (extra ? `<span class="fc-repair">${extra}</span>` : '') +
    `</div>`
  );
}

/** Параметр в сетке «Состава». */
export interface StatView {
  stat: ConsoleStat;
  icon: HoloIcon;
  label: string;
  value: string;
  tone: StatTone;
}

export function statGridHtml(stats: readonly StatView[]): string {
  return (
    `<div class="fc-stats">` +
    stats
      .map(
        (s) =>
          `<button type="button" class="fc-stat${toneClass(s.tone)}" data-stat="${s.stat}" aria-haspopup="dialog">` +
          `${holoIcon(s.icon)}<span>${esc(s.label)}</span><b>${esc(s.value)}</b></button>`,
      )
      .join('') +
    `</div>`
  );
}

/** Заголовок колонки: подпись и необязательный хвост справа (готовая разметка). */
export function columnTitleHtml(label: string, tail = ''): string {
  return `<div class="fc-title"><b>${esc(label)}</b>${tail}</div>`;
}

/** Строка таблицы «Десанта». `planet` — `null`, когда флот не у своего мира. */
export interface TroopRow {
  icon: string;
  name: string;
  planet: number | null;
  aboard: number;
}

/** Таблица «Подразделение · На планете · На борту». Без мира под флотом колонки
 *  «На планете» нет: чужой гарнизон сюда не выводится, а пустая колонка читалась бы
 *  как «на планете никого». */
export function troopTableHtml(rows: readonly TroopRow[], atPlanet: boolean): string {
  if (rows.length === 0) return '';
  const head =
    `<th>${esc(t('fleet.console.unit'))}</th>` +
    (atPlanet ? `<th>${esc(t('fleet.console.at-planet'))}</th>` : '') +
    `<th>${esc(t('fleet.console.aboard'))}</th>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td><span class="bicon">${r.icon}</span>${esc(r.name)}</td>` +
        (atPlanet ? `<td>${r.planet ?? 0}</td>` : '') +
        `<td>${r.aboard}</td></tr>`,
    )
    .join('');
  return `<table class="fc-troops"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Строка всплывашки: подпись уже локализована, `pct` — знаковые проценты. */
export interface StatPopRow {
  label: string;
  pct: number;
}

export interface StatPopView {
  title: string;
  value: string;
  tone: StatTone;
  /** Правило параметра — статья словаря; ссылки `[[id|слово]]` в нём становятся терминами. */
  desc: string;
  /** Подзаголовок строк — у корпуса и щита это «входящий урон». */
  sub?: string;
  /** База без надбавок, уже отформатированная. */
  base?: string;
  rows: readonly StatPopRow[];
  /** Итог в процентах; `null` — строки итога нет. */
  total: number | null;
  /** Меньше — лучше (входящий урон): цвет строк обратный. */
  lessIsBetter?: boolean;
  /** Параметр без надбавок по природе (линия огня): только правило, без строк. */
  plain?: boolean;
}

function rowTone(pct: number, lessIsBetter: boolean): string {
  if (pct === 0) return '';
  return (pct > 0) !== lessIsBetter ? ' buff' : ' debuff';
}

/** Содержимое всплывашки надбавок. Каркас (`#statpop`) и место на экране — у хозяина. */
export function statPopHtml(v: StatPopView): string {
  const less = v.lessIsBetter ?? false;
  const line = (label: string, value: string, cls = ''): string =>
    `<div class="sp-row${cls}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  let rows = '';
  if (!v.plain) {
    rows += v.sub ? `<div class="sp-sub">${esc(v.sub)}</div>` : '';
    rows += v.base !== undefined ? line(t('stat.pop.base'), v.base) : '';
    if (v.rows.length === 0) rows += `<div class="sp-none">${esc(t('stat.pop.none'))}</div>`;
    for (const r of v.rows) rows += line(r.label, pctText(r.pct), rowTone(r.pct, less));
    if (v.rows.length > 0 && v.total !== null)
      rows += line(t('stat.pop.total'), pctText(v.total), ` total${rowTone(v.total, less)}`);
  }
  return (
    `<div class="sp-head"><b>${esc(v.title)}</b><span class="sp-val${toneClass(v.tone)}">${esc(v.value)}</span></div>` +
    (v.desc ? `<p class="sp-desc">${termTextHtml(v.desc)}</p>` : '') +
    rows
  );
}
