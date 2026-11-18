/**
 * Схема окна боя рядами (заказ владельца 2026-11-17, макет v5): табло, плитки сторон в два
 * ряда, стрелки залпов и плитки приказов внизу.
 *
 * Что показать — решает `decisions/battleScheme.ts` (кто в каком ряду, чьи стрелки видны,
 * что свернуть в «+N», перегруз линии, кому достанется мир). Здесь — только разметка;
 * стрелки по ней рисует `battleArrows.ts`, когда плитки уже легли в окно.
 *
 * 1. **Плитка стороны маленькая и одинаковая** — лик (герой флота или главный род войск),
 *    отсчёт до залпа или щит ответа, имя, полоса корпуса, число юнитов. Всё остальное —
 *    в листе стороны по нажатию (`battleScreen.ts`).
 * 2. **Приказы — плитками внизу и только для выделенного своего флота.** Свой флот один —
 *    он выделен сразу. Своих несколько и ни один не выделен — внизу общие «Атака всеми» и
 *    «Отступить всеми».
 * 3. **Строки табло — только когда им есть что сказать:** осада своего мира, наследник мира
 *    при двух плацдармах, перегруз своей линии, «вы не участвуете» в чужом бою.
 */
import { hasKey, t } from '../../localization/runtime';
import { hullTone, meterShare, powerShares } from '../../decisions/battleBalance';
import {
  LANE_MAX,
  foldLane,
  lineOverload,
  schemeLanes,
  visibleVolleys,
  worldHeir,
  type SchemeSide,
} from '../../decisions/battleScheme';
import type { Hostility } from '../../decisions/battleForecast';
import { OVERCHARGE_HOURS } from '../../packages/shared-core/src/util/overflow';
import type { BattleModel } from '../../packages/client/src/matchHud';
import {
  ownerLabel,
  sideAlive,
  sideColor,
  sideFleetId,
  sideKey,
  sideName,
  sideStacks,
  sideTileName,
  type BattleView,
  type Side,
} from './battleSide';
import { esc } from './format';

export type Lane = 'ours' | 'theirs';

/** Местное состояние схемы: выделение, лист, фильтры стрелок, раскрытые ряды. */
export interface SchemeOptions {
  ended?: boolean;
  /** Выделенная своя сторона; `null` — выбраны «все флоты», `undefined` — по умолчанию. */
  sel?: string | null;
  /** Сторона, чей лист открыт. */
  sheet?: string | null;
  arrows?: 'all' | 'mine';
  /** Рисовать ли ответы (пунктир); по умолчанию — да. */
  replies?: boolean;
  openLanes?: ReadonlySet<Lane>;
  retreats?: readonly string[];
}

export interface SchemeLayout {
  lanes: Record<Lane, { all: Side[]; shown: Side[]; folded: Side[] }>;
  observer: boolean;
  /** Выделенная своя сторона после правила 2, либо `null`. */
  sel: string | null;
  hostile: Hostility;
}

type Seat = SchemeSide & { side: Side };

const seat = (side: Side): Seat => ({
  key: sideKey(side),
  owner: side.owner,
  mine: side.mine,
  ally: side.relation === 'ally',
  attacks: side.role === 'attacker',
  alive: sideAlive(side),
  side,
});

export function schemeLayout(
  m: BattleModel,
  view: BattleView,
  options: SchemeOptions,
): SchemeLayout {
  const hostile: Hostility = view.hostile ?? ((a, b) => a !== b);
  const lanes = schemeLanes(m.sides.map(seat), hostile);
  const lane = (list: Seat[], name: Lane) => {
    const sides = list.map((s) => s.side);
    const { shown, folded } = foldLane(sides, options.openLanes?.has(name) ?? false);
    return { all: sides, shown, folded };
  };
  const mine = options.ended ? [] : m.sides.filter((s) => s.mine && sideAlive(s));
  const wanted = options.sel;
  const sel =
    wanted && mine.some((s) => sideKey(s) === wanted)
      ? wanted
      : wanted !== null && mine.length === 1
        ? sideKey(mine[0]!)
        : null;
  return {
    lanes: { ours: lane(lanes.ours, 'ours'), theirs: lane(lanes.theirs, 'theirs') },
    observer: lanes.observer,
    sel,
    hostile,
  };
}

/** Стрелка схемы: от плитки к плитке; свёрнутая сторона — это плитка «+N» её ряда. */
export interface SchemeArrow {
  from: string;
  to: string;
  fromLane: Lane;
  toLane: Lane;
  /** На сколько целей делится залп (1 — весь в одну). */
  of: number;
  reply: boolean;
  /** Сколько залпов слилось в эту стрелку (в «+N»). */
  n: number;
  color: string;
  mine: boolean;
  ally: boolean;
}

const laneTile = (lane: Lane): string => `lane:${lane}`;

/** Все стрелки, которые игрок вправе видеть, до фильтров. */
export function schemeArrows(
  m: BattleModel,
  view: BattleView,
  options: SchemeOptions,
  layout: SchemeLayout,
): SchemeArrow[] {
  if (options.ended) return [];
  const where = new Map<string, { lane: Lane; tile: string; side: Side }>();
  for (const lane of ['ours', 'theirs'] as const)
    for (const side of layout.lanes[lane].all) {
      const key = sideKey(side);
      const shown = layout.lanes[lane].shown.includes(side);
      where.set(key, { lane, tile: shown ? key : laneTile(lane), side });
    }
  const merged = new Map<string, SchemeArrow>();
  for (const v of visibleVolleys(m.sides.map(seat), layout.hostile)) {
    const a = where.get(v.from);
    const b = where.get(v.to);
    if (!a || !b) continue;
    const id = `${a.tile}>${b.tile}>${v.reply ? 'r' : 'a'}`;
    const prev = merged.get(id);
    if (prev) prev.n += 1;
    else
      merged.set(id, {
        from: a.tile,
        to: b.tile,
        fromLane: a.lane,
        toLane: b.lane,
        of: v.of,
        reply: v.reply,
        n: 1,
        color: sideColor(a.side, view),
        mine: a.side.mine,
        ally: a.side.relation === 'ally',
      });
  }
  return [...merged.values()];
}

/** Стрелки после фильтров «Наши / Мои» и «Ответ». */
export function shownArrows(arrows: readonly SchemeArrow[], options: SchemeOptions): SchemeArrow[] {
  return arrows.filter(
    (a) => (options.replies !== false || !a.reply) && (options.arrows !== 'mine' || a.mine),
  );
}

/** Доля залпа на стрелке: ½, ⅓, ¼, ⅕ или 1/n. */
export function shareLabel(of: number): string {
  return ({ 2: '½', 3: '⅓', 4: '¼', 5: '⅕' } as Record<number, string>)[of] ?? `1/${of}`;
}

/* ── плитки ── */

function tileHtml(side: Side, view: BattleView, options: SchemeOptions, layout: SchemeLayout) {
  const key = sideKey(side);
  const color = sideColor(side, view);
  const alive = sideAlive(side);
  const hull = side.hull;
  const share = hull && hull.max > 0 ? meterShare(hull.current, hull.max) : alive ? 1 : 0;
  const tone = hull ? hullTone(hull.current, hull.max) : 'ok';
  const count = sideStacks(side).reduce((n, u) => n + u.count, 0);
  const name = sideTileName(side, view);
  const role =
    options.ended || !alive
      ? ''
      : side.role === 'attacker'
        ? `<span class="bw-ft-t" title="${esc(t('battle.win.next-attack'))}">⚔<b class="pn-timer" data-at="${side.nextAttackAt ?? ''}">…</b></span>`
        : `<span class="bw-ft-t def" title="${esc(t('battle.win.response'))}">🛡</span>`;
  const fleetId = sideFleetId(side);
  const charge = side.mine && fleetId ? view.charge?.(fleetId) : null;
  const cls = [
    'bw-ft',
    side.mine ? 'me' : '',
    layout.sel === key ? 'pick' : '',
    options.sheet === key ? 'sel' : '',
    alive ? '' : 'dead',
  ]
    .filter(Boolean)
    .join(' ');
  const label = [sideName(side, view), ownerLabel(side, view), side.mine ? t('battle.win.you') : '']
    .filter(Boolean)
    .join(' · ');
  return (
    `<button class="${cls}" data-battle-side="${esc(key)}" data-tile="${esc(key)}" style="--own:${esc(color)}" aria-label="${esc(label)}">` +
    (side.mine ? `<em class="bw-ft-you">${esc(t('battle.win.you'))}</em>` : '') +
    `<span class="bw-ft-top"><span class="bw-ft-ic">${view.icon?.(side, color) ?? ''}</span>${role}</span>` +
    `<b class="bw-ft-name">${esc(name)}</b>` +
    `<span class="bw-ft-bar"><span class="bw-ft-hp tone-${tone}"><i style="width:${Math.round(share * 100)}%"></i></span>` +
    (side.shield && side.shield.current > 0
      ? `<span class="bw-ft-sh" title="${esc(t('battle.win.shield'))}"></span>`
      : '') +
    `<span class="bw-ft-n">${count ? `×${count}` : '—'}</span></span>` +
    (charge
      ? `<span class="bw-ft-charge" title="${esc(t('battle.win.charge', { n: Math.round(charge.damage), m: Math.round(OVERCHARGE_HOURS * 60) }))}">⚡</span>`
      : '') +
    `</button>`
  );
}

function groupHtml(lane: Lane, list: { all: Side[]; folded: Side[] }, view: BattleView) {
  const n = list.folded.length;
  if (n > 0) {
    const owners = [...new Set(list.folded.map((s) => ownerLabel(s, view)))];
    return (
      `<button class="bw-ft grp" data-battle-lane="${lane}" data-tile="${laneTile(lane)}" aria-expanded="false">` +
      `<b>+${n}</b><span>${esc(t('battle.win.more-sides', { n }))}</span>` +
      `<small>${esc(owners.slice(0, 2).join(', '))}${owners.length > 2 ? '…' : ''}</small></button>`
    );
  }
  return list.all.length > LANE_MAX
    ? `<button class="bw-ft grp" data-battle-lane="${lane}" aria-expanded="true"><b>−</b><span>${esc(t('battle.win.fold'))}</span></button>`
    : '';
}

/** Ряды плиток со стрелками поверх (стрелки дорисовывает `battleArrows.ts`). */
export function schemeHtml(
  view: BattleView,
  options: SchemeOptions,
  layout: SchemeLayout,
  quiet: boolean,
): string {
  const head = (lane: Lane): string => {
    const lead = layout.lanes[lane].all[0];
    if (layout.observer && lead) return ownerLabel(lead, view);
    return t(lane === 'ours' ? 'battle.win.allies' : 'battle.win.opponents');
  };
  const row = (lane: Lane): string => {
    const list = layout.lanes[lane];
    if (!list.all.length) return '';
    const tiles =
      list.shown.map((s) => tileHtml(s, view, options, layout)).join('') +
      groupHtml(lane, list, view);
    return `<div class="bw-lane ${lane}">${tiles}</div>`;
  };
  const top = row('theirs');
  const bottom = row('ours');
  return (
    `<div class="bw-scheme${quiet ? ' quiet' : ''}"><svg class="bw-arrows" aria-hidden="true"></svg>` +
    (top ? `<p class="bw-row-h">${esc(head('theirs'))}</p>${top}` : '') +
    (top && bottom ? '<div class="bw-gap"></div>' : '') +
    (bottom ? `${bottom}<p class="bw-row-h">${esc(head('ours'))}</p>` : '') +
    `</div>`
  );
}

const ARROWS_KEY = { all: 'battle.win.arrows.all', mine: 'battle.win.arrows.mine' } as const;

/** Фильтры стрелок: «Наши / Мои», когда есть союзные залпы, и «Ответ», когда есть ответы. */
export function filtersHtml(arrows: readonly SchemeArrow[], options: SchemeOptions): string {
  if (!arrows.length) return '';
  const pick = options.arrows ?? 'all';
  const seg = arrows.some((a) => a.ally)
    ? `<span class="bw-seg" role="group">` +
      (['all', 'mine'] as const)
        .map(
          (k) =>
            `<button class="bw-seg-b${pick === k ? ' on' : ''}" data-battle-arrows="${k}" aria-pressed="${pick === k}">${esc(t(ARROWS_KEY[k]))}</button>`,
        )
        .join('') +
      `</span>`
    : `<span class="bw-flt-note">${esc(t('battle.win.arrows.hidden'))}</span>`;
  const on = options.replies !== false;
  const replies = arrows.some((a) => a.reply)
    ? `<button class="bw-tog${on ? ' on' : ''}" data-battle-replies aria-pressed="${on}">┄ ${esc(t('battle.win.replies'))}</button>`
    : '';
  return `<div class="bw-filters">${seg}${replies}</div>`;
}

/* ── табло ── */

/** Полоса «свои против остальных» по остатку прочности; меньше двух долей — нет полосы. */
function tugHtml(view: BattleView, layout: SchemeLayout): string {
  const sides = [...layout.lanes.ours.all, ...layout.lanes.theirs.all];
  const shares = powerShares(sides);
  if (shares.length < 2) return '';
  const ours = layout.lanes.ours.all.length;
  const us = shares.slice(0, ours).reduce((a, b) => a + b, 0);
  const pct = Math.round(us * 100);
  const seg = (s: Side, i: number): string =>
    `<i${s.mine ? ' class="mine"' : ''} style="flex:${(shares[i] ?? 0).toFixed(4)};background:${esc(sideColor(s, view))}"></i>`;
  const lead = (lane: Lane, key: string): string => {
    const first = layout.lanes[lane].all[0];
    return layout.observer && first ? ownerLabel(first, view) : t(key);
  };
  return (
    `<div class="bw-tugline" title="${esc(t('battle.win.balance'))}"><span>${esc(lead('ours', 'battle.win.us'))} <b>${pct}%</b></span>` +
    `<div class="bw-tug">${sides.slice(0, ours).map(seg).join('')}<span class="mid"></span>` +
    `${sides
      .slice(ours)
      .map((s, i) => seg(s, i + ours))
      .join('')}</div>` +
    `<span><b>${100 - pct}%</b> ${esc(lead('theirs', 'battle.win.them'))}</span></div>`
  );
}

/** Очередь залпов: кто бьёт следующим. Атакующий один — его отсчёт и так на плитке. */
function queueHtml(m: BattleModel, view: BattleView, options: SchemeOptions): string {
  if (options.ended) return '';
  const next = m.sides
    .filter((s) => s.role === 'attacker' && sideAlive(s))
    .sort((a, b) => (a.nextAttackAt ?? Infinity) - (b.nextAttackAt ?? Infinity));
  if (next.length < 2) return '';
  return (
    `<div class="bw-queue" aria-label="${esc(t('battle.win.queue'))}">` +
    next
      .map(
        (s, i) =>
          `<span class="bw-q${i === 0 ? ' next' : ''}"><i style="background:${esc(sideColor(s, view))}"></i>${esc(sideTileName(s, view))}` +
          `<b class="pn-timer" data-at="${s.nextAttackAt ?? ''}">…</b></span>`,
      )
      .join('') +
    `</div>`
  );
}

/** Строки табло (правило 3). */
function notesHtml(
  m: BattleModel,
  view: BattleView,
  options: SchemeOptions,
  layout: SchemeLayout,
): string {
  if (options.ended) return '';
  let html = '';
  const siege = view.siege?.(m.location);
  const key = siege?.archetype ? `boss.${siege.archetype}.siege` : '';
  if (siege && key && hasKey(key)) {
    const SLOT = '\u0001';
    const [head = '', tail = ''] = t(key, {
      world: view.placeName?.(m.location) ?? m.location,
      in: SLOT,
    }).split(SLOT);
    html += `<p class="bw-alert">${esc(head)}<b class="pn-timer" data-at="${siege.until}">…</b>${esc(tail)}</p>`;
  }
  const beach = m.sides.filter((s) => s.kind === 'beachhead');
  if (beach.length >= 2) {
    const order =
      view.landingOrder?.(m.location) ??
      beach.map((s) => s.owner).filter((o): o is string => o !== null);
    const heir = worldHeir(
      order.map((owner) => ({
        owner,
        alive: beach.some((s) => s.owner === owner && sideAlive(s)),
      })),
    );
    if (heir)
      html += `<p class="bw-note">${esc(t('battle.win.heir', { name: view.ownerName?.(heir) ?? heir }))}</p>`;
  }
  if (!layout.observer) {
    const units = m.sides.filter((s) => s.mine && sideAlive(s)).flatMap((s) => sideStacks(s));
    const over = lineOverload(units, view.isGround ?? (() => false));
    if (over)
      html += `<p class="bw-note warn">${esc(t('battle.win.overload', { n: over.count, cap: over.cap, pct: over.pct }))}</p>`;
  } else html += `<p class="bw-note">${esc(t('battle.win.watch'))}</p>`;
  return html;
}

/** Табло: полоса сил, прогноз, очередь залпов и строки, которым есть что сказать. */
export function boardHtml(
  m: BattleModel,
  view: BattleView,
  options: SchemeOptions,
  layout: SchemeLayout,
  forecast: string,
): string {
  return (
    `<section class="bw-board">${tugHtml(view, layout)}${forecast}${queueHtml(m, view, options)}` +
    `${notesHtml(m, view, options, layout)}</section>`
  );
}

/* ── приказы ── */

const order = (cls: string, attr: string, icon: string, label: string, off = false): string =>
  `<button class="b bw-ot ${cls}" ${attr}${off ? ' disabled' : ''}><i aria-hidden="true">${icon}</i><span>${esc(label)}</span></button>`;

/** Плитки приказов внизу (правило 2). В чужом и в кончившемся бою — ничего. */
export function ordersHtml(
  m: BattleModel,
  view: BattleView,
  options: SchemeOptions,
  layout: SchemeLayout,
): string {
  if (options.ended || layout.observer) return '';
  const mine = m.sides.filter((s) => s.mine && sideAlive(s));
  if (!mine.length) return '';
  const retreats = options.retreats ?? [];
  const sel = mine.find((s) => sideKey(s) === layout.sel);
  if (!sel) {
    const canAttack = mine.some((s) => s.role === 'defender');
    return (
      `<div class="bw-orders"><div class="bw-ots">` +
      order(
        'bw-attack btn-main',
        'data-battle-attack-all',
        '⚔',
        t('battle.win.attack-all'),
        !canAttack,
      ) +
      order(
        'btn-second',
        'data-battle-retreat-all',
        '⤺',
        t('battle.win.retreat-all'),
        !retreats.length,
      ) +
      `</div><p class="bw-status">${esc(t('battle.win.pick-own'))}</p></div>`
    );
  }
  const key = sideKey(sel);
  const fleetId = sideFleetId(sel);
  const foes = m.sides.filter(
    (s) => s !== sel && sideAlive(s) && layout.hostile(sel.owner, s.owner),
  ).length;
  const tiles: string[] = [];
  const notes: string[] = [];
  if (sel.role === 'defender') {
    tiles.push(
      order('bw-attack btn-main', `data-battle-attack="${esc(key)}"`, '⚔', t('battle.win.attack')),
    );
    notes.push(t('battle.win.response'));
  } else if (foes > 1) notes.push(t('battle.win.split', { n: foes }));
  else if (foes === 1) notes.push(t('battle.win.one-target'));
  if (sel.kind === 'fleet' && fleetId)
    tiles.push(
      order(
        'btn-second',
        `data-battle-retreat="${esc(fleetId)}"`,
        '⤺',
        t('battle.win.retreat'),
        !retreats.includes(fleetId),
      ),
    );
  // Наземным «не отступают» уже сказано строкой правил прямо над приказами.
  tiles.push(order('btn-second', `data-battle-info="${esc(key)}"`, 'ℹ', t('battle.win.info')));
  if (mine.length > 1)
    tiles.push(order('btn-quiet', 'data-battle-unselect', '◎', t('battle.win.all-fleets')));
  const auto = fleetId && sel.kind === 'fleet' ? view.autoRetreatAt?.(fleetId) : undefined;
  if (auto !== undefined)
    notes.push(
      auto === null
        ? t('battle.win.auto.off')
        : t('battle.win.auto.on', { n: Math.round(auto * 100) }),
    );
  return (
    `<div class="bw-orders"><div class="bw-ots">${tiles.join('')}</div>` +
    `<p class="bw-status"><b>${esc(sideName(sel, view))}</b> · ${esc(notes.join(' · '))}</p></div>`
  );
}
