import { describe, expect, it } from 'vitest';
import { TILE_HP_LOW_PCT, tileHp } from './unitTile';

describe('здоровье на плитке состава: полоска и числа (заказ владельца 2026-09-25)', () => {
  it('раненый стек — доля и «осталось/всего»', () => {
    expect(tileHp({ cur: 75, max: 120 })).toEqual({ pct: 63, cur: 75, max: 120, low: false });
    expect(tileHp({ cur: 140, max: 140 })).toEqual({ pct: 100, cur: 140, max: 140, low: false });
  });

  it('живой стек не показывает ноль: остаток меньше единицы — «1»', () => {
    expect(tileHp({ cur: 0.3, max: 30 })).toMatchObject({ cur: 1, max: 30, low: true });
    expect(tileHp({ cur: 0, max: 30 })).toMatchObject({ cur: 0, pct: 0 });
  });

  it('остаток зажат в 0..всего, дробный корпус округляется', () => {
    expect(tileHp({ cur: 200, max: 120 })).toMatchObject({ cur: 120, pct: 100 });
    expect(tileHp({ cur: -5, max: 30 })).toMatchObject({ cur: 0, pct: 0 });
    expect(tileHp({ cur: 100.8, max: 100.8 })).toMatchObject({ cur: 101, max: 101, pct: 100 });
    expect(tileHp({ cur: 100.4, max: 100.4 })).toMatchObject({ cur: 100, max: 100 });
  });

  it('нечему ломаться — целый, как прежняя полоска', () => {
    expect(tileHp({ cur: 0, max: 0 })).toEqual({ pct: 100, cur: 0, max: 0, low: false });
  });

  it('красная полоска — ниже порога хромоты, не на нём', () => {
    expect(TILE_HP_LOW_PCT).toBe(30);
    expect(tileHp({ cur: 29, max: 100 }).low).toBe(true);
    expect(tileHp({ cur: 30, max: 100 }).low).toBe(false);
  });
});
