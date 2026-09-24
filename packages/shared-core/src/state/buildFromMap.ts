import type { GameData } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { hashGameDataBundle } from '../data/loadGameData';
import { avaShape, type MatchMap } from '../data/mapSchema';
import {
  createInitialState,
  type DiplomaticStance,
  type Fleet,
  type GameState,
  type Hero,
  type Planet,
  type Player,
  type PlayerArsenal,
} from './gameState';
import { pairKey } from './diplomacy';
import { distance } from './route';
import { mosaicBorderSegments, mosaicBorders, sealPlan, type MosaicSeed } from './mosaic';
import { deriveRoads, shareRoadNetwork } from './roads';

/**
 * Map-as-content loader (map-roadmap.md M1.2 / M1.3). Turns a validated `MatchMap`
 * into a runtime `GameState`, deriving each sector's `links` from the undirected
 * `paths` edge list. Pure and deterministic (no time/random): same map + data →
 * same state. Replaces the procedural prototype map and the hard-coded server
 * scenario with a single "load this map file" path.
 */

/** The adjacency a map actually plays on, plus what terrain shut. */
export interface MapEdges {
  /** Travelable lanes — an undirected edge list, canonical and sorted when derived. */
  paths: Array<[string, string]>;
  /** Borders that EXIST on the mosaic but carry no lane (derived maps only). */
  sealed: Array<[string, string]>;
  /** Sectors terrain could not bring within budget without cutting the map in two. */
  overBudget: string[];
  /** Did this come from the mosaic (`true`) or from the map's own `paths` (`false`)? */
  derived: boolean;
}

/**
 * Resolve a map's adjacency (M4.3). A map that declares `paths` plays on exactly those,
 * as always. A map that OMITS them derives them from the province mosaic: geometry
 * proposes every shared border, terrain seals the surplus (`maxLinks`), and an impassable
 * kind seals all of its own — so the drawn border and the travelable lane are one graph
 * instead of two that silently disagree (see `mosaic.ts`).
 *
 * Degrades rather than crashes without `data`: with no catalogue there are no budgets, so
 * every shared border stays open.
 */
/** The mosaic's sites for a map — sorted ids, positions, sizes. ONE place builds them,
 *  because the lanes and the roads (`roads.ts`) must be read off the same mosaic: seeds
 *  in a different order or scale would be a different diagram. */
function mosaicSeedsOf(map: MatchMap): MosaicSeed[] {
  return Object.keys(map.sectors)
    .sort()
    .map((id) => {
      const sec = map.sectors[id]!;
      return { id, x: sec.position.x, y: sec.position.y, size: sec.size };
    });
}

export function matchMapEdges(map: MatchMap, data?: GameData): MapEdges {
  if (map.paths !== undefined) {
    return { paths: map.paths, sealed: [], overBudget: [], derived: false };
  }
  const ids = Object.keys(map.sectors).sort();
  const seeds = mosaicSeedsOf(map);
  const budgetOf = (id: string): number => {
    if (!data) return Number.POSITIVE_INFINITY;
    const sec = map.sectors[id];
    if (sec?.kind !== undefined && data.sectorKinds[sec.kind]?.traversable === false) return 0;
    return sec?.terrain !== undefined
      ? (data.sectors[sec.terrain]?.maxLinks ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
  };
  const plan = sealPlan(mosaicBorders(seeds), budgetOf, ids);
  return {
    paths: plan.open.map((b) => [b.a, b.b] as [string, string]),
    sealed: plan.sealed.map((b) => [b.a, b.b] as [string, string]),
    overBudget: plan.overBudget,
    derived: true,
  };
}

/**
 * Structural + geometric validation of a map (M1.3). Returns a list of stable
 * issue codes (empty = valid); `buildStateFromMap` rejects on any. Beyond shape
 * (zod already did that), this enforces the **neighbour-only** path rule: a path
 * may join two sectors only if no third sector lies "between" them — nothing inside
 * the circle having A—B as its diameter (the Gabriel criterion). That still forbids
 * long criss-crossing lanes, but it proposes generously: a sector in open space
 * really does reach everything near it.
 *
 * Geometry decides which lanes are POSSIBLE; terrain decides how many of them a
 * sector actually carries (`SectorTypeDefSchema.maxLinks`, `E_SECTOR_OVERLINKED`).
 * The two together are why a province is sparse: not because the author drew few
 * lines, but because that region of space admits few — an asteroid cluster takes a
 * single approach, open space routes freely. Needs `data` (the budget lives there).
 */
export function validateMatchMap(map: MatchMap, data?: GameData): string[] {
  const issues: string[] = [];
  const ids = Object.keys(map.sectors);
  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(map.sectors, id);
  const isOwnerRef = (ref: string): boolean =>
    Object.prototype.hasOwnProperty.call(map.players, ref) ||
    Object.prototype.hasOwnProperty.call(map.slots, ref);
  // The lanes this map plays on: its own `paths`, or — when it omits them — the mosaic
  // borders minus what terrain seals (M4.3). Everything below validates THESE.
  const edges = matchMapEdges(map, data);

  // a slot id must not collide with a player id (an ambiguous owner reference)
  for (const sid of Object.keys(map.slots)) {
    if (Object.prototype.hasOwnProperty.call(map.players, sid)) issues.push(`E_SLOT_PLAYER_ID_CLASH:${sid}`);
  }

  // an AvA-eligible map must be a symmetric team map (AVA-5): ≥2 sides with an
  // equal number of slots each — the pool derives the map's shape from `slots`,
  // so a lopsided or teamless "eligible" map would silently never match a request
  if (map.avaEligible && avaShape(map) === null) issues.push('E_AVA_SHAPE');

  // owners reference a declared player or slot
  for (const [id, sec] of Object.entries(map.sectors)) {
    if (sec.owner != null && !isOwnerRef(sec.owner)) issues.push(`E_SECTOR_UNKNOWN_OWNER:${id}`);
    if (data) {
      if (sec.kind && !data.sectorKinds[sec.kind]) issues.push(`E_UNKNOWN_KIND:${id}`);
      if (sec.terrain && !data.sectors[sec.terrain]) issues.push(`E_UNKNOWN_TERRAIN:${id}`);
      if (sec.planetType && !data.planetTypes[sec.planetType]) issues.push(`E_UNKNOWN_PLANET_TYPE:${id}`);
      for (const b of sec.buildings) if (!data.buildings[b.type]) issues.push(`E_UNKNOWN_BUILDING:${b.type}`);
      for (const g of sec.garrison) if (!data.units[g.unit]) issues.push(`E_UNKNOWN_UNIT:${g.unit}`);
    }
  }

  // paths: known endpoints, no self-loop, no duplicate, neighbour-only
  const seen = new Set<string>();
  for (const [a, b] of edges.paths) {
    if (!has(a) || !has(b)) {
      issues.push(`E_PATH_UNKNOWN_SECTOR:${a}-${b}`);
      continue;
    }
    if (a === b) {
      issues.push(`E_PATH_SELF_LOOP:${a}`);
      continue;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) {
      issues.push(`E_PATH_DUPLICATE:${key}`);
      continue;
    }
    seen.add(key);
    // Derived lanes ARE mosaic borders, which is a wider (and different) criterion than
    // Gabriel's — judging them by it would reject the very adjacency the mosaic draws.
    if (edges.derived) continue;
    // Gabriel criterion: the lane is legal unless a third sector sits inside the
    // circle that has A—B as its diameter — i.e. unless something is genuinely IN
    // THE WAY. Deliberately more permissive than the relative-neighbourhood rule it
    // replaced (MAP-LINK): geometry is supposed to PROPOSE generously (open space
    // really does connect to everything nearby) and TERRAIN is what cuts the lanes
    // back down (`maxLinks` below). Under the old rule geometry alone capped every
    // node at ~2-3 lanes, so the terrain budget could never bind and "this province
    // is a dead end" had no in-world cause — it was an accident of coordinates.
    // Strictly WIDER than the old rule (a Gabriel neighbourhood contains the
    // relative one), so no previously valid map becomes invalid.
    const pa = map.sectors[a]!.position;
    const pb = map.sectors[b]!.position;
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const radius = distance(pa, pb) / 2;
    const between = ids.some(
      (c) => c !== a && c !== b && distance(mid, map.sectors[c]!.position) < radius,
    );
    if (between) issues.push(`E_PATH_NOT_NEIGHBOR:${key}`);
  }

  // A derived map is already within budget by construction (`sealPlan` shut the surplus).
  // What it could NOT shut without stranding a province is a real authoring problem — the
  // dots are placed so that some region carries more approaches than its terrain admits —
  // so it surfaces under the same code an authored map would get.
  for (const id of edges.overBudget) issues.push(`E_SECTOR_OVERLINKED:${id}`);

  // Link budget (MAP-LINK): terrain decides how many lanes a region can carry.
  // Geometry above says which sectors CAN see each other; this says how many of
  // those a world of that terrain actually admits — a dense asteroid cluster takes
  // one approach and is therefore a dead end, open space routes freely. Counted over
  // the accepted edges only, so a map already rejected above is not blamed twice.
  if (data && !edges.derived) {
    const degree = new Map<string, number>();
    for (const key of seen) {
      const [a, b] = key.split('|') as [string, string];
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    for (const [id, deg] of [...degree].sort()) {
      const terrain = map.sectors[id]?.terrain;
      const budget = terrain ? data.sectors[terrain]?.maxLinks : undefined;
      if (budget !== undefined && deg > budget) {
        issues.push(`E_SECTOR_OVERLINKED:${id}:${deg}>${budget}`);
      }
    }
  }

  // Impassability (MAP-BARRIER). A kind marked `traversable: false` is a HOLE in the
  // map, not a place: nothing may route through it and no lane may lead into it. The
  // flag existed since M2.1 but was read in exactly one place (the hero corridor), so
  // the shipped black hole was impassable only because its generator happened to give
  // it no edges — a convention, not a rule. Enforced here instead of in the router:
  // with no lanes there is nothing to route through, and the sector still does its job
  // by EXISTING, since the neighbour rule above kills any lane that would pass through
  // the space it occupies. That is what makes a rift a barrier rather than a label.
  // A derived map cannot reach here with a lane into a barrier: an impassable kind is
  // given a budget of ZERO, so every one of its borders is sealed before this runs.
  if (data && !edges.derived) {
    for (const key of seen) {
      const [a, b] = key.split('|') as [string, string];
      for (const end of [a, b]) {
        const kind = map.sectors[end]?.kind;
        if (kind !== undefined && data.sectorKinds[kind]?.traversable === false) {
          issues.push(`E_IMPASSABLE_HAS_LANE:${end}`);
        }
      }
    }
  }

  // Transit (MAP-TRANSIT): a sector may declare WHICH pairs of its neighbours connect
  // through it, so two lanes can cross the same province without meeting. The pairs
  // must name real neighbours — a pair pointing at a sector there is no lane to would
  // silently do nothing, which is the kind of "configured but inert" bug this file
  // exists to catch.
  const neighbours = new Map<string, Set<string>>();
  for (const key of seen) {
    const [a, b] = key.split('|') as [string, string];
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  for (const [id, sec] of Object.entries(map.sectors)) {
    if (!sec.transit) continue;
    const near = neighbours.get(id) ?? new Set<string>();
    const pairSeen = new Set<string>();
    for (const [a, b] of sec.transit) {
      if (a === b) {
        issues.push(`E_TRANSIT_SELF:${id}:${a}`);
        continue;
      }
      for (const end of [a, b]) {
        if (!near.has(end)) issues.push(`E_TRANSIT_NOT_NEIGHBOR:${id}:${end}`);
      }
      const pk = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (pairSeen.has(pk)) issues.push(`E_TRANSIT_DUPLICATE:${id}:${pk}`);
      pairSeen.add(pk);
    }
  }

  // …and the constraint must not strand anyone. Plain connectivity (below) walks the
  // undirected graph and cannot see transit, so a lane-crossing spec could leave a
  // sector reachable on the map yet unreachable to any fleet. Checked the way a fleet
  // actually travels: over (sector, lane it arrived by) states, from every start.
  if (ids.length > 1 && Object.values(map.sectors).some((sec) => sec.transit)) {
    const passable = (node: string, from: string | null, to: string): boolean => {
      const pairs = map.sectors[node]?.transit;
      if (!pairs || pairs.length === 0 || from === null) return true;
      return pairs.some(([a, b]) => (a === from && b === to) || (b === from && a === to));
    };
    for (const start of ids) {
      const seenNodes = new Set<string>([start]);
      const queue: Array<[string, string | null]> = [[start, null]];
      const seenStates = new Set<string>([`${start}\u0000`]);
      while (queue.length) {
        const [cur, from] = queue.shift()!;
        for (const next of neighbours.get(cur) ?? []) {
          if (!passable(cur, from, next)) continue;
          seenNodes.add(next);
          const sk = `${next}\u0000${cur}`;
          if (seenStates.has(sk)) continue;
          seenStates.add(sk);
          queue.push([next, cur]);
        }
      }
      for (const target of ids) {
        if (target !== start && !seenNodes.has(target)) {
          issues.push(`E_TRANSIT_UNREACHABLE:${start}->${target}`);
        }
      }
    }
  }

  // fleets reference an existing sector + a declared player
  for (const [id, fl] of Object.entries(map.fleets)) {
    if (!has(fl.location)) issues.push(`E_FLEET_UNKNOWN_SECTOR:${id}`);
    if (!isOwnerRef(fl.owner)) issues.push(`E_FLEET_UNKNOWN_OWNER:${id}`);
  }

  // graph connectivity (BFS over the valid undirected edges). Impassable sectors are
  // EXEMPT from the requirement: a rift or a black hole is a hole in the map, so
  // demanding a route to it would force the author to either drill a lane into the
  // barrier or switch the check off — and both defeat the barrier. What must stay
  // connected is everything a fleet can actually reach.
  const reachRequired = ids.filter((id) => {
    const kind = map.sectors[id]?.kind;
    return !(data && kind !== undefined && data.sectorKinds[kind]?.traversable === false);
  });
  if (reachRequired.length > 1) {
    const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const [a, b] of edges.paths) {
      if (has(a) && has(b) && a !== b) {
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
      }
    }
    const seenN = new Set<string>([reachRequired[0]!]);
    const queue = [reachRequired[0]!];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (!seenN.has(n)) {
          seenN.add(n);
          queue.push(n);
        }
      }
    }
    if (reachRequired.some((id) => !seenN.has(id))) issues.push('E_MAP_DISCONNECTED');
  }

  return issues;
}

/** Seats a concrete player into a map slot at session creation (the server
 *  orchestrator supplies these once it has matched accounts to slots). */
export interface SlotAssignment {
  /** Concrete player id to create and own this slot's sectors/fleets. */
  playerId: string;
  /** Display name (defaults to the player id). */
  name?: string;
  /** Faction tag — legacy/dormant field on `Player`; defaults to ''. */
  faction?: string;
  /** Chosen research leaders (a council of up to 2) — ids from `data.scientists` + an
   *  optional meta level (default 1), snapshotted onto the seated player. Distinct ids;
   *  unknown / duplicate / more-than-two fail the boot (fail-secure). */
  scientists?: Array<{ id: string; level?: number }>;
  /** @deprecated Legacy single-leader id — seated as a one-leader council when
   *  `scientists` is omitted. */
  scientist?: string;
  /** @deprecated Meta level for the legacy single `scientist`. Defaults to 1. */
  scientistLevel?: number;
  /** Pre-match technology picks (C3): ids from `data.technologies` granted as already
   *  COMPLETED at match start — their hook bonuses and unlocks apply from second one.
   *  A start kit may grant a mid-tree node directly (prerequisites are not enforced
   *  here — the kit designer's choice); unknown ids fail the boot (fail-secure). */
  technologies?: string[];
  /** Pre-match hero roster (HERO-9): up to 3 DISTINCT archetype ids from `data.heroes`,
   *  snapshotted like the scientist council (GDD §5.2). Each seeds an UNDEPLOYED hero
   *  instance anchored at the slot's first owned world (`home`), carrying the
   *  archetype's `startAbilities`/`startPassives`; the player raises ships with
   *  `hero.spawn` (HERO-3). Unknown / duplicate / more-than-three fail the boot. */
  heroes?: string[];
  /** Arsenal snapshot (ARS-3): what this seat OWNS and may build with, taken from
   *  the account's `ArsenalStore` when the session is assembled (AvA: at roster
   *  lock). Seated onto `Player.arsenal`; while present, `unit.build`/`hero.fit`
   *  enforce ownership (`E_NOT_OWNED`). Absent = unrestricted (dev matches, bots). */
  arsenal?: PlayerArsenal;
  /** Seat an AI-driven player (bot) into this slot. Default: human. */
  ai?: boolean;
}

export interface BuildFromMapOptions {
  /** Manifest version to pin into the match (defaults to '1'). */
  manifest?: string;
  /** Override the map's start time. */
  time?: number;
  /** Slot id → the player seated there. Required for every slot referenced as an
   *  `owner`; a slot-based (AvA) map is inert data until these are supplied. */
  slots?: Record<string, SlotAssignment>;
  /** Stance seeded BETWEEN the sides of a teamed (slot) map: `war` (default) —
   *  fight from the first hour; `peace` — the AvA peaceful start (AVA-8: the
   *  orchestrator later escalates to war by timer via `diplomacy.declare`).
   *  Ignored on a map without teams — a free-for-all seeds every pair at peace. */
  crossTeamStart?: 'war' | 'peace';
}

/** Seeds `state.diplomacy` from the seats' teams (AVA-1) — the same seeding the
 *  prototype's `newGame` does, ported to the server path. A map WITHOUT teams
 *  (plain declared players) is a free-for-all at PEACE — no marching through
 *  another commander's space and no combat until war is declared (the prototype
 *  convention, not the engine's bare `war` default). A TEAMED (slot) map seeds
 *  the same side ALLIED — win together, no friendly fire; seeded state, so it
 *  deliberately bypasses the `E_BOT_ALLIANCE` declare-gate (an AI teammate is a
 *  real ally and the SES-1 victory clique reads the stance) — and opposing
 *  sides per `crossTeamStart`. Pairs come from the sorted player ids, so the
 *  record is canonical: same seats → identical JSON. */
function seedTeamDiplomacy(
  teamOf: Map<string, string | undefined>,
  crossTeamStart: 'war' | 'peace',
  players: Record<string, Player>,
): Record<string, DiplomaticStance> | undefined {
  const ids = [...teamOf.keys()].sort();
  if (ids.length < 2) return undefined;
  const teamed = ids.some((id) => teamOf.get(id) !== undefined);
  const diplomacy: Record<string, DiplomaticStance> = {};
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const ta = teamOf.get(ids[i]!);
      const tb = teamOf.get(ids[j]!);
      const a = players[ids[i]!]!.npc;
      const b = players[ids[j]!]!.npc;
      diplomacy[pairKey(ids[i]!, ids[j]!)] = a === 'pirate' || b === 'pirate'
        ? 'war'
        : a === 'neutral' || b === 'neutral' || !teamed
          ? 'peace'
          : ta !== undefined && ta === tb
            ? 'alliance'
            : crossTeamStart;
    }
  return diplomacy;
}

/** Normalizes a slot's scientist council (new `scientists`, else the legacy single
 *  `scientist`) into ≤2 distinct, catalog-known leaders. Fail-secure at boot:
 *  `E_UNKNOWN_SCIENTIST` / `E_DUPLICATE_SCIENTIST` / `E_TOO_MANY_SCIENTISTS`. */
function resolveScientists(
  a: SlotAssignment,
  data: GameData,
): Array<{ id: string; level: number }> {
  const raw = a.scientists ?? (a.scientist ? [{ id: a.scientist, level: a.scientistLevel }] : []);
  if (raw.length > 2) throw new Error('E_TOO_MANY_SCIENTISTS');
  const seen = new Set<string>();
  return raw.map((s) => {
    if (!data.scientists[s.id]) throw new Error(`E_UNKNOWN_SCIENTIST: ${s.id}`);
    if (seen.has(s.id)) throw new Error(`E_DUPLICATE_SCIENTIST: ${s.id}`);
    seen.add(s.id);
    return { id: s.id, level: s.level ?? 1 };
  });
}

/** The roster cap — mirrors the hero module's active cap (docs/heroes.md: до трёх). */
const HERO_ROSTER_MAX = 3;

/** Validates a slot's hero roster (HERO-9): ≤3 distinct, catalog-known archetypes.
 *  Fail-secure at boot: `E_UNKNOWN_HERO` / `E_DUPLICATE_HERO` / `E_TOO_MANY_HEROES`. */
function resolveHeroes(a: SlotAssignment, data: GameData): string[] {
  const raw = a.heroes ?? [];
  if (raw.length > HERO_ROSTER_MAX) throw new Error('E_TOO_MANY_HEROES');
  const seen = new Set<string>();
  for (const id of raw) {
    if (!data.heroes[id]) throw new Error(`E_UNKNOWN_HERO: ${id}`);
    if (seen.has(id)) throw new Error(`E_DUPLICATE_HERO: ${id}`);
    seen.add(id);
  }
  return raw;
}

/** Build a `GameState` from a validated map. Throws `E_INVALID_MAP` listing the
 *  issue codes if the map fails {@link validateMatchMap} (fail-secure at boot). */
export function buildStateFromMap(map: MatchMap, data: GameData, options: BuildFromMapOptions = {}): GameState {
  const issues = validateMatchMap(map, data);
  if (issues.length > 0) throw new Error(`E_INVALID_MAP: ${issues.join('; ')}`);

  const base = createInitialState({
    seed: map.seed,
    version: { data: data.version, manifest: options.manifest ?? '1', dataHash: hashGameDataBundle(data) },
    time: options.time ?? map.time,
  });

  // per-sector links from the resolved adjacency (sorted = JSON-stable), plus the
  // borders terrain shut — a derived map publishes those so the renderer can draw the
  // barrier without re-deriving the geometry (M4.3).
  const edges = matchMapEdges(map, data);
  const links: Record<string, string[]> = {};
  const sealed: Record<string, string[]> = {};
  for (const id of Object.keys(map.sectors)) {
    links[id] = [];
    sealed[id] = [];
  }
  for (const [a, b] of edges.paths) {
    links[a]!.push(b);
    links[b]!.push(a);
  }
  for (const [a, b] of edges.sealed) {
    sealed[a]!.push(b);
    sealed[b]!.push(a);
  }
  // The roads inside each province (ROADS-1), read off the same mosaic as the lanes. An
  // authored `paths` map has no mosaic behind its lanes, so there the road crosses at the
  // midpoint between the centres.
  const roads = deriveRoads({
    sectors: Object.fromEntries(
      Object.entries(map.sectors).map(([id, sec]) => [
        id,
        { x: sec.position.x, y: sec.position.y, ...(sec.terrain ? { terrain: sec.terrain } : {}) },
      ]),
    ),
    lanes: edges.paths,
    borders: edges.derived ? mosaicBorderSegments(mosaicSeedsOf(map)) : [],
    corridorsOf: (terrain) => (terrain ? data.sectors[terrain]?.corridors : undefined),
  });

  // Resolve an owner ref (a player id or a slot id) to a concrete player id.
  // `validateMatchMap` already proved the ref is a known player or slot; a slot
  // named as an owner must have an assignment (fail-secure at boot).
  const slotAssign = options.slots ?? {};
  const resolveOwner = (ref: string): string => {
    if (Object.prototype.hasOwnProperty.call(map.players, ref)) return ref;
    const a = slotAssign[ref];
    if (!a) throw new Error(`E_SLOT_UNASSIGNED: ${ref}`);
    return a.playerId;
  };

  const planets: Record<string, Planet> = {};
  for (const [id, sec] of Object.entries(map.sectors)) {
    const planet: Planet = {
      id,
      owner: sec.owner == null ? null : resolveOwner(sec.owner),
      position: { x: sec.position.x, y: sec.position.y },
      links: [...new Set(links[id])].sort(),
      ...(sealed[id]!.length ? { sealed: [...new Set(sealed[id])].sort() } : {}),
      ...(sec.transit ? { transit: sec.transit.map(([a, b]) => [a, b] as [string, string]) } : {}),
      ...(roads[id] ? { roads: roads[id] } : {}),
      resources: {},
      buildings: sec.buildings.map((b) => ({
        type: b.type,
        level: b.level,
        hp: buildingLevel(data.buildings[b.type]!, b.level).hp,
      })),
      garrison: sec.garrison.map((g) => ({ unit: g.unit, count: g.count })),
      traits: [...sec.traits],
    };
    if (sec.terrain) planet.terrain = sec.terrain;
    if (sec.planetType) planet.planetType = sec.planetType;
    if (sec.kind) planet.kind = sec.kind;
    if (sec.size !== 1) planet.size = sec.size;
    planets[id] = planet;
  }

  const players: Record<string, Player> = {};
  for (const [id, pl] of Object.entries(map.players)) {
    players[id] = {
      id,
      name: pl.name,
      faction: pl.faction,
      status: 'active',
      resources: { ...pl.resources },
      ...(pl.ai ? { ai: true } : {}),
      ...(pl.npc ? { npc: pl.npc } : {}),
    };
  }
  // seat assigned slots as concrete players (start kit = the slot's resources)
  const heroes: Record<string, Hero> = {};
  for (const [slotId, a] of Object.entries(slotAssign)) {
    const slot = map.slots[slotId];
    if (!slot) continue; // ignore assignments for slots this map does not declare
    if (a.playerId.includes('|') || a.playerId.includes('>')) {
      // `|` is the diplomacy pair-key separator and `>` the DIRECTED offer-key
      // separator (see `pairKey`/`offerKey`) — an id carrying either would let two
      // ids concatenate into an ambiguous key and misattribute a stance or offer.
      // Fail-secure at boot.
      throw new Error(`E_BAD_PLAYER_ID: ${a.playerId}`);
    }
    const scientists = resolveScientists(a, data); // fail-secure: unknown / duplicate / >2
    for (const t of a.technologies ?? []) {
      if (!data.technologies[t]) throw new Error(`E_UNKNOWN_TECHNOLOGY: ${t}`); // fail-secure at boot
    }
    players[a.playerId] = {
      id: a.playerId,
      name: a.name ?? a.playerId,
      faction: a.faction ?? '',
      status: 'active',
      resources: { ...slot.resources },
      ...(a.ai ? { ai: true } : {}),
      ...(scientists.length ? { scientists } : {}),
      ...(a.technologies?.length ? { technologies: { completed: [...new Set(a.technologies)] } } : {}),
      // ARS-3: the ownership snapshot rides onto the seat — copied (unique+sorted)
      // so later mutations of the caller's object can't reach the frozen match.
      ...(a.arsenal
        ? {
            arsenal: {
              hulls: [...new Set(a.arsenal.hulls)].sort(),
              modules: [...new Set(a.arsenal.modules)].sort(),
            },
          }
        : {}),
    };
    // HERO-9: seed the roster as UNDEPLOYED hero instances anchored at the slot's
    // first owned world; hero.spawn (HERO-3) raises their ships in-match.
    const roster = resolveHeroes(a, data); // fail-secure: unknown / duplicate / >3
    if (roster.length > 0) {
      const home = Object.keys(map.sectors)
        .sort()
        .find((id) => map.sectors[id]!.owner === slotId);
      if (home === undefined) throw new Error(`E_HERO_NO_HOMEWORLD: ${slotId}`);
      roster.forEach((archetype, i) => {
        const def = data.heroes[archetype]!;
        const id = `hero:${a.playerId}:${i + 1}`;
        heroes[id] = {
          id,
          owner: a.playerId,
          // No `name`: `def.name` is catalogue PROSE, and prose in `GameState` can
          // never be localised (one state, one locale per viewer — AUD-13). The
          // archetype below is the name's source; the renderer resolves it.
          location: home,
          home,
          cooldowns: {},
          archetype,
          abilities: [...def.startAbilities],
          passives: [...def.startPassives],
        };
      });
    }
  }

  const fleets: Record<string, Fleet> = {};
  for (const [id, fl] of Object.entries(map.fleets)) {
    fleets[id] = {
      id,
      owner: resolveOwner(fl.owner),
      location: fl.location,
      movement: null,
      units: fl.units.map((u) => ({ unit: u.unit, count: u.count })),
      landing: fl.landing.map((u) => ({ unit: u.unit, count: u.count })),
      orbit: 'near',
      traits: [...fl.traits],
    };
  }

  // AVA-1: seed the pairwise stances from the seats' teams (a slot carries its
  // side; a plain declared player has none). Seated slots overwrite a same-id
  // plain entry, mirroring how the seating loop overwrites `players`.
  const teamOf = new Map<string, string | undefined>(
    Object.keys(map.players).map((id) => [id, undefined]),
  );
  for (const [slotId, a] of Object.entries(slotAssign)) {
    if (map.slots[slotId]) teamOf.set(a.playerId, map.slots[slotId]!.team);
  }
  const diplomacy = seedTeamDiplomacy(teamOf, options.crossTeamStart ?? 'war', players);

  return {
    ...base,
    players,
    // The road network never changes for the match: shared, not copied, by every kernel
    // step's clone (ROADS-7, `shareRoadNetwork`).
    planets: shareRoadNetwork(planets),
    fleets,
    ...(diplomacy ? { diplomacy } : {}),
    ...(Object.keys(heroes).length ? { heroes } : {}),
  };
}
