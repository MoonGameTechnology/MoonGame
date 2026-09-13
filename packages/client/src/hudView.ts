/**
 * The in-match HUD renderer (MIG-3) — the half `matchHud.ts` deliberately does not have.
 *
 * `matchHud.ts` projects `GameState` into render-ready DESCRIPTIONS and stops there: it
 * carries stable ids, numbers and enums, never a localised sentence, and it knows nothing
 * about the DOM. That split is why those models could be written long before any screen
 * existed — and also why they sat unrendered: 854 lines of model and 892 lines of test
 * described panels that nothing drew.
 *
 * This file is the missing half and nothing more. It turns a model into HTML and resolves
 * ids into words (`tData` for game data, `t` for interface copy). It holds no state, makes
 * no decisions the model already made, and never reads `GameState` itself — so the rule
 * "what to show" stays in one place and stays testable without a browser, and "how it
 * looks" stays here where a designer can change it without touching a projection.
 *
 * Every function returns a string, which is what keeps this testable at all: the tests
 * assert the markup directly, with no DOM and no renderer harness.
 */
import type { GameData, ShipSlotType } from '@void/shared-core';
import { t, tData } from '../../../localization/core';
import { displayUnit } from '../../../decisions/dataNames';
import type {
  BattleModel,
  BattleSideView,
  FleetSelectionModel,
  SelectionStack,
  StatusBarModel,
} from './matchHud';
import type { LoadoutModel } from './loadoutEditor';

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escape for text AND attribute values (CWE-79) — one copy for the whole client. */
export const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

const MS_PER_HOUR = 3_600_000;

/** `dayTimeMs` → `HH:MM`. The model hands over milliseconds into the day on purpose:
 *  the clock format is a presentation choice, not part of the projection. */
export function clockHM(dayTimeMs: number): string {
  const h = Math.floor(dayTimeMs / MS_PER_HOUR);
  const m = Math.floor((dayTimeMs % MS_PER_HOUR) / 60_000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** A countdown to a server timestamp, floored at zero. Shown as `M:SS` under an hour. */
export function countdown(until: number, now: number): string {
  const left = Math.max(0, until - now);
  const total = Math.floor(left / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Ключи полос — ЛИТЕРАЛАМИ, а не `t(`hud.${kind}`)`: сканер осиротевших переводов
 *  (`prototype/src/i18n.test.ts`) ищет ключи текстом, и собранный из шаблона он не видит
 *  — перевод выглядел бы мёртвым и был бы удалён при следующей чистке локали. */
const BAR_LABEL: Record<'hull' | 'shield', string> = {
  hull: 'hud.hull',
  shield: 'hud.shield',
};

/** A hull/shield bar. Rendered only when the model carried the pool: an absent pool
 *  means the stats could not be derived, and an empty bar would claim zero instead. */
function barHtml(kind: 'hull' | 'shield', pool: { current: number; max: number }): string {
  const pct = pool.max > 0 ? Math.max(0, Math.min(100, (pool.current / pool.max) * 100)) : 0;
  return (
    `<div class="bar ${kind}" role="img" aria-label="${esc(t(BAR_LABEL[kind]))} ${Math.round(pool.current)}/${Math.round(pool.max)}">` +
    `<i style="width:${pct.toFixed(1)}%"></i>` +
    `<span>${Math.round(pool.current)}/${Math.round(pool.max)}</span></div>`
  );
}

function stacksHtml(stacks: SelectionStack[]): string {
  if (stacks.length === 0) return `<p class="dim">${esc(t('hud.no-units'))}</p>`;
  return (
    `<ul class="stacks">` +
    stacks
      .map(
        (s) =>
          `<li${s.domain ? ` class="${esc(s.domain)}"` : ''}>` +
          `<b>${s.count}×</b> ${esc(displayUnit(s.unit))}</li>`,
      )
      .join('') +
    `</ul>`
  );
}

/* ─────────────────────────── Zone A — status bar ─────────────────────────── */

export function statusBarHtml(m: StatusBarModel): string {
  const res = m.resources
    .map(
      (r) =>
        `<span class="res rc-${esc(r.id)}" title="${esc(tData(r.id))}">` +
        `${esc(tData(r.id).slice(0, 1).toUpperCase())}<b>${Math.round(r.amount)}</b></span>`,
    )
    .join('');
  return (
    `<div class="hud-bar${m.defeated ? ' defeated' : ''}">` +
    `<span class="who"><b>${esc(m.commander)}</b><i>${esc(tData(m.faction))}</i></span>` +
    // `day` приходит 0-based (как в браузере матчей и в dayGate) — игроку показываем +1.
    `<span class="clock">${esc(t('hud.day', { d: m.day + 1 }))} · ${clockHM(m.dayTimeMs)}</span>` +
    `<span class="rank">${esc(t('hud.rank', { n: m.rank, of: m.players }))}</span>` +
    `<span class="treasury">${res}</span>` +
    (m.defeated ? `<span class="dead">${esc(t('hud.defeated'))}</span>` : '') +
    `</div>`
  );
}

/* ──────────────────────── Zone D — selection panel ───────────────────────── */

/**
 * Панель выделенного флота.
 *
 * `canBuildHere` — не украшение: свой мир, на котором стоит свой флот, это САМЫЙ частый
 * случай (родная планета), и без этой кнопки верфь на нём недостижима вовсе — тап по
 * такому миру всегда выбирает флот, а второй тап снимает выбор. Найдено браузерным
 * прогоном: проверка «свой мир открывает верфь» получала панель состава.
 */
export function selectionHtml(
  m: FleetSelectionModel,
  now: number,
  opts: { canBuildHere?: boolean } = {},
): string {
  const where =
    m.status === 'transit' && m.transit
      ? t('hud.transit', {
          to: m.transit.destination,
          eta: countdown(m.transit.arrivesAt, now),
        })
      : m.status === 'parked' && m.parked
        ? t('hud.parked', { from: m.parked.from, to: m.parked.to })
        : t('hud.stationed', { at: m.location ?? '—' });
  const commander = m.commander
    ? `<p class="cmdr">${esc(m.commander.name ?? (m.commander.archetype ? tData(m.commander.archetype) : m.ownerName))}` +
      (m.commander.grade ? ` <i>${esc(m.commander.grade)}</i>` : '') +
      `</p>`
    : '';
  return (
    `<div class="hud-panel sel${m.mine ? ' mine' : ''}">` +
    `<h3>${esc(m.id)}${m.inCombat ? ` <i class="combat">${esc(t('hud.in-combat'))}</i>` : ''}</h3>` +
    `<p class="owner">${esc(m.ownerName)} · ${esc(tData(m.ownerFaction))}</p>` +
    `<p class="where">${esc(where)}</p>` +
    commander +
    (m.hull ? barHtml('hull', m.hull) : '') +
    (m.shield ? barHtml('shield', m.shield) : '') +
    stacksHtml(m.ships) +
    (opts.canBuildHere
      ? `<button class="btn tiny" data-act="yard">${esc(t('hud.build-here'))}</button>`
      : '') +
    `</div>`
  );
}

/* ─────────────────────── Combat zone — battle panel ──────────────────────── */

const SIDE_KIND: Record<BattleSideView['kind'], string> = {
  fleet: 'hud.side.fleet',
  landing: 'hud.side.landing',
  beachhead: 'hud.side.beachhead',
  garrison: 'hud.side.garrison',
};

function sideHtml(side: BattleSideView): string {
  return (
    `<div class="side${side.mine ? ' mine' : ''}">` +
    `<p class="owner">${esc(side.ownerName)}<i>${esc(t(SIDE_KIND[side.kind]))}</i></p>` +
    (side.hull ? barHtml('hull', side.hull) : '') +
    (side.shield ? barHtml('shield', side.shield) : '') +
    stacksHtml(side.units) +
    `</div>`
  );
}

export function battleHtml(m: BattleModel, now: number): string {
  const phase = t(m.phase === 'ground' ? 'hud.phase.ground' : 'hud.phase.orbital');
  return (
    `<div class="hud-panel battle">` +
    `<h3>${esc(t('hud.battle.at', { at: m.location }))} · ${esc(phase)}</h3>` +
    `<p class="round">${esc(t('hud.battle.round', { n: m.round }))}` +
    (m.nextRoundAt !== undefined
      ? ` · ${esc(t('hud.battle.next', { in: countdown(m.nextRoundAt, now) }))}`
      : '') +
    `</p>` +
    `<div class="sides">${sideHtml(m.attacker)}${sideHtml(m.defender)}</div>` +
    // Кнопка появляется, только если модель нашла свой орбитальный флот в этом бою:
    // `resolveBattleAction` иначе всё равно откажет (`E_CANNOT_RETREAT`), и показывать
    // заведомо мёртвую кнопку значит обещать игроку действие, которого у него нет.
    (m.retreatFleetId
      ? `<button class="btn danger" data-act="retreat">${esc(t('hud.retreat'))}</button>`
      : '') +
    `</div>`
  );
}

/* ───────────────────────── Shipyard — what to build ──────────────────────────── */

/** The hulls a player may order here. The list is a CONVENIENCE, not a gate: the server
 *  decides what is actually buildable (tech unlocks, cost, the planet's yard), and its
 *  refusal now reaches the player as words. Filtering to the player's own house up front
 *  just keeps the menu short instead of offering obviously foreign hulls. */
export function unitPickerHtml(unitIds: readonly string[], at: string): string {
  if (unitIds.length === 0) return '';
  return (
    `<div class="hud-panel yard">` +
    `<h3>${esc(t('hud.build-here'))} · ${esc(at)}</h3>` +
    `<div class="palette">` +
    unitIds
      .map((id) => `<button class="btn tiny" data-act="pick" data-unit="${esc(id)}">${esc(displayUnit(id))}</button>`)
      .join('') +
    `</div>` +
    `<button class="btn tiny" data-act="close">${esc(t('hud.close'))}</button>` +
    `</div>`
  );
}

/* ────────────────────────── Ship loadout editor ──────────────────────────── */

/** Те же соображения, что у `BAR_LABEL`: ключ слота — литерал, иначе сканер сирот
 *  посчитает три перевода мёртвыми. */
const SLOT_LABEL: Record<ShipSlotType, string> = {
  weapon: 'hud.slot.weapon',
  defense: 'hud.slot.defense',
  utility: 'hud.slot.utility',
};

function bagHtml(bag: Record<string, number>): string {
  const parts = Object.entries(bag).filter(([, n]) => n !== 0);
  if (parts.length === 0) return esc(t('hud.free'));
  return parts
    .map(([r, n]) => `<span class="res rc-${esc(r)}">${esc(tData(r).slice(0, 1).toUpperCase())}${n}</span>`)
    .join(' ');
}

export function loadoutHtml(m: LoadoutModel, data: Pick<GameData, 'units'>): string {
  const hull = data.units[m.unit];
  const slots = m.hasSlots
    ? `<ul class="slots">` +
      m.slots
        .map(
          (s, i) =>
            `<li class="${esc(s.type)}${s.moduleId ? ' filled' : ''}">` +
            `<i>${esc(t(SLOT_LABEL[s.type]))}</i>` +
            (s.moduleId
              ? `<button class="btn tiny" data-act="unequip" data-module="${esc(s.moduleId)}" data-slot="${i}">` +
                `${esc(tData(s.moduleName ?? s.moduleId))} ✕</button>`
              : `<span class="dim">—</span>`) +
            `</li>`,
        )
        .join('') +
      `</ul>`
    : `<p class="dim">${esc(t('hud.no-slots'))}</p>`;

  const palette = m.palette
    .map(
      (o) =>
        `<button class="btn tiny${o.installable ? '' : ' off'}" data-act="equip" data-module="${esc(o.id)}"` +
        (o.installable ? '' : ` disabled title="${esc(o.code ?? '')}"`) +
        `>${esc(tData(o.name))}</button>`,
    )
    .join('');

  const stats = m.preview
    .map(
      (s) =>
        `<li><span>${esc(s.label)}</span><b>${s.effective}</b>` +
        (s.delta !== 0 ? `<i class="${s.delta > 0 ? 'up' : 'down'}">${s.delta > 0 ? '+' : ''}${s.delta}</i>` : '') +
        `</li>`,
    )
    .join('');

  return (
    `<div class="hud-panel loadout">` +
    `<h3>${esc(displayUnit(m.unit))}${hull ? '' : ''}</h3>` +
    slots +
    `<div class="palette">${palette}</div>` +
    `<ul class="stats">${stats}</ul>` +
    `<p class="cost">${esc(t('hud.total'))}: ${bagHtml(m.totalCost)}</p>` +
    `<div class="login">` +
    `<button class="btn tiny" data-act="count" data-delta="-1">−</button>` +
    `<span class="count">${m.count}</span>` +
    `<button class="btn tiny" data-act="count" data-delta="1">+</button>` +
    `<button class="btn primary${m.affordable ? '' : ' off'}" data-act="build"` +
    (m.affordable ? '' : ' disabled') +
    `>${esc(t('hud.build'))}</button>` +
    // Выход обязателен: без него панель — тупик. Неоплатный корпус оставляет «Построить»
    // отключённой, и игроку нечем ни отменить заказ, ни выбрать другой корпус.
    // Найдено браузерным прогоном, который упёрся ровно в это.
    `<button class="btn tiny" data-act="close">${esc(t('hud.close'))}</button>` +
    `</div></div>`
  );
}
