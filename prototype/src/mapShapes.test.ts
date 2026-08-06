import { describe, it, expect } from 'vitest';
import { BELT_FLATTEN, asteroidsFor, bracketStrokes, makeRocks, polyPoints } from './mapShapes';

const TAU = Math.PI * 2;
const dist = (p: { x: number; y: number }, x: number, y: number) => Math.hypot(p.x - x, p.y - y);

describe('фигуры карты — многоугольник', () => {
  it('сторон столько, сколько заказано', () => {
    expect(polyPoints(0, 0, 10, 3)).toHaveLength(3);
    expect(polyPoints(0, 0, 10, 6)).toHaveLength(6);
  });

  it('все вершины лежат ровно на радиусе от центра', () => {
    for (const p of polyPoints(50, -20, 12, 5)) expect(dist(p, 50, -20)).toBeCloseTo(12, 9);
  });

  it('поворот двигает фигуру, не меняя её размера', () => {
    const a = polyPoints(0, 0, 10, 4);
    const b = polyPoints(0, 0, 10, 4, 0.5);
    expect(b[0]).not.toEqual(a[0]);
    for (const p of b) expect(dist(p, 0, 0)).toBeCloseTo(10, 9);
  });

  it('полный оборот возвращает фигуру на место', () => {
    const a = polyPoints(0, 0, 10, 5);
    const b = polyPoints(0, 0, 10, 5, TAU);
    for (let i = 0; i < a.length; i++) {
      expect(b[i]!.x).toBeCloseTo(a[i]!.x, 9);
      expect(b[i]!.y).toBeCloseTo(a[i]!.y, 9);
    }
  });

  it('вершины идут по кругу без повторов', () => {
    const pts = polyPoints(0, 0, 10, 6).map((p) => `${p.x.toFixed(6)}|${p.y.toFixed(6)}`);
    expect(new Set(pts).size).toBe(6);
  });

  it('вырожденный запрос не роняет расчёт', () => {
    expect(polyPoints(0, 0, 10, 0)).toEqual([]);
    expect(polyPoints(0, 0, 0, 4)).toHaveLength(4);
  });
});

describe('фигуры карты — уголки прицела', () => {
  const strokes = bracketStrokes(20, 6);

  it('уголков четыре — по одному в каждом квадранте', () => {
    expect(strokes).toHaveLength(4);
    const quadrants = strokes.map((s) => `${Math.sign(s.corner.x)}${Math.sign(s.corner.y)}`);
    expect(new Set(quadrants).size).toBe(4);
  });

  it('угол стоит на своём радиусе, а штрихи идут ВНУТРЬ рамки', () => {
    for (const s of strokes) {
      expect(Math.abs(s.corner.x)).toBe(20);
      expect(Math.abs(s.corner.y)).toBe(20);
      expect(Math.abs(s.from.x)).toBeLessThan(20); // хвост ближе к центру
      expect(Math.abs(s.to.y)).toBeLessThan(20);
    }
  });

  it('длина штриха — та, что заказана', () => {
    for (const s of strokes) {
      expect(Math.hypot(s.corner.x - s.from.x, s.corner.y - s.from.y)).toBeCloseTo(6, 9);
      expect(Math.hypot(s.corner.x - s.to.x, s.corner.y - s.to.y)).toBeCloseTo(6, 9);
    }
  });

  it('рамка больше — уголки разъезжаются', () => {
    const wide = bracketStrokes(40, 6);
    expect(Math.abs(wide[0]!.corner.x)).toBe(40);
  });
});

describe('фигуры карты — поле астероидов', () => {
  it('КАМНИ НЕ МЕРЦАЮТ: те же координаты — то же поле', () => {
    expect(makeRocks(120, 340)).toEqual(makeRocks(120, 340));
  });

  it('разные узлы получают разные поля', () => {
    expect(makeRocks(120, 340)).not.toEqual(makeRocks(121, 340));
  });

  it('камней столько, чтобы читалось поясом, но не толпой', () => {
    for (const [x, y] of [
      [0, 0],
      [500, 120],
      [-73, 998],
    ] as ReadonlyArray<readonly [number, number]>) {
      const n = makeRocks(x, y).length;
      expect(n).toBeGreaterThanOrEqual(9);
      expect(n).toBeLessThanOrEqual(12);
    }
  });

  it('камни держатся в поясе вокруг узла, а не улетают', () => {
    for (const rock of makeRocks(42, 17)) {
      const away = Math.hypot(rock.dx, rock.dy / BELT_FLATTEN);
      expect(away).toBeGreaterThanOrEqual(7);
      expect(away).toBeLessThanOrEqual(28);
    }
  });

  it('ПОЯС СПЛЮСНУТ по вертикали — иначе это облако, а не кольцо', () => {
    const rocks = makeRocks(42, 17);
    const maxX = Math.max(...rocks.map((r) => Math.abs(r.dx)));
    const maxY = Math.max(...rocks.map((r) => Math.abs(r.dy)));
    expect(maxY).toBeLessThan(maxX);
  });

  it('камни разного размера и формы — но в разумных границах', () => {
    for (const rock of makeRocks(9, 9)) {
      expect(rock.r).toBeGreaterThanOrEqual(1.5);
      expect(rock.r).toBeLessThanOrEqual(4.3);
      expect(rock.sides).toBeGreaterThanOrEqual(3);
      expect(rock.sides).toBeLessThanOrEqual(5);
      expect(rock.rot).toBeGreaterThanOrEqual(0);
      expect(rock.rot).toBeLessThan(TAU);
    }
  });

  it('поле узла считается один раз и отдаётся тем же', () => {
    const first = asteroidsFor('C1R1', 10, 20);
    expect(asteroidsFor('C1R1', 10, 20)).toBe(first); // тот же массив, а не копия
  });

  it('узел помнят по id: сдвиг координат уже посчитанного поля его не пересобирает', () => {
    const first = asteroidsFor('C2R2', 10, 20);
    expect(asteroidsFor('C2R2', 999, 999)).toBe(first);
  });

  it('разные узлы — разные поля в памяти', () => {
    expect(asteroidsFor('A', 10, 20)).not.toBe(asteroidsFor('B', 10, 20));
  });
});
