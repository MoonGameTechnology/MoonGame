import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import { createInitialState, type GameState, type Planet } from './gameState';
import { isLandmark, withLandmarks } from './landmarks';
import { sensorCoverage, viewCoverage, visibleState } from './visibility';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  technologies: {},
  events: {},
  sectorKinds: {
    planet: { name: 'Planet', capturable: true, buildable: true },
    star: { name: 'Star', traversable: false, capturable: false, overflight: false },
    corona: { name: 'Corona', traversable: false, capturable: false, overflight: false },
    rift: { name: 'Rift', traversable: false, capturable: false },
  },
});

function planet(id: string, x: number, extra: Partial<Planet> = {}): Planet {
  return {
    id,
    owner: null,
    position: { x, y: 0 },
    links: [],
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    ...extra,
  };
}

/** p1 holds `home`; a star and its ring stand far beyond sight, a rival world and a rift
 *  stand between them, as far out. */
function world(): GameState {
  const base = createInitialState({ seed: 'landmarks', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 0 } },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: { metal: 0 } },
    },
    planets: {
      home: planet('home', 0, { owner: 'p1', kind: 'planet' }),
      rival: planet('rival', 5000, {
        owner: 'p2',
        kind: 'planet',
        garrison: [{ unit: 'cruiser', count: 3 }],
        terrain: 'oceanic',
      }),
      rift: planet('rift', 5200, { kind: 'rift', terrain: 'rift' }),
      sun: planet('sun', 6000, { kind: 'star', terrain: 'red_giant' }),
      sun_ring: planet('sun_ring', 6200, { kind: 'corona', terrain: 'corona' }),
    },
  };
}

describe('landmarks: stars, black holes and their rings are on every map from the start', () => {
  it('a kind nothing enters or flies over is a landmark; a rift and a world are not', () => {
    expect(isLandmark('star', data)).toBe(true);
    expect(isLandmark('corona', data)).toBe(true);
    expect(isLandmark('rift', data)).toBe(false);
    expect(isLandmark('planet', data)).toBe(false);
    expect(isLandmark(undefined, data)).toBe(false);
    expect(isLandmark('__proto__', data)).toBe(false);
  });

  it('the map shows the star and its ring far out of sight, and nothing else there', () => {
    const { identify, radar } = viewCoverage(world(), 'p1', data);
    expect([...identify]).toEqual(['home', 'sun', 'sun_ring']);
    expect(radar.has('sun')).toBe(true);
    expect(identify.has('rival')).toBe(false);
    expect(identify.has('rift')).toBe(false);
  });

  it('the projection keeps the star’s kind and class; a world out of sight stays fogged', () => {
    const view = visibleState(world(), 'p1', data);
    expect(view.planets.sun).toMatchObject({ kind: 'star', terrain: 'red_giant', owner: null });
    expect(view.planets.sun_ring).toMatchObject({ kind: 'corona', terrain: 'corona' });
    expect(view.planets.rival).toMatchObject({ owner: null, garrison: [] });
    expect(view.planets.rival!.kind).toBeUndefined();
    expect(view.planets.rift!.kind).toBeUndefined();
  });

  it('display only: the sensors that count as exploration do not reach the star', () => {
    const live = sensorCoverage(world(), 'p1', data);
    expect(live.identify.has('sun')).toBe(false);
    expect(live.radar.has('sun')).toBe(false);
  });

  it('a map without landmarks gets its coverage back untouched', () => {
    const s = world();
    delete s.planets.sun;
    delete s.planets.sun_ring;
    const live = sensorCoverage(s, 'p1', data);
    expect(withLandmarks(live, Object.values(s.planets), data)).toBe(live);
  });
});
