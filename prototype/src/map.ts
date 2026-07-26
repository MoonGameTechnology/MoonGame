/**
 * The prototype's sector-type registry and the generated match map — a square,
 * mirror-symmetric 11×11 lattice of provinces wired by a relative-neighbourhood
 * graph. Extracted from `game.ts` (REFP-2): the block depended only on `data`
 * (for `SECTOR_TYPES` derivation) and the core `sectorKind` helpers, none of the
 * rest of `game.ts`. `game.ts` re-exports the public surface (`SECTOR_TYPES`,
 * `MapNode`, `SectorType`, `START_CANDIDATES`, `MAP`) for back-compat.
 */
import {
  allowedBuildings,
  hasOrbit,
  isBuildable,
  isCapturable,
} from '../../packages/shared-core/src/index';
import { data } from './prototypeData';

/**
 * Sector-type registry — the whole map is a graph of sectors, each of exactly one
 * type. Types are pure data: add/remove them freely; every type carries its own
 * properties, and rendering + behaviour read from here (no hard-coded sector logic).
 *   core       — terrain key in `data.sectors` (speed/HP bonuses) this type maps to
 *   capturable — can be owned/taken (empty space can't — only traversed)
 *   buildable  — structures can be raised here
 *   orbit      — has the orbital layer; fleets can station in orbit (cities, fortresses)
 *   color      — map accent for the type
 */
export interface SectorType {
  name: string;
  core: string;
  capturable: boolean;
  buildable: boolean;
  orbit: boolean;
  color: string;
  /** Province-centric build roster (the buildings raisable here). Absent = the
   *  default `BUILDABLE` set. Mirrors core `sectorKinds.allowedBuildings`. */
  allowedBuildings?: string[];
}
/** The prototype's UI delta per sector kind: display name, `data.sectors` terrain
 *  mapping and map colour, plus an optionally STRICTER build roster than the core's
 *  (asteroid: the UI offers only the starfort even though the core kind is open). */
interface SectorTypeUi {
  name: string;
  core: string;
  color: string;
  allowedBuildings?: string[];
}
const SECTOR_TYPE_UI: Record<string, SectorTypeUi> = {
  planet: { name: 'Planet', core: 'empty_space', color: '#5fd0ff' },
  nebula: { name: 'Nebula', core: 'nebula', color: '#8f6dff' },
  asteroid: {
    name: 'Asteroid Field',
    core: 'asteroid_field',
    color: '#d6a645',
    allowedBuildings: ['starfort'],
  },
  empty: { name: 'Empty Space', core: 'empty_space', color: '#46606e' },
  // new terrains — each maps to a core `data.sectors` entry for its speed/HP bonus
  ion_storm: { name: 'Ion Storm', core: 'ion_storm', color: '#6fe3ff' },
  dense_nebula: { name: 'Dense Nebula', core: 'dense_nebula', color: '#a78bff' },
  solar_flare: { name: 'Solar Flare Zone', core: 'solar_flare_zone', color: '#ff9f3a' },
  graveyard: { name: 'Derelict Graveyard', core: 'derelict_graveyard', color: '#9fb0a8' },
  // debris field — a fast but UN-capturable corridor (kind `debris_field` in sectorKinds)
  debris_field: { name: 'Debris Field', core: 'deep_void', color: '#2f4a59' },
  // dead world — a destroyed planet; re-claimable, only the salvage rig builds here
  dead_world: { name: 'Dead World', core: 'deep_void', color: '#5a4a4a' },
};

/** SECTOR_TYPES = UI delta + gameplay flags DERIVED from `data.sectorKinds` via the
 *  core's own resolution (permissive default for kinds the data doesn't list) — one
 *  source of truth for capturable/buildable/orbit, so the prototype can't drift from
 *  what the kernel actually enforces. `allowedBuildings` stays the UI roster: the
 *  prototype may be stricter than the core (asteroid), else it mirrors the data
 *  (dead_world's salvage rig comes from `data.sectorKinds`). */
export const SECTOR_TYPES: Record<string, SectorType> = Object.fromEntries(
  Object.entries(SECTOR_TYPE_UI).map(([kind, ui]) => {
    const planet = { kind };
    const roster = ui.allowedBuildings ?? allowedBuildings(data, planet);
    const type: SectorType = {
      name: ui.name,
      core: ui.core,
      color: ui.color,
      capturable: isCapturable(data, planet),
      buildable: isBuildable(data, planet),
      orbit: hasOrbit(data, planet),
      ...(roster === undefined ? {} : { allowedBuildings: roster }),
    };
    return [kind, type];
  }),
);

// --- the map -----------------------------------------------------------------

/** One sector node. `sector` is its type key (see SECTOR_TYPES); `links` are the
 *  paths to neighbouring sectors; `type` is the planet-type (bonuses) for worlds. */
export interface MapNode {
  id: string;
  owner: string | null;
  x: number;
  y: number;
  sector: string;
  type?: string;
  links: string[];
  buildings?: Array<{ type: string; level?: number }>;
  garrison?: Array<[string, number]>;
}

type KeyNode = Omit<MapNode, 'links'>;

// A SQUARE, ORGANIC contested field: a jittered 11×11 lattice (equal cell spacing, no rigid
// grid look) wired to neighbours by a relative-neighbourhood graph. EXACTLY 30 are 'planet'
// kind — 10 START candidates around the perimeter (where players & AI spawn) + 20 neutral
// worlds — and the other 91 are non-planet provinces, so the board totals ~2410 base points
// (30×50 + 91×10); a solo win needs 1100 (SCORE_LIMIT). All planets start NEUTRAL; newGame()
// seeds owners + homes at the chosen starts. The jitter is deterministic (seeded sine hash)
// → reproducible. Square aspect so it reads well in portrait (fills width, pans vertically).
//
// FAIRNESS (self-play M4 finding): the field is mirror-symmetric in BOTH axes — jitter,
// terrain kinds and planet types are computed for the canonical quadrant cell and
// mirrored out. The ten starts form three mirrored orbits (4 + 2 + 4), keeping opposite
// seats equivalent while fitting ten evenly-spaced homes on a square perimeter. The first
// asymmetric layout gave one corner ~6× the nearby province value (70 vs 410 points
// within 3 hops) and that start won 100% of seeded bot matches regardless of slot
// or faction. Competitive skirmish maps are symmetric for exactly this reason; the
// per-quadrant jitter keeps the organic look.
const FIELD = { cols: 11, rows: 11, x0: 150, dx: 145, y0: 150, dy: 145, jitter: 0.4 };
const NON_PLANET_KINDS = [
  'asteroid',
  'nebula',
  'graveyard',
  'ion_storm',
  'dense_nebula',
  'solar_flare',
];
const NEUTRAL_PLANET_TYPES = [
  'oceanic',
  'volcanic',
  'fortress_world',
  'relic_world',
  'gas_giant',
  'irradiated',
  'ringworld',
  'crystalline',
];
// 10 start candidates around the inset perimeter: three along the top/bottom and two
// along each side. Ordering follows the perimeter clockwise so automatic seat placement
// spreads through the board predictably.
const START_CELLS = ['2,1', '5,1', '8,1', '9,3', '9,7', '8,9', '5,9', '2,9', '1,7', '1,3'];
// 20 neutral 'planet' worlds in five four-cell axis-symmetric orbits. Combined with the
// ten starts this preserves the old density: three planet provinces per maximum seat.
const NEUTRAL_PLANET_CELLS = [
  '3,3',
  '7,3',
  '3,7',
  '7,7',
  '2,0',
  '8,0',
  '2,10',
  '8,10',
  '4,2',
  '6,2',
  '4,8',
  '6,8',
  '2,4',
  '8,4',
  '2,6',
  '8,6',
  '4,4',
  '6,4',
  '4,6',
  '6,6',
];

const cellId = (cell: string): string => {
  const [c, r] = cell.split(',');
  return `C${c}R${r}`;
};
/** Deterministic 0..1 hash for the organic jitter (no Math.random → reproducible map). */
function jhash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildField(): KeyNode[] {
  const starts = new Set(START_CELLS);
  const neutralP = new Set(NEUTRAL_PLANET_CELLS);
  const maxCol = FIELD.cols - 1;
  const maxRow = FIELD.rows - 1;
  const midCol = maxCol / 2;
  const midRow = maxRow / 2;
  // Canonical quadrant cell: fold (col,row) around the two centre axes. Jitter, terrain and
  // planet type are decided ONCE per canonical cell and mirrored to its orbit, which
  // is what makes opposite regions exactly equivalent (see the FIELD comment).
  const canon = (c: number, r: number): string =>
    `${Math.min(c, maxCol - c)},${Math.min(r, maxRow - r)}`;
  const jx = new Map<string, number>();
  const jy = new Map<string, number>();
  const kindOf = new Map<string, string>();
  const typeOf = new Map<string, string>();
  let ptIdx = 0; // cycles neutral planet types (per orbit)
  let npIdx = 0; // cycles non-planet terrains (per orbit)
  let i = 0; // jitter index (per canonical cell)
  for (let row = 0; row <= midRow; row += 1) {
    for (let col = 0; col <= midCol; col += 1) {
      const key = `${col},${row}`;
      jx.set(key, (jhash(i * 2) - 0.5) * 2 * FIELD.jitter * FIELD.dx);
      jy.set(key, (jhash(i * 2 + 1) - 0.5) * 2 * FIELD.jitter * FIELD.dy);
      i += 1;
      if (starts.has(key)) continue; // start orbit — always the terran home
      if (neutralP.has(key)) {
        typeOf.set(key, NEUTRAL_PLANET_TYPES[ptIdx++ % NEUTRAL_PLANET_TYPES.length]!);
      } else {
        kindOf.set(key, NON_PLANET_KINDS[npIdx++ % NON_PLANET_KINDS.length]!);
      }
    }
  }
  const nodes: KeyNode[] = [];
  for (let row = 0; row < FIELD.rows; row += 1) {
    for (let col = 0; col < FIELD.cols; col += 1) {
      const cell = `${col},${row}`;
      const key = canon(col, row);
      // Mirror the canonical jitter: flip its sign across each centre axis; a cell ON
      // a centre axis is its own mirror there, so that component stays unjittered.
      const sx = col < midCol ? 1 : col > midCol ? -1 : 0;
      const sy = row < midRow ? 1 : row > midRow ? -1 : 0;
      const x = Math.round(FIELD.x0 + col * FIELD.dx + sx * jx.get(key)!);
      const y = Math.round(FIELD.y0 + row * FIELD.dy + sy * jy.get(key)!);
      const id = cellId(cell);
      if (starts.has(cell)) {
        nodes.push({ id, owner: null, x, y, sector: 'planet', type: 'terran' });
      } else if (neutralP.has(cell)) {
        nodes.push({ id, owner: null, x, y, sector: 'planet', type: typeOf.get(key)! });
      } else {
        nodes.push({ id, owner: null, x, y, sector: kindOf.get(key)! });
      }
    }
  }
  return nodes;
}

const KEY: KeyNode[] = buildField();
/** The 10 worlds players spawn on — the start picker offers these. */
export const START_CANDIDATES: string[] = START_CELLS.map(cellId);

// Wire sectors up as a Relative Neighbourhood Graph: a sector links to another
// ONLY if no third sector lies "between" them (closer to both than they are to
// each other). That gives each sector paths to its immediate neighbours only —
// no long criss-crossing lanes — while the map stays one fully-connected graph
// (an RNG always contains the Euclidean minimum spanning tree). Links are
// symmetric. O(n³), trivial for a few dozen sectors.
function withNeighborLinks(nodes: KeyNode[]): MapNode[] {
  const dist = (a: KeyNode, b: KeyNode): number => Math.hypot(a.x - b.x, a.y - b.y);
  const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const dab = dist(a, b);
      const between = nodes.some((c) => c !== a && c !== b && dist(a, c) < dab && dist(b, c) < dab);
      if (!between) {
        adj.get(a.id)!.add(b.id);
        adj.get(b.id)!.add(a.id);
      }
    }
  }
  return nodes.map((n) => ({ ...n, links: [...adj.get(n.id)!] }));
}

// Bytro-style province map: only real provinces (no "empty" void waypoints), wired
// to their neighbours by shared border (relative-neighbourhood graph). Movement is
// province-to-adjacent; the links ARE the visible path network.
export const MAP: MapNode[] = withNeighborLinks(KEY);