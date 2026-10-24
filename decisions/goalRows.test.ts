import { describe, expect, it } from 'vitest';
import { visibleGoalRows } from './goalRows';

/** Десять целей урока; `done` — номера выполненных. */
const rows = (...done: number[]) =>
  Array.from({ length: 10 }, (_, id) => ({ id, done: done.includes(id) }));
const ids = (r: { id: number }[]) => r.map((x) => x.id);

describe('visibleGoalRows (ONB-15)', () => {
  it('в начале урока — две ближайшие цели, выполненных ещё нет', () => {
    expect(ids(visibleGoalRows(rows()))).toEqual([0, 1]);
  });

  it('последняя выполненная стоит над текущей и следующей', () => {
    expect(ids(visibleGoalRows(rows(0, 1, 2)))).toEqual([2, 3, 4]);
  });

  it('цель, закрытая раньше своей главы, остаётся на месте урока', () => {
    // Рынок (4) пройден до захвата (3): строки идут в порядке урока.
    expect(ids(visibleGoalRows(rows(0, 1, 2, 4)))).toEqual([3, 4, 5]);
  });

  it('всё выполнено — видна только последняя цель', () => {
    const all = rows(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(ids(visibleGoalRows(all))).toEqual([9]);
  });

  it('`ahead` задаёт, сколько невыполненных видно', () => {
    expect(ids(visibleGoalRows(rows(0), 1))).toEqual([0, 1]);
  });
});
