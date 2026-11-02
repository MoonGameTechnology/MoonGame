import type { GameState, Planet, PlanetId, PlayerId } from './gameState';
import type { GameData } from '../data/schemas';
import { radarSources, sightCircles } from './visibility';
import { deepClone } from '../util/clone';

/**
 * Зрение — ТОЛЬКО КРУГИ (решение владельца 2026-09-24). Каждый свой мир и флот видит
 * вокруг себя круг полного обзора; радары (постройки, корабли, модули) расширяют его
 * вторым, внешним кругом засечки. Связи между мирами на зрение не влияют: раньше свой
 * мир раскрывал соседей ПО ЛИНИЯМ на любом расстоянии, и игрок видел мир в 781 единице,
 * но не видел мир в 521 без линии. Расстояния — в единицах карты.
 */
export interface SightRules {
  /** Радиус полного обзора вокруг каждого своего мира — у вида провинции без своего числа в
   *  `byKind`. */
  world: number;
  /** Свой радиус обзора по виду провинции (`Planet.kind`) вместо `world`. Решение владельца
   *  2026-09-25 для забега: вокруг себя видят только колонии и космические крепости, по 100;
   *  захваченное поле, туманность или мёртвый мир — только себя, дальше — радар. */
  byKind?: Record<string, number>;
  /** Радиус полного обзора вокруг каждого своего флота — в его фактическом месте. */
  fleet: number;
  /** Множитель дальности всех радаров, мировых и корабельных: карты Sector Zero крупнее. */
  radarScale: number;
}

/** Current world coverage, shared over the viewer's direct vision bloc. */
export interface Coverage {
  identify: Set<PlanetId>;
  radar: Set<PlanetId>;
}

/** Both radii use the same map-space origin as the rendered visibility frontier. */
export interface SightCircle {
  owner: PlayerId;
  /** Shared sources expose their footprint, without another player's entity id. */
  source: { kind: 'world' | 'fleet' | 'reveal' | 'mine' | 'patrol' | 'shared'; id: string };
  x: number;
  y: number;
  identify: number;
  signature: number;
}

/** Geometry for a sweep; sensitivity is resolved before a contact reaches the client. */
export interface RadarFootprint {
  x: number;
  y: number;
  range: number;
}

/** Projection-only sensor results. Research, arrears and source identities stay private. */
export interface SensorView {
  viewerId: PlayerId;
  circles: SightCircle[];
  sharedRadars: RadarFootprint[];
}

export function withProjectedSensors(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
): GameState {
  const sensorView: SensorView = {
    viewerId,
    circles: sightCircles(state, viewerId, data).map((c) => ({
      ...c,
      source: c.owner === viewerId ? { ...c.source } : { kind: 'shared', id: '' },
    })),
    sharedRadars: radarSources(state, viewerId, data, undefined, true).map(({ x, y, range }) => ({
      x,
      y,
      range,
    })),
  };
  return { ...deepClone(state), sensorView };
}

/** Resolve only worlds present in this view; hidden fortress ids must not cross the wire. */
export function coverageInCircles(
  planets: readonly Planet[],
  circles: readonly SightCircle[],
): Coverage {
  const identify = new Set<PlanetId>();
  const radar = new Set<PlanetId>();
  for (const p of planets) {
    for (const c of circles) {
      const distance = (p.position.x - c.x) ** 2 + (p.position.y - c.y) ** 2;
      if (distance > c.signature ** 2) continue;
      radar.add(p.id);
      if (distance <= c.identify ** 2) {
        identify.add(p.id);
        break;
      }
    }
  }
  return { identify, radar };
}

/** Rendering reads resolved server geometry; solo and legacy snapshots use live rules. */
export function viewSightCircles(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  planets?: readonly Planet[],
): SightCircle[] {
  return state.sensorView?.viewerId === viewerId
    ? state.sensorView.circles
    : sightCircles(state, viewerId, data, planets);
}

/** Allied radar arms must paint contacts even when no own radar covers their position. */
export function sharedRadarSources(
  state: GameState,
  viewerId: PlayerId,
  data: GameData,
  planets?: readonly Planet[],
): RadarFootprint[] {
  return state.sensorView?.viewerId === viewerId
    ? state.sensorView.sharedRadars
    : radarSources(state, viewerId, data, planets, true).map(({ x, y, range }) => ({
        x,
        y,
        range,
      }));
}
