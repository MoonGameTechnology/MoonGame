import { describe, expect, it } from 'vitest';
import { bombardTimerShown, nextVolleyIn } from './bombardTimer';

const HOUR = 3_600_000;

describe('таймер бомбардировки — через сколько следующий залп', () => {
  it('ближайшие часы из нескольких флотов, в мс мира', () => {
    expect(nextVolleyIn([HOUR], 0)).toBe(HOUR);
    expect(nextVolleyIn([3 * HOUR, 2 * HOUR + 5_000], HOUR)).toBe(HOUR + 5_000);
  });

  it('флот без часов не считается; без часов вовсе — таймера нет', () => {
    expect(nextVolleyIn([undefined, 2 * HOUR], 0)).toBe(2 * HOUR);
    expect(nextVolleyIn([undefined], 0)).toBeNull();
    expect(nextVolleyIn([], 0)).toBeNull();
    expect(nextVolleyIn([Number.NaN], 0)).toBeNull();
  });

  it('отсчёт не уходит в минус', () => {
    expect(nextVolleyIn([HOUR], 2 * HOUR)).toBe(0);
  });

  it('таймер видят только хозяин мира и хозяин обстреливающего флота', () => {
    expect(bombardTimerShown('p1', 'p1', ['p2'])).toBe(true);
    expect(bombardTimerShown('p2', 'p1', ['p2'])).toBe(true);
    expect(bombardTimerShown('p3', 'p1', ['p2'])).toBe(false);
  });
});
