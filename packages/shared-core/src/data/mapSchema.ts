import { z } from 'zod';

import { ResourceBagSchema } from './schemas';

/**
 * Map-as-content (map-roadmap.md M1.1). A **map** is a data-driven match setup:
 * a graph of **sectors** (the atomic unit — a capture point with paths to its
 * neighbours; a planet is just a smaller sector) plus the starting players and
 * fleets. Validated here before it ever reaches the core (OWASP A05/A08), exactly
 * like the game-content bundle.
 *
 * A sector maps almost 1:1 onto the runtime `Planet` (sector) state; the loader
 * `buildStateFromMap` turns this into a `GameState`. The `paths` edge list is the
 * configurable adjacency — see `validateMatchMap` for the neighbour-only rule.
 */

const PositionSchema = z.object({ x: z.number(), y: z.number() });

const MapUnitStackSchema = z.object({
  unit: z.string(),
  count: z.number().int().positive(),
});

const MapBuildingSchema = z.object({
  type: z.string(),
  level: z.number().int().positive().default(1),
});

export const MapSectorSchema = z.object({
  position: PositionSchema,
  /** Province type (planet / asteroid / nebula / void_station / empty …). Projected to
   *  `Planet.kind` by the loader and resolved against game data `sectorKinds` —
   *  capturable / buildable / orbit + the build roster + map appearance. */
  kind: z.string().default('planet'),
  /** Terrain id → resolved against game data `sectors` (speed / HP modifiers). */
  terrain: z.string().optional(),
  /** World nature id → game data `planetTypes` (production / defense), if a planet. */
  planetType: z.string().optional(),
  /** Relative size / weight (default 1): how much territory the sector claims —
   *  borders with neighbours sit proportionally to size, so resizing one shifts
   *  the neighbours' borders evenly. */
  size: z.number().positive().default(1),
  /** Starting owner — a declared player id OR a slot id (a slot is resolved to a
   *  concrete player at load by `buildStateFromMap`); null / absent = neutral. */
  owner: z.string().nullable().default(null),
  buildings: z.array(MapBuildingSchema).default([]),
  garrison: z.array(MapUnitStackSchema).default([]),
  /** Which pairs of neighbours connect THROUGH this sector (MAP-TRANSIT). Absent =
   *  the sector is a full interchange: arriving by any lane you may leave by any other,
   *  which is how every sector behaved before and how most still do. Present = these
   *  pairs are the ONLY through-connections, so two lanes can cross the same province
   *  without meeting — a fleet running one of them cannot switch to the other in
   *  passing. Order within a pair is irrelevant (lanes are two-way). Validated in
   *  `validateMatchMap`: both ends must be real neighbours, no self-pair, no duplicate,
   *  and the map must stay reachable with the constraint applied. */
  transit: z.array(z.tuple([z.string(), z.string()])).optional(),
});

const MapPlayerSchema = z.object({
  name: z.string(),
  faction: z.string(),
  resources: ResourceBagSchema.default({}),
  /** AI-driven seat (bot). Rules may key off it (e.g. bots are not invitable to
   *  an alliance). Default: human. */
  ai: z.boolean().default(false),
  /** Map inhabitant, excluded from player seats and victory. Independent of `ai`:
   *  an NPC without a field controller holds its starting position and fights normally. */
  npc: z.enum(['pirate', 'neutral']).optional(),
});

/** A player id. `|` is barred: it is the diplomacy pair-key separator — an id
 *  containing it would make `pairKey('a|b','c')` collide with `pairKey('a','b|c')`
 *  and break the participant check that fogs diplomatic offers. */
const playerIdSchema = z.string().min(1).regex(/^[^|]+$/, 'player id must not contain "|"');

const MapFleetSchema = z.object({
  owner: z.string(),
  location: z.string(),
  units: z.array(MapUnitStackSchema).default([]),
  landing: z.array(MapUnitStackSchema).default([]),
});

/** How a slot's home is placed at session creation (read by the server
 *  orchestrator; the deterministic loader works on already-resolved ownership).
 *  `fixed` = the sectors this slot owns in the map; `choice` = player-picked from
 *  candidates; `random` = randomly assigned. */
export const SpawnPolicySchema = z.enum(['fixed', 'choice', 'random']);

/**
 * A team-aware **start slot** (`corporation-wars.md` §4): a start position
 * decoupled from any concrete player. AvA / matchmade maps declare slots instead
 * of baking in specific players; the orchestrator seats real players into slots at
 * session creation (`buildStateFromMap`'s `slots` assignments). A sector or fleet
 * names a slot id as its `owner`.
 */
export const MapSlotSchema = z.object({
  /** Side this slot fights for (e.g. 'A' / 'B'); a free-for-all map gives each slot its own team. */
  team: z.string(),
  /** Home-placement policy at session creation (orchestrator-read). */
  spawn: SpawnPolicySchema.default('fixed'),
  /** Starting resources granted to whoever fills the slot (a symmetric start kit). */
  resources: ResourceBagSchema.default({}),
});

/**
 * ДОПОЛНИТЕЛЬНАЯ ЗАДАЧА КАРТЫ — «миссия», которую игрок может выполнить по дороге
 * (решение владельца 2026-09-22). Объявляется здесь, а ПРОВЕРЯЕТСЯ чистым предикатом в
 * `decisions/missionObjectives.ts`: всё, что владелец назвал задачей, читается из
 * состояния матча напрямую, поэтому ни секции состояния, ни модуля ядра под это не
 * заводится. Тип объявлен ОДИН раз и здесь, потому что это форма ДАННЫХ карты; логика
 * живёт в `/decisions`, которые импортируют его отсюда.
 */
export const MapObjectiveSchema = z.object({
  /** Ключ локализации заголовка: в коде и в данных живёт КЛЮЧ, не текст. */
  id: z.string(),
  kind: z.enum(['control', 'raze', 'scout']),
  /** `control` — id провинций; `raze` — виды построек; `scout` не читает. */
  targets: z.array(z.string()).default([]),
  /** `scout` — сколько провинций опознать. */
  count: z.number().int().positive().optional(),
  /** Надбавка к награде за забег; складывается с выплатой за волны, а не заменяет её. */
  reward: z.number().nonnegative().default(0),
});
export type MapObjective = z.infer<typeof MapObjectiveSchema>;

export const MatchMapSchema = z.object({
  id: z.string(),
  seed: z.string(),
  /** Opts this map into the AvA pool (AVA-5, `corporation-wars.md` S4). The map's
   *  SHAPE — how many sides and slots per side — is deliberately NOT declared
   *  alongside: it is derived from `slots` by {@link avaShape}, so the tag can
   *  never drift out of sync with the actual layout. `validateMatchMap` rejects
   *  an eligible map whose slots are not a symmetric ≥2-side split (`E_AVA_SHAPE`). */
  avaEligible: z.boolean().default(false),
  /** World time the scenario starts at (default 0). */
  time: z.number().default(0),
  /** The mode this map DEFAULTS to being played under — an id from `data.modes`,
   *  resolved by {@link resolveMatchConfig}. It is the map's suggestion, not a lock:
   *  the host may arm a different mode, and a map without one is played under whatever
   *  the host picks (the pre-existing behaviour). Exists so that "which rules does this
   *  map want" is DATA rather than a branch at every call site — a PvE map and the
   *  `pve_waves` mode used to both exist and never be introduced to each other. */
  mode: z.string().optional(),
  sectors: z.record(z.string(), MapSectorSchema),
  /** Дополнительные задачи забега на этой карте. Пусто — карта без задач, и это
   *  нормальный случай: задачи ДОПОЛНИТЕЛЬНЫЕ, победа от них не зависит. */
  objectives: z.array(MapObjectiveSchema).default([]),
  /** Undirected adjacency: each pair is a two-way path. Order within a pair is
   *  irrelevant; symmetry, no self-loops and the neighbour-only rule are enforced
   *  in `validateMatchMap`.
   *
   *  **OMIT IT to derive adjacency from the mosaic** (M4.3, the model §0 asks for):
   *  neighbours are then whoever shares a border in the power diagram over the sector
   *  centres, minus what terrain seals (`maxLinks`). That is the only way the drawn
   *  border and the travelable lane cannot disagree — an authored list next to a drawn
   *  mosaic is two graphs, and on every shipped map they diverged. Authored paths stay
   *  supported (fixtures, the legacy prototype graphs) and keep the neighbour-only rule.
   *  An explicit `[]` means a map with no lanes at all, which is NOT the same thing. */
  paths: z.array(z.tuple([z.string(), z.string()])).optional(),
  players: z.record(playerIdSchema, MapPlayerSchema).default({}),
  /** Team-aware start slots (`corporation-wars.md`): start positions decoupled from
   *  concrete players. A sector/fleet `owner` may name a slot id; `buildStateFromMap`
   *  seats real players into slots via its `slots` assignments. */
  slots: z.record(z.string(), MapSlotSchema).default({}),
  fleets: z.record(z.string(), MapFleetSchema).default({}),
});

export type MatchMap = z.infer<typeof MatchMapSchema>;
export type MapSector = z.infer<typeof MapSectorSchema>;
export type MapSlot = z.infer<typeof MapSlotSchema>;
export type SpawnPolicy = z.infer<typeof SpawnPolicySchema>;

/** The derived AvA shape of a map: how many sides its slots declare and how many
 *  slots each side holds — `null` when the map has no slots, only one side, or
 *  the sides are uneven (not a symmetric team map). The slots themselves are the
 *  single source of truth (no separate declared numbers to drift out of sync);
 *  the pool (`pickAvaMap`, server/meta) matches this against the requested size. */
export function avaShape(map: MatchMap): { sides: number; slotsPerSide: number } | null {
  const counts = new Map<string, number>();
  for (const slot of Object.values(map.slots)) {
    counts.set(slot.team, (counts.get(slot.team) ?? 0) + 1);
  }
  if (counts.size < 2) return null;
  const sizes = [...counts.values()];
  const per = sizes[0]!;
  if (sizes.some((n) => n !== per)) return null;
  return { sides: counts.size, slotsPerSide: per };
}

/** Strict parse — throws on a malformed map (use at trusted boot). */
export function parseMatchMap(raw: unknown): MatchMap {
  return MatchMapSchema.parse(raw);
}

/** Non-throwing parse — for validating untrusted input before use (A05/A08). */
export function safeParseMatchMap(raw: unknown): z.ZodSafeParseResult<MatchMap> {
  return MatchMapSchema.safeParse(raw);
}
