import { describe, expect, it } from 'vitest';
import {
  aimPath,
  aimTip,
  etaShown,
  etaText,
  laneSought,
  routeNeeded,
  routeViaLane,
  targetPipRadius,
  type Point,
} from './aimPreview';

const p = (x: number, y: number): Point => ({ x, y });

describe('laneSought', () => {
  // Правило 1: мир важнее дороги.
  it('looks for a lane only when no world was hit', () => {
    expect(laneSought(null)).toBe(true);
    expect(laneSought('C1R1')).toBe(false);
  });
});

describe('aimTip', () => {
  it('uses the target when there is one', () => {
    expect(aimTip(p(10, 20), p(99, 99))).toEqual(p(10, 20));
  });

  // Правило 2: без цели линия обязана дотянуться до пальца.
  it('falls back to the pointer itself', () => {
    expect(aimTip(null, p(99, 99))).toEqual(p(99, 99));
  });
});

describe('routeViaLane', () => {
  // Правило 4: точка входа нужна, только когда цель — дорога И мы знаем, откуда идём.
  it('routes through the lane entry with a lane target and a known origin', () => {
    expect(routeViaLane(true, 'C1R1')).toBe(true);
  });

  it('routes straight to the target without a lane', () => {
    expect(routeViaLane(false, 'C1R1')).toBe(false);
  });

  // Флот в пути (узла под ним нет) — точку входа считать не от чего.
  it('routes straight when the fleet stands nowhere', () => {
    expect(routeViaLane(true, null)).toBe(false);
    expect(routeViaLane(false, null)).toBe(false);
  });
});

describe('routeNeeded', () => {
  it('asks for a route between two different known nodes', () => {
    expect(routeNeeded('A', 'B')).toBe(true);
  });

  // Правило 5: путь из узла в себя пуст — просить его незачем.
  it('asks for nothing when both ends are the same node', () => {
    expect(routeNeeded('A', 'A')).toBe(false);
  });

  it('asks for nothing when either end is unknown', () => {
    expect(routeNeeded(null, 'B')).toBe(false);
    expect(routeNeeded('A', null)).toBe(false);
    expect(routeNeeded(null, null)).toBe(false);
  });
});

describe('aimPath', () => {
  // Правило 3: путь идёт через центры провинций маршрута.
  it('threads the route hops between the anchor and the target', () => {
    expect(aimPath(p(0, 0), [p(1, 1), p(2, 2)], null, p(9, 9))).toEqual([
      p(0, 0),
      p(1, 1),
      p(2, 2),
    ]);
  });

  // Правило 4: точка на дороге — последний отрезок, после маршрута.
  it('adds the lane point last, after the route', () => {
    expect(aimPath(p(0, 0), [p(1, 1)], p(5, 5), p(9, 9))).toEqual([p(0, 0), p(1, 1), p(5, 5)]);
  });

  // Правило 6: без маршрута и без дороги линия всё равно доходит до острия.
  it('falls back to a straight line to the tip when there is nothing else', () => {
    expect(aimPath(p(0, 0), [], null, p(9, 9))).toEqual([p(0, 0), p(9, 9)]);
  });

  it('does not add the fallback when a lane point already extends the line', () => {
    expect(aimPath(p(0, 0), [], p(5, 5), p(9, 9))).toEqual([p(0, 0), p(5, 5)]);
  });

  it('never returns a single point — a one-point line draws nothing', () => {
    for (const hops of [[], [p(1, 1)]])
      for (const lane of [null, p(5, 5)])
        expect(aimPath(p(0, 0), hops, lane, p(9, 9)).length).toBeGreaterThanOrEqual(2);
  });
});

describe('targetPipRadius', () => {
  // Правило 7: у точки на дороге метка меньше.
  it('draws a smaller pip on a lane point than on a world', () => {
    expect(targetPipRadius(true)).toBe(9);
    expect(targetPipRadius(false)).toBe(16);
    expect(targetPipRadius(true)).toBeLessThan(targetPipRadius(false));
  });
});

describe('etaShown', () => {
  it('prints a finite estimate', () => {
    expect(etaShown(0)).toBe(true);
    expect(etaShown(3.5)).toBe(true);
  });

  // Правило 8: «маршрута нет» молчит, а не печатает «~Infinityh».
  it('stays silent on a missing, infinite or non-numeric estimate', () => {
    expect(etaShown(null)).toBe(false);
    expect(etaShown(Infinity)).toBe(false);
    expect(etaShown(-Infinity)).toBe(false);
    expect(etaShown(NaN)).toBe(false);
  });
});

describe('etaText', () => {
  it('shows tenths of an hour from one hour up', () => {
    expect(etaText(1)).toBe('~1.0h');
    expect(etaText(2.44)).toBe('~2.4h');
    expect(etaText(27.96)).toBe('~28.0h');
  });

  // Правило 8: меньше часа — минуты, и вверх: обещать меньше хуже, чем больше.
  it('shows whole minutes below an hour, always rounded up', () => {
    expect(etaText(0.5)).toBe('~30m');
    expect(etaText(0.51)).toBe('~31m');
    expect(etaText(0.001)).toBe('~1m');
    expect(etaText(0)).toBe('~0m');
  });
});
