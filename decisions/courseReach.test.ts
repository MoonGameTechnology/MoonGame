import { describe, expect, it } from 'vitest';
import { COURSE_REACH_LIMIT, courseReach } from './courseReach';

describe('досягаемые миры в прицеле «Курс» (UIX-7.2)', () => {
  it('ближайшие по сроку первыми', () => {
    expect(
      courseReach([
        { id: 'c', hours: 5 },
        { id: 'a', hours: 1.5 },
        { id: 'b', hours: 3 },
      ]),
    ).toEqual([
      { id: 'a', hours: 1.5 },
      { id: 'b', hours: 3 },
      { id: 'c', hours: 5 },
    ]);
  });

  it('без маршрута, с бесконечным или нулевым сроком мир не метится', () => {
    expect(
      courseReach([
        { id: 'none', hours: null },
        { id: 'inf', hours: Infinity },
        { id: 'nan', hours: NaN },
        { id: 'here', hours: 0 },
        { id: 'ok', hours: 2 },
      ]),
    ).toEqual([{ id: 'ok', hours: 2 }]);
  });

  it(`не больше ${COURSE_REACH_LIMIT} миров — дальние отрезаны`, () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, hours: 10 - i }));
    const got = courseReach(many);
    expect(got).toHaveLength(COURSE_REACH_LIMIT);
    expect(got.map((w) => w.hours)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(courseReach(many, null, 2).map((w) => w.id)).toEqual(['w9', 'w8']);
  });

  it('ровный срок делится по id, и набор не зависит от порядка входа', () => {
    const a = courseReach(
      [
        { id: 'z', hours: 2 },
        { id: 'm', hours: 2 },
        { id: 'a', hours: 2 },
      ],
      null,
      2,
    );
    const b = courseReach(
      [
        { id: 'a', hours: 2 },
        { id: 'z', hours: 2 },
        { id: 'm', hours: 2 },
      ],
      null,
      2,
    );
    expect(a.map((w) => w.id)).toEqual(['a', 'm']);
    expect(b).toEqual(a);
  });

  it('мир под указателем не метится, его место занимает следующий', () => {
    expect(
      courseReach(
        [
          { id: 'a', hours: 1 },
          { id: 'b', hours: 2 },
          { id: 'c', hours: 3 },
        ],
        'a',
        2,
      ).map((w) => w.id),
    ).toEqual(['b', 'c']);
  });
});
