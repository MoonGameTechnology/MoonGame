import { describe, expect, it } from 'vitest';
import { missileCard } from './missileCard';
import { shippedGameData } from '../data/bundle';

const data = shippedGameData();
const def = data.modules.rocket_mine_layer!.rocketMine!;
const per = data.units.missile!.stats.hp!;
const flight = { from: { x: 0, y: 0 }, to: { x: 80, y: 0 }, departedAt: 1000, arrivesAt: 61_000 };
const missile = (hp?: number) => ({
  owner: 'p1',
  flight,
  units: [{ unit: 'missile', count: 1, modules: ['rocket_mine_layer'], ...(hp !== undefined ? { hp } : {}) }],
});

describe('карточка летящей ракеты — прочность, остаток полёта, удар хозяину (SM-3.7b)', () => {
  it('своя ракета: удар из боевой части, взрыв — из модуля, остаток — до точки цели', () => {
    expect(missileCard(missile(), 88, 'p1', 31_000, data)).toEqual({
      own: true,
      damage: 88,
      blast: def.blastRadius,
      hull: { cur: per, max: per },
      leftMs: 30_000,
    });
  });

  it('чужая ракета: удара нет, даже если боевая часть попала под руку; подбитый корпус виден', () => {
    const card = missileCard(missile(per - 5), 80, 'p2', 31_000, data);
    expect(card).toMatchObject({ own: false, damage: null, hull: { cur: per - 5, max: per } });
  });

  it('у цели остаток — ноль, а не минус', () => {
    expect(missileCard(missile(), 80, 'p1', 90_000, data)?.leftMs).toBe(0);
  });

  it('ракетная мина и ракета без полёта — не летящая ракета', () => {
    const mine = { owner: 'p1', units: [{ unit: 'rocket_mine', count: 1, modules: ['rocket_mine_layer'] }] };
    expect(missileCard({ ...mine, flight }, 80, 'p1', 0, data)).toBeNull();
    expect(missileCard({ owner: 'p1', units: missile().units }, 80, 'p1', 0, data)).toBeNull();
  });
});
