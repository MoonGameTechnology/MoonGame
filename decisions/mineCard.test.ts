import { describe, expect, it } from 'vitest';
import { mineCard } from './mineCard';
import { shippedGameData } from '../data/bundle';

const data = shippedGameData();

describe('карточка мины — заряды, доля за подрыв, прочность', () => {
  it('обычная мина заградителя: 3 заряда, −15% корпуса, прочность 3 × корпус мины', () => {
    const per = data.units.mine!.stats.hp!;
    expect(mineCard({ units: [{ unit: 'mine', count: 3, modules: ['mine_layer'] }] }, data)).toEqual({
      charges: 3,
      hitPct: 15,
      hull: { cur: 3 * per, max: 3 * per },
    });
  });

  it('побитая мина: текущая прочность из стека, полная — по числу мин', () => {
    const per = data.units.mine!.stats.hp!;
    const card = mineCard({ units: [{ unit: 'mine', count: 2, hp: per + 5, modules: ['mine_layer'] }] }, data);
    expect(card.hull).toEqual({ cur: per + 5, max: 2 * per });
  });

  it('легендарная боевая часть читается с прибавкой редкости', () => {
    const card = mineCard(
      { units: [{ unit: 'mine', count: 1, modules: ['mine_layer'], moduleRarity: { mine_layer: 'legendary' } }] },
      data,
    );
    expect(card.hitPct).toBe(20);
  });
});
