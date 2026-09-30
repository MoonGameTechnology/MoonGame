import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { createInitialState, type Fleet, type GameState } from '../packages/shared-core/src/index';
import { minelayerOffer, ownMinefields } from './minefields';

const data = shippedGameData();

function fleet(over: Partial<Fleet> = {}, modules: string[] = ['mine_layer']): Fleet {
  return {
    id: 'F',
    owner: 'p1',
    location: 'N',
    movement: null,
    traits: [],
    battleId: null,
    units: [{ unit: 'cruiser', count: 1, modules }],
    ...over,
  };
}
function state(over: Partial<GameState> = {}): GameState {
  return {
    ...createInitialState({ seed: 'm', version: { data: '0', manifest: '1' } }),
    time: 1000,
    ...over,
  };
}

describe('SM-3.5 — кнопка «Поставить мины» и свои поля на карте', () => {
  it('в каталоге заградитель даёт заряд и долю корпуса', () => {
    expect(data.modules.mine_layer?.effects.stats.mineCharge).toBeGreaterThanOrEqual(1);
    expect(data.modules.mine_layer?.effects.stats.mineHit).toBeGreaterThan(0);
  });

  it('свой стоящий флот с заградителем — можно ставить', () => {
    expect(minelayerOffer(fleet(), state(), data, 'p1')).toEqual({ ready: true, readyInMs: 0 });
  });

  it('без заградителя и на чужом флоте кнопки нет', () => {
    expect(minelayerOffer(fleet({}, []), state(), data, 'p1')).toBeNull();
    expect(minelayerOffer(fleet(), state(), data, 'p2')).toBeNull();
  });

  it('в пути и в бою — нельзя, причина «занят»', () => {
    expect(minelayerOffer(fleet({ location: null }), state(), data, 'p1')?.reason).toBe('busy');
    expect(minelayerOffer(fleet({ battleId: 'b' }), state(), data, 'p1')?.reason).toBe('busy');
  });

  it('перезарядка: нельзя и видно, сколько ждать', () => {
    const s = state({ minefields: { readyAt: { F: 4000 } } });
    expect(minelayerOffer(fleet(), s, data, 'p1')).toEqual({
      ready: false,
      reason: 'cooldown',
      readyInMs: 3000,
    });
  });

  it('на карте только свои мины-отряды с зарядами', () => {
    const mine = (id: string, owner: string, count: number): Fleet => ({
      id, owner, location: 'N', movement: null, traits: [], battleId: null,
      units: [{ unit: 'mine', count, modules: ['mine_layer'] }],
    });
    const s = state({
      fleets: { 'm:b': mine('m:b', 'p1', 2), 'm:a': mine('m:a', 'p1', 1), 'm:c': mine('m:c', 'p2', 3), F: fleet() },
    });
    expect(ownMinefields(s, 'p1', data)).toEqual([
      { fleetId: 'm:a', charge: 1 },
      { fleetId: 'm:b', charge: 2 },
    ]);
    expect(ownMinefields(state(), 'p1', data)).toEqual([]);
  });
});
