import { describe, expect, it } from 'vitest';

import { statDeltas } from './itemCompare';

describe('PVR-6.5 — сравнение «до/после»', () => {
  it('только изменившееся, со знаком разницы', () => {
    expect(statDeltas({ attack: 16, hp: 60 }, { attack: 20, hp: 60 })).toEqual([
      { key: 'attack', before: 16, after: 20, diff: 4 },
    ]);
    expect(statDeltas({ speed: 40 }, { speed: 38 })[0]!.diff).toBe(-2);
  });

  it('стат, которого не было, считается от нуля', () => {
    expect(statDeltas({}, { shield: 15 })).toEqual([{ key: 'shield', before: 0, after: 15, diff: 15 }]);
    expect(statDeltas({ shield: 15 }, {})).toEqual([{ key: 'shield', before: 15, after: 0, diff: -15 }]);
  });

  it('погрешность плавающей точки — не изменение', () => {
    expect(statDeltas({ cargo: 6.6 }, { cargo: 6 * 1.1 })).toEqual([]);
  });

  it('порядок экрана, затем прочие по алфавиту', () => {
    const rows = statDeltas({}, { radar: 1, attack: 1, zeta: 1, alpha: 1 }, ['attack', 'radar']);
    expect(rows.map((r) => r.key)).toEqual(['attack', 'radar', 'alpha', 'zeta']);
  });

  it('мусор вместо числа читается как 0, а не NaN', () => {
    expect(statDeltas({ hp: Number.NaN }, { hp: 10 })).toEqual([{ key: 'hp', before: 0, after: 10, diff: 10 }]);
  });
});
