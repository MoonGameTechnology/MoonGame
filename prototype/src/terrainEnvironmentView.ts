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

/** A remembered province uses its snapshot, never the now-hidden live environment.
 * Older saves without an environment snapshot safely remain undecorated. */
export function terrainKnowledge(
  live: EnvironmentKnowledge | undefined,
  identified: boolean,
  remembered?: { environment?: EnvironmentKnowledge },
): { known: boolean; kind?: string; terrain?: string } {
  const allowed = identified ? live : remembered?.environment;
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

/** One permitted scene at a time; changing viewer/history never reuses another mask. */
export class TerrainEnvironmentSceneCache {
  private key = '';
  private scene: TerrainEnvironment | null = null;

  clear(): void {
    this.key = '';
    this.scene = null;
  }

  prepare(input: TerrainEnvironmentInput): TerrainEnvironment {
    const permitted = permittedInput(input);
    const key = JSON.stringify(permitted);
    if (!this.scene || key !== this.key) {
      this.scene = buildTerrainEnvironment(permitted);
      this.key = key;
    }
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
