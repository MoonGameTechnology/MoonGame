import {
  MAP_SCORE_LIMITS,
  mapVictoryRules,
  matchMapEdges,
  parseMatchMap,
  validateMatchMap,
  type GameState,
  type MatchMap,
} from '../../packages/shared-core/src/index';
import { isForkSite } from '../../packages/shared-core/src/state/forkSite';
import frontier50 from '../../data/frontier-50.json';
import frontier100 from '../../data/frontier-100.json';
import duel from '../../data/maps/duel-1.json';
import ffa4 from '../../data/maps/ffa-4.json';
import ffa20 from '../../data/maps/ffa-20.json';
import ffa50 from '../../data/maps/ffa-50.json';
import team2v2 from '../../data/maps/team-2v2.json';
import team3v3 from '../../data/maps/team-3v3.json';
import { data } from './gameData';
import { MAP, START_CANDIDATES, type MapNode } from './map';

/** Presets offered for NEW matches. The retired id remains readable for old sessions. */
export const MAP_IDS = ['duel-1', 'ffa-4', 'team-2v2', 'team-3v3', 'ffa-20', 'ffa-50'] as const;
export const DEFAULT_MAP_ID = MAP_IDS[0];
export type MapId = (typeof MAP_IDS)[number] | 'nexus' | 'frontier-50' | 'frontier-100';
export const isCurrentMap = (id: string | undefined): boolean => MAP_IDS.some((map) => map === id);
export const isFrontier = (id: string | undefined): boolean =>
  id === 'frontier-50' || id === 'frontier-100';
/** Карты битв корпораций (CORP-5). Партию на них заводит только сервер по запертому составу,
 *  поэтому среди карт новой партии их нет: клиенту нужны лишь их подпись и порог победы. */
export const AVA_MAP_IDS = ['ava-duel-1', 'ava-2v2-1'] as const;
type AvaMapId = (typeof AVA_MAP_IDS)[number];
export const isAvaMap = (id: string | undefined): boolean => AVA_MAP_IDS.some((map) => map === id);
/** Порог победы по карте — ОДНА таблица на все хосты, `MAP_SCORE_LIMITS` в ядре
 *  (`mapVictory.ts`): по ней судит и канонический сервер. Раньше те же числа стояли двумя
 *  наборами литералов, и правка одного места молча разводила полосу прогресса с настоящим
 *  порогом конца партии. Тип требует порог у каждой карты каталога. */
const SCORE_LIMITS: Record<MapId | AvaMapId, number> = MAP_SCORE_LIMITS;
export interface MapPreset {
  id: MapId;
  nodes: MapNode[];
  starts: string[];
  boundary: string[];
  scoreLimit: number;
  /** Authored maps use the core loader for terrain, mosaic adjacency and roads. */
  map?: MatchMap;
}

const PRESETS = new Map<string, MapPreset>([
  [
    'nexus',
    {
      id: 'nexus',
      nodes: MAP,
      starts: START_CANDIDATES,
      boundary: [],
      scoreLimit: SCORE_LIMITS.nexus,
    },
  ],
]);
const nodeId = (i: number): string => `F${i}`;
/** Архив площадки (`YAG-1.1c`): Sector Zero играет только на картах глав, и две большие
 *  карты фронтира (~140 КБ) туда не кладутся. Флаг проверяется через `typeof`, потому
 *  что модуль читают и тесты, где сборщика с его `define` нет. */
declare const __SECTOR_ZERO_ONLY__: boolean | undefined;

/** JSON опубликованной карты. Две большие FFA (~300 КБ вместе) в архив Sector Zero не
 *  кладутся — по той же причине и тем же условием, что фронтир ниже. */
function authoredMap(id: string): unknown {
  if (id === 'duel-1') return duel;
  if (id === 'ffa-4') return ffa4;
  if (id === 'team-2v2') return team2v2;
  if (id === 'team-3v3') return team3v3;
  return typeof __SECTOR_ZERO_ONLY__ !== 'undefined' && __SECTOR_ZERO_ONLY__
    ? null
    : id === 'ffa-20'
      ? ffa20
      : id === 'ffa-50'
        ? ffa50
        : null;
}

/** Места на экране настройки идут строкой на каждое — пока их не больше этого. На картах
 *  крупнее (фронтир, FFA на 20 и 50) список не поместится, и экран спрашивает только,
 *  сколько соперников ИИ позвать. */
export const SEAT_ROWS_MAX = 10;
export const seatsByCount = (id: string): boolean => mapPreset(id).starts.length > SEAT_ROWS_MAX;

/** Frozen authored content; instantiate the large retired graph only when requested. */
export function mapPreset(id: string = 'nexus'): MapPreset {
  const cached = PRESETS.get(id);
  if (cached) return cached;
  if (isCurrentMap(id)) {
    const content = authoredMap(id);
    if (!content) throw new Error('E_UNKNOWN_MAP');
    const map = parseMatchMap(content);
    if (validateMatchMap(map, data).length) throw new Error('E_INVALID_MAP');
    const edges = matchMapEdges(map, data);
    const nodes: MapNode[] = Object.entries(map.sectors).map(([id, sector]) => ({
      id,
      owner: null,
      x: sector.position.x,
      y: sector.position.y,
      sector: sector.kind,
      type: sector.planetType,
      links: edges.paths.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])),
    }));
    const preset: MapPreset = {
      id: id as MapId,
      map,
      nodes,
      boundary: [],
      scoreLimit: SCORE_LIMITS[id as MapId],
      starts: Object.keys(map.slots).map((slot) =>
        Object.keys(map.sectors).find((key) => map.sectors[key]!.owner === slot)!,
      ),
    };
    PRESETS.set(id, preset);
    return preset;
  }
  if (id !== 'frontier-50' && id !== 'frontier-100') throw new Error('E_UNKNOWN_MAP');
  // Условие, а не ранний `throw`: сборщик выкидывает НЕДОСТИЖИМУЮ ветку вместе с тем, что
  // в ней импортировано, а код после `throw` для него всё ещё ссылается на карты.
  const content =
    typeof __SECTOR_ZERO_ONLY__ !== 'undefined' && __SECTOR_ZERO_ONLY__
      ? null
      : id === 'frontier-50'
        ? frontier50
        : frontier100;
  if (!content) throw new Error('E_UNKNOWN_MAP');
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
    scoreLimit: SCORE_LIMITS[id],
  };
  PRESETS.set(id, preset);
  return preset;
}
/** Team maps whose sides are fixed match rules, and the mode each one plays. */
const FIXED_SIDE_MODE: Partial<Record<MapId, string>> = {
  'team-2v2': 'team_2v2',
  'team-3v3': 'team_3v3',
};
/** The fixed-side mode of a team map; `undefined` for every other map. */
export function fixedSideMode(mapId: string | undefined): string | undefined {
  return mapId === undefined ? undefined : FIXED_SIDE_MODE[mapId as MapId];
}

/** Fixed side belongs to a starting world, even when the solo player changes seats. */
export function teamForStart(mapId: MapId, start: string): string | undefined {
  if (!fixedSideMode(mapId)) return undefined;
  const map = mapPreset(mapId).map!;
  const slot = map.sectors[start]?.owner;
  return slot ? map.slots[slot]?.team : undefined;
}

export function scoreLimitFor(state: Pick<GameState, 'mapId'>): number {
  const id = state.mapId;
  return (id !== undefined && SCORE_LIMITS[id as MapId | AvaMapId]) || SCORE_LIMITS.nexus;
}
/** Условия победы карты для конфига матча — один источник для локальной симуляции
 *  (`protoKernel.ctx`) и сетевого хоста (`netserver.ts`); доля захвата у дуэли и FFA на
 *  четверых своя (BAL-16). Карта вне таблицы играет до порога `nexus`. */
export function victoryFor(state: Pick<GameState, 'mapId'>): {
  scoreLimit: number;
  dominationPercent?: number;
} {
  return mapVictoryRules(state.mapId) ?? { scoreLimit: SCORE_LIMITS.nexus };
}
/** Geometry comes from the authoritative snapshot, including custom scenarios. */
export function mapNodesFromState(state: GameState): MapNode[] {
  // Площадка крепости на развилке (FORT-6.1) — не узел карты: ни клетки мозаики, ни лейнов,
  // ни подписи провинции. Её рисует и выбирает отдельный проход по состоянию, а здесь она
  // стала бы провинцией в точке развилки.
  const planets = Object.values(state.planets).filter((p) => !isForkSite(p));
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
