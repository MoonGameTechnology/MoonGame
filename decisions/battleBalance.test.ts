import { describe, it, expect } from 'vitest';
import { hullTone, meterShare, powerShares } from './battleBalance';

describe('окно боя: что видно глазами', () => {
  it('полоса прочности — доли остатка корпуса и щита, сумма 1', () => {
    const shares = powerShares([
      { hull: { current: 300 }, shield: { current: 100 } },
      { hull: { current: 100 } },
    ]);
    expect(shares).toEqual([0.8, 0.2]);
  });

  it('нечего делить — полосы нет, а не деление на ноль', () => {
    expect(powerShares([{}, { hull: { current: 0 } }])).toEqual([]);
    expect(powerShares([])).toEqual([]);
  });

  it('отрицательный остаток не отнимает у соседей', () => {
    expect(powerShares([{ hull: { current: -50 } }, { hull: { current: 10 } }])).toEqual([0, 1]);
  });

  it('тон корпуса — три ступени светофора', () => {
    expect(hullTone(200, 200)).toBe('ok');
    expect(hullTone(100, 200)).toBe('hurt');
    expect(hullTone(60, 200)).toBe('low');
    expect(hullTone(5, 0)).toBe('low');
  });

  it('шкала не выходит за край и не верит мусору', () => {
    expect(meterShare(300, 200)).toBe(1);
    expect(meterShare(-1, 200)).toBe(0);
    expect(meterShare(Number.NaN, 200)).toBe(0);
    expect(meterShare(50, 200)).toBe(0.25);
  });
});
