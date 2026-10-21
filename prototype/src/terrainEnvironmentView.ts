/** Viewer boundary and camera adapter for the shared, world-space terrain planner. */
import {
  buildTerrainEnvironment,
  type TerrainEnvironment,
  type TerrainEnvironmentInput,
  type TerrainEnvironmentTile,
  type TerrainPoint,
} from '../../decisions/terrainEnvironment';
import type { TerrainField } from './holographicSurface';

interface EnvironmentKnowledge { kind?: string; terrain?: string }
export interface TerrainEnvironmentProjection { scale: number; x: number; y: number }

/** The environment the viewer may know, as is rather than a copy: the live one when
 * identified, the remembered snapshot otherwise, `undefined` when there is neither. */
export function knownEnvironment(
  live: EnvironmentKnowledge | undefined,
  identified: boolean,
  remembered?: { environment?: EnvironmentKnowledge },
): EnvironmentKnowledge | undefined {
  return (identified ? live : remembered?.environment) ?? undefined;
}

/** A remembered province uses its snapshot, never the now-hidden live environment.
 * Older saves without an environment snapshot safely remain undecorated. */
export function terrainKnowledge(
  live: EnvironmentKnowledge | undefined,
  identified: boolean,
  remembered?: { environment?: EnvironmentKnowledge },
): { known: boolean; kind?: string; terrain?: string } {
  const allowed = knownEnvironment(live, identified, remembered);
  if (!allowed) return { known: false };
  return {
    known: true,
    ...(allowed.kind !== undefined ? { kind: allowed.kind } : {}),
    ...(allowed.terrain !== undefined ? { terrain: allowed.terrain } : {}),
  };
}

const q = (n: number): number => Math.round(n * 1e6) / 1e6;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Canonicalize ONLY permitted visual inputs. Unknown cells cannot affect the scene,
 * even its cache identity. Public roads arrive filtered by the caller's intel boundary. */
function permittedInput(input: TerrainEnvironmentInput): TerrainEnvironmentInput {
  const cells = input.cells.filter(c => c.known).map(c => ({
    id: c.id,
    known: true,
    ...(c.kind !== undefined ? { kind: c.kind } : {}),
    ...(c.terrain !== undefined ? { terrain: c.terrain } : {}),
    poly: c.poly.map(([x, y]): TerrainPoint => [q(x), q(y)]),
  })).sort((a, b) => compare(a.id, b.id));
  const roads = (input.roads ?? []).map(road => {
    const points = road.map(p => ({ x: q(p.x), y: q(p.y) }));
    // Reversing a permitted polyline changes neither its geometry nor its calming.
    const reverse = [...points].reverse();
    return compare(JSON.stringify(points), JSON.stringify(reverse)) <= 0 ? points : reverse;
  }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const markers = (input.markers ?? []).map(m => ({ x: q(m.x), y: q(m.y), kind: m.kind }))
    .sort((a, b) => a.x - b.x || a.y - b.y || compare(a.kind, b.kind));
  return { cells, roads, markers, seed: input.seed ?? 'terrain' };
}

/** Far below a display pixel at any zoom, far above the camera's floating-point noise. */
const SCENE_TOLERANCE = 1e-3;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= SCENE_TOLERANCE;

/** The same permitted scene: identical metadata and order, every coordinate within noise. */
function sameScene(a: TerrainEnvironmentInput, b: TerrainEnvironmentInput): boolean {
  if (a.seed !== b.seed || a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) {
    const p = a.cells[i]!, q = b.cells[i]!;
    if (p.id !== q.id || p.kind !== q.kind || p.terrain !== q.terrain || p.poly.length !== q.poly.length) return false;
    for (let j = 0; j < p.poly.length; j++) {
      if (!near(p.poly[j]![0], q.poly[j]![0]) || !near(p.poly[j]![1], q.poly[j]![1])) return false;
    }
  }
  const ar = a.roads ?? [], br = b.roads ?? [];
  if (ar.length !== br.length) return false;
  for (let i = 0; i < ar.length; i++) {
    if (ar[i]!.length !== br[i]!.length) return false;
    for (let j = 0; j < ar[i]!.length; j++) {
      if (!near(ar[i]![j]!.x, br[i]![j]!.x) || !near(ar[i]![j]!.y, br[i]![j]!.y)) return false;
    }
  }
  const am = a.markers ?? [], bm = b.markers ?? [];
  if (am.length !== bm.length) return false;
  return am.every((m, i) => m.kind === bm[i]!.kind && near(m.x, bm[i]!.x) && near(m.y, bm[i]!.y));
}

/** One permitted scene at a time; changing viewer/history never reuses another mask. */
export class TerrainEnvironmentSceneCache {
  private key = '';
  private input: TerrainEnvironmentInput | null = null;
  private scene: TerrainEnvironment | null = null;

  clear(): void {
    this.key = '';
    this.input = null;
    this.scene = null;
  }

  prepare(input: TerrainEnvironmentInput): TerrainEnvironment {
    const permitted = permittedInput(input);
    const key = JSON.stringify(permitted);
    // The map hands world coordinates through the camera, so a zoom can flip the last
    // rounded digit of a vertex. That is the same scene, not a new one: a rebuild costs a
    // quarter second on a 2 на 2 map, once per zoom bake.
    if (!this.scene || (key !== this.key && !sameScene(this.input!, permitted))) {
      this.scene = buildTerrainEnvironment(permitted);
      this.input = permitted;
    }
    this.key = key;
    return this.scene;
  }
}

/** Retain the world tile and its full extent. The painter clips its permitted union;
 * this rectangle is only for culling/raster dimensions, never an administrative mask. */
export function projectTerrainTile(
  tile: TerrainEnvironmentTile,
  projection: TerrainEnvironmentProjection,
): TerrainField {
  const box = {
    x: tile.box.x * projection.scale + projection.x,
    y: tile.box.y * projection.scale + projection.y,
    width: tile.box.width * projection.scale,
    height: tile.box.height * projection.scale,
  };
  return {
    id: `environment:${tile.id}`,
    kind: 'environment',
    color: '',
    phase: 0,
    box,
    poly: [[box.x, box.y], [box.x + box.width, box.y],
      [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]],
    environment: { tile, projection },
  };
}
