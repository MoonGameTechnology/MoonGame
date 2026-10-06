import { describe, expect, it } from 'vitest';
import { rocketMineCard } from './rocketMineCard';
import { shippedGameData } from '../data/bundle';

const data = shippedGameData();
const def = data.modules.rocket_mine_layer!.rocketMine!;
const per = data.units.rocket_mine!.stats.hp!;
const mine = (hp?: number) => ({
  owner: 'p1',
  units: [{ unit: 'rocket_mine', count: 1, modules: ['rocket_mine_layer'], ...(hp !== undefined ? { hp } : {}) }],
});

describe('карточка ракетной мины — оружие, прочность, управление хозяину (SM-3.7a)', () => {
  it('своя мина: режим и удар из управления, радар и обзор — из модуля', () => {
    expect(rocketMineCard(mine(), { mode: 'confirmed', damage: 88 }, 'p1', data)).toEqual({
      own: true,
      mode: 'confirmed',
      damage: 88,
      radar: def.radarRange,
      sight: def.sightRange,
      hull: { cur: per, max: per },
    });
  });

  it('чужая мина: режима и удара нет, даже если управление попало под руку', () => {
    const card = rocketMineCard(mine(per - 5), { mode: 'any', damage: 80 }, 'p2', data);
    expect(card).toMatchObject({ own: false, mode: null, damage: null, hull: { cur: per - 5, max: per } });
  });

  it('контактная мина и корабль — не ракетная мина', () => {
    expect(rocketMineCard({ owner: 'p1', units: [{ unit: 'mine', count: 2, modules: ['mine_layer'] }] }, undefined, 'p1', data)).toBeNull();
    expect(rocketMineCard({ owner: 'p1', units: [{ unit: 'frigate', count: 1, modules: ['rocket_mine_layer'] }] }, undefined, 'p1', data)).toBeNull();
  });
});
