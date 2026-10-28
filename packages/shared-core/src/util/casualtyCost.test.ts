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

it.each([false, true])(
  'never duplicates value across repeated death rows for the same hull (class pools: %s)',
  async (classed) => {
    const { createKernel } = await import('../kernel/kernel');
    const { applyDamage, applyDamageToSide, hookedDamage } = await import('./combat');
    const data = parseGameData({
      version: '1',
      resources: ['metal'],
      factions: {},
      buildings: {},
      events: {},
      modules: { gun: { name: 'Gun', tag: 'horizontal', slot: 'weapon', cost: { metal: 10 } } },
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
    const state = createInitialState({
      seed: 'repeat-death',
      version: { data: '1', manifest: '1' },
    });
    state.pricing = { cost: { metal: 1.5 }, shipCost: { metal: 2.5 } };
    state.planets.A = {
      id: 'A',
      owner: 'a',
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      traits: [],
      garrison: [
        { unit: 'ship', count: 1, modules: ['gun'] },
        { unit: 'ship', count: 1 },
      ],
    };
    const kernel = createKernel([
      {
        id: 'damage-fixture',
        version: '1',
        setup(api) {
          api.onAction('test.damage', (_action, h) => {
            if (classed)
              applyDamageToSide(
                h,
                { kind: 'garrison', planetId: 'A' },
                hookedDamage(h,40,{phase:'ground',location:'A',attacker:'b',defender:'a'}),
                h.ctx.data,
                'A',
                undefined,
                { infantry: 0, vehicle: 0, other: 40 },
                'b',
              );
            else
              h.state.planets.A!.garrison = applyDamage(
                h,
                h.state.planets.A!.garrison,
                40,
                h.ctx.data,
                { owner: 'a', killedBy: 'b', at: 'A' },
              );
          });
        },
      },
    ]);
    const result = kernel.applyAction(
      state,
      { id: 'damage', type: 'test.damage', playerId: 'a', payload: {}, issuedAt: 1 },
      { now: 1, data },
    );
    if (!result.ok) throw Error(result.code);
    const deaths = result.events
      .filter((e) => e.type === 'unit.died')
      .map((e) => e.payload as { count: number; lossCost: { metal: number } });
    expect(deaths).toHaveLength(2);
    expect(deaths.reduce((n, d) => n + d.count, 0)).toBe(2);
    expect(deaths.reduce((n, d) => n + d.lossCost.metal, 0)).toBe(691);
    expect(state.planets.A!.garrison.map((s) => s.count)).toEqual([1, 1]);
  },
);
