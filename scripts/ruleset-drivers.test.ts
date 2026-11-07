import { expect, it } from 'vitest';
import { createInitialState, createKernel, GAME_MODULES, type GameState } from '../packages/shared-core/src/index';
import { data } from '../prototype/src/gameData';
import { drivers } from './ruleset-drivers';

it('keeps a queued flight waiting while auto-assault is landing troops', () => {
  let state: GameState = {
    ...createInitialState({ seed: 'standing-phases', version: { data: data.version, manifest: '104' } }),
    players: {
      green: { id: 'green', name: 'green', faction: 'x', status: 'active', resources: {} },
      red: { id: 'red', name: 'red', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      A: { id: 'A', owner: 'red', position: { x: 0, y: 0 }, links: ['B'], resources: {}, buildings: [], traits: [], garrison: [{ unit: 'militia', count: 3 }] },
      B: { id: 'B', owner: null, position: { x: 1, y: 0 }, links: ['A'], resources: {}, buildings: [], traits: [], garrison: [] },
    },
    fleets: {
      F: { id: 'F', owner: 'green', location: 'A', movement: null, units: [{ unit: 'cruiser', count: 1 }], landing: [{ unit: 'militia', count: 6 }], traits: [], orbit: 'near' },
    },
    autoAssault: { F: true },
    orders: { F: { steps: [{ kind: 'move', to: 'B' }] } },
  };
  const kernel = createKernel(GAME_MODULES);
  const issued: string[] = [];
  for (const group of drivers.standing(() => state)) {
    for (const action of group.actions) {
      const result = kernel.applyAction(state, action, { now: state.time, data });
      expect(result.ok, action.type).toBe(true);
      if (!result.ok) break;
      state = result.state;
      issued.push(action.type);
    }
  }
  expect(issued).toEqual(['fleet.assault']);
  expect(state.fleets.F?.assaultLanding?.planetId).toBe('A');
  expect(state.fleets.F?.movement).toBeNull();
  expect(state.orders?.F?.steps).toEqual([{ kind: 'move', to: 'B' }]);
});
