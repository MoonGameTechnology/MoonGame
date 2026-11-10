/**
 * Каркас окна «Производство»: шапка, строка мира, список линий и каталог открытой линии
 * (заказ владельца 2026-11-09 «сначала линии»). Разметка чистая; что в каталоге, решает
 * `shipyard.ts`, какие разделы у линии — `decisions/productionLanes.ts`.
 */
import { holoIcon } from './holographicIcons';
import { t } from '../../localization/runtime';
import { LANE_NAME } from './productionQueueView';
import { LANE_SECTIONS, laneOfSection, type ProductionLane } from '../../decisions/productionSections';
import type { YardTab } from './shipyard';

/** Подвкладки каталога линии; какие из них у какой линии — `LANE_SECTIONS`. */
export const YARD_TABS: [YardTab, string][] = [
  ['buildings', 'production.buildings'],
  ['ships', 'yard.tab.ships'],
  // ROS-SUP-1: корабли не для линии боя — своя вкладка; признак в данных (`support`).
  ['support', 'yard.tab.support'],
  ['squads', 'yard.tab.squads'],
  ['infantry', 'yard.tab.infantry'],
  ['vehicles', 'yard.tab.vehicles'],
  ['heroes', 'yard.tab.heroes'],
];
const YARD_TAB_LABEL = Object.fromEntries(YARD_TABS) as Record<YardTab, string>;

/** Что окно показывает вокруг каталога: открытая линия (`null` — только список линий),
 *  очередь этой линии, строка мира с доходом и приказы мира под списком линий. */
export interface ProductionFrame {
  lane?: ProductionLane | null;
  strip?: string;
  context?: string;
  orders?: string;
}

/** The window chrome: title and close, the world row, the lane list and, once a lane is
 *  picked, its catalog with the lane's sections, its queue, the pane and, under it, the order
 *  bar — outside the scrolling body, so it never leaves the screen. */
export function yardBoxHtml(
  tab: YardTab,
  body: string,
  order = '',
  again = '',
  queue = '',
  templates = '',
  frame: ProductionFrame = {},
): string {
  const lane = frame.lane === undefined ? laneOfSection(tab) : frame.lane;
  const tabBtn = (k: YardTab): string =>
    `<button class="cn-tab${tab === k ? ' on' : ''}" data-ctab="${k}">${t(YARD_TAB_LABEL[k])}</button>`;
  const sections = lane ? LANE_SECTIONS[lane] : [];
  const sub = sections.length > 1 ? `<div class="cn-tabs pw-subtabs">${sections.map(tabBtn).join('')}</div>` : '';
  // ← на телефоне (каталог закрывает список линий), ✕ на ПК (список стоит рядом).
  const back = (cls: string, key: string, mark: string): string =>
    `<button class="${cls}" data-pw-back aria-label="${t(key)}">${mark}</button>`;
  const catalog = lane
    ? `<section class="pw-catalog" data-lane="${lane}"><div class="pw-cat-head">${back('btn-quiet pw-lane-back', 'production.lane.back', '←')}<b>${t(LANE_NAME[lane])}</b>${sub}${back('btn-x pw-cat-close', 'production.lane.hide', '✕')}</div>` +
      `<div class="pw-lane-strip">${frame.strip ?? ''}</div><div id="constructorbody"><div class="pw-content">${body}</div></div></section>`
    : '';
  return (
    `<div class="cnbox${lane ? ' pw-cat-open' : ''}"><div class="cn-head"><b>${holoIcon('hammer')}${t('yard.title')}</b>${again}<button class="cn-close btn-x">✕</button></div>` +
    (frame.context ?? '') +
    templates +
    `<div class="pw-work"><div class="pw-lane-pane"><nav id="cn-queue" class="pw-lane-list">${queue}</nav>${frame.orders ?? ''}</div>${catalog}</div>${order}</div>`
  );
}
