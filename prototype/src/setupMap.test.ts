import { describe, it, expect } from 'vitest';
import { drawOrder, lanes, mapViewBox, type MapNodeLike } from './setupMap';
import { MAP, START_CANDIDATES } from './map';

const node = (id: string, x: number, y: number, links: string[] = []): MapNodeLike => ({
  id,
  x,
  y,
  links,
});

describe('мини-карта сетапа — рамка', () => {
  it('охватывает все узлы с отступом', () => {
    const box = mapViewBox([node('A', 10, 20), node('B', 50, 80)], 5);
    expect(box).toEqual({ x: 5, y: 15, w: 50, h: 70 });
  });

  it('ОТСТУП ЕСТЬ ВСЕГДА — иначе крайние узлы срезаются наполовину', () => {
    const box = mapViewBox([node('A', 0, 0)], 30);
    expect(box.x).toBe(-30);
    expect(box.w).toBe(60);
  });

  it('единственный узел даёт рамку по отступу, а не нулевую', () => {
    expect(mapViewBox([node('A', 100, 100)], 10)).toEqual({ x: 90, y: 90, w: 20, h: 20 });
  });

  it('пустая карта не даёт NaN', () => {
    const box = mapViewBox([], 12);
    for (const v of Object.values(box)) expect(Number.isFinite(v)).toBe(true);
  });

  it('настоящая карта укладывается в свою рамку целиком', () => {
    const box = mapViewBox(MAP, 60);
    for (const n of MAP) {
      expect(n.x).toBeGreaterThanOrEqual(box.x);
      expect(n.x).toBeLessThanOrEqual(box.x + box.w);
      expect(n.y).toBeGreaterThanOrEqual(box.y);
      expect(n.y).toBeLessThanOrEqual(box.y + box.h);
    }
  });
});

describe('мини-карта сетапа — трассы', () => {
  const pair = [node('A', 0, 0, ['B']), node('B', 10, 0, ['A'])];

  it('ДВУСТОРОННЯЯ связь даёт ОДНУ линию, а не две друг на друге', () => {
    expect(lanes(pair)).toHaveLength(1);
  });

  it('линия идёт от младшего конца к старшему — порядок предсказуем', () => {
    const [lane] = lanes(pair);
    expect([lane!.from.id, lane!.to.id]).toEqual(['A', 'B']);
  });

  it('ссылка в никуда не роняет отрисовку', () => {
    expect(lanes([node('A', 0, 0, ['нет-такого'])])).toEqual([]);
  });

  it('на настоящей карте каждое ребро встречается ровно один раз', () => {
    const seen = lanes(MAP).map((l) => [l.from.id, l.to.id].sort().join('|'));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('нарисованы ВСЕ связи карты — ни одна не потерялась', () => {
    const declared = new Set<string>();
    for (const n of MAP) for (const id of n.links) declared.add([n.id, id].sort().join('|'));
    const drawn = new Set(lanes(MAP).map((l) => [l.from.id, l.to.id].sort().join('|')));
    expect(drawn).toEqual(declared);
  });
});

describe('мини-карта сетапа — порядок рисования', () => {
  const nodes = [node('A', 0, 0), node('B', 1, 0), node('C', 2, 0)];

  it('КАНДИДАТЫ ОТДЕЛЬНО — их рисуют поверх, иначе фон перекроет цель тапа', () => {
    const order = drawOrder(nodes, ['B']);
    expect(order.plain.map((n) => n.id)).toEqual(['A', 'C']);
    expect(order.candidates.map((n) => n.id)).toEqual(['B']);
  });

  it('ни один узел не рисуется дважды', () => {
    const order = drawOrder(nodes, ['B', 'C']);
    const ids = [...order.plain, ...order.candidates].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(nodes.length);
  });

  it('порядок кандидатов — как в списке стартовых точек', () => {
    expect(drawOrder(nodes, ['C', 'A']).candidates.map((n) => n.id)).toEqual(['C', 'A']);
  });

  it('кандидат, которого нет на карте, пропускается молча', () => {
    expect(drawOrder(nodes, ['нет-такого']).candidates).toEqual([]);
  });

  it('на настоящей карте все стартовые точки находятся', () => {
    expect(drawOrder(MAP, START_CANDIDATES).candidates).toHaveLength(START_CANDIDATES.length);
  });
});
