/**
 * In-match HUD view-models — zones **A (status bar)** and **D (selection panel)**
 * of the mobile HUD (docs/hud-inmatch.md, adapted from the Iron Order reference).
 * Like `welcomeScreen.ts`, this is the **framework-agnostic view-model**: pure
 * factories that project the fog-stripped `GameState` a client holds
 * (`MultiplayerSnapshot.state`) into render-ready descriptions. The renderer draws
 * them and localises ids (resource ids, unit ids, faction id, the status enum) —
 * the model carries stable ids/numbers/enums, never localised sentences.
 *
 * Invariants (mirror the core's discipline): pure + deterministic (no Date/random),
 * outputs are JSON-serialisable, and the projections are **fail-secure** — a viewer
 * or selection that is not present yields `{ ok: false, code }` with a stable code
 * only, never a thrown detail.
 *
 * Grounded strictly in real state — every field traces to a `GameState`/`GameData`
 * field. Elements of the mockup with **no backing data yet** are deliberately
 * omitted rather than faked: a fleet has no display name (labelled by id/owner),
 * `faction` is a content id (not a corp/clan tag), and the commanding `Hero` has a
 * `grade` tier but no numeric level. The **shield** bar is now real (shields-roadmap
 * SH-0.1/0.2 — `shieldHp` pool); a derived power rating / damage-reduction still
 * don't exist in the core (docs/hud-inmatch.md HUD-2 ⏳) and land once they ship.
 */
import {
  attackerOf,
  defenderOf,
  effectiveStats,
  isInhabited,
  MAX_STEWARD_HOLD_POINTS,
  MS_PER_DAY,
  previewBattle,
  previewLossCount,
  stewardUnlocked,
} from '@void/shared-core';
import type {
  BattleId,
  BattlePreviewSide,
  CombatantRef,
  Fleet,
  FleetId,
  GameData,
  GameState,
  PlanetId,
  PlayerId,
  ResourceId,
  UnitStack,
} from '@void/shared-core';
import { assaultSteps } from '../../../decisions/assaultOrder';
import { capitalOffer, holdOffer, type CapitalOffer, type HoldOffer } from '../../../decisions/worldOrders';
import { mergePlan } from '../../../decisions/mergeOrders';
import {
  canConfirmSplit,
  cargoSplit,
  normalizeSlotTake,
  shipTotals,
  splitSlots,
  stepTake,
  type CargoSplit,
  type SplitSlot,
} from '../../../decisions/splitPlan';

/* ─────────────────────────── Zone A — status bar ─────────────────────────── */

/** One treasury entry for the status bar (`id` resolves against game data; the
 *  renderer localises it to an icon/label). */
export interface StatusResource {
  id: ResourceId;
  amount: number;
}

/** Render-ready description of the top status bar for the viewing commander. */
export interface StatusBarModel {
  /** `player.name` — the commander callsign. */
  commander: string;
  /** `player.faction` — a content faction id (NOT a corporation/clan tag; the
   *  runtime has no such tag). The renderer resolves it to a display name. */
  faction: string;
  /** 1-based placement among all players by `match.scores[*].total` (ties broken
   *  by id for determinism). Early, before any score is computed, everyone ties on
   *  0 and placement falls back to id order. */
  rank: number;
  /** How many commanders are in the match — the denominator for "N-е из M". */
  players: number;
  /** Whole in-match days elapsed: `floor((time − startedAt) / MS_PER_DAY)`, 0-based
   *  and startedAt-anchored — identical to the match browser (`matchRegistry`) and
   *  the technology `dayGate`. A renderer wanting a 1-based label shows `day + 1`. */
  day: number;
  /** Milliseconds into the current day, in `[0, MS_PER_DAY)` — the renderer formats
   *  it as `HH:MM`. */
  dayTimeMs: number;
  /** Treasury, ordered by the game-data resource order when `data` is supplied
   *  (missing keys shown as 0), else by the bag's own key order. */
  resources: StatusResource[];
  /** `player.status === 'defeated'`. */
  defeated: boolean;
}

/** Status-bar projection outcome: the model, or a stable error code. */
export type StatusBarResult = ({ ok: true } & StatusBarModel) | { ok: false; code: string };

/** Project the status bar for `viewerId` from their view of `state`. Fail-secure:
 *  a viewer absent from `state.players` yields `E_NO_PLAYER`. `data` is optional —
 *  it only fixes the canonical resource order (graceful degradation without it). */
export function createStatusBarModel(
  state: GameState,
  viewerId: PlayerId,
  data?: Pick<GameData, 'resources'>,
): StatusBarResult {
  const player = state.players[viewerId];
  if (!player) {
    return { ok: false, code: 'E_NO_PLAYER' };
  }

  // Placement: rank every player by score total, ties by id (deterministic).
  const ids = Object.keys(state.players);
  const ranked = ids
    .map((id) => ({ id, total: state.match.scores[id]?.total ?? 0 }))
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rank = ranked.findIndex((r) => r.id === viewerId) + 1;

  // World clock, anchored on startedAt (the authoritative convention). Elapsed is
  // clamped at 0 so `day` and `dayTimeMs` stay coherent (reconstruct the same
  // instant) even under a backward clock skew where startedAt briefly exceeds time.
  const elapsed = Math.max(0, state.time - (state.startedAt ?? 0));
  const day = Math.floor(elapsed / MS_PER_DAY);
  const dayTimeMs = elapsed % MS_PER_DAY;

  // Treasury in canonical order (data-driven) with missing resources shown as 0,
  // then any extra bag keys not in the canonical list (defensive).
  const bag = player.resources;
  const resources: StatusResource[] = [];
  const seen = new Set<string>();
  for (const id of data?.resources ?? Object.keys(bag)) {
    resources.push({ id, amount: bag[id] ?? 0 });
    seen.add(id);
  }
  for (const id of Object.keys(bag)) {
    const amount = bag[id];
    if (!seen.has(id) && amount !== undefined) resources.push({ id, amount });
  }

  return {
    ok: true,
    commander: player.name,
    faction: player.faction,
    rank,
    players: ids.length,
    day,
    dayTimeMs,
    resources,
    defeated: player.status === 'defeated',
  };
}

/* ──────────────────────── Zone D — selection panel ───────────────────────── */

/** One unit stack in a fleet's composition. `domain` is filled from game data when
 *  supplied (space crew vs ground army). */
export interface SelectionStack {
  unit: string;
  count: number;
  domain?: 'space' | 'ground';
}

/** The hero commanding the selected fleet. Own fleets only — enemy heroes are
 *  fogged out of the viewer's `state.heroes`. `grade` is the rarity tier the core
 *  carries; there is no numeric commander level. */
export interface SelectionCommander {
  /** SEAT identity when the hero carries one (a main hero: the player's callsign,
   *  or the house id of a solo seat — the renderer localises a house by key and
   *  leaves a callsign alone). Absent for a roster hero: its NAME comes from
   *  `archetype`, because human-readable text is never stored in the state
   *  (AUD-13). Falls back to the owner's callsign only when neither is known. */
  name?: string;
  /** Archetype id (`data.heroes`) — the renderer resolves it into the hero's
   *  name (`tData(data.heroes[archetype].name)`). */
  archetype?: string;
  grade?: string;
}

/** Where the fleet is / is heading. Exactly one of these is set, matching `status`. */
export interface SelectionTransit {
  from: string;
  to: string;
  destination: string;
  /** Server-authoritative timestamps (ms) — the renderer counts down to `arrivesAt`. */
  departedAt: number;
  arrivesAt: number;
}
export interface SelectionParked {
  from: string;
  to: string;
  /** Fraction along the lane, in (0,1). */
  t: number;
}

/** Render-ready description of a selected fleet. */
export interface FleetSelectionModel {
  kind: 'fleet';
  id: FleetId;
  owner: PlayerId;
  /** `player.name` of the owner (kept through fog even for an identified enemy). */
  ownerName: string;
  /** Owner's `faction` content id. */
  ownerFaction: string;
  /** `owner === viewerId`. */
  mine: boolean;
  /** `transit` (moving), `parked` (stopped mid-lane), or `stationed` (at a node/orbit). */
  status: 'transit' | 'parked' | 'stationed';
  /** Set when `stationed` — the node the fleet occupies. */
  location?: string;
  /** Set when `transit`. */
  transit?: SelectionTransit;
  /** Set when `parked`. */
  parked?: SelectionParked;
  /** Ship stacks crewing the fleet (`fleet.units`). */
  ships: SelectionStack[];
  /** The commanding hero, when one is attached and visible. */
  commander?: SelectionCommander;
  /** Aggregate hull HP `{ current, max }`, derived as `Σ count × def.stats.hp`
   *  (`current` uses the per-stack combat pool when present, else full). Omitted
   *  when `data` is not supplied — max HP cannot be derived without unit defs. */
  hull?: { current: number; max: number };
  /** Aggregate ablative shield `{ current, max }`, derived as `Σ count × def.stats.shield`
   *  (`current` uses the per-stack `shieldHp` pool when present, else full). Omitted
   *  when `data` is absent OR the fleet has no shield capacity (max 0) — a shieldless
   *  fleet shows one HP bar, not an empty second one. */
  shield?: { current: number; max: number };
  /** Engaged in an active battle (`fleet.battleId` set). */
  inCombat: boolean;
  /** Holding the single near orbit of the world below (`fleet.orbit`, GDD §7.4).
   *  Arrival sets it by itself, so this is normally true for a stationed fleet —
   *  the panel reads it to know whether an assault needs the orbit step paired in
   *  front of it (`decisions/assaultOrder.ts`). */
  orbit?: 'near';
  /** Shelling the world below right now. The panel needs the CURRENT value because
   *  the order is a toggle (`fleet.bombard { on }`): a button that always sent `true`
   *  could never stop the shelling. */
  bombarding?: boolean;
  /** Marching at +50% speed for hull wear (`state.forcedMarch`). Own fleets only —
   *  the fog pass already strips other players' entries, and this keeps that true even
   *  when the model is handed an unfogged state (same defence in depth as the hero). */
  forcedMarch?: boolean;
}

/** Selection projection outcome: the fleet model, or a stable error code. */
export type SelectionResult = ({ ok: true } & FleetSelectionModel) | { ok: false; code: string };

function toStacks(stacks: UnitStack[], data?: Pick<GameData, 'units'>): SelectionStack[] {
  return stacks.map((s) => {
    const out: SelectionStack = { unit: s.unit, count: s.count };
    const domain = data?.units[s.unit]?.domain;
    if (domain) out.domain = domain;
    return out;
  });
}

/** Aggregate a whole-stack pool (hull or shield) over the stacks: max = Σ count ×
 *  per-ship stat; current reads the stack's pool field, absent = full. The one
 *  loop both mirrored aggregators share. */
function poolOf(
  stacks: UnitStack[],
  data: Pick<GameData, 'units'>,
  stat: 'hp' | 'shield',
  pool: 'hp' | 'shieldHp',
): { current: number; max: number } {
  let current = 0;
  let max = 0;
  for (const s of stacks) {
    const perShip = data.units[s.unit]?.stats[stat] ?? 0;
    const stackMax = s.count * perShip;
    max += stackMax;
    current += s[pool] ?? stackMax;
  }
  return { current, max };
}

function hullOf(stacks: UnitStack[], data: Pick<GameData, 'units'>): { current: number; max: number } {
  return poolOf(stacks, data, 'hp', 'hp');
}

/** Aggregate ablative shield, or undefined when the stacks have no shield capacity. */
function shieldOf(
  stacks: UnitStack[],
  data: Pick<GameData, 'units'>,
): { current: number; max: number } | undefined {
  const shield = poolOf(stacks, data, 'shield', 'shieldHp');
  return shield.max > 0 ? shield : undefined;
}

/** The living hero commanding `fleet`, if any. Self-securing: only the viewer's own
 *  heroes resolve, so an enemy commander never leaks even if this is handed a
 *  non-fogged state (defence in depth — the fog pass already strips enemy heroes). */
function fleetCommander(
  state: GameState,
  fleet: Fleet,
  viewerId: PlayerId,
): SelectionCommander | undefined {
  if (!state.heroes) return undefined;
  for (const hero of Object.values(state.heroes)) {
    if (hero.fleetId !== fleet.id || hero.owner !== viewerId || hero.alive === false) continue;
    const out: SelectionCommander = {};
    if (hero.name !== undefined) out.name = hero.name;
    else if (hero.archetype === undefined) {
      out.name = state.players[fleet.owner]?.name ?? fleet.owner; // nothing else to draw
    }
    if (hero.archetype !== undefined) out.archetype = hero.archetype;
    if (hero.grade) out.grade = hero.grade;
    return out;
  }
  return undefined;
}

/** Project the selection panel for the fleet `fleetId`, as seen by `viewerId`.
 *  Fail-secure: a fleet absent from `state.fleets` (gone, or fogged to a radar-only
 *  signature) yields `E_NO_SELECTION`. `data` is optional — without it `hull` and
 *  stack `domain` are omitted (graceful degradation). */
export function createSelectionModel(
  state: GameState,
  fleetId: FleetId,
  viewerId: PlayerId,
  data?: Pick<GameData, 'units'>,
): SelectionResult {
  const fleet = state.fleets[fleetId];
  if (!fleet) {
    return { ok: false, code: 'E_NO_SELECTION' };
  }

  const owner = state.players[fleet.owner];
  const model: FleetSelectionModel = {
    kind: 'fleet',
    id: fleet.id,
    owner: fleet.owner,
    ownerName: owner?.name ?? fleet.owner,
    ownerFaction: owner?.faction ?? '',
    mine: fleet.owner === viewerId,
    status: fleet.movement ? 'transit' : fleet.edge ? 'parked' : 'stationed',
    ships: toStacks(fleet.units, data),
    inCombat: fleet.battleId != null,
  };

  if (fleet.movement) {
    const mv = fleet.movement;
    model.transit = {
      from: mv.from,
      to: mv.to,
      destination: mv.destination ?? mv.to,
      departedAt: mv.departedAt,
      arrivesAt: mv.arrivesAt,
    };
  } else if (fleet.edge) {
    model.parked = { from: fleet.edge.from, to: fleet.edge.to, t: fleet.edge.t };
  } else if (fleet.location) {
    model.location = fleet.location;
  }

  if (fleet.orbit === 'near') model.orbit = 'near';
  if (fleet.bombarding) model.bombarding = true;
  if (model.mine && state.forcedMarch?.[fleet.id]) model.forcedMarch = true;

  const commander = fleetCommander(state, fleet, viewerId);
  if (commander) model.commander = commander;
  if (data) {
    model.hull = hullOf(fleet.units, data);
    const shield = shieldOf(fleet.units, data);
    if (shield) model.shield = shield;
  }

  return { ok: true, ...model };
}

/* ──────────────────── Fleet panel — the orders it can issue ───────────────── */

/** What the fleet panel's buttons ask for. */
export type FleetAction =
  | { kind: 'stop' }
  | { kind: 'forcemarch'; on: boolean }
  | { kind: 'bombard'; on: boolean }
  | { kind: 'assault' };

/** One order as it goes on the wire — the caller hands `type`/`payload` to the shared
 *  builder, it does not assemble an envelope itself. A LIST because one request is not
 *  always one order: an assault from outside orbit is a pair (`decisions/assaultOrder.ts`). */
export interface FleetStep {
  type: string;
  payload: Record<string, unknown>;
}

/** Orders to issue, or a stable reject code (fail-secure). */
export type FleetIntent = { ok: true; steps: FleetStep[] } | { ok: false; code: string };

/**
 * Map a fleet-panel button to the order(s) it issues.
 *
 * The codes here are the CORE's own, not invented: someone else's fleet answers
 * `E_NO_FLEET` (the same opaque code the core gives, so a client cannot probe ids for
 * fog-hidden fleets), a fleet that is moving or fighting answers `E_FLEET_BUSY`
 * (`requireOwnedIdleFleet`), and bombardment from outside orbit answers
 * `E_WRONG_ORBIT`. Refusing here is not a substitute for the server — it saves the
 * player a wasted tap and says why.
 *
 * What is deliberately NOT checked: whether the assault itself is possible (landing
 * troops aboard, the world hostile and capturable, no other assault running). That
 * answer belongs to the core and only to the core — `decisions/assaultOrder.ts` rule 1:
 * a hand-written copy of those conditions falls behind on the first new rule, and falls
 * behind SILENTLY, leaving the player a button that does nothing.
 */
export function resolveFleetAction(action: FleetAction, model: FleetSelectionModel): FleetIntent {
  if (!model.mine) return { ok: false, code: 'E_NO_FLEET' };
  const fleetId = model.id;

  if (action.kind === 'forcemarch') {
    // The one order that does NOT need an idle fleet — and must not, since its whole
    // point is speed IN TRANSIT (`forcedMarch.ts` checks ownership only).
    return { ok: true, steps: [{ type: 'fleet.forcemarch', payload: { fleetId, on: action.on } }] };
  }

  if (action.kind === 'stop') {
    // Nothing to halt unless it is actually under way; a battle pins it in place.
    if (model.status !== 'transit' || model.inCombat) return { ok: false, code: 'E_FLEET_BUSY' };
    return { ok: true, steps: [{ type: 'fleet.stop', payload: { fleetId } }] };
  }

  // Both remaining orders act on the world below, so the fleet must be sitting at one.
  if (model.status !== 'stationed' || model.inCombat) return { ok: false, code: 'E_FLEET_BUSY' };

  if (action.kind === 'bombard') {
    // Only STARTING needs the orbit; stopping is always allowed, so a fleet that somehow
    // ended up shelling from nowhere can still be told to stop.
    if (action.on && model.orbit !== 'near') return { ok: false, code: 'E_WRONG_ORBIT' };
    return { ok: true, steps: [{ type: 'fleet.bombard', payload: { fleetId, on: action.on } }] };
  }

  return {
    ok: true,
    steps: assaultSteps(model.orbit).map((step) =>
      step === 'orbit-near'
        ? { type: 'fleet.orbit', payload: { fleetId, orbit: 'near' } }
        : { type: 'fleet.assault', payload: { fleetId } },
    ),
  };
}

/* ───────────────── Fleet panel — split and merge (MIG-9) ─────────────────── */

/** Свои ДРУГИЕ флоты, стоящие там же, — кандидаты в слияние. */
export interface MergeCandidate {
  id: FleetId;
  ships: number;
}

/**
 * Кого можно слить в выделенный флот прямо сейчас.
 *
 * Только СТОЯЩИЕ вместе: слить разнесённые флоты ядро тоже умеет, но это отложенное
 * намерение («лети к якорю и слейся по прибытии»), а его нечем показать в панели —
 * игрок не увидит ни полёта, ни момента слияния. Панель предлагает лишь то, что
 * случится сразу; `decisions/mergeOrders.ts` знает обе ветки и решает, какая тут.
 */
export function mergeCandidates(
  state: GameState,
  fleetId: FleetId,
  viewerId: PlayerId,
): MergeCandidate[] {
  const anchor = state.fleets[fleetId];
  if (!anchor || anchor.owner !== viewerId || !anchor.location || anchor.movement) return [];
  const out: MergeCandidate[] = [];
  for (const id of Object.keys(state.fleets).sort()) {
    const f = state.fleets[id];
    if (!f || id === fleetId || f.owner !== viewerId) continue;
    if (f.location !== anchor.location || f.movement || f.battleId) continue;
    out.push({ id, ships: f.units.reduce((n, st) => n + st.count, 0) });
  }
  return out;
}

/** Слить `moverId` в выделенный флот — или стабильный код отказа (fail-secure). */
export function resolveMerge(
  state: GameState,
  anchorId: FleetId,
  moverId: FleetId,
  viewerId: PlayerId,
): FleetIntent {
  // План строит общее решение: оно одно знает, что якорь обязан быть своим и живым,
  // что сам в себя флот не сливается и что разнесённые флоты дают ДРУГУЮ ветку.
  const plan = mergePlan(
    Object.fromEntries(
      Object.entries(state.fleets).map(([id, f]) => [
        id,
        f && { owner: f.owner, location: f.location, movingTo: f.movement?.destination ?? null },
      ]),
    ),
    [moverId],
    anchorId,
    viewerId,
  );
  if (!plan) return { ok: false, code: 'E_NO_FLEET' };
  const step = plan.steps[0];
  // Панель предлагает слияние только стоящим вместе, поэтому ветка «лететь к якорю»
  // сюда доходить не должна: если дошла — состояние изменилось между отрисовкой и
  // нажатием, и честнее отказать, чем отправить флот в полёт, которого игрок не просил.
  if (!step || step.kind !== 'now') return { ok: false, code: 'E_FLEET_BUSY' };
  return {
    ok: true,
    steps: [{ type: 'fleet.merge', payload: { from: step.mover, into: anchorId } }],
  };
}

/** Строка окна деления: стек флота и сколько из него уводят. */
export interface SplitRow extends SplitSlot {
  take: number;
}

/** Окно «Разделить флот» — живёт поверх ЖИВОГО флота, поэтому пересчитывается целиком. */
export interface SplitModel {
  kind: 'split';
  fleetId: FleetId;
  rows: SplitRow[];
  /** Итоги по КОРАБЛЯМ: правила «не ноль и не всё» касаются только их. */
  takeTotal: number;
  total: number;
  cargo: CargoSplit;
  /** Можно ли подтверждать (корабли делятся честно И десант влезает в обе половины). */
  canConfirm: boolean;
}

export type SplitResult = ({ ok: true } & SplitModel) | { ok: false; code: string };

/**
 * Пересчитать окно деления под текущий флот и текущий отбор.
 *
 * Пересчёт ПОЛНЫЙ на каждый шаг счётчика, а не накопление: окно живёт поверх живого
 * флота, и пока игрок жмёт «+10», состав может измениться боем или стыковкой. Вчерашний
 * отбор обязан ужаться (`normalizeSlotTake`), а не уехать в отказ на сервере.
 */
export function createSplitModel(
  state: GameState,
  fleetId: FleetId,
  viewerId: PlayerId,
  take: Readonly<Record<string, number>>,
  data: GameData,
): SplitResult {
  const fleet = state.fleets[fleetId];
  if (!fleet || fleet.owner !== viewerId) return { ok: false, code: 'E_NO_FLEET' };
  if (fleet.movement || fleet.battleId) return { ok: false, code: 'E_FLEET_BUSY' };

  const slots = splitSlots(fleet.units, fleet.landing ?? []);
  const normalized = normalizeSlotTake(take, slots);
  const cargo = cargoSplit(
    slots,
    normalized,
    // Вместимость считается С НАЧИНКОЙ: грузовой модуль — ровно та причина, по которой
    // два стека одного корпуса везут разное.
    (unit, modules) => {
      const def = data.units[unit];
      if (!def) return 0;
      return (
        effectiveStats(def, { ...(modules ? { modules: [...modules] } : {}) }, data).cargoCapacity ??
        0
      );
    },
    (unit) => data.units[unit]?.stats.cargoSize ?? 1,
  );
  const { takeTotal, total } = shipTotals(slots, normalized);
  return {
    ok: true,
    kind: 'split',
    fleetId,
    rows: slots.map((slot) => ({ ...slot, take: normalized[slot.key] ?? 0 })),
    takeTotal,
    total,
    cargo,
    canConfirm: canConfirmSplit(slots, normalized, cargo),
  };
}

/** Шаг счётчика в окне деления — арифметику держит `decisions/splitPlan.ts`. */
export function stepSplitTake(
  model: SplitModel,
  key: string,
  step: 'inc' | 'dec' | 'all',
  n = 1,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of model.rows) {
    out[row.key] = row.key === key ? stepTake(row.take, row.have, step, n) : row.take;
  }
  return out;
}

/** Подтверждение деления → `fleet.split`, или стабильный код отказа. */
export function resolveSplit(model: SplitModel): FleetIntent {
  if (!model.canConfirm) {
    // Две разные причины, и игроку они говорят разное: «ноль или всё» — поправь отбор,
    // «трюм не сойдётся» — десант некуда девать.
    return { ok: false, code: model.cargo.fits ? 'E_BAD_SPLIT' : 'E_NO_CAPACITY' };
  }
  const take: { unit: string; modules?: string[]; count: number }[] = [];
  const takeLanding: { unit: string; count: number }[] = [];
  for (const row of model.rows) {
    if (row.take <= 0) continue;
    if (row.kind === 'ship') {
      // `modules` адресует КОНКРЕТНЫЙ стек (FSPLIT-1): без поля ядро возьмёт любой,
      // и «два крейсера» разъедутся с тем, что игрок отметил на экране.
      take.push({ unit: row.unit, count: row.take, ...(row.modules ? { modules: [...row.modules] } : {}) });
    } else {
      takeLanding.push({ unit: row.unit, count: row.take });
    }
  }
  return {
    ok: true,
    steps: [
      {
        type: 'fleet.split',
        payload: {
          fleetId: model.fleetId,
          take,
          ...(takeLanding.length > 0 ? { takeLanding } : {}),
        },
      },
    ],
  };
}

/* ─────────────────────── World zone — the planet panel ───────────────────── */

/** One structure of the world, as the panel lists it. */
export interface WorldBuildingView {
  type: string;
  level: number;
}

/** Render-ready description of a tapped world. */
export interface WorldModel {
  kind: 'world';
  id: PlanetId;
  /** Owner, or null for a neutral world — AND for one the viewer has never seen:
   *  the fog pass blanks an unidentified world to `owner: null` with nothing on it,
   *  so those two read the same here. `remembered` is what separates a memory from
   *  a live look; «never seen» stays deliberately indistinguishable from «nobody's». */
  owner: PlayerId | null;
  ownerName?: string;
  ownerFaction?: string;
  mine: boolean;
  /** Content ids; the renderer resolves them into words. */
  planetType?: string;
  sectorKind?: string;
  garrison: SelectionStack[];
  buildings: WorldBuildingView[];
  /** Shown from FOG MEMORY (the view's `remembered` list) — the garrison and the
   *  structures are a stale snapshot, not what is there now. The panel must say so:
   *  drawing a remembered world as a live one lies about a garrison the player never
   *  saw (`panelSelect.ts`, rule 3). */
  remembered: boolean;
  /** What the panel may offer about the capital / the Steward's hold point —
   *  decided by `decisions/worldOrders.ts`, shared with the prototype. */
  capital: CapitalOffer;
  hold: HoldOffer;
}

export type WorldResult = ({ ok: true } & WorldModel) | { ok: false; code: string };

/** Project the world panel for `planetId` as `viewerId` sees it. `remembered` is the
 *  view's own list of memory-shown worlds (it rides beside the state, not inside it).
 *
 *  `data` is optional and degrades like the selection model: without it the stacks lose
 *  their `domain`, and BOTH offers fall back to "nothing to offer" — «обитаем ли мир» и
 *  «открыт ли Хранитель» это вопросы к данным, и угадывать ответ панель не вправе.
 *  Fail-secure: a planet absent from the snapshot yields `E_NO_PLANET`. */
export function createWorldModel(
  state: GameState,
  planetId: PlanetId,
  viewerId: PlayerId,
  data?: GameData,
  remembered?: readonly string[],
): WorldResult {
  const planet = state.planets[planetId];
  if (!planet) return { ok: false, code: 'E_NO_PLANET' };

  const owner = planet.owner;
  const mine = owner === viewerId;
  const player = state.players[viewerId];
  const points = player?.stewardHoldPoints ?? [];
  const model: WorldModel = {
    kind: 'world',
    id: planet.id,
    owner,
    mine,
    garrison: toStacks(planet.garrison, data),
    buildings: planet.buildings.map((b) => ({ type: b.type, level: b.level })),
    remembered: remembered?.includes(planet.id) ?? false,
    // Оба предложения считает общее решение — второй формулировки условий здесь нет.
    // «Обитаемость» и техгейт Хранителя спрашиваются у ЯДРА (`isInhabited`,
    // `stewardUnlocked`), а не переписываются: обе зависят от игровых ДАННЫХ и молча
    // разъехались бы на первом новом типе мира или новой технологии.
    capital: capitalOffer(
      mine,
      state.capital?.[viewerId] === planet.id,
      !!data && isInhabited(data, planet),
    ),
    hold: holdOffer(
      mine,
      !!player && !!data && stewardUnlocked(player, data),
      points.includes(planet.id),
      points.length,
      MAX_STEWARD_HOLD_POINTS,
    ),
  };

  const ownerPlayer = owner ? state.players[owner] : undefined;
  if (ownerPlayer?.name !== undefined) model.ownerName = ownerPlayer.name;
  if (ownerPlayer?.faction !== undefined) model.ownerFaction = ownerPlayer.faction;
  if (planet.planetType !== undefined) model.planetType = planet.planetType;
  if (planet.kind !== undefined) model.sectorKind = planet.kind;

  return { ok: true, ...model };
}

/** What the world panel's buttons ask for. */
export type WorldAction = { kind: 'capital' } | { kind: 'hold'; on: boolean };

/** Orders to issue, or a stable reject code (fail-secure) — same shape as the fleet panel. */
export function resolveWorldAction(action: WorldAction, model: WorldModel): FleetIntent {
  // Чужой мир не отдаёт ни одного из этих приказов: оба — распоряжения владельца,
  // и ядро отвечает `E_FORBIDDEN` (в отличие от флота, где код непрозрачен: мир и так
  // виден на карте, скрывать его существование не от кого).
  if (!model.mine) return { ok: false, code: 'E_FORBIDDEN' };

  if (action.kind === 'capital') {
    // Уже столица — приказ был бы пустым; необитаемый мир ядро отвергнет
    // (`E_NOT_INHABITED`), и кнопки на него панель не рисует.
    if (model.capital !== 'designate') return { ok: false, code: 'E_NOT_INHABITED' };
    return { ok: true, steps: [{ type: 'capital.designate', payload: { planetId: model.id } }] };
  }

  // Точка удержания: ставить можно, пока есть место в лимите; СНИМАТЬ — всегда, иначе
  // исчерпавший лимит игрок заперт (правило 6 `worldOrders`).
  if (action.on && model.hold !== 'set') {
    return { ok: false, code: model.hold === 'set-disabled' ? 'E_LIMIT' : 'E_STEWARD_LOCKED' };
  }
  if (!action.on && model.hold !== 'clear') return { ok: false, code: 'E_STEWARD_LOCKED' };
  return {
    ok: true,
    steps: [{ type: 'steward.holdpoint', payload: { planetId: model.id, on: action.on } }],
  };
}

/* ─────────────────────── Combat zone — battle panel ──────────────────────── */

/** One side of a battle (attacker or defender) as the panel shows it. */
export interface BattleSideView {
  owner: PlayerId | null;
  /** Owner's `player.name`, or the raw id / '—' for a neutral side. */
  ownerName: string;
  /** Owner's `faction` content id ('' when neutral/unknown). */
  ownerFaction: string;
  /** What is fighting: an orbital `fleet`, a fleet's `landing` troops, the `beachhead`
   *  a shuttle drop put ashore (ROS-1.5), or a planet `garrison`. */
  kind: 'fleet' | 'landing' | 'beachhead' | 'garrison';
  /** Composition of this side's forces. */
  units: SelectionStack[];
  /** Aggregate hull / shield (when `data` is supplied; shield omitted with no capacity). */
  hull?: { current: number; max: number };
  shield?: { current: number; max: number };
  /** This side belongs to the viewing player. */
  mine: boolean;
  /** MSB-6: чем эта сторона бьёт — атакующая своим `attack`, обороняющаяся отвечает
   *  `defense`. Роль принадлежит СТОРОНЕ (MSB-1), поэтому её нельзя вывести из места в
   *  списке: атакующих может быть сразу несколько. */
  role: 'attacker' | 'defender';
}

/** Render-ready description of an active battle — the "combat zone" panel. */
export interface BattleModel {
  kind: 'battle';
  id: BattleId;
  /** Contested world / node. */
  location: PlanetId;
  /** `orbital` (fleet vs fleet) or `ground` (landing vs garrison). */
  phase: 'orbital' | 'ground';
  /** Rounds resolved so far. */
  round: number;
  /** Server time (ms) the next hourly round fires — the live countdown. */
  nextRoundAt?: number;
  /** MSB-6: ВСЕ стороны боя, в порядке вступления. Панель рисует именно этот список —
   *  на дуэли он ровно `[attacker, defender]`, поэтому вид двустороннего боя не меняется
   *  ни на пиксель, а на пяти сторонах появляются пять строк вместо двух. */
  sides: BattleSideView[];
  /** Первая атакующая и первая обороняющаяся сторона — короткий путь для дуэли и для
   *  тех читателей, кому расклад целиком не нужен. При нескольких атакующих это именно
   *  ПЕРВЫЙ атакующий, а не «весь штурм»: полная картина живёт в `sides`. */
  attacker: BattleSideView;
  defender: BattleSideView;
  /** The viewer's own orbital fleet in this battle, if any — the sole action
   *  (`fleet.retreat`) targets it. Absent = the viewer has nothing here that can pull out. */
  retreatFleetId?: FleetId;
}

/** Battle projection outcome: the model, or a stable error code. */
export type BattleResult = ({ ok: true } & BattleModel) | { ok: false; code: string };

function sideView(
  state: GameState,
  side: { ref: CombatantRef; owner: PlayerId | null; role: 'attacker' | 'defender' },
  viewerId: PlayerId,
  data?: Pick<GameData, 'units'>,
): BattleSideView {
  const ref = side.ref;
  const stacks: UnitStack[] =
    ref.kind === 'garrison'
      ? (state.planets[ref.planetId]?.garrison ?? [])
      : // ROS-1.5: плацдарм держит МИР, а не флот — читается оттуда же, откуда гарнизон.
        // MSB-4: плацдармов на мире бывает несколько, адресует их владелец в ссылке.
        ref.kind === 'beachhead'
        ? (state.planets[ref.planetId]?.beachheads?.find((b) => b.owner === ref.owner)?.units ??
          [])
        : ref.kind === 'landing'
          ? (state.fleets[ref.fleetId]?.landing ?? [])
          : (state.fleets[ref.fleetId]?.units ?? []);
  const owner = side.owner;
  const ownerPlayer = owner != null ? state.players[owner] : undefined;
  const view: BattleSideView = {
    owner,
    ownerName: ownerPlayer?.name ?? owner ?? '—',
    ownerFaction: ownerPlayer?.faction ?? '',
    kind: ref.kind,
    units: toStacks(stacks, data),
    mine: owner != null && owner === viewerId,
    role: side.role,
  };
  if (data) {
    view.hull = hullOf(stacks, data);
    const shield = shieldOf(stacks, data);
    if (shield) view.shield = shield;
  }
  return view;
}

/** Project the combat panel for `battleId`, as seen by `viewerId`. Fail-secure: a
 *  battle absent from `state.battles` (resolved, or fogged) yields `E_NO_BATTLE`.
 *  Fog-safe by construction — the battle is only present when its world is visible. */
export function createBattleModel(
  state: GameState,
  battleId: BattleId,
  viewerId: PlayerId,
  data?: Pick<GameData, 'units'>,
): BattleResult {
  const battle = state.battles[battleId];
  if (!battle) {
    return { ok: false, code: 'E_NO_BATTLE' };
  }
  // MSB-6: панель проецирует ВЕСЬ список сторон. `attacker`/`defender` остаются как
  // короткий путь (первая сторона каждой роли), но полный расклад — в `sides`.
  const attackerSide = attackerOf(battle);
  const defenderSide = defenderOf(battle);
  if (!attackerSide || !defenderSide) {
    return { ok: false, code: 'E_NO_BATTLE' };
  }
  const sides = battle.sides.map((side) => sideView(state, side, viewerId, data));
  const attacker = sideView(state, attackerSide, viewerId, data);
  const defender = sideView(state, defenderSide, viewerId, data);

  const model: BattleModel = {
    kind: 'battle',
    id: battle.id,
    location: battle.location,
    phase: battle.phase,
    round: battle.round,
    sides,
    attacker,
    defender,
  };
  if (battle.nextRoundAt != null) model.nextRoundAt = battle.nextRoundAt;

  // Only an orbital ship-side the viewer owns can retreat (not a garrison/landing).
  for (const side of battle.sides) {
    if (side.ref.kind === 'fleet' && side.owner === viewerId) {
      model.retreatFleetId = side.ref.fleetId;
      break;
    }
  }

  return { ok: true, ...model };
}

/** The panel's only action. */
export type BattleAction = { kind: 'retreat' };

/** Server intent from a panel action, or a stable reject code (fail-secure). */
export type BattleIntent =
  | { ok: true; type: 'fleet.retreat'; fleetId: FleetId }
  | { ok: false; code: string };

/** Map the panel's retreat tap to a `fleet.retreat` intent. Rejects when the viewer
 *  has no retreatable fleet in the battle (`retreatFleetId` absent). */
export function resolveBattleAction(action: BattleAction, model: BattleModel): BattleIntent {
  if (action.kind !== 'retreat') {
    return { ok: false, code: 'E_UNKNOWN_ACTION' };
  }
  if (!model.retreatFleetId) {
    return { ok: false, code: 'E_CANNOT_RETREAT' };
  }
  return { ok: true, type: 'fleet.retreat', fleetId: model.retreatFleetId };
}

/* ─────────────────── Combat forecast — assault preview (G4) ──────────────────── */

/** One side's forecast in the assault-preview panel — losses only (survivors are
 *  already visible via the selection/battle panels), plus the two numbers the
 *  copy thresholds on: how many units, and what hull-share is at stake. */
export interface BattlePreviewSideView {
  losses: SelectionStack[];
  lossCount: number;
  /** Share of this side's hull pool the forecast predicts lost, in [0,1]. */
  damageFraction: number;
}

/** Render-ready «если атакую — что будет?» forecast (ONB-6/G4) for a fleet's
 *  landing force against the garrison of the world it is docked over. */
export interface BattlePreviewModel {
  kind: 'preview';
  outcome: 'attacker' | 'defender' | 'stalemate';
  roundsEst: number;
  attacker: BattlePreviewSideView;
  defender: BattlePreviewSideView;
}

/** Preview projection outcome: the forecast, or a stable error code. */
export type BattlePreviewResult = ({ ok: true } & BattlePreviewModel) | { ok: false; code: string };

function previewSideView(
  side: BattlePreviewSide,
  data: Pick<GameData, 'units'>,
): BattlePreviewSideView {
  return {
    losses: toStacks(side.losses, data),
    lossCount: previewLossCount(side),
    damageFraction: side.damageFraction,
  };
}

/**
 * Project the assault forecast for `fleetId`'s landing force against the garrison
 * of the world it is docked at — a thin render-ready wrapper over the core's pure
 * `previewBattle` (ONB-6). Fog-safe by construction: a stationed fleet has already
 * identified its own world, so there is nothing here fog could still be hiding.
 *
 * Fail-secure: absent fleet → `E_NO_SELECTION`; not the viewer's own → `E_FORBIDDEN`;
 * not stationed (in transit, parked mid-lane, or already fighting) → `E_NOT_DOCKED`;
 * the docked world is the viewer's own, or its sector kind isn't capturable →
 * `E_NOT_HOSTILE`; no landing force aboard, or the garrison is empty (nothing to
 * forecast) → `E_NOTHING_TO_FORECAST`.
 */
export function createBattlePreviewModel(
  state: GameState,
  fleetId: FleetId,
  viewerId: PlayerId,
  data: GameData,
): BattlePreviewResult {
  const fleet = state.fleets[fleetId];
  if (!fleet) {
    return { ok: false, code: 'E_NO_SELECTION' };
  }
  if (fleet.owner !== viewerId) {
    return { ok: false, code: 'E_FORBIDDEN' };
  }
  if (!fleet.location || fleet.movement || fleet.battleId) {
    return { ok: false, code: 'E_NOT_DOCKED' };
  }
  const planet = state.planets[fleet.location];
  if (!planet) {
    return { ok: false, code: 'E_NOT_DOCKED' };
  }
  const capturable = planet.kind ? (data.sectorKinds[planet.kind]?.capturable ?? true) : true;
  if (planet.owner === viewerId || !capturable) {
    return { ok: false, code: 'E_NOT_HOSTILE' };
  }
  const landing = fleet.landing ?? [];
  const garrison = planet.garrison;
  if (!landing.some((u) => u.count > 0) || !garrison.some((u) => u.count > 0)) {
    return { ok: false, code: 'E_NOTHING_TO_FORECAST' };
  }

  const preview = previewBattle(landing, garrison, data);
  return {
    ok: true,
    kind: 'preview',
    outcome: preview.outcome,
    roundsEst: preview.roundsEst,
    attacker: previewSideView(preview.attacker, data),
    defender: previewSideView(preview.defender, data),
  };
}
