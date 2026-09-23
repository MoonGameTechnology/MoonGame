import { describe, it, expect } from 'vitest';
import { routeShown, routeStroke } from './fleetRoute';

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
