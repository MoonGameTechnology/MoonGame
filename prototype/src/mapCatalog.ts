import type { GameState } from '../../packages/shared-core/src/index';
import frontier from '../../data/frontier-100.json';
import { MAP, START_CANDIDATES, type MapNode } from './map';

export const MAP_IDS = ['nexus', 'frontier-100'] as const;
export type MapId = (typeof MAP_IDS)[number];
export interface MapPreset {
  id: MapId;
  nodes: MapNode[];
  starts: string[];
  boundary: string[];
  scoreLimit: number;
}

// Authored Voronoi graph: coordinates/terrain and undirected lanes are frozen
// content, not random work performed when a client opens the setup screen.
const nodeId = (i: number): string => `F${i}`;
const frontierNodes: MapNode[] = frontier.points.map(([x, y], i) => ({
  id: nodeId(i),
  owner: null,
  x: Math.round(5000 + x! * 4500),
  y: Math.round(5000 + y! * 4500),
  sector: frontier.terrain[i]!,
  links: [],
  ...(frontier.terrain[i] === 'planet' ? { type: 'terran' } : {}),
}));
for (const [a, b] of frontier.edges) {
  frontierNodes[a!]!.links.push(nodeId(b!));
  frontierNodes[b!]!.links.push(nodeId(a!));
}
const PRESETS: Record<MapId, MapPreset> = {
  nexus: { id: 'nexus', nodes: MAP, starts: START_CANDIDATES, boundary: [], scoreLimit: 1100 },
  'frontier-100': {
    id: 'frontier-100',
    nodes: frontierNodes,
    starts: frontier.starts.map(nodeId),
    boundary: frontier.boundary.map(nodeId),
    scoreLimit: 15000,
  },
};
export function mapPreset(id: string = 'nexus'): MapPreset {
  if (!Object.hasOwn(PRESETS, id)) throw new Error('E_UNKNOWN_MAP');
  return PRESETS[id as MapId];
}
export function scoreLimitFor(state: Pick<GameState, 'mapId'>): number {
  return state.mapId === 'frontier-100' ? PRESETS['frontier-100'].scoreLimit : 1100;
}
/** Geometry comes from the authoritative snapshot, including custom scenarios. */
export function mapNodesFromState(state: GameState): MapNode[] {
  const authored = MAP_IDS.some((id) => id === state.mapId) ? mapPreset(state.mapId).nodes : MAP;
  const kinds = new Map(authored.map((n) => [n.id, n.sector]));
  return Object.values(state.planets).map((p) => ({
    id: p.id,
    owner: p.owner,
    x: p.position.x,
    y: p.position.y,
    sector: p.kind ?? kinds.get(p.id) ?? 'empty',
    links: [...(p.links ?? [])],
    ...(p.planetType ? { type: p.planetType } : {}),
  }));
}
