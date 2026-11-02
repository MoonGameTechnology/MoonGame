import { expect, it } from 'vitest';
import { shippedGameData } from './bundle';
import type { Fleet, Planet, UnitStack } from '../packages/shared-core/src/state/gameState';
import { buildingLevel } from '../packages/shared-core/src/data/schemas';
import { refreshFortressBody } from '../packages/shared-core/src/state/fortress';
import { fleetPointDefense } from '../packages/shared-core/src/util/pointDefense';

const data = shippedGameData();
it.each([1, 2, 3])('installed level %i defense battery supplies working hull point defense', (level) => {
  const battery = { type: 'station_defense', level, hp: buildingLevel(data.buildings.station_defense!, level).hp };
  const site: Planet = { id: 'station-A', owner: 'p1', position: { x: 0, y: 0 }, resources: {},
    garrison: [], traits: [], buildings: [battery], fortress: { level: 1, modules: [] } };
  const stack: UnitStack = { unit: 'fortress_guns', count: 1, stationScale: 1 };
  const fleet: Fleet = { id: 'fleet:station:station-A', owner: 'p1', location: 'A',
    movement: null, units: [stack], traits: [] };
  refreshFortressBody(site, stack, data, 1);
  const full = fleetPointDefense(fleet, data);
  expect(full).toBeGreaterThan(0);
  refreshFortressBody(site, stack, data, 0.5);
  expect(fleetPointDefense(fleet, data)).toBeCloseTo(full / 2);
  battery.hp = 0;
  refreshFortressBody(site, stack, data, 1);
  expect(fleetPointDefense(fleet, data)).toBe(0);
});
