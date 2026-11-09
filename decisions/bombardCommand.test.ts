import { expect, it } from 'vitest';
import { createInitialState, type Fleet } from '../packages/shared-core/src/index';
import { fixtureData } from '../packages/shared-core/src/testkit/arbitraries';
import { bombardCommandAvailable } from './bombardCommand';

it('checking a command does not switch bombardment on or mutate a frozen view', () => {
  const state = createInitialState({ seed: 'command', version: { data: 'test', manifest: '1' } });
  const fleet: Fleet = {
    id: 'f',
    owner: 'p1',
    location: 'target',
    orbit: 'near',
    movement: null,
    units: [{ unit: 'cruiser', count: 1 }],
    traits: [],
  };
  state.planets.target = {
    id: 'target',
    owner: null,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  state.fleets.f = fleet;
  Object.freeze(fleet.units[0]);
  Object.freeze(fleet.units);
  Object.freeze(fleet);
  Object.freeze(state.planets.target);
  Object.freeze(state.planets);
  Object.freeze(state.fleets);
  Object.freeze(state);
  const before = JSON.stringify(state);
  expect(bombardCommandAvailable(state, fleet, 'p1', fixtureData, true)).toBe(true);
  expect(bombardCommandAvailable(state, fleet, 'p1', fixtureData, false)).toBe(false);
  expect(bombardCommandAvailable(state, fleet, 'other', fixtureData, true)).toBe(false);
  expect(bombardCommandAvailable(state, fleet, 'other', fixtureData, false)).toBe(false);
  expect(JSON.stringify(state)).toBe(before);
});
