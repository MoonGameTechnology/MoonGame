import { describe, expect, it } from 'vitest';
import { logByDay } from './logDays';

const e = (day: number, msg: string) => ({ day, msg });
const dayOf = (x: { day: number }) => x.day;

describe('журнал по дням (UIX-10.9)', () => {
  it('свежий день первым, внутри дня поздняя запись первой', () => {
    const groups = logByDay([e(1, 'a'), e(1, 'b'), e(2, 'c'), e(3, 'd'), e(3, 'e')], dayOf);
    expect(groups.map((g) => [g.day, g.rows.map((r) => r.msg)])).toEqual([
      [3, ['e', 'd']],
      [2, ['c']],
      [1, ['b', 'a']],
    ]);
  });

  it('день без записей не пишется, пустой журнал — без дней', () => {
    expect(logByDay([e(1, 'a'), e(4, 'b')], dayOf).map((g) => g.day)).toEqual([4, 1]);
    expect(logByDay([], dayOf)).toEqual([]);
  });
});
