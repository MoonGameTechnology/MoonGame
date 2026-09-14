import type { GameState } from '../../packages/shared-core/src/index';
import frontier50 from '../../data/frontier-50.json';
import frontier100 from '../../data/frontier-100.json';
import { MAP, START_CANDIDATES, type MapNode } from './map';

/** Presets offered for NEW matches. The retired id remains readable for old sessions. */
export const MAP_IDS = ['nexus', 'frontier-50'] as const;
export type MapId = (typeof MAP_IDS)[number] | 'frontier-100';
export const isFrontier = (id: string | undefined): boolean =>
  id === 'frontier-50' || id === 'frontier-100';
export interface MapPreset {
  id: MapId;
  nodes: MapNode[];
  starts: string[];
  boundary: string[];
  scoreLimit: number;
}

const PRESETS = new Map<string, MapPreset>([
  ['nexus', { id: 'nexus', nodes: MAP, starts: START_CANDIDATES, boundary: [], scoreLimit: 1100 }],
]);
const nodeId = (i: number): string => `F${i}`;

/** Frozen authored content; instantiate the large retired graph only when requested. */
export function mapPreset(id: string = 'nexus'): MapPreset {
  const cached = PRESETS.get(id);
  if (cached) return cached;
  if (id !== 'frontier-50' && id !== 'frontier-100') throw new Error('E_UNKNOWN_MAP');
  const content = id === 'frontier-50' ? frontier50 : frontier100;
  // Keep local province/route distances close to the old map while reducing its area.
  const radius = id === 'frontier-50' ? 3200 : 4500;
  const nodes: MapNode[] = content.points.map(([x, y], i) => ({
    id: nodeId(i),
    owner: null,
    x: Math.round(5000 + x! * radius),
    y: Math.round(5000 + y! * radius),
    sector: content.terrain[i]!,
    links: [],
    ...(content.terrain[i] === 'planet' ? { type: 'terran' } : {}),
  }));
  for (const [a, b] of content.edges) {
    nodes[a!]!.links.push(nodeId(b!));
    nodes[b!]!.links.push(nodeId(a!));
  }
  const preset: MapPreset = {
    id,
    nodes,
    starts: content.starts.map(nodeId),
    boundary: content.boundary.map(nodeId),
    scoreLimit: id === 'frontier-50' ? 7500 : 15000,
  };
  PRESETS.set(id, preset);
  return preset;
}
export function scoreLimitFor(state: Pick<GameState, 'mapId'>): number {
  return state.mapId === 'frontier-50' ? 7500 : state.mapId === 'frontier-100' ? 15000 : 1100;
}
/** Geometry comes from the authoritative snapshot, including custom scenarios. */
export function mapNodesFromState(state: GameState): MapNode[] {
  const planets = Object.values(state.planets);
  // Current snapshots carry their own kinds. Do not materialize another full graph
  // just to restore one; the fallback is for older snapshots without kind metadata.
  const authored = planets.some((p) => !p.kind)
    ? isFrontier(state.mapId)
      ? mapPreset(state.mapId).nodes
      : MAP
    : [];
  const kinds = new Map(authored.map((n) => [n.id, n.sector]));
  return planets.map((p) => ({
    id: p.id,
    owner: p.owner,
    x: p.position.x,
    y: p.position.y,
    sector: p.kind ?? kinds.get(p.id) ?? 'empty',
    links: [...(p.links ?? [])],
    ...(p.planetType ? { type: p.planetType } : {}),
  }));
}
