import { seedRng, type RngState } from '../rng/rng';
import type { SortieState } from './squadron';
import type { FleetChain } from './chain';

/**
 * The authoritative game state. Stored as JSONB on the server
 * (docs/architecture.md §4.3) and mirrored on the client. Pure data: no class
 * instances, no functions — it must round-trip through JSON unchanged.
 *
 * Note: the core is data-driven (docs/architecture.md §2). Identifiers below
 * (units, buildings, traits, resources) are plain strings that resolve against
 * the loaded game data — the engine never hard-codes any concrete content.
 */

export type PlayerId = string;
export type PlanetId = string;
export type FleetId = string;
export type BattleId = string;
export type ResourceId = string;
export type UnitId = string;
export type ModuleId = string;
export type BuildingId = string;
export type TechnologyId = string;
export type TraitId = string;

/** A dynamic resource ledger. The engine never assumes a fixed set of
 *  resources (docs/architecture.md §2.3). */
export type ResourceBag = Record<ResourceId, number>;

export interface UnitStack {
  unit: UnitId;
  count: number;
  /** Remaining HP pool of this stack during a battle (≤ count × def.hp).
   *  Undefined outside combat = full health. */
  hp?: number;
  /** Remaining ablative shield pool of this stack (≤ count × def.shield). Absorbs
   *  damage before `hp`; a ship still dies only when its HULL (`hp`) hits 0.
   *  Undefined = full shield (shields-roadmap SH-0.1). */
  shieldHp?: number;
  /** Installed ship modules (the loadout), chosen at BUILD time and LOCKED after
   *  — there is no refit action. Ids → `data.modules`; effect applies ×count.
   *  Part of the stack's merge identity: stacks with different loadouts never
   *  merge (ship-modules-roadmap.md SM-0.3). Absent = no modules. */
  modules?: ModuleId[];
}

/** A constructed building on a planet. Buildings are leveled (1..maxLevel) and
 *  carry structural HP that orbital bombardment / ground assault wear down
 *  (GDD §7.4); a destroyed building is removed and stops granting its bonus. */
export interface BuildingInstance {
  /** Unique instance id (RULES-2.1): allows `building.upgrade` to address a
   *  SPECIFIC instance when `maxPerPlanet > 1`. Without it, `find(b => b.type === …)`
   *  always hits the first instance. Auto-assigned at construction time;
   *  optional for back-compat (old state without uid → find-by-type). */
  uid?: string;
  type: BuildingId;
  level: number;
  hp: number;
}

/** A construction/upgrade/unit order cancelled mid-build: the paid-in-full order was
 *  refunded its unbuilt share and halted rather than lost outright — `resume` pays
 *  `remainingCost` (exactly what was refunded) to re-schedule the same
 *  `remainingHours` and finish from here, not from scratch. `id` is the original
 *  scheduled event's `seq` (stable across cancel → resume). Planet-scoped: buildings,
 *  upgrades and unit orders are all placed against a specific planet. */
export interface PausedConstructionSite {
  id: number;
  kind: 'building' | 'upgrade' | 'unit';
  playerId: PlayerId;
  building?: BuildingId;
  /** Upgrade target level (kind: 'upgrade' only). */
  level?: number;
  unit?: UnitId;
  count?: number;
  modules?: ModuleId[];
  /** RULES-2.1: instance uid for upgrade resume (when maxPerPlanet > 1). */
  uid?: string;
  /** Fraction (0..1) already complete at the moment of the pause. */
  progress: number;
  /** Game-hours still needed to finish, same units as `buildTimeHours`. */
  remainingHours: number;
  /** Exactly what was refunded; exactly what `resume` charges again. */
  remainingCost: ResourceBag;
}

export interface Player {
  id: PlayerId;
  name: string;
  faction: string;
  status: 'active' | 'defeated';
  /** True for an AI-driven seat (bot). Absent = human. Game rules may key off it —
   *  e.g. diplomacy: a coalition (alliance) is between humans only, bots are not
   *  invitable (`diplomacyModule` rejects `E_BOT_ALLIANCE`). */
  ai?: boolean;
  /** The player's treasury — production accrues here, upkeep/costs drain it. */
  resources: ResourceBag;
  /** Resources whose upkeep went UNPAID at the last settlement (treasury pinned at
   *  zero with a remainder owed). While a resource is in arrears, buildings whose
   *  upkeep consumes it run at half output (economy.ts BROWNOUT) — a brownout, not
   *  a shutdown. Sorted for determinism; absent = all bills paid. Private to the
   *  owner (stripped from other players' views like the treasury itself). */
  arrears?: string[];
  technologies?: PlayerTechnologyState;
  /** Chosen research leaders (a council of up to 2), snapshotted at match start and
   *  immutable (GDD §2/§5.2): each `id` into `data.scientists`, `level` from the account
   *  meta. A `has_scientist` gate passes if ANY leader matches; `research.slots` bonuses
   *  sum across them. Read via {@link scientistsOf}. Absent/empty = no leader chosen. */
  scientists?: Array<{ id: string; level: number }>;
  /** @deprecated Legacy single-leader field (snapshots from before the 2-slot council).
   *  Never written now; still READ through {@link scientistsOf} for old persisted state. */
  scientist?: { id: string; level: number };
  /** ИГРОВОЕ время заявки на место (`seat.claim`, ENTRY-3): дом и совет выбраны и
   *  больше не меняются. Отсутствует — место ещё никем не занималось, за него играет
   *  серверный ИИ. Держать маркер В СОСТОЯНИИ обязательно: `seat.claim` — КЛИЕНТСКИЙ
   *  тип, игрок может прислать его сам, поэтому «заявить можно один раз» обязан
   *  проверять редьюсер, а не память сервера.
   *
   *  Время игровое, а РЕАЛЬНОЕ из него выводится делением на `timeScale` — та же
   *  дисциплина, что у окна входа (`MatchRegistry.entryOpen`). Настенных часов в
   *  `GameState` нет и быть не должно: они сделали бы реплей невоспроизводимым. */
  claimedAt?: number;
  /** Игрок ДОШЁЛ до карты (`seat.confirm`): с этого момента место закреплено за ним
   *  насовсем. До подтверждения заявка временная — место, взятое по ссылке и брошенное,
   *  освобождается по истечении окна (`seat.release`), иначе один не пришедший человек
   *  запирал бы кресло до конца партии. */
  seated?: true;
  /** Steward delegation ("hand the seat to the AI while I sleep"): while set and the
   *  world clock is before `until`, the server AI plays this seat with `posture`. The
   *  server-side driver reads it via `stewardActive`; it auto-expires on the clock
   *  crossing `until` (stewardModule). Absent = the player commands the seat. */
  steward?: StewardState;
  /** The Steward's decision journal (SITREP, ST-2.4): what the AI did on this seat's
   *  last watch, stamped by the server driver via `steward.report` and kept AFTER the
   *  delegation lapses — the sleeping player's client is offline, so the morning
   *  report must live in state, not in a client log. Bounded FIFO; a new delegation
   *  starts a fresh journal. Owner-private (stripped from rivals' views, like the
   *  treasury — both the journal and the autopilot status itself read as «спит»). */
  stewardLog?: StewardLogEntry[];
  /** Hold points (ST-2.1, guard): OWN worlds the player ORDERED held — a standing
   *  order (the CC-4 family), honored by the Steward under any posture: a hold
   *  point is never auto-evacuated; a threatened one is REINFORCED instead. Set
   *  via `steward.holdpoint` (client-submittable, capped at
   *  `MAX_STEWARD_HOLD_POINTS`). Owner-private — a rival reading your anchors is
   *  targeting intel. Absent = no points. */
  stewardHoldPoints?: PlanetId[];
  /** Arsenal snapshot (ARS-3): the catalog ids this seat OWNS and may build with —
   *  taken from the account's `ArsenalStore` when the session is assembled (AvA:
   *  at roster lock, GDD §2 «консервация»). While present, `unit.build` requires
   *  the hull and every module to be listed (`E_NOT_OWNED`) and `hero.fit` the
   *  fitting; ABSENT = no restriction (regular/dev matches — graceful degradation).
   *  Owner-private like the treasury (stripped from other players' views). LARS-1
   *  will complement this with the live server-side ownership read (LARS-0.2). */
  arsenal?: PlayerArsenal;
}


/** The build-permission snapshot of a seat (see `Player.arsenal`): unique, sorted
 *  catalog ids per kind — the shape both the core gate and the UI filter read. */
export interface PlayerArsenal {
  /** Buildable hulls → `data.units` ids. */
  hulls: string[];
  /** Installable ship modules → `data.modules` ids. */
  modules: string[];
  /** Installable hero fittings → `data.heroFittings` ids. */
  fittings: string[];
}

/** A live Steward delegation on a player (see `Player.steward`). */
export interface StewardState {
  /** Behaviour profile the AI follows (see `STEWARD_POSTURES`). */
  posture: string;
  /** Game-time (ms) the delegation lapses at — control returns to the player then. */
  until: number;
}

/** One recorded Steward decision (see `Player.stewardLog`): a compact, JSON-safe fact
 *  the driver stamps; the client renders it localized. `kind` is the driver's
 *  vocabulary (evac / ferry / strike / watch / hold / stranded — extensible), the
 *  optional fields carry only what that kind needs. */
export interface StewardLogEntry {
  /** Game-time (ms) of the decision. */
  at: number;
  kind: string;
  /** Node (planet id) the decision concerns. */
  node?: string;
  /** Fleet the decision tasked. */
  fleetId?: string;
  /** Destination node (evacuation target etc.). */
  to?: string;
  /** A relevant count (fleets moved, units lifted, ...). */
  count?: number;
  /** Forecast hull-loss fraction (0..1) the decision keyed off. */
  fraction?: number;
}

/** The player's chosen research leaders (0–2). Reads the current `scientists` council and
 *  falls back to the legacy single `scientist` (older snapshots) — the one accessor the
 *  `+slot` bonus and `has_scientist` gate use, so both stay agnostic to the field shape. */
export function scientistsOf(
  player: Player | undefined,
): ReadonlyArray<{ id: string; level: number }> {
  if (!player) return [];
  if (player.scientists) return player.scientists;
  return player.scientist ? [player.scientist] : [];
}

export interface ActiveResearch {
  technology: TechnologyId;
  startedAt: number;
  completesAt: number;
  /** Premium boosts already applied (SES-3): drives the geometric diminishing
   *  returns of `technology.boost`. Absent = never boosted. */
  boosts?: number;
}

export interface PlayerTechnologyState {
  completed: TechnologyId[];
  /** Research currently in progress — one entry per occupied slot (base 2,
   *  raisable to a max of 3 via the `research.slots` hook). Absent/empty = idle labs. */
  active?: ActiveResearch[];
}

/** Diplomatic stance between two players (symmetric). Richer than the combat
 *  `hostile|ally|neutral` relation the `diplomacy` capability projects (D2):
 *  - `war`      → hostile (fleets engage, worlds can be assaulted)
 *  - `peace`    → neutral (no auto-combat; the plain "we are not fighting" state)
 *  - `pact`     → neutral (a non-aggression pact — like peace, but a declared,
 *                 breakable agreement rather than mere absence of war)
 *  - `alliance` → ally (shared side; an ally's world can't be attacked)
 *  The stance→relation mapping is `stanceToRelation` (`state/diplomacy.ts`),
 *  provided as the `diplomacy` capability by `diplomacyModule` (D2). */
export type DiplomaticStance = 'war' | 'peace' | 'pact' | 'alliance';


/** A stolen, time-boxed intel window (espionage): while `until` is ahead of the
 *  world clock, `visibleState` lets the OWNING viewer see through the fog at the
 *  granted target. What each kind opens:
 *  - `treasury` — the target player's resource bag stays visible;
 *  - `planet`   — the granted world's contents (owner/garrison/buildings) read live;
 *  - `fleets`   — the target player's fleets stay in view (position + composition).
 *  Grants are produced by `espionageModule` and expire on their own. */
export interface IntelGrant {
  kind: 'treasury' | 'planet' | 'fleets';
  /** `treasury`/`fleets` → target player id; `planet` → the granted planet id. */
  target: string;
  /** World-time (ms) the window closes. */
  until: number;
}

export type MatchStatus = 'ongoing' | 'ended';
export type MatchEndReason =
  | 'domination'
  | 'elimination'
  | 'score'
  | 'timeout'
  /** PVE-4: the wave assault was survived and the enemy cleared — everyone still
   *  standing wins TOGETHER (`match.winners`), there is no single champion. */
  | 'pve-cleared'
  /** PVE-4: every human seat fell. The NPC is the formal winner. */
  | 'pve-failed';

export interface MatchScore {
  /** Map control: owned planet/sectors. */
  controlledPlanets: number;
  /** Standing fleets the player still commands. */
  fleets: number;
  /** Ships, carried ground troops and planetary garrisons. */
  units: number;
  /** Aggregate score used by score-limit and timeout victories. */
  total: number;
}

/** One row of the session-end reward table (SES-2 first slice, GDD §3.4). The
 *  core only REPORTS the table — crediting accounts (XP / meta-resources) is the
 *  server's job once the meta-economy lands (EC-*). */
export interface PlayerReward {
  /** Standing in the final score table — standard competition ranking (1224):
   *  equal totals share a place, the next place skips the tied count. */
  place: number;
  /** Account XP earned: participation + capped score share + win bonus, scaled
   *  by `GameData.rewards`. */
  xp: number;
}

export interface MatchState {
  status: MatchStatus;
  winner: PlayerId | null;
  /** Every winner of a coalition (alliance) score win, sorted (GDD §3.3). Present
   *  only when a coalition won together; `winner` then holds its top scorer. */
  winners?: PlayerId[];
  endedAt?: number;
  reason?: MatchEndReason;
  scores: Record<PlayerId, MatchScore>;
  /** Session-end reward table (GDD §3.4), written once when the match ends —
   *  every seated player gets a row (participation pays even in defeat). */
  rewards?: Record<PlayerId, PlayerReward>;
}

export interface Planet {
  id: PlanetId;
  /** Owning player, or null for a neutral / unclaimed sector. */
  owner: PlayerId | null;
  position: { x: number; y: number };
  /** Star lanes: ids of directly-connected planets. The map is this graph;
   *  fleets travel along lanes (GDD §1 — секторная структура, узлы-планеты). */
  links?: PlanetId[];
  /** Sector terrain type id (resolved against game data `sectors`); its buffs
   *  /debuffs are applied through hooks. Undefined = plain space, no modifier. */
  terrain?: string;
  /** Sector kind id (planet / asteroid / nebula / empty …; resolved against game
   *  data `sectorKinds`) — decides capturable / buildable / orbit. Undefined
   *  degrades to the permissive defaults (see `sectorKindDef`). */
  kind?: string;
  /** Relative size / weight of the sector (default 1). Drives how much territory
   *  it claims: a sector's border with a neighbour sits proportionally to their
   *  sizes, so resizing one shifts its neighbours' borders evenly. Undefined = 1. */
  size?: number;
  /** Planet type id — the world's nature (resolved against game data
   *  `planetTypes`); production/defense modifiers are applied through hooks.
   *  Undefined = generic world, no modifier. */
  planetType?: string;
  resources: ResourceBag;
  buildings: BuildingInstance[];
  garrison: UnitStack[];
  traits: TraitId[];
  /** Cancelled-mid-build construction/upgrade/unit orders, paused and resumable
   *  (see `PausedConstructionSite`). Undefined/empty = nothing paused here. */
  pausedConstruction?: PausedConstructionSite[];
}

export interface FleetMovement {
  /** Origin of the current leg. */
  from: PlanetId;
  /** Next hop (the planet this leg ends at). */
  to: PlanetId;
  /** Server-authoritative timestamps (ms). */
  departedAt: number;
  arrivesAt: number;
  /** Remaining hops after `to`, in order, ending at `destination`. */
  path?: PlanetId[];
  /** Final destination of the whole journey. */
  destination?: PlanetId;
  /** Fraction along (`from`,`to`) this leg STARTS at, in [0,1) (default 0). >0
   *  only on the first leg out of a mid-lane parked position — the fleet resumes
   *  partway down the road instead of from a node. */
  startT?: number;
  /** Fraction along (`from`,`to`) this (final) leg ENDS at, in (0,1] (default 1).
   *  <1 means the journey stops at a point ON the lane: on arrival the fleet
   *  parks (`edge`) at this fraction instead of reaching node `to`. */
  endT?: number;
  /** Journey-wide park fraction carried across hops: when the LAST leg fires it
   *  parks at `parkT` (becomes that leg's `endT`). Absent = arrive at a node. */
  parkT?: number;
}

/** A fleet parked at a continuous point ALONG a lane (it stopped mid-march, or
 *  marched to a point on the path — not a node). `t` ∈ (0,1) is the fraction
 *  from `from` to `to`. Mutually exclusive with `location`/`movement`: a fleet is
 *  either at a node, in transit, or parked on a lane. */
export interface FleetEdge {
  from: PlanetId;
  to: PlanetId;
  t: number;
}

export interface Fleet {
  id: FleetId;
  owner: PlayerId;
  /** Current location, or null while in transit / parked on a lane. */
  location: PlanetId | null;
  movement: FleetMovement | null;
  /** Parked at a continuous point on a lane (stopped mid-march or marched to a
   *  point on the path). Set only while `location` and `movement` are both null. */
  edge?: FleetEdge | null;
  units: UnitStack[];
  /** Ground army carried as cargo (the landing force of a ground assault),
   *  bounded by the ships' transport capacity — see the `army` module. */
  landing?: UnitStack[];
  /** Set (`'near'`) while the fleet is stationed in orbit at a planet; undefined while
   *  in transit. There is a SINGLE orbit (GDD §7.4): a stationed fleet can bombard /
   *  land and is exposed to the planet's orbital AA — no separate "far" safe standoff.
   *  (The value stays `'near'` for back-compat; the old near/far split was collapsed.) */
  orbit?: 'near';
  /** Whether the fleet is actively bombarding the planet below (in orbit over a
   *  hostile world). Damages structures and freezes the owner's production. */
  bombarding?: boolean;
  traits: TraitId[];
  /** Id of the battle this fleet is engaged in; absent/null when free to move. */
  battleId?: BattleId | null;
  /** Player-chosen focus-fire target for this fleet's artillery standoff fire
   *  (`fleet.barrage`). Absent/null = auto-target the nearest hostile in range.
   *  Cleared automatically once the target dies or drifts out of range. */
  barrageTarget?: FleetId | null;
  /** Rules of engagement for this fleet's artillery standoff fire. Absent = the
   *  `standard` default. See `BarrageMode`. */
  barrageMode?: BarrageMode;
  /** Set true once this fleet has taken combat damage — the trigger for the
   *  `return` ("ответный") fire mode, which holds fire until first hit. */
  barrageProvoked?: boolean;
  /** World-time (ms) this fleet last took damage. Gates shield regen: shields stay
   *  down for a delay after the last hit (shields-roadmap SH-1.1). Absent = never hit. */
  lastDamagedAt?: number;
  /** World-time (ms) until which this fleet's travel speed is boosted after a
   *  `fleet.retreat` — the disengaging fleet flees faster while `now < it`. Absent =
   *  no boost. Read by the `fleet.speed` hook. */
  retreatHasteUntil?: number;
  /** Free-space position for squadron/missile fleets that move OFF the lane graph.
   *  Set when the fleet is launched from a carrier/base; the fleet flies freely
   *  within `strikeRange` of its `homeBase`. Null/absent = a regular lane-bound fleet. */
  freePosition?: { x: number; y: number } | null;
  /** Active free-space flight: the fleet is flying from `freePosition` toward
   *  `targetX,targetY` (a point in space, not a node). Arrives at `arrivesAt`.
   *  Null/absent = parked at `freePosition` (not currently flying). */
  freeMovement?: { targetX: number; targetY: number; departedAt: number; arrivesAt: number } | null;
  /** The fleet this one was launched from (its carrier/base). A squadron must stay
   *  within `strikeRange` of its home base's position. Absent = not a launched fleet. */
  homeBase?: FleetId | null;
  /** Point-defense cooldown: world-time (ms) until which this fleet's PD system
   *  is recharging after a volley. Absent/0 = ready to fire. PD fires reactively
   *  when an enemy squadron enters range, then cools down for 20 game-minutes. */
  pdCooldownUntil?: number;
}

/**
 * Rules of engagement for a fleet's artillery standoff fire (an aggression
 * ladder):
 *  - `passive`    — never auto-fire (hold fire).
 *  - `return`     — fire only after the fleet has taken damage (`barrageProvoked`).
 *  - `standard`   — fire at the nearest enemy at WAR (the default).
 *  - `aggressive` — fire at the nearest fleet that is NOT a pact/alliance partner
 *                   (i.e. `war` OR `peace`), opening fire on non-allied neighbours.
 */
export type BarrageMode = 'passive' | 'return' | 'standard' | 'aggressive';

/**
 * A combatant in a battle — the ship units of a fleet (orbital), the landing
 * troops a fleet carries (ground assault), or a planet's garrison (ground
 * defense). One round engine drives all three (GDD §7.3).
 */
export type CombatantRef =
  | { kind: 'fleet'; fleetId: FleetId }
  | { kind: 'landing'; fleetId: FleetId }
  | { kind: 'garrison'; planetId: PlanetId };

export interface BattleSide {
  ref: CombatantRef;
  /** Owner of this side (for victory / planet ownership). */
  owner: PlayerId | null;
}

/**
 * An ongoing battle — a stateful entity that resolves over real hours, one
 * round per `combat.tick` (GDD §7). Capturing a planet is two sequential
 * battles: `orbital` (fleet vs fleet) then `ground` (landing vs garrison) — §7.4.
 */
export interface Battle {
  id: BattleId;
  /** Contested planet where the engagement happens. */
  location: PlanetId;
  phase: 'orbital' | 'ground';
  attacker: BattleSide;
  defender: BattleSide;
  /** Rounds resolved so far. */
  round: number;
  /** Server time (ms) the next hourly round fires — the live battle timer the
   *  client counts down to. Set whenever a round is scheduled. */
  nextRoundAt?: number;
}

/**
 * A future occurrence on the world timeline: fleet arrival, construction
 * complete, a recurring combat tick, a dark event, ... The game is real-time
 * (continuous wall-clock time, like the Bytro titles), so durations are
 * expressed by scheduling an event at a future `at` and letting `advanceTo`
 * fire it when the world reaches that instant (docs/architecture.md §4.1).
 *
 * The schedule lives inside the state so it is serializable, deterministic and
 * survives a server restart (the server also mirrors it as delayed jobs to know
 * *when to wake up*, but the source of truth is here).
 */
export interface ScheduledEvent {
  /** Stable id, e.g. `evt:42`. */
  id: string;
  /** When it fires (ms, server-authoritative). */
  at: number;
  /** Domain event type dispatched to module subscribers when it fires. */
  type: string;
  /** Event payload. */
  payload: unknown;
  /** Deterministic tiebreaker among events sharing the same `at`. */
  seq: number;
}

/**
 * Versions pinned to a match. Rules and the active module set are frozen per
 * match (docs/architecture.md §4.4, docs/modulesystem.md) — in-flight matches
 * keep their original rules, integrity-relevant for OWASP A08.
 */
export interface GameVersion {
  /** Game-data (JSON content) version. */
  data: string;
  /** Module-manifest version. */
  manifest: string;
  /** MP-4: content-integrity fingerprint of the game-data bundle this match was
   *  created with (`hashGameDataBundle`, `data/loadGameData.ts`) — deterministic,
   *  non-cryptographic. Stamped once at creation and persisted verbatim; a match
   *  LOADER re-hashes the currently-deployed bundle and refuses to resume on a
   *  mismatch ("подмена бандла меняет правила"). Optional: snapshots persisted
   *  before this field existed carry none and skip the check (graceful
   *  degradation, not a crash — matches the module system's own discipline). */
  dataHash?: string;
}

export interface GameState {
  version: GameVersion;
  /** Current simulation time (ms), server-authoritative. */
  time: number;
  /** World time (ms) at which the match began — the anchor for "session day N"
   *  gates (e.g. a technology's `dayGate`). Set to the initial `time` at creation;
   *  the match's elapsed day count is `(time − startedAt) / MS_PER_DAY`, the same
   *  formula the match browser shows (matchRegistry). Optional: matches persisted
   *  before this field existed read as 0 — correct for the 0-based world clock, and
   *  all such nodes are ungated (dayGate 0) anyway. */
  startedAt?: number;
  /** Terminal match state and the latest scoreboard. */
  match: MatchState;
  rng: RngState;
  players: Record<PlayerId, Player>;
  planets: Record<PlanetId, Planet>;
  fleets: Record<FleetId, Fleet>;
  battles: Record<BattleId, Battle>;
  /** Monotonic counter handing each battle its id. */
  battleSeq: number;
  /** Pending timeline, processed in (at, seq) order by `advanceTo`. */
  scheduled: ScheduledEvent[];
  /** Monotonic counter handing each scheduled event its deterministic `seq`. */
  scheduleSeq: number;
  /** Per-player fog-of-war memory (variant B): the last identified snapshot of
   *  each seen world. Maintained by `visibilityModule`; read by `visibleState`
   *  to show greyed "last known" worlds. Internal — stripped from projections. */
  fog?: Record<PlayerId, FogMemory>;
  /** Hero instances, keyed by instance id (`Hero.id`), maintained by `heroModule`.
   *  A player may field several — filter by `owner`. (Key was the `PlayerId` in the
   *  one-hero-per-player skeleton; instance-keyed since the roster migration.) */
  heroes?: Record<string, Hero>;
  /** Active temporary lanes opened by hero abilities — real graph edges for their
   *  duration (added to `Planet.links`), with a per-owner speed bonus. */
  tempLanes?: TempLane[];
  /** Topology version — bumped whenever `Planet.links` change (a temp lane opens or
   *  expires) so the movement route cache can invalidate. */
  topology?: number;
  /** Monotonic counter handing each temp lane its id. */
  heroSeq?: number;
  /** Pairwise diplomatic stances between players, keyed by a canonical unordered
   *  pair key (`pairKey`). Symmetric and PUBLIC (not fog-gated — who is at war /
   *  allied is open knowledge). A pair with no entry defaults to `DEFAULT_STANCE`
   *  (war), so absence = the engine's no-diplomacy FFA. Read/written through
   *  `state/diplomacy.ts`; `diplomacyModule` (D2) owns the actions and exposes it
   *  as the `diplomacy` capability that drives combat's `isHostile`. */
  diplomacy?: Record<string, DiplomaticStance>;
  /** Standing DE-ESCALATION offers (D3), keyed by the directed `offerKey`
   *  (`from>to`) → the friendlier stance offered. An offer is recorded by a
   *  friendly `diplomacy.declare` and commits when the other side declares the
   *  same stance (mutual consent); any escalation between the pair voids both
   *  directions. Unlike `diplomacy`, offers are PRIVATE to the two parties —
   *  `visibleState` strips everyone else's negotiations. Maintained by
   *  `diplomacyModule`; helpers in `state/diplomacy.ts`. */
  diplomacyOffers?: Record<string, DiplomaticStance>;
  /** MAPSHARE-1. Договоры об ОБМЕНЕ КАРТАМИ, ключ — симметричный `pairKey`.
   *
   *  Это НЕ ступень дипломатической лестницы, а отдельное соглашение поверх неё:
   *  лестница `war→peace→pact→alliance` линейна и задаёт враждебность, а обмен
   *  картами ортогонален — его заключают и при мире, и при пакте, и он не делает
   *  участников союзниками. Даёт ровно два права: делится разведкой (`coverageFor`
   *  пулит покрытие так же, как по `alliance`) и пускает чужой десант на свою землю
   *  (`army.unload`). НЕ даёт: союзного отношения в бою (`stanceToRelation` не
   *  трогается) и места в коалиции для победы (`victory.ts` считает только
   *  взаимно-союзные клики).
   *
   *  Заключается по взаимному согласию (тот же consent-протокол, что у смягчения
   *  стойки), расторгается односторонне и рвётся сам при объявлении войны. Симметричен
   *  и ПУБЛИЧЕН, как `diplomacy`: кто с кем делится картой — не тайна. */
  mapShares?: Record<string, true>;
  /** Стоящие ПРЕДЛОЖЕНИЯ обмена картами, ключ — направленный `offerKey` (`from>to`).
   *  Приватны для двух сторон, как `diplomacyOffers` — `visibleState` вырезает чужие
   *  переговоры. */
  mapShareOffers?: Record<string, true>;
  /** Stolen intel windows per beneficiary (`espionageModule`). PRIVATE: a viewer's
   *  projection carries only their own grants — who spies on whom is never public. */
  intel?: Record<PlayerId, IntelGrant[]>;
  /** Session resource market: a public per-match order book maintained by
   *  `marketModule`. Sellers escrow a resource at a price; buyers pay money. */
  market?: MarketOrder[];
  /** Monotonic counter handing each market order its id. */
  marketSeq?: number;
  /** A player's designated capital world (`capitalModule`, `capital.designate`) — the
   *  hero respawn anchor (`heroModule` falls back to `[hero.home, hero.location]`).
   *  Absent for a player who never (re-)designated ⇒ their heroes' `home` is whatever
   *  was seeded at match start (usually the homeworld); designating updates both this
   *  map AND every owned hero's `home` in one action. */
  capital?: Record<PlayerId, PlanetId>;
  /** CC-2 auto-storm: fleet ids with "auto-assault when idle at a hostile world"
   *  armed (`standingOrdersModule`, `order.auto`). A driver reads this; the module
   *  itself only stores the flag and garbage-collects it for dead fleets. */
  autoAssault?: Record<FleetId, true>;
  /** CC-4 дежурный вылет ("standing patrol"): a squadron wing armed to auto-scramble
   *  at the nearest identified hostile within `radius` of `center`, maintained by
   *  `standingOrdersModule` (`order.scramble` arms/disarms; `patrol.stamp` is the
   *  server driver's own runtime update of `sortie`/`rearmAt` — never client-issuable,
   *  see `actions/payloadSchemas.ts`). */
  patrols?: Record<FleetId, PatrolEntry>;
  /** A wing's sortie budget stashed while its patrol is disarmed (`order.scramble`
   *  off) — carries `fuel`/`rearming` forward instead of resetting on re-arm. */
  wingSorties?: Record<FleetId, SortieState>;
  /** CC-1 order chains: a fleet's queued plan (`standingOrdersModule`, `order.chain`
   *  sets/replaces it; `chain.stamp` is the server driver's own runtime update of
   *  the consumed head / armed wait deadline — never client-issuable). */
  orders?: Record<FleetId, FleetChain>;
  /** BOOST-1 форс-марш: fleet ids currently marching at +50% speed for 5% max-hp
   *  wear per game-hour in transit (`forcedMarchModule`, `fleet.forcemarch`). */
  forcedMarch?: Record<FleetId, true>;
  /** PVE-3: the wave counter of a PvE match (`pveModule`). Present only once the
   *  module has recognised the match as PvE (its mode carries a `pve` section) AND
   *  found the NPC seat; absent everywhere else, so a PvP match carries no trace of
   *  the mechanic. The next wave's time lives in `scheduled`, like every other future
   *  occurrence — `nextWaveAt` is a READ-ONLY echo for the HUD, never the source of
   *  truth about when the wave fires. */
  pve?: PveState;
}

/** PvE wave progress (`pveModule`, docs/pve-team-modes-roadmap.md Фаза 3). */
export interface PveState {
  /** Waves that have already landed. 0 until the first one fires. */
  waveNumber: number;
  /** Waves this match must survive, copied from the mode's `pve.waves` at seed —
   *  the match keeps running under the rules it started with even if content changes. */
  totalWaves: number;
  /** The seat the NPC enemy plays (resolved once, by the mode's `npcFaction`). */
  npcPlayerId: PlayerId;
  /** World time the next wave is due — an echo of the scheduled event, for the HUD.
   *  Absent once the last wave has landed. */
  nextWaveAt?: number;
}

/** A standing patrol's launch anchor + reach + current sortie budget (CC-4). */
export interface PatrolEntry {
  center: { x: number; y: number };
  radius: number;
  sortie: SortieState;
  /** World-time (ms) the rearm cadence next ticks; stamped by the server driver. */
  rearmAt?: number;
}

/** Which side of the book a standing order sits on (CONV-9). */
export type MarketSide = 'sell' | 'buy';

/** A standing order on the session market. Both sides ESCROW up front, so nothing
 *  on the book can be double-spent:
 *
 *   - `sell` — the owner escrowed `amount` of `resource` and wants credits for it;
 *   - `buy`  — the owner escrowed `amount × price` credits and wants the goods.
 *
 *  Filled (partially) by `market.take`; the remainder is refunded on cancel. The
 *  book used to be sell-only here and two-sided in the prototype's copy — CONV-9
 *  merged them, taking the richer shape. */
export interface MarketOrder {
  id: string;
  side: MarketSide;
  /** Who placed it and whose escrow is held (was `seller` while the book was sell-only). */
  owner: PlayerId;
  resource: ResourceId;
  /** Remaining units on offer (escrowed). */
  amount: number;
  /** Price per unit, in money (`credits`). */
  price: number;
}

/** A player's hero — a per-player entity with a position on the map and ability
 *  cooldowns. Acts from its current node (`location`); relocates with `hero.move`. */
export interface Hero {
  /** Instance id — the key under which this hero lives in `GameState.heroes`.
   *  Identifies the hero across events (death/respawn) independently of `owner`. */
  id: string;
  owner: PlayerId;
  /** SEAT identity of a main hero — the callsign the player signed in with, or the
   *  house id of the seat in a solo match. Written only where a seat exists (the
   *  prototype's `matchSetup`); a roster hero carries none.
   *
   *  NOT a display name (AUD-13): human-readable text must never be stored in
   *  `GameState`, because the state is shared by every player while the locale is
   *  per-viewer — anything written here reaches the screen untranslated. A hero's
   *  NAME is built by the renderer from `archetype` (→ `data.heroes[a].name`);
   *  what lives here is an identity that has no translation (a nick) or that the
   *  renderer localises by key (a house). */
  name?: string;
  /** The node the hero currently occupies / respawns at (abilities act from here,
   *  the projection hero returns here after dying). */
  location: PlanetId;
  /** Per-ability `readyAt` timestamp (ms): the ability is on cooldown while now < it.
   *  The projection hero's death timer lives under the `respawn` key. */
  cooldowns: Record<string, number>;
  /** False while the hero is dead and awaiting respawn; absent/true ⇒ alive. */
  alive?: boolean;
  /** Rarity tier (e.g. `common` | `rare` | `legendary` | `main`). Drives the client
   *  roster's module-slot count; the core carries it but does not enforce slots. */
  grade?: string;
  /** Equipped ability "modules", one per grade slot (`null` = empty). Carried with the
   *  hero; per-module gating/effects are a later brick. */
  abilities?: (string | null)[];
  /** Active passive ids (→ `data.heroPassives`, HERO-5): always-on hook contributions
   *  while the hero is alive. Copied from the archetype's `startPassives` at seed. */
  passives?: string[];
  /** The archetype this hero instantiates (→ `data.heroes`, HERO-3): resolves the ship
   *  unit its fleet forms with on spawn/respawn. Absent ⇒ the default `hero` unit. */
  archetype?: string;
  /** Unlocked skill-tree node ids (→ `data.heroSkillTrees`, HERO-7). Grants applied on
   *  unlock land in `abilities`/`passives`; the list itself gates `requires` chains. */
  skills?: string[];
  /** Installed ship fittings (→ `data.heroFittings`, HERO-6), capped by the archetype's
   *  `slots`. Installed for good — no refit (the ship-modules owner rule). */
  fittings?: string[];
  /** Respawn anchor — the owner's capital. A slain hero re-forms here if still held;
   *  absent ⇒ the core falls back to the hero's last node, then any owned world. */
  home?: PlanetId;
  /** The fleet this hero commands (its ship) while deployed; cleared on death. Lets a
   *  death be attributed to the right hero when several share an owner. */
  fleetId?: FleetId;
  /** Active time-boxed combat auras cast via `hero.effect.aura` (rally/bulwark) — each
   *  adds `bonus` to the `combat.damage` of the owner's fleets within `radius` of the
   *  hero's node until `until` (ms). Filtered by `until` at read time; pruned on cast. */
  activeAuras?: { bonus: number; radius: number; until: number }[];
  /** Active time-boxed fog reveals cast via `hero.effect.reveal` (scan) — each lifts the
   *  fog to full-identify detail for every world within `radius` of `center` until `until`
   *  (ms), but only in the OWNER's own visibility projection. Filtered by `until` at read
   *  time; pruned on cast. */
  activeReveals?: { center: PlanetId; radius: number; until: number }[];
}

/** A temporary lane a hero opened: a real, routable graph edge between two nodes for
 *  a limited time, granting the owner's fleets a speed bonus along it. */
export interface TempLane {
  id: string;
  owner: PlayerId;
  from: PlanetId;
  to: PlanetId;
  /** Speed multiplier bonus for the owner's fleets traversing this lane (e.g. 0.5). */
  speedBonus: number;
  /** Simulation time (ms) the lane closes. */
  expiresAt: number;
  /** Whether the lane ADDED the `links` edge (vs the nodes were already linked) — so
   *  expiry only removes a link the lane itself created. */
  addedLink: boolean;
  /** HERO-CORRIDOR — ступень способности, она же ПРАВО ПРОХОДА:
   *  · `1` — одноразовый: идёт только стак с этим героем, коридор закрывается, как
   *    только эта армия ПРИБЫЛА (не когда вышла — иначе она летела бы по уже
   *    закрытому коридору);
   *  · `2` — временный: то же право прохода, но живёт до `expiresAt`;
   *  · `3` — общий: по нему двигаются ВСЕ — враг, союзник, свои, нейтральные.
   *
   *  Ступени 1–2 держатся ВЕТО ПО РЕБРУ в маршрутизаторе: ребро в графе есть (без него
   *  не посчитать геометрию), но чужому оно закрыто. Раньше ступени не было вовсе, и
   *  коридор вёл себя как ступень 3 ДЛЯ ВСЕХ — то есть уже был проходим врагом, просто
   *  без бонуса скорости. Отсутствие поля читается как `1` (fail-secure: по умолчанию
   *  коридор ЛИЧНЫЙ, а не общий). */
  tier?: number;
  /** Герой, чей это коридор — на ступенях 1–2 право прохода у флота, который его несёт.
   *  Флот меняется (герой пересаживается), поэтому храним героя, а не флот. */
  heroId?: string;
}

/** A player's remembered last-known state of one world (fog-of-war memory). */
export interface PlanetSnapshot {
  owner: PlayerId | null;
  garrison: UnitStack[];
  buildings: BuildingInstance[];
  terrain?: string;
  planetType?: string;
  /** Province type (`kind`) at snapshot time — so a remembered node renders its
   *  last-known appearance, and an unseen node never leaks its true kind. */
  kind?: string;
  /** Simulation time (ms) this snapshot was taken. */
  at: number;
}
/** One player's memory: last-known snapshot per world they have ever identified. */
export type FogMemory = Record<PlanetId, PlanetSnapshot>;

/** Creates an empty, deterministically-seeded initial state. */
export function createInitialState(params: {
  seed: string | number;
  version: GameVersion;
  time?: number;
}): GameState {
  return {
    version: params.version,
    time: params.time ?? 0,
    startedAt: params.time ?? 0,
    match: { status: 'ongoing', winner: null, scores: {} },
    rng: seedRng(params.seed),
    players: {},
    planets: {},
    fleets: {},
    battles: {},
    battleSeq: 0,
    scheduled: [],
    scheduleSeq: 0,
  };
}
