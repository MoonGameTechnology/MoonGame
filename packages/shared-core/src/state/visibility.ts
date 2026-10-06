import { buildingLevel, type GameData, type UnitDef } from '../data/schemas';
import { observedSwarm } from './swarmIntel';
import { deepClone } from '../util/clone';
import { effectiveStats } from '../util/loadout';
import { getStance, hasMapShare, offerInvolves } from './diplomacy';
import { fleetNodeAt, fleetPositionAt } from './fleetPosition';
import { emptyOrdnance, inRadius, isMissileFleet, rocketMineModule } from './ordnance';
import { visibleMinefields, isMineFleet, mineDetectionRange, mineFleetVisible } from './minefields';
import { detectSignals, fleetSignalStrength, type RadarSource, type SignalEmitter, type SignatureContact } from './radarSignals';
export type { SignatureContact, SignatureSize } from './radarSignals';
import type { DomainEvent } from '../action/types';
import type {
  Battle,
  BattleId,
  Fleet,
  FleetId,
  GameState,
  Planet,
  PlanetId,
  PlayerId,
  ScheduledEvent,
  SeenPatrol,
  SightRules,
  UnitStack,
} from './gameState';

/** A scheduled event belongs to a player when it clearly references their own planet,
 *  fleet, or is owner-tagged for them. Used to keep a player's OWN pending construction /
 *  production / arrivals in their view (the client renders the build queue + ETAs from
 *  them) while every enemy timer stays hidden. */
function scheduledOwnedBy(event: ScheduledEvent, viewerId: PlayerId, state: GameState): boolean {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  if (p.owner === viewerId) return true;
  // Per-player events tagged by `playerId` (e.g. `technology.complete`) — the
  // viewer's own research/economy timers, which they should keep in view.
  if (p.playerId === viewerId) return true;
  if (typeof p.planetId === 'string' && state.planets[p.planetId]?.owner === viewerId) return true;
  if (typeof p.fleetId === 'string' && state.fleets[p.fleetId]?.owner === viewerId) return true;
  return false;
}

/**
 * Fog of war as a SECURITY boundary (docs/modulesystem.md, deep-technical-roadmap
 * §6). `visibleState` is a pure projection the server runs before sending state
 * to a client: it physically removes everything `viewerId` may not see, so a
 * tampered client has no hidden data to reveal — not "send all, hide on the
 * client". It never feeds back into the reducer (determinism is untouched); it
 * is a read-only view.
 *
 * This is the first brick (current-visibility + radar signatures). Persistent
 * memory of last-seen state (variant B) layers on top in a follow-up.
 */

/**
 * Общие радиусы зрения ядра — у матча без своих чисел в режиме (решение владельца
 * 2026-09-24: «круги везде», «единый радиус»). Подобраны по основной карте (nexus:
 * ближайший сосед ~80, линия ~119): мир видит ближнее кольцо соседей, флот — узел, в
 * котором стоит, и почти ничего в пути. Разведка дальше — радаром: массив в мире
 * (240/330/420), радарный корабль или модуль, разведдрон.
 *
 * До этого свой мир раскрывал соседей ПО ЛИНИЯМ на любом расстоянии, а флот — ближайший
 * к нему узел, хоть на середине длинной линии. Граница обзора при этом рисовалась
 * кругами радара, и мир за ней светился, а мир рядом без линии — нет.
 */
export const DEFAULT_SIGHT: Readonly<SightRules> = { world: 120, fleet: 40, radarScale: 1 };

/** Радиусы зрения матча: его собственные (`state.sight`, из режима) или общие. Сломанные
 *  числа (не конечные, отрицательные, нулевой масштаб) читаются как общие целиком — карта
 *  не должна ослепнуть или прозреть от опечатки в данных. */
export function sightRulesOf(state: Pick<GameState, 'sight'>): Readonly<SightRules> {
  const s = state.sight;
  const ok = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const kindsOk = (k: unknown): boolean =>
    k === undefined || (!!k && typeof k === 'object' && Object.values(k).every(ok));
  return s && ok(s.world) && ok(s.fleet) && ok(s.radarScale) && s.radarScale > 0 && kindsOk(s.byKind)
    ? s
    : DEFAULT_SIGHT;
}

/** Базовый обзор своего мира: число его вида провинции (`byKind`) или общее `world`. Вид
 *  ищется только среди СОБСТВЕННЫХ ключей таблицы: `__proto__` или `constructor` в данных
 *  не должен прочитаться как обзор. */
export function worldSightOf(rules: Readonly<SightRules>, kind: string | undefined): number {
  const own = rules.byKind;
  return kind !== undefined && own && Object.prototype.hasOwnProperty.call(own, kind)
    ? own[kind]!
    : rules.world;
}

/** A radar projects TWO concentric ranges: it catches coarse signatures out to its
 *  full reach, and fully identifies contacts within the inner half of that reach
 *  (close contacts are resolved; far ones are just blips). */
const IDENTIFY_REACH_FRACTION = 0.5;

/** The state as one player may see it: a filtered `GameState`, the radar
 *  contacts that stand in for fleets detected but not identified, and the ids of
 *  worlds shown from memory (greyed "last known", variant B). */
export type VisibleState = GameState & {
  signatures: SignatureContact[];
  remembered: PlanetId[];
};

/**
 * Radar reach one stack projects: the hull's OWN dish plus what its installed
 * modules add.
 *
 * The two live in different places on purpose, and that is the whole subtlety:
 * `UnitDef.radarRange` is a top-level field, while a module's delta lands in the
 * `stats` bag. `effectiveStats` seeds itself from `def.stats` — which carries no
 * `radarRange` — so what it returns for that key IS the module sum. They add up;
 * neither shadows the other.
 *
 * (Before this, radar was read straight off `def.radarRange`, so a radar module
 * was bought, priced and displayed — and changed nothing.)
 */
export function stackRadarRange(
  def: UnitDef,
  stack: Pick<UnitStack, 'modules'>,
  data: GameData,
): number {
  return def.radarRange + (effectiveStats(def, stack, data).radarRange ?? 0);
}

/** Radar reach (distance, in map units) a fleet projects, from its loudest radar-ship.
 *  Exported so the client draws the same circle the fog computes — a second copy of
 *  this rule is how a module silently stops counting on one side of the wire. */
export function fleetRadarRange(fleet: Pick<Fleet, 'units'>, data: GameData): number {
  let reach = 0;
  for (const stack of fleet.units) {
    const def = data.units[stack.unit];
    if (def && stack.count > 0) reach = Math.max(reach, stackRadarRange(def, stack, data));
  }
  return reach;
}

/** A fleet's CONTINUOUS map position right now — the shared interpolation
 *  (`state/fleetPosition.ts`) evaluated at `state.time`, so a fleet's sensor
 *  reach tracks the SHIP, not its destination. */
function fleetPosition(state: GameState, fleet: Fleet): { x: number; y: number } | null {
  return fleetPositionAt(state, fleet, state.time);
}

/** The node a fleet is NEAREST to right now — its anchor for graph-hop identify and
 *  for where its radar contact blips. Same shared interpolation, at `state.time`. */
function fleetNode(state: GameState, fleet: Fleet): PlanetId | null {
  return fleetNodeAt(state, fleet, state.time);
}

/** ECON-2 «блэкаут»: unpaid energy (the economy module's `arrears` marker) halves
 *  the owner's sensors and AA until the bill is coverable again. One constant for
 *  both surfaces (radar reach here, AA damage in orbital.ts) — a single balance knob. */
export const BLACKOUT_MULT = 0.5;

/** Viewer-wide radar-reach multiplier: ×(1 + Σ completed-tech `radarRangeBonus`
 *  + faction passive `radarRangeBonus`) — how technologies and factions extend
 *  every radar the player fields (A2). Data-driven; no data → ×1. An owner in
 *  energy `arrears` runs at `BLACKOUT_MULT` on top (ECON-2): unpaid grids dim
 *  every screen the player fields — deterministic state read, replays intact. */
function radarMultiplier(state: GameState, viewerId: PlayerId, data: GameData): number {
  const player = state.players[viewerId];
  if (!player) return 1;
  let bonus = data.factions[player.faction]?.passives.radarRangeBonus ?? 0;
  for (const id of player.technologies?.completed ?? []) {
    bonus += data.technologies[id]?.effects.radarRangeBonus ?? 0;
  }
  const mult = Math.max(0, 1 + bonus); // a (mis)configured negative pile-up darkens, never inverts
  return player.arrears?.includes('energy') ? mult * BLACKOUT_MULT : mult;
}

/** What a viewer senses right now: full detail (`identify`) and the wider
 *  signatures-only ring (`radar`). Exported because a RENDERER needs both halves —
 *  `identifiedNodes` alone answers only the inner one. */
export interface Coverage {
  identify: Set<PlanetId>;
  radar: Set<PlanetId>;
}

/** The players whose sensors feed `viewerId`'s screen: the viewer plus everyone they
 *  hold the `alliance` stance with — «общая видимость» for a союз / коалиция (in this
 *  model a coalition IS the alliance stance, see `victory.ts`). `pact`/`peace` do NOT
 *  share intel: a non-aggression treaty is not an intelligence treaty.
 *
 *  Deliberately the DIRECT neighbourhood, not victory's mutually-allied clique and not
 *  a connected component: sharing is pairwise. With A–B and B–C allied but A–C at war,
 *  B sees both sides' intel while A and C — who never agreed to anything — share
 *  nothing. A component would silently leak A's map to their enemy through B.
 *
 *  The viewer is always first, and the rest follow `state.players` order, so the union
 *  below is built in a fixed order (invariant #1: no order-dependent behaviour). Both
 *  ends of an `alliance` see each other (`getStance` is symmetric), so the sharing is
 *  mutual by construction. */
function visionBloc(state: GameState, viewerId: PlayerId): PlayerId[] {
  const bloc: PlayerId[] = [viewerId];
  for (const id of Object.keys(state.players)) {
    if (id === viewerId) continue;
    // MAPSHARE-1: карту делит и СОЮЗ, и отдельный договор об обмене картами. Второй
    // ортогонален лестнице стоек — его заключают и при мире, и при пакте, — но на
    // разведку действует ровно так же, поэтому вход в блок зрения один.
    if (getStance(state, viewerId, id) === 'alliance' || hasMapShare(state, viewerId, id)) {
      bloc.push(id);
    }
  }
  return bloc;
}

/** Дальность радара мира без множителей: лучший из его массивов по уровню. */
function worldRadarRaw(planet: Pick<Planet, 'buildings'>, data: GameData): number {
  let reach = 0;
  for (const b of planet.buildings) {
    const def = data.buildings[b.type];
    if (def) reach = Math.max(reach, buildingLevel(def, b.level).radarRange);
  }
  return reach;
}

/** Дальность засечки радара мира — с масштабом режима и множителем ВЛАДЕЛЬЦА (технологии,
 *  фракция, блэкаут). Экспорт — чтобы клиент рисовал тот же круг, что считает туман. */
export function worldRadarReach(state: GameState, planet: Planet, data: GameData): number {
  if (planet.owner === null) return 0;
  const scale = sightRulesOf(state).radarScale;
  return worldRadarRaw(planet, data) * scale * radarMultiplier(state, planet.owner, data);
}

/** То же для флота: его самый «слышащий» корабль, масштаб режима, множитель владельца. */
export function fleetRadarReach(state: GameState, fleet: Fleet, data: GameData): number {
  const scale = sightRulesOf(state).radarScale;
  return fleetRadarRange(fleet, data) * scale * radarMultiplier(state, fleet.owner, data);
}

/**
 * Один круг зрения: где он стоит, чей он и какие у него два радиуса. Внутренний —
 * полный обзор (опознание), внешний — засечка сигнатур; внешний не меньше внутреннего.
 * Туман считается ТОЛЬКО по этим кругам, и граница обзора на карте рисуется из них же:
 * видно ровно то, что внутри нарисованной границы.
 */
export interface SightCircle {
  owner: PlayerId;
  /** Чей это круг: свой мир, флот, скан героя, ракетная мина или висящий патруль шаттлов
   *  (SHU-6.7) — клиент выделяет круг выбранного. */
  source: { kind: 'world' | 'fleet' | 'reveal' | 'mine' | 'patrol'; id: string };
  x: number;
  y: number;
  identify: number;
  signature: number;
}

/** Круги одного игрока — его собственные глаза и радары. Множитель радара у каждого свой:
 *  технологии союзника расширяют его радары, а союзник в блэкауте даёт тусклую картинку
 *  (ECON-2) — ровно как на его собственном экране. Базовые круги мира и флота — «глаза»,
 *  а не радар: множители радара (и блэкаут) их не трогают. */
function playerCircles(
  state: GameState,
  ownerId: PlayerId,
  data: GameData,
  rules: Readonly<SightRules>,
  out: SightCircle[],
): void {
  const mult = radarMultiplier(state, ownerId, data) * rules.radarScale;
  const circle = (
    source: SightCircle['source'],
    at: { x: number; y: number },
    base: number,
    radar: number,
  ): void => {
    out.push({
      owner: ownerId,
      source,
      x: at.x,
      y: at.y,
      identify: Math.max(base, radar * IDENTIFY_REACH_FRACTION),
      signature: Math.max(base, radar),
    });
  };
  for (const planet of Object.values(state.planets)) {
    if (planet.owner !== ownerId) continue;
    const radar = worldRadarRaw(planet, data) * mult;
    circle({ kind: 'world', id: planet.id }, planet.position, worldSightOf(rules, planet.kind), radar);
  }
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.owner !== ownerId) continue;
    // Круг стоит там, где КОРАБЛЬ, а не в узле назначения и не в ближайшем узле.
    const pos = fleetPosition(state, fleet);
    if (isMineFleet(fleet, data)) {
      // Контактная мина не глаз (SM-3.6). Ракетная — глаз и радар своего модуля, как и
      // прежде, когда она лежала вне `fleets` (SM-3.7a): опознаёт по позиции (`seesByPosition`).
      const rocket = rocketMineModule(fleet, data);
      if (rocket && pos) out.push({
        owner: ownerId, source: { kind: 'mine', id: fleet.id }, ...pos,
        identify: rocket.def.sightRange, signature: rocket.def.radarRange,
      });
      continue;
    }
    // Ракета (SM-3.7b) не глаз и не радар: она летит к цели, а не смотрит.
    if (isMissileFleet(fleet, data)) continue;
    if (pos) circle({ kind: 'fleet', id: fleet.id }, pos, rules.fleet, fleetRadarRange(fleet, data) * mult);
  }
  // SHU-6.7: висящий патруль шаттлов — глаза эскадры над её точкой. Круг тот же, в котором
  // патруль бьёт (`patrol.radius`), и это глаза, а не радар: опознание и засечка совпадают,
  // множители радара и блэкаут его не трогают. Только нога `patrol`: эскадра на пути к точке
  // или домой карту не открывает.
  for (const strike of state.strikes ?? []) {
    if (strike.owner !== ownerId || strike.leg !== 'patrol' || !strike.patrol) continue;
    const r = strike.patrol.radius;
    if (r > 0) out.push({
      owner: ownerId, source: { kind: 'patrol', id: strike.id }, ...strike.to,
      identify: r, signature: r,
    });
  }
  // HERO-FX3 `reveal` (scan): the owner's OWN living heroes' active time-boxed reveals
  // light a full-identify zone around their target node until it expires.
  for (const hero of Object.values(state.heroes ?? {})) {
    if (hero.owner !== ownerId || hero.alive !== true) continue; // deployed only (BF-24)
    for (const r of hero.activeReveals ?? []) {
      const at = state.planets[r.center]?.position;
      if (r.until > state.time && at) circle({ kind: 'reveal', id: hero.id }, at, r.radius, 0);
    }
  }
}

/** Все круги, которыми видит `viewerId`: его собственные и его блока зрения (союз, обмен
 *  картами). Порядок фиксирован — зритель, затем `state.players` (инвариант №1). */
export function sightCircles(state: GameState, viewerId: PlayerId, data: GameData): SightCircle[] {
  const rules = sightRulesOf(state);
  const out: SightCircle[] = [];
  for (const memberId of visionBloc(state, viewerId)) playerCircles(state, memberId, data, rules, out);
  return out;
}

/** Опознаёт ли круг корабль по его ПОЗИЦИИ, а не по ближайшему узлу: ракетная мина и
 *  висящий патруль (SHU-6.7) висят над дорогой вдали от миров, и правило «опознан узел —
 *  виден флот» не видело бы ровно того, что под ними. */
function seesByPosition(c: SightCircle): boolean {
  return c.source.kind === 'mine' || c.source.kind === 'patrol';
}

/** Круги зрителя, опознающие корабль по позиции ({@link seesByPosition}). */
function positionEyes(state: GameState, viewerId: PlayerId, data: GameData): SightCircle[] {
  return sightCircles(state, viewerId, data).filter(seesByPosition);
}

/**
 * Чужие флоты, которые зритель опознаёт по ПОЗИЦИИ — в круге ракетной мины или висящего
 * патруля (SHU-6.7), где бы ни стоял их ближайший узел. Мина-флот сюда не входит: у неё
 * своё правило «только вблизи» (`mineFleetVisible`). Экспорт — для клиента, который
 * считает туман сам (соло): копия правила разъехалась бы с проекцией.
 */
export function fleetsSeenByPosition(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  eyes: readonly SightCircle[] = positionEyes(state, viewerId, data),
): Set<FleetId> {
  const seen = new Set<FleetId>();
  if (eyes.length === 0) return seen;
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.owner === viewerId || isMineFleet(fleet, data) || isMissileFleet(fleet, data)) continue;
    const at = fleetPosition(state, fleet);
    if (at && eyes.some((c) => inRadius(at, c, c.identify))) seen.add(fleet.id);
  }
  return seen;
}

/**
 * Видна ли ракета (SM-3.7b; резолюция владельца 2026-10-06: «по обычному туману: глаза и
 * радар по её позиции»). Своя — всегда. Чужая — в живом окне шпионажа по флотам её хозяина
 * и целиком, когда её точка внутри опознания хоть одного круга зрителя с его блоком зрения;
 * ракета летит вне дорог, поэтому узел тут не мерка. Под одним радаром — только безымянная
 * отметка (`radarSignatures`). Особого предупреждения цели нет: цель без глаз узнаёт о
 * ракете по попаданию. Одно правило на проекцию, `isVisibleTo` и удар челноков: ракету,
 * которую зритель видит, он может и бить (замечание Codex на #1503). `circles` — для
 * вызывающего, который проверяет много ракет одним проходом.
 */
export function missileVisible(
  state: GameState,
  fleet: Fleet,
  viewerId: PlayerId,
  data: GameData,
  circles: readonly SightCircle[] = sightCircles(state, viewerId, data),
): boolean {
  if (fleet.owner === viewerId) return true;
  const spied = (state.intel?.[viewerId] ?? []).some(
    (g) => g.kind === 'fleets' && g.target === fleet.owner && g.until > state.time,
  );
  if (spied) return true;
  const at = fleetPosition(state, fleet);
  return !!at && circles.some((c) => inRadius(at, c, c.identify));
}

/**
 * Чужие висящие патрули, которые видит зритель (SHU-6.10; рекомендация карточки
 * владельцу 2026-10-04 — «видно в обзоре», как самолёты в Conflict of Nations).
 *
 * 1. **Только висящий.** Эскадра на пути к точке и домой скрыта, как любой чужой вылет
 *    (SHU-3.1): налёт остаётся внезапным.
 * 2. **Точка в обзоре зрителя** — внутри опознания хоть одного его круга, с блоком зрения.
 *    Это та же граница, что нарисована на карте: видно то, что внутри неё.
 * 3. **Или в круге патруля стоит флот блока.** Обзор флота (40 по умолчанию) меньше
 *    круга патруля (90), и без этого правила патруль бил бы флот, оставаясь невидимым.
 *    Граница круга включительна — та же мерка, по которой патруль выбирает цель.
 * 4. **Со стороны видно круг и состав**, а не базу, эскадру, удержание и срок
 *    ({@link SeenPatrol}). Свой патруль сюда не входит: он целиком в `strikes`.
 */
export function patrolsSeenBy(state: GameState, viewerId: PlayerId, data: GameData): SeenPatrol[] {
  const hanging = (state.strikes ?? []).filter(
    (st) => st.owner !== viewerId && st.leg === 'patrol' && (st.patrol?.radius ?? 0) > 0,
  );
  if (hanging.length === 0) return [];
  const eyes = sightCircles(state, viewerId, data);
  const bloc = new Set(visionBloc(state, viewerId));
  const guarded: Array<{ x: number; y: number }> = [];
  for (const fleet of Object.values(state.fleets)) {
    if (!bloc.has(fleet.owner) || !fleet.units.some((u) => u.count > 0)) continue;
    const at = fleetPosition(state, fleet);
    if (at) guarded.push(at);
  }
  const out: SeenPatrol[] = [];
  for (const st of hanging) {
    const radius = st.patrol!.radius;
    const seen =
      eyes.some((c) => inRadius(st.to, c, c.identify)) || // правило 2
      guarded.some((at) => inRadius(at, st.to, radius)); // правило 3
    if (!seen) continue;
    out.push({
      owner: st.owner,
      at: { x: st.to.x, y: st.to.y },
      radius,
      units: st.units.filter((u) => u.count > 0).map((u) => ({ unit: u.unit, count: u.count })),
    });
  }
  return out;
}

/** What `viewerId` can sense this instant: an identify range (full detail) and a
 *  wider radar range (signatures only) — the worlds inside the viewer's sight circles
 *  (`sightCircles`), UNIONED over the vision bloc, so allies pool their reconnaissance.
 *
 *  This is the single point the whole fog boundary reads: the per-player projection
 *  (`project`), the remembered-fog writer (`visibilityModule`), the broadcast event
 *  filter (`matchRoom`) and threat scanning all route through here, so shared vision
 *  stays consistent across every surface instead of being re-derived per caller.
 *  Squared distances — exact and deterministic, no sqrt. */
export function sensorCoverage(state: GameState, viewerId: PlayerId, data: GameData): Coverage {
  const identify = new Set<PlanetId>();
  const radar = new Set<PlanetId>();
  const circles = sightCircles(state, viewerId, data);
  for (const planet of Object.values(state.planets)) {
    for (const c of circles) {
      const dx = planet.position.x - c.x;
      const dy = planet.position.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > c.signature * c.signature) continue;
      radar.add(planet.id); // identify implies radar: identify ≤ signature by construction
      if (d2 <= c.identify * c.identify) {
        identify.add(planet.id);
        break;
      }
    }
  }
  return { identify, radar };
}

/** The set of nodes `viewerId` currently identifies (full detail). Exported so
 *  `visibilityModule` snapshots exactly what the projection treats as live. */
export function identifiedNodes(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
): Set<PlanetId> {
  return sensorCoverage(state, viewerId, data).identify;
}

/** Shared radar projection for the server and solo client. It deliberately contains
 * no fleet identity, owner, count or loadout; identification remains a separate rule. */
export function radarSources(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
): RadarSource[] {
  const sources: RadarSource[] = [];
  const scale = sightRulesOf(state).radarScale;
  for (const owner of visionBloc(state, viewerId)) {
    const mult = scale * radarMultiplier(state, owner, data);
    const add = (at: { x: number; y: number }, range: number, level: number): void => {
      if (range * mult > 0) sources.push({ ...at, range: range * mult, level });
    };
    for (const planet of Object.values(state.planets)) {
      if (planet.owner !== owner) continue;
      for (const b of planet.buildings) {
        const def = data.buildings[b.type];
        if (!def) continue;
        const lv = buildingLevel(def, b.level);
        add(planet.position, lv.radarRange, lv.radarLevel);
      }
    }
    for (const fleet of Object.values(state.fleets)) {
      if (fleet.owner !== owner) continue;
      const at = fleetPosition(state, fleet);
      if (!at) continue;
      if (isMineFleet(fleet, data)) {
        // Радар у мины — только у ракетной, своего модуля (SM-3.7a), без множителей игрока.
        const rocket = rocketMineModule(fleet, data);
        if (rocket) sources.push({ ...at, range: rocket.def.radarRange, level: rocket.def.radarLevel });
        continue;
      }
      for (const stack of fleet.units) {
        const def = data.units[stack.unit];
        if (def && stack.count > 0) add(at, stackRadarRange(def, stack, data), def.radarLevel);
      }
    }
  }
  return sources;
}

export function radarSignatures(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  identify: ReadonlySet<PlanetId> = identifiedNodes(state, viewerId, data),
  seenAt: ReadonlySet<FleetId> = fleetsSeenByPosition(state, viewerId, data),
): SignatureContact[] {
  const sources = radarSources(state, viewerId, data);
  if (!sources.length) return [];
  const spied = new Set((state.intel?.[viewerId] ?? [])
    .filter((g) => g.kind === 'fleets' && g.until > state.time).map((g) => g.target));
  // A fleet in the viewer's own battle is shown in full (`engagementOf`) — no blip on top.
  const engaged = engagementOf(state, viewerId).fleets;
  const emitters: SignalEmitter[] = [];
  const mineEmitters: Array<{ emitter: SignalEmitter; reach: number }> = [];
  let eyes: SightCircle[] | undefined;
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.owner === viewerId) continue;
    // Мина (SM-3.6): видимая вблизи — полностью, иначе — слабая отметка, которую ловит
    // только близкий радар. Шпионаж, опознанный узел и чужой бой её не раскрывают.
    if (isMineFleet(fleet, data)) {
      const node = fleetNode(state, fleet);
      const at = fleetPosition(state, fleet);
      if (node === null || !at || mineFleetVisible(state, fleet, viewerId, data)) continue;
      // Ракетная мина излучает по своему модулю (`mineSignature`), контактная — по юниту.
      const rocket = rocketMineModule(fleet, data);
      const strength = rocket ? rocket.def.mineSignature : fleetSignalStrength(fleet, data);
      mineEmitters.push({
        emitter: { location: node, ...at, inTransit: !!fleet.edge, strength },
        reach: mineDetectionRange(fleet, data),
      });
      continue;
    }
    // Ракета (SM-3.7b): увиденная глазами — целиком, иначе — отметка по её сигнатуре в точке
    // полёта. Узла у неё нет, поэтому опознанный узел её не раскрывает.
    if (isMissileFleet(fleet, data)) {
      const at = fleetPosition(state, fleet);
      const location = fleetNode(state, fleet);
      if (spied.has(fleet.owner) || !at || location === null) continue;
      if (missileVisible(state, fleet, viewerId, data, (eyes ??= sightCircles(state, viewerId, data)))) continue;
      emitters.push({ location, ...at, inTransit: true, strength: fleetSignalStrength(fleet, data) });
      continue;
    }
    // Опознанный кругом мины или патруля виден целиком — отметка поверх была бы вторым
    // значком одного корабля.
    if (spied.has(fleet.owner) || engaged.has(fleet.id) || seenAt.has(fleet.id)) continue;
    const location = fleetNode(state, fleet);
    const at = fleetPosition(state, fleet);
    if (location === null || identify.has(location) || !at) continue;
    const emitter: SignalEmitter = { location, ...at, strength: fleetSignalStrength(fleet, data) };
    const node = state.planets[location]?.position;
    if (node && (node.x !== at.x || node.y !== at.y)) emitter.inTransit = true;
    emitters.push(emitter);
  }
  // Decoys obey the same sensitivity, proximity and expiry rules as real emissions.
  for (const hero of Object.values(state.heroes ?? {})) {
    if (hero.owner === viewerId || hero.alive !== true) continue;
    for (const decoy of hero.activeDecoys ?? []) {
      const at = state.planets[decoy.at]?.position;
      if (decoy.until <= state.time || identify.has(decoy.at) || !at) continue;
      emitters.push({ location: decoy.at, ...at, strength: decoy.signature });
    }
  }
  const contacts = detectSignals(emitters, sources);
  // Mines have the lowest emission and can be picked up only at close range.
  // A coarse blip carries no mine id, owner, launch doctrine or module configuration.
  for (const { emitter, reach } of mineEmitters)
    contacts.push(...detectSignals([emitter], sources.map((r) => ({ ...r, range: Math.min(r.range, reach) }))));
  return contacts;
}

/** Стоит ли в бою сторона кого-то из `bloc`. */
function fightsIn(battle: Pick<Battle, 'sides'>, bloc: ReadonlySet<PlayerId>): boolean {
  return battle.sides.some((side) => side.owner !== null && bloc.has(side.owner));
}

/** Входит ли кто-то из `owners` в блок зрения зрителя (он сам, союзники, обмен картами).
 *  Нужен там, где боя в состоянии уже нет: бой, начавшийся и кончившийся между двумя
 *  кадрами, знают только по событиям, и аудиторию ему отвечает список его сторон. */
export function inVisionBloc(state: GameState, viewerId: PlayerId, owners: Iterable<PlayerId | null>): boolean {
  const bloc = new Set(visionBloc(state, viewerId));
  for (const owner of owners) if (owner !== null && bloc.has(owner)) return true;
  return false;
}

/** Стороны боёв, которых в итоговом состоянии уже нет, — по событиям пакета: `battle.started`
 *  называет атакующего и обороняющегося, `battle.joined` — каждого вступившего. Аудиторию
 *  такого боя (`inVisionBloc` по этим сторонам) одинаково считают сервер, раздавая события,
 *  и местная симуляция клиента, повторяя тот же фильтр (замечание Codex на #1417). */
export function flashBattles(events: readonly DomainEvent[], state: GameState): Map<string, Array<PlayerId | null>> {
  const out = new Map<string, Array<PlayerId | null>>();
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const id = p.battleId;
    if (typeof id !== 'string' || Object.hasOwn(state.battles, id)) continue;
    const owners = out.get(id) ?? [];
    if (e.type === 'battle.started') owners.push(sideOwner(p.attacker), sideOwner(p.defender));
    else if (e.type === 'battle.joined') owners.push(sideOwner(p.owner));
    else continue;
    out.set(id, owners);
  }
  return out;
}

function sideOwner(v: unknown): PlayerId | null {
  return typeof v === 'string' ? v : null;
}

/** Бои, в которых дерётся зритель или его блок зрения, и флоты этих боёв. */
export interface Engagement {
  battles: Set<BattleId>;
  fleets: Set<FleetId>;
}

/**
 * Свой бой виден целиком — сам бой и каждый флот в нём, где бы ни стоял его якорь.
 *
 * Опознание привязано к УЗЛАМ: чужой флот виден, когда опознан ближайший к нему мир. А
 * перехват случается на полпути: посреди длинной трассы оба флота далеко от миров, и
 * ни один круг зрения ближайший узел не накрывает. Бой при этом идёт — `startBattle`
 * снимает с флота движение, — и игрок видел, как его флот встал посреди пустоты без
 * врага и без отметки боя (владелец 2026-09-29: «мой флот столкнулся с невидимым
 * вражеским флотом. Я сначала даже и не понял, почему замер мой флот»).
 *
 * Утечки тут нет: кто стреляет по твоим кораблям, ты знаешь из самого боя. Блок зрения
 * (союз, обмен картами) делит и это — ровно как делит круги зрения.
 */
export function engagementOf(state: GameState, viewerId: PlayerId): Engagement {
  const bloc = new Set(visionBloc(state, viewerId));
  const battles = new Set<BattleId>();
  for (const battle of Object.values(state.battles)) {
    if (fightsIn(battle, bloc)) battles.add(battle.id);
  }
  const fleets = new Set<FleetId>();
  for (const fleet of Object.values(state.fleets)) {
    if (fleet.battleId && battles.has(fleet.battleId)) fleets.add(fleet.id);
  }
  return { battles, fleets };
}

/** Ad-hoc query (A4): can `viewerId` see this object at IDENTIFY detail right
 *  now? Exactly the rule `visibleState` projects by — own objects always, a fleet in
 *  the viewer's own battle always (`engagementOf`), others when their node is
 *  currently identified. A radar-only contact answers false
 *  (detected is not seen), remembered fog answers false (stale is not now), and
 *  an unknown id answers false (fail-secure). Fog is opt-in: a host that does
 *  not enforce it simply never consults this and everything stays visible.
 *
 *  Computing coverage is the expensive part — a caller checking MANY objects for
 *  one viewer should hoist `identifiedNodes(state, viewerId, data)` once and pass
 *  it as `identified` (the matchRoom event-filter pattern); each call is then a
 *  set lookup. Omitted, the coverage is computed per call. */
export function isVisibleTo(
  state: GameState,
  viewerId: PlayerId,
  target: { planetId: PlanetId } | { fleetId: string },
  data: GameData,
  identified?: Set<PlanetId>,
): boolean {
  if ('planetId' in target) {
    const planet = state.planets[target.planetId];
    if (!planet) return false;
    if (planet.owner === viewerId) return true;
    return (identified ?? identifiedNodes(state, viewerId, data)).has(target.planetId);
  }
  const fleet = state.fleets[target.fleetId];
  if (!fleet) return false;
  if (fleet.owner === viewerId) return true;
  // Мина видна только вблизи — ни опознанный узел, ни круг мины её не раскрывают (SM-3.6).
  if (isMineFleet(fleet, data)) return mineFleetVisible(state, fleet, viewerId, data);
  // Ракета — по своей позиции, глазами блока зрения, и в окне шпионажа (SM-3.7b).
  if (isMissileFleet(fleet, data)) return missileVisible(state, fleet, viewerId, data);
  const battle = fleet.battleId ? state.battles[fleet.battleId] : undefined;
  if (battle && fightsIn(battle, new Set(visionBloc(state, viewerId)))) return true;
  const at = fleetPositionAt(state, fleet, state.time);
  if (at && positionEyes(state, viewerId, data).some((c) => inRadius(at, c, c.identify))) return true;
  const node = fleetNode(state, fleet);
  return node !== null && (identified ?? identifiedNodes(state, viewerId, data)).has(node);
}

/**
 * Project `state` to what `viewerId` may see. Pure: the input is never mutated
 * (works on a `deepClone`). Hides every other player's private data, the
 * unexplored map's contents, unseen fleets/battles and the whole schedule
 * (it leaks future intent); radar-only enemy fleets become coarse signatures.
 */
export function visibleState(state: GameState, viewerId: PlayerId, data: GameData): VisibleState {
  return visibleView(state, viewerId, data).view;
}

/** A player's projection plus the identify set it was computed from. */
export interface VisibleView {
  view: VisibleState;
  /** Nodes the viewer currently identifies — the same set `identifiedNodes` returns. */
  identified: Set<PlanetId>;
}

/**
 * `visibleState` plus the identify set behind it, from ONE coverage pass.
 * The broadcast path needs both (the view to diff, the set to fog-filter
 * events); computing them together halves the per-player coverage work.
 */
export function visibleView(state: GameState, viewerId: PlayerId, data: GameData): VisibleView {
  const coverage = sensorCoverage(state, viewerId, data);
  return { view: project(state, viewerId, data, coverage), identified: coverage.identify };
}

/** One visibility boundary reused by networking and the local map/UI. */
export function visibleOrdnance(state: GameState, viewerId: PlayerId): GameState['ordnance'] {
  if (!state.ordnance) return undefined;
  {
    const cloned = deepClone(state.ordnance);
    const ord = emptyOrdnance();
    const source = state.ordnance;
    if (source.serials[viewerId] !== undefined) ord.serials[viewerId] = source.serials[viewerId]!;
    if (source.cooldowns[viewerId] !== undefined) ord.cooldowns[viewerId] = source.cooldowns[viewerId]!;
    ord.installations = cloned.installations.filter((m) => m.owner === viewerId);
    // The standing mine itself is a fleet (SM-3.7a) and passes the fleet fog («только
    // вблизи»); its doctrine, next scan and warhead stay with its owner.
    for (const [id, control] of Object.entries(cloned.controls ?? {}))
      if (state.fleets[id]?.owner === viewerId) (ord.controls ??= {})[id] = control;
    // The flying missile is a fleet too (SM-3.7b) and passes the ordinary fog; its warhead
    // stays with its owner. No special warning reaches the target (owner's resolution
    // 2026-10-06): a target without eyes learns of the missile by the hit.
    for (const [id, warhead] of Object.entries(cloned.warheads ?? {}))
      if (state.fleets[id]?.owner === viewerId) (ord.warheads ??= {})[id] = warhead;
    if (Object.keys(ord.controls ?? {}).length || Object.keys(ord.warheads ?? {}).length || ord.installations.length || Object.keys(ord.serials).length || Object.keys(ord.cooldowns).length) return ord;
    return undefined;
  }
}

/** The projection body, over a precomputed coverage (see `visibleView`). */
function project(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  { identify }: Coverage,
): VisibleState {
  const view = deepClone(state) as VisibleState;
  const ord = visibleOrdnance(state, viewerId);
  if (ord) view.ordnance = ord;
  else delete view.ordnance;
  // EVT-2 bookkeeping is SERVER-SIDE ONLY. It is keyed by node and priced from what
  // died there, so shipping it would report a battle's toll on worlds the viewer
  // cannot see — including ones they have never scouted. The player learns what they
  // salvaged from `salvage.paid`, which is addressed to them by name.
  delete view.salvage;
  const fields = visibleMinefields(state, viewerId);
  if (fields) view.minefields = fields;
  else delete view.minefields;
  // Private dossier plus this instant's resolved contacts. Never retain another
  // observer's records, and never put remembered fleets back on the live map.
  const contacts = { ...view.swarmIntel?.[viewerId], ...observedSwarm(state, viewerId, identify) };
  if (Object.keys(contacts).length) view.swarmIntel = { [viewerId]: contacts };
  else delete view.swarmIntel;

  // PVR-4.5: журнал адаптаций — знание ИГРОКА, поэтому фильтруется по зрителю тем же
  // правилом, что досье: своё видно, чужое снято целиком. Чужой журнал показал бы, что
  // успел выяснить сосед, — это разведка чужой разведки.
  const journal = view.swarmJournal?.[viewerId];
  if (journal) view.swarmJournal = { [viewerId]: journal };
  else delete view.swarmJournal;

  // Факты задач забега (`missionFacts`) — фильтруются по зрителю: свои удержания, свои
  // потери, свои доставленные беженцы. Чужой `held` рассказал бы, кто и когда взял мир в
  // тумане, а чужой `fallen` — что сосед потерял.
  const mf = view.missionFacts;
  if (mf) {
    const held = Object.fromEntries(
      Object.entries(mf.held ?? {}).filter(([, v]) => v.owner === viewerId),
    );
    const longest = Object.fromEntries(
      Object.entries(mf.longest ?? {}).flatMap(([id, by]) =>
        by[viewerId] !== undefined ? [[id, { [viewerId]: by[viewerId]! }]] : [],
      ),
    );
    const mine: NonNullable<GameState['missionFacts']> = {};
    if (mf.recruited?.[viewerId]) mine.recruited = { [viewerId]: [...mf.recruited[viewerId]!] };
    if (Object.keys(held).length) mine.held = held;
    if (Object.keys(longest).length) mine.longest = longest;
    if (mf.fallen?.[viewerId]) mine.fallen = { [viewerId]: [...mf.fallen[viewerId]!] };
    if (mf.evacuated?.[viewerId] !== undefined)
      mine.evacuated = { [viewerId]: mf.evacuated[viewerId]! };
    if (mf.contacted?.[viewerId]) mine.contacted = { [viewerId]: [...mf.contacted[viewerId]!] };
    // PVR-8.4: о каком месте эпизода знает сосед — разведка его разведки.
    if (mf.found?.[viewerId]) mine.found = { [viewerId]: [...mf.found[viewerId]!] };
    if (Object.keys(mine).length) view.missionFacts = mine;
    else delete view.missionFacts;
  }

  // Stolen intel windows (espionage): the viewer's LIVE grants open narrow holes in
  // the fog below. Expired grants open nothing — expiry is enforced HERE, at the
  // security boundary, not only by the module's housekeeping.
  const grants = (state.intel?.[viewerId] ?? []).filter((g) => g.until > state.time);
  const spiedTreasury = new Set(grants.filter((g) => g.kind === 'treasury').map((g) => g.target));
  const spiedPlanets = new Set(grants.filter((g) => g.kind === 'planet').map((g) => g.target));
  const spiedFleets = new Set(grants.filter((g) => g.kind === 'fleets').map((g) => g.target));

  // Other players' private data: keep identity, drop treasury and research (incl. the
  // chosen research leader — its branch focus / +slot is strategic, not public).
  for (const player of Object.values(view.players)) {
    if (player.id === viewerId) continue;
    if (!spiedTreasury.has(player.id)) player.resources = {};
    delete player.technologies;
    delete player.scientist;
    delete player.scientists; // the council (branch focus / +slot) — same intel as the legacy field
    delete player.arrears; // unpaid bills read as treasury intel — owner-private
    // Autopilot status is «спит — можно бить» intel, the SITREP journal narrates
    // the owner's defenses, and hold points are targeting intel («вот его якоря»)
    // — all strictly owner-private (ST-2.4 / ST-2.1).
    delete player.steward;
    delete player.stewardLog;
    delete player.stewardHoldPoints;
    delete player.arsenal; // what an enemy CAN build is strategic intel (ARS-3)
  }
  // Scoreboard: each player's live planet/fleet/unit totals aggregate territory
  // the viewer can't see, so an enemy's `scores` line is fog-sensitive intel
  // (its `total`/`fleets` tick reveals a build-up or a capture behind the fog).
  // Keep only the viewer's own line — the client renders just `scores[ME]`.
  // `status`/`winner` stay: the match's end result is public to everyone.
  if (view.match?.scores) {
    const own = view.match.scores[viewerId];
    view.match.scores = own ? { [viewerId]: own } : {};
  }
  // Stolen intel is the thief's secret: strip everyone else's grants (and the key
  // entirely when the viewer has none — no empty-map blip in third-party deltas).
  if (view.intel) {
    const own = view.intel[viewerId];
    if (own?.length) view.intel = { [viewerId]: own };
    else delete view.intel;
  }
  // Diplomatic OFFERS are private to the two negotiating parties (the committed
  // stances themselves are public): a third party must not see who is suing for
  // peace with whom. Keep only offers the viewer sends or receives; a map left
  // EMPTY after the strip is removed entirely — otherwise the undefined→{} flip
  // rides a third party's delta and leaks "someone made the match's first offer".
  if (view.mapShareOffers) {
    // MAPSHARE-1: предложение обмена картами — переговоры двоих, как и стоечный оффер.
    for (const key of Object.keys(view.mapShareOffers)) {
      if (!offerInvolves(key, viewerId)) delete view.mapShareOffers[key];
    }
    if (Object.keys(view.mapShareOffers).length === 0) delete view.mapShareOffers;
  }
  if (view.diplomacyOffers) {
    for (const key of Object.keys(view.diplomacyOffers)) {
      if (!offerInvolves(key, viewerId)) delete view.diplomacyOffers[key];
    }
    if (Object.keys(view.diplomacyOffers).length === 0) delete view.diplomacyOffers;
  }
  // Heroes are private: a viewer sees only their own (position + cooldowns). Temp
  // lanes stay — they are public map topology (real `links`), visible to everyone.
  if (view.heroes) {
    for (const id of Object.keys(view.heroes)) {
      if (view.heroes[id]?.owner !== viewerId) delete view.heroes[id];
    }
  }
  // Order chains and standing orders (`standingOrdersModule`'s `orders` / `autoAssault`,
  // and the prototype-style `forcedMarch`) are future intent — exactly what `scheduled`
  // is stripped for below. Keep only the entries of the viewer's OWN fleets; a map left
  // empty is removed (same delta hygiene as offers).
  for (const key of ['orders', 'autoAssault', 'autoRetreat', 'forcedMarch'] as const) {
    const host = view as unknown as Record<string, Record<string, unknown> | undefined>;
    const map = host[key];
    if (!map) continue;
    for (const fleetId of Object.keys(map)) {
      if (state.fleets[fleetId]?.owner !== viewerId) delete map[fleetId];
    }
    if (Object.keys(map).length === 0) delete host[key];
  }
  // A rival's capital designation is their hero-respawn anchor — the same
  // targeting intel as steward hold points («вот его якорь»). Keep only the
  // viewer's own entry; an empty map is removed (delta hygiene, as above).
  if (view.capital) {
    for (const playerId of Object.keys(view.capital)) {
      if (playerId !== viewerId) delete view.capital[playerId];
    }
    if (Object.keys(view.capital).length === 0) delete view.capital;
  }

  // Челночные удары (SHU-1.2): свои видны, чужие сняты целиком. Иначе игрок заранее
  // знает о налёте, и внезапность, ради которой челнок и летит мимо линий, исчезает.
  if (view.strikes) {
    const mine = view.strikes.filter((s) => s.owner === viewerId);
    if (mine.length === 0) delete view.strikes;
    else view.strikes = mine.map((s) => ({ ...s, units: s.units.map((u) => ({ ...u })) }));
  }
  // SHU-6.10: чужой ВИСЯЩИЙ патруль в обзоре виден — отдельным списком, а не вылетом: у
  // вылета база, эскадра и срок, а со стороны видно только круг и состав.
  const patrols = patrolsSeenBy(state, viewerId, data);
  if (patrols.length > 0) view.seenPatrols = patrols;
  else delete view.seenPatrols;

  // Planets: keep topology (id/position/links) but strip contents you can't see.
  // A world you have seen before shows its remembered snapshot (variant B);
  // one never identified shows nothing.
  const remembered: PlanetId[] = [];
  const memory = state.fog?.[viewerId];
  // Миры, на земле которых идёт СВОЙ наземный бой зрителя (или его блока зрения). Бой
  // проекция и так оставляет (`engagementOf`), а обе его стороны живут в самом мире —
  // гарнизон и плацдармы. Без них неопознанный мир отдавал бы бой с пустыми сторонами или
  // протухший снимок памяти (замечание Codex на #1408).
  // Мир → владельцы плацдармов, стоящих СТОРОНАМИ этих боёв: берег, оставшийся на земле без
  // боя (после перемирия или ничьей), в бою не участвует и остаётся в тумане (замечание Codex
  // на #1417).
  const engagedBattles = engagementOf(state, viewerId).battles;
  const groundFights = new Map<PlanetId, Set<PlayerId>>();
  for (const b of Object.values(state.battles)) {
    if (b.phase !== 'ground' || !engagedBattles.has(b.id)) continue;
    const shores = groundFights.get(b.location) ?? new Set<PlayerId>();
    for (const side of b.sides) if (side.ref.kind === 'beachhead') shores.add(side.ref.owner);
    groundFights.set(b.location, shores);
  }
  for (const planet of Object.values(view.planets)) {
    // BLD-1. Очередь стройки — БУДУЩЕЕ НАМЕРЕНИЕ, ровно то, за что ниже режут
    // `scheduled` и выше — цепочки приказов: «что он собирается построить» это разведка
    // планов, а не наблюдение мира. Поэтому режется РАНЬШЕ развилки видимости: чужой
    // мир не отдаёт очередь, даже когда ты смотришь на него в упор.
    if (planet.owner !== viewerId) {
      delete planet.buildQueue;
      // SHU-6.6. «Держать патруль» — постоянный приказ эскадры, то же намерение, что
      // цепочки и авто-штурм: точка, где хозяин снова встанет кругом, — разведка планов.
      // Ангар опознанного мира виден, флаг удержания в нём — нет.
      for (const squad of planet.hangar ?? []) delete squad.hold;
      // FOG-9. Приостановленная стройка — то же НАМЕРЕНИЕ, только с паузой: вид, уровень
      // и остаток цены рассказывают, что хозяин собирался тут поставить и сколько уже
      // вложил. Резалось всё вокруг (`scheduled`, цепочки приказов, очередь), а это
      // поле — нет, поэтому опознанный чужой мир отдавал планы прежнего владельца
      // целиком. Режем там же и по той же причине.
      delete planet.pausedConstruction;
    }
    // FORT-5.13. `priorKind` — СЛУЖЕБНАЯ память конверсии («чем узел был до крепости»),
    // и наружу она не идёт НИКОМУ: само её наличие выдаёт стоящую крепость, а значение —
    // исходный вид местности под ней. Неопознанный узел отдавал бы и то и другое, а
    // запомненный — конверсию, случившуюся уже после последнего наблюдения (в снимке
    // памяти этого поля нет). Режется до развилки видимости и у всех сразу, как `fog` и
    // поток ГСЧ: внутреннее поле ядра, которому в проекции делать нечего.
    delete planet.priorKind;
    // Ждущий флот (`joinsOnArrival`) ещё не в игре: зритель знает только свой — он и есть
    // цель, куда вести флот. Чужой выдал бы состав и место до всякой разведки.
    if (planet.awaitingFleets) {
      const own = planet.awaitingFleets.filter((f) => f.owner === viewerId);
      if (own.length > 0) planet.awaitingFleets = own;
      else delete planet.awaitingFleets;
    }
    if (planet.owner === viewerId || identify.has(planet.id) || spiedPlanets.has(planet.id))
      continue;
    // FORT-6.1: площадка крепости на развилке — не топология карты, а сооружение, и само
    // её существование говорит «здесь стоит (или стояла) крепость». Провинции видны всем
    // (они и есть карта), а площадку, которую зритель не видел ни разу, он не получает
    // вовсе — иначе туман выдавал бы каждую крепость на дорогах. Увиденную помнит, как и
    // любой мир.
    if (planet.fork && !memory?.[planet.id]) {
      delete view.planets[planet.id];
      continue;
    }
    // Ангар чужого мира не виден НИКОГДА (SHU-1.1): челнок стоит внутри порта, а не на
    // орбите — снаружи видно здание, но не то, сколько машин в нём. Единственное
    // исключение выше по функции: шпионаж (`spiedPlanets`) вскрывает мир целиком и
    // сюда не доходит.
    delete planet.hangar;
    // ROS-1.5: плацдарм — войска НА ЗЕМЛЕ чужого мира, и виден он ровно там же, где
    // виден гарнизон. На неопознанном мире его быть не должно: иначе десант соседа
    // выдавал бы и сам факт вторжения, и место, куда игрок не смотрит. В памятном
    // снимке его нет намеренно — плацдарм живёт часы, и «помнить» его значило бы
    // показывать заведомо протухшее.
    delete planet.beachheads;
    const snap = memory?.[planet.id];
    if (snap) {
      planet.owner = snap.owner;
      planet.garrison = snap.garrison.map((s) => ({ ...s }));
      planet.buildings = snap.buildings.map((b) => ({ ...b }));
      planet.resources = {};
      if (snap.terrain === undefined) delete planet.terrain;
      else planet.terrain = snap.terrain;
      if (snap.planetType === undefined) delete planet.planetType;
      else planet.planetType = snap.planetType;
      if (snap.kind === undefined) delete planet.kind;
      else planet.kind = snap.kind;
      remembered.push(planet.id);
    } else {
      planet.owner = null;
      planet.garrison = [];
      planet.buildings = [];
      planet.resources = {};
      delete planet.terrain;
      delete planet.planetType;
      delete planet.kind;
    }
    // Свой наземный бой: его стороны — живые. Хозяин, гарнизон и плацдармы боя — то, с чем и
    // против кого зритель дерётся прямо сейчас; постройки, склады и посторонние берега мира
    // остаются в тумане.
    const shores = groundFights.get(planet.id);
    if (shores) {
      const live = state.planets[planet.id]!;
      planet.owner = live.owner;
      planet.garrison = live.garrison.map((st) => ({ ...st }));
      const fighting = (live.beachheads ?? []).filter((b) => shores.has(b.owner));
      if (fighting.length > 0) {
        planet.beachheads = fighting.map((b) => ({ ...b, units: b.units.map((st) => ({ ...st })) }));
      }
    }
  }
  remembered.sort();
  view.remembered = remembered;
  delete view.fog; // memory is authoritative-internal — never shipped raw
  // The seeded RNG stream (sfc32 a/b/c/d) is the world's dice: a client holding it can
  // roll every upcoming combat round / dark event before the server does — the sharpest
  // hidden-information leak there is. Authoritative-internal like `fog`; `hashState`
  // never reads it, so the desync digest is unaffected.
  //
  // ВНИМАНИЕ на будущее. Здесь стояло обоснование «ядро крутит только сервер, сетевой
  // клиент лишь рисует снапшоты и applyAction не зовёт». Оно ПРОТУХЛО (RULES-1): клиент
  // зовёт `canApply`, чтобы погасить недоступные приказы, то есть гоняет те же
  // обработчики на этой самой проекции. Резать поток всё равно правильно — но ядро
  // обязано переживать его отсутствие, а не падать: `runStep` подставляет `AbsentRng`
  // и отвечает `E_NO_RNG` тому, кто до костей дотянулся (kernel.ts). Не «чините» это
  // место, возвращая клиенту поток.
  delete (view as Partial<GameState>).rng;

  // PVR-4.2: память Роя снимается целиком. Это не «серверная кухня», а правило игры:
  // §3.4 требует, чтобы игрок узнавал вывод противника из ЖУРНАЛА адаптаций (PVR-4.5),
  // где подтверждённый факт отделён от гипотезы, — а не читал счётчик наблюдений прямо
  // из состояния. Отдать его клиенту значило бы выдать и то, чего Рой ещё не показал.
  delete (view as Partial<GameState>).swarmMemory;
  // PVR-4.3: идущий проект адаптации снимается по той же причине, что и память.
  // §3.9: игрок узнаёт об уровне ПОСЛЕ того, как тот проявился в завершённом бою, а не
  // из состояния. Видимый счётчик «до перехватчика осталось 4 часа» — это разведка,
  // которой не было.
  delete (view as Partial<GameState>).swarmAdapts;
  // AUD-20: рецепт Роя — то же знание о проекте, только законченном. Игрок видит ответ
  // в бою (журнал), а не читает уровень из состояния.
  delete (view as Partial<GameState>).swarmRecipes;
  // Сеть Роя: что знает каждая его часть — это его память, а не разведка игрока. Сами
  // узлы (ретрансляторы во флотах, центры на мирах) видны обычным туманом.
  delete (view as Partial<GameState>).swarmNet;

  // Fleets: own + identified enemy stay; radar-only enemy → a coarse signature;
  // everything else is removed entirely.
  const seenAt = fleetsSeenByPosition(state, viewerId, data);
  view.signatures = radarSignatures(state, viewerId, data, identify, seenAt);
  const engaged = engagementOf(state, viewerId);
  let eyes: SightCircle[] | undefined;
  for (const id of Object.keys(view.fleets).sort()) {
    const fleet = view.fleets[id];
    if (!fleet || fleet.owner === viewerId) continue;
    // Чужая мина — только вблизи; шпионаж, бой и опознанный узел её не раскрывают (SM-3.6).
    if (isMineFleet(fleet, data)) {
      const original = state.fleets[id];
      if (!original || !mineFleetVisible(state, original, viewerId, data)) delete view.fleets[id];
      continue;
    }
    if (spiedFleets.has(fleet.owner)) continue;
    // Ракета (SM-3.7b) — глазами по её позиции; под одним радаром она — отметка выше.
    if (isMissileFleet(fleet, data)) {
      const original = state.fleets[id];
      if (!original || !missileVisible(state, original, viewerId, data, (eyes ??= sightCircles(state, viewerId, data))))
        delete view.fleets[id];
      continue;
    }
    if (engaged.fleets.has(id)) continue; // the enemy in YOUR battle is not a secret
    const node = fleetNode(view, fleet);
    // Rocket mines and hanging shuttle patrols (SHU-6.7) identify ships at their
    // continuous positions, including roads far from any node.
    if (seenAt.has(id)) continue;
    if (node !== null && identify.has(node)) continue; // fully identified
    delete view.fleets[id];
  }
  // SHU-6.6: удержание патруля у чужого корабля — намерение, как и у мира выше. Режется у
  // всех оставшихся чужих флотов разом: опознанный, вскрытый шпионом и стоящий в моём бою
  // показывают ангар, но не планы.
  for (const fleet of Object.values(view.fleets)) {
    if (fleet.owner === viewerId) continue;
    for (const squad of fleet.hangar ?? []) delete squad.hold;
  }
  // Battles you cannot see, and enemy timers from the schedule (it leaks future
  // events) — but KEEP the viewer's own pending events: their construction/production/
  // arrivals are their own information, and the client renders the build queue + ETAs
  // from them. (A blanket strip is why the build queue showed nothing in net mode.)
  for (const id of Object.keys(view.battles)) {
    const battle = view.battles[id];
    if (battle && !identify.has(battle.location) && !engaged.battles.has(id)) delete view.battles[id];
  }
  view.scheduled = view.scheduled.filter((e) => scheduledOwnedBy(e, viewerId, state));

  // Контракт операции (PVR-8.3): очаги, пороги и факты разгрома — правила главы, их видят
  // все. Флоты соединений — только те, что зритель видит и так: учёт идёт и за частями,
  // отделёнными в тумане, и их id рассказали бы, что враг разделился и когда.
  // Контрудар (PVR-8.4) — замысел врага: когда и куда он двинет уцелевшее, игрок узнаёт по
  // наблюдаемому курсу, а не из состояния.
  if (view.operation) {
    for (const force of Object.values(view.operation.forces))
      force.fleets = force.fleets.filter((id) => view.fleets[id] !== undefined);
    delete view.operation.counterattack;
  }

  return view;
}
