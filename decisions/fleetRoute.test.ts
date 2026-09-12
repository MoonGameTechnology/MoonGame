import { describe, it, expect } from 'vitest';
import {
  parkFraction,
  routeNodes,
  routeShown,
  routeStops,
  routeStroke,
  type RoutePoint,
} from './fleetRoute';

const МИР: Record<string, RoutePoint> = {
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  c: { x: 100, y: 100 },
};
const posOf = (id: string): RoutePoint | undefined => МИР[id];

describe('маршрут — чей виден', () => {
  it('свой идущий флот показывает маршрут', () => {
    expect(routeShown('p1', 'p1', true)).toBe(true);
  });

  it('ЧУЖОЙ МАРШРУТ НЕ ПОКАЗЫВАЕМ: это разведка, которой у игрока нет', () => {
    expect(routeShown('p2', 'p1', true)).toBe(false);
  });

  it('у стоящего флота маршрута нет вовсе', () => {
    expect(routeShown('p1', 'p1', false)).toBe(false);
  });

  it('ничейный флот тоже не свой', () => {
    expect(routeShown(null, 'p1', true)).toBe(false);
  });
});

describe('маршрут — доля остановки', () => {
  it('без полей идём до узла', () => {
    expect(parkFraction({ from: 'a', to: 'b' })).toBe(1);
  });

  it('parkT важнее endT — это приказ встать на лейне', () => {
    expect(parkFraction({ from: 'a', to: 'b', parkT: 0.25, endT: 0.9 })).toBe(0.25);
  });

  it('endT работает, когда parkT не задан', () => {
    expect(parkFraction({ from: 'a', to: 'b', endT: 0.4 })).toBe(0.4);
  });

  it('ДИАПАЗОН ДЕРЖИТ ЯДРО, а не карта: доля отдаётся как есть', () => {
    // `targetsOf` (movement.ts) схлопывает t <= EPS и t >= 1-EPS в узел, поэтому
    // parkT вне (0,1) сюда не доезжает; зажимать его тут — обработка невозможного.
    expect(parkFraction({ from: 'a', to: 'b', parkT: 0.001 })).toBe(0.001);
    expect(parkFraction({ from: 'a', to: 'b', parkT: 0.999 })).toBe(0.999);
  });
});

describe('маршрут — опорные точки', () => {
  it('простой ход даёт узел назначения', () => {
    expect(routeStops({ from: 'a', to: 'b' }, posOf)).toEqual([{ x: 100, y: 0 }]);
  });

  it('многоходовый маршрут идёт по порядку: цель, потом остаток пути', () => {
    expect(routeNodes({ from: 'a', to: 'b', path: ['c'] })).toEqual(['b', 'c']);
    expect(routeStops({ from: 'a', to: 'b', path: ['c'] }, posOf)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it('ОСТАНОВКА НА ЛЕЙНЕ — ТОЧКА, А НЕ УЗЕЛ: линия не обещает прибытия', () => {
    expect(routeStops({ from: 'a', to: 'b', parkT: 0.5 }, posOf)).toEqual([{ x: 50, y: 0 }]);
  });

  it('точка остановки на ПОСЛЕДНЕМ отрезке, промежуточные узлы целы', () => {
    expect(routeStops({ from: 'a', to: 'b', path: ['c'], parkT: 0.25 }, posOf)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 25 },
    ]);
  });

  it('ПРОПАВШИЙ УЗЕЛ МАРШРУТ НЕ РВЁТ: карта могла обогнать состояние', () => {
    expect(routeStops({ from: 'a', to: 'b', path: ['нет-такого'] }, posOf)).toEqual([
      { x: 100, y: 0 },
    ]);
  });

  it('без известных узлов точек нет — рисовать нечего', () => {
    expect(routeStops({ from: 'a', to: 'нет-такого' }, posOf)).toEqual([]);
  });

  it('пропавший предыдущий узел не мешает: точка падает на сам узел', () => {
    expect(routeStops({ from: 'нет-такого', to: 'b', parkT: 0.5 }, posOf)).toEqual([
      { x: 100, y: 0 },
    ]);
  });
});

describe('маршрут — начертание', () => {
  it('ВЫДЕЛЕННЫЙ ЯРЧЕ И ТОЛЩЕ: выбранная линия должна читаться сразу', () => {
    const sel = routeStroke(true);
    const dim = routeStroke(false);
    expect(sel.alpha).toBeGreaterThan(dim.alpha);
    expect(sel.width).toBeGreaterThan(dim.width);
    expect(sel.blur).toBeGreaterThan(dim.blur);
  });

  it('невыделенный маршрут виден, но не спорит с картой', () => {
    const dim = routeStroke(false);
    expect(dim.alpha).toBeGreaterThan(0);
    expect(dim.alpha).toBeLessThan(0.5);
  });
});
