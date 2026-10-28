import { it, expect } from 'vitest';
import { captureCasualtyCost } from './casualtyCost';
import { parseGameData } from '../data/schemas';
import { createInitialState } from '../state/gameState';
it('values only destroyed hulls and their actual loadouts at match-pinned prices', () => {
  const data = parseGameData({
    version: '1',
    resources: ['metal'],
    factions: {},
    buildings: {},
    events: {},
    modules: {
      gun: {
        name: 'Gun',
        tag: 'horizontal',
        slot: 'weapon',
        cost: { metal: 10 },
        stats: { attack: 1 },
      },
    },
    units: {
      ship: {
        faction: 'x',
        domain: 'space',
        hullClass: 'medium',
        cost: { metal: 90 },
        stats: { hp: 20, attack: 1, defense: 1, speed: 1 },
      },
    },
  });
  const state = createInitialState({ seed: 'cost', version: { data: '1', manifest: '1' } });
  state.pricing = { cost: { metal: 1.5 }, shipCost: { metal: 2.5 } };
  const units = [
    { unit: 'ship', count: 3, modules: ['gun'] },
    { unit: 'ship', count: 2 },
  ];
  const value = captureCasualtyCost(state, units, data);
  units[0]!.count = 2;
  expect(value()).toEqual({ ship: { metal: 353 } }); // ceil(90*1.5*2.5) + ceil(10*1.5)
  expect(units[1]!.count).toBe(2);
});
