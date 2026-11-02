import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  parseGameData,
  UNIT_LANES,
  type BuildingInstance,
  type GameState,
} from '../packages/shared-core/src/index';
import { shownProductionLanes } from './productionLanes';

const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      stats: { attack: 1, defense: 1, speed: 1, hp: 1 },
      cost: {},
      buildTimeHours: 1,
    },
    trooper: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { attack: 1, defense: 1, speed: 1, hp: 1 },
      cost: {},
      buildTimeHours: 1,
    },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: { attack: 1, defense: 1, speed: 1, hp: 1 },
      cost: {},
      buildTimeHours: 1,
    },
  },
  factions: {},
  buildings: {
    shipyard: { name: 'Shipyard', cost: {}, buildTimeHours: 1, enablesShipConstruction: true },
    barracks: { name: 'Barracks', cost: {}, buildTimeHours: 1, enablesInfantryConstruction: true },
    factory: { name: 'Factory', cost: {}, buildTimeHours: 1, enablesVehicleConstruction: true },
  },
  events: {},
});

function world(buildings: string[]): GameState {
  const s = createInitialState({ seed: 'pl', version: { data: '0.1.0', manifest: '1' } });
  const b: BuildingInstance[] = buildings.map((type, i) => ({
    uid: `u${i}`,
    type,
    level: 1,
    hp: 10,
  }));
  s.planets.A = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: b,
    garrison: [],
    traits: [],
  };
  return s;
}

describe('какие очереди производства показать на мире', () => {
  it('полоса видна там, где стоит её постройка, в порядке переданных полос', () => {
    expect(
      shownProductionLanes(world(['factory', 'shipyard', 'barracks']), 'A', UNIT_LANES, data),
    ).toEqual(['ships', 'infantry', 'vehicles']);
    expect(shownProductionLanes(world(['barracks']), 'A', ['infantry', 'vehicles'], data)).toEqual([
      'infantry',
    ]);
  });

  it('заказ держит свою полосу на виду, даже если постройку снесли', () => {
    const s = world(['barracks']);
    s.planets.A!.buildQueue = [{ id: 1, kind: 'unit', playerId: 'p1', unit: 'tank', count: 1 }];
    expect(shownProductionLanes(s, 'A', ['infantry', 'vehicles'], data)).toEqual([
      'infantry',
      'vehicles',
    ]);
    const t = world([]);
    t.scheduled = [
      {
        id: 'evt:1',
        at: 1,
        seq: 1,
        type: 'construction.complete',
        payload: { kind: 'unit', planetId: 'A', unit: 'cruiser' },
      },
    ];
    expect(shownProductionLanes(t, 'A', ['ships'], data)).toEqual(['ships']);
  });

  it('мир без постройки и без дел — первая полоса вкладки, а не пустота', () => {
    expect(shownProductionLanes(world([]), 'A', ['infantry', 'vehicles'], data)).toEqual([
      'infantry',
    ]);
    expect(shownProductionLanes(world([]), 'нет', ['ships'], data)).toEqual(['ships']);
  });
});
