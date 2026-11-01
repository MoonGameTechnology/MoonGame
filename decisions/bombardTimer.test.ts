import { describe, expect, it } from 'vitest';
import { bombardTimerShown, nextBuildingFall } from './bombardTimer';

const HOUR = 3_600_000;

describe('таймер бомбардировки — какая постройка рухнет и когда', () => {
  it('первая уязвимая постройка по порядку мира: прочность / скорость, в мс мира', () => {
    const b = [
      { type: 'mine', hp: 15, maxHp: 20 },
      { type: 'depot', hp: 30, maxHp: 30 },
    ];
    expect(nextBuildingFall(b, 10, HOUR)).toEqual({ building: 'mine', leftMs: 1.5 * HOUR });
    // Масштаб матча: игровой час короче — и срок короче.
    expect(nextBuildingFall(b, 10, HOUR / 4)?.leftMs).toBe(0.375 * HOUR);
  });

  it('неразрушаемая постройка пропускается, как и в уроне ядра', () => {
    const b = [
      { type: 'relic', hp: 0, maxHp: 0 },
      { type: 'depot', hp: 30, maxHp: 30 },
    ];
    expect(nextBuildingFall(b, 15, HOUR)).toEqual({ building: 'depot', leftMs: 2 * HOUR });
  });

  it('сносить нечего или скорость нулевая — таймера нет', () => {
    expect(nextBuildingFall([], 10, HOUR)).toBeNull();
    expect(nextBuildingFall([{ type: 'relic', hp: 0, maxHp: 0 }], 10, HOUR)).toBeNull();
    expect(nextBuildingFall([{ type: 'mine', hp: 5, maxHp: 20 }], 0, HOUR)).toBeNull();
    expect(nextBuildingFall([{ type: 'mine', hp: 5, maxHp: 20 }], Number.NaN, HOUR)).toBeNull();
  });

  it('отсчёт не уходит в минус', () => {
    expect(nextBuildingFall([{ type: 'mine', hp: -2, maxHp: 20 }], 10, HOUR)).toEqual({
      building: 'mine',
      leftMs: 0,
    });
  });

  it('таймер видят только хозяин мира и хозяин обстреливающего флота', () => {
    expect(bombardTimerShown('p1', 'p1', ['p2'])).toBe(true);
    expect(bombardTimerShown('p2', 'p1', ['p2'])).toBe(true);
    expect(bombardTimerShown('p3', 'p1', ['p2'])).toBe(false);
  });
});
