import { describe, it, expect } from 'vitest';
import {
  SNAP_REACH,
  drawOrder,
  lanes,
  mapViewBox,
  viewBoxPoint,
  type MapNodeLike,
} from './setupMap';
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

describe('тап по мини-карте — перевод в координаты viewBox (REFM-126)', () => {
  const vb = { x: 0, y: 0, width: 100, height: 100 };

  it('карта ещё не разложена — переводить нечего', () => {
    expect(viewBoxPoint({ left: 0, top: 0, width: 0, height: 0 }, vb, 5, 5)).toBeNull();
    expect(
      viewBoxPoint({ left: 0, top: 0, width: 200, height: 200 }, { ...vb, width: 0 }, 5, 5),
    ).toBeNull();
  });

  it('квадрат в квадрат: центр экрана — центр рамки', () => {
    const p = viewBoxPoint({ left: 0, top: 0, width: 200, height: 200 }, vb, 100, 100);
    expect(p).toEqual({ x: 50, y: 50 });
  });

  it('МАСШТАБ ПО МЕНЬШЕЙ СТОРОНЕ: на широком экране карта не растягивается', () => {
    // 400×200 под рамку 100×100: масштаб 2, карта шириной 200 стоит по центру
    const p = viewBoxPoint({ left: 0, top: 0, width: 400, height: 200 }, vb, 200, 100);
    expect(p).toEqual({ x: 50, y: 50 }); // центр экрана — всё ещё центр карты
  });

  it('ЛИШНЕЕ МЕСТО ДЕЛИТСЯ ПОПОЛАМ: без центрирования тап уезжал бы на полполосы', () => {
    // тот же широкий экран: левый край КАРТЫ лежит на 100px экрана, а не на нуле
    const p = viewBoxPoint({ left: 0, top: 0, width: 400, height: 200 }, vb, 100, 0);
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it('на узком экране лишнее место уходит по вертикали', () => {
    const p = viewBoxPoint({ left: 0, top: 0, width: 200, height: 400 }, vb, 0, 100);
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it('положение элемента на странице учитывается', () => {
    const p = viewBoxPoint({ left: 40, top: 25, width: 200, height: 200 }, vb, 140, 125);
    expect(p).toEqual({ x: 50, y: 50 });
  });

  it('сдвиг рамки не забыт: viewBox может начинаться не в нуле', () => {
    const p = viewBoxPoint(
      { left: 0, top: 0, width: 200, height: 200 },
      { x: -30, y: 70, width: 100, height: 100 },
      100,
      100,
    );
    expect(p).toEqual({ x: 20, y: 120 });
  });

  it('РАДИУС СНАПА — В ЕДИНИЦАХ VIEWBOX: в экранных он плыл бы с размером окна', () => {
    expect(SNAP_REACH).toBeGreaterThan(0);
    // примерно три радиуса кружка кандидата (кружок ~26 единиц в поперечнике)
    expect(SNAP_REACH).toBeGreaterThan(30);
  });
});

// Правило 7: та же `lanes()` раскладывает трассы БОЛЬШОЙ карты матча, где сеть путей
// печётся в статический слой. Эти тесты держат один дом на обе карты.
describe('трассы: одна функция на обе карты (REFM-127)', () => {
  it('НА РЕАЛЬНОЙ КАРТЕ СЕТЬ ТА ЖЕ, что давал ручной цикл большой карты', () => {
    const manual: string[] = [];
    for (const n of MAP) for (const l of n.links) if (n.id < l) manual.push(`${n.id}|${l}`);
    const got = lanes(MAP).map((r) => `${r.from.id}|${r.to.id}`);
    expect(got).toEqual(manual); // совпадает и по составу, и по ПОРЯДКУ обхода
    expect(got.length).toBeGreaterThan(100); // сеть не выродилась
  });

  it('УЗЕЛ БЕЗ МИРА ОТСЕИВАЕТСЯ ДО ВЫЗОВА: ссылка в никуда дороги не даёт', () => {
    const nodes = [node('a', 0, 0, ['b', 'нет-такого']), node('b', 10, 0, ['a'])];
    expect(lanes(nodes).map((r) => `${r.from.id}|${r.to.id}`)).toEqual(['a|b']);
  });

  it('САМОССЫЛОК НА КАРТЕ НЕТ — единственное место, где два сравнения разошлись бы', () => {
    expect(MAP.filter((n) => n.links.includes(n.id))).toEqual([]);
  });
});
