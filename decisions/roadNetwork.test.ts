import { describe, expect, it } from 'vitest';
import {
  forkMarks,
  lanePieceT,
  lanePieces,
  roadHeading,
  roadStrokes,
  type NetPlanet,
} from './roadNetwork';

/**
 * Рисунок сети дорог (ROADS-2). Карта руками: у B соседи A и C на одной тропе с
 * развилкой F, D — на своей тропе; E связан с B временным коридором без дороги.
 */
const X_AB = { x: 100, y: -75 };
const X_CB = { x: 100, y: 75 };
const X_DB = { x: -150, y: 0 };
const F = { x: 60, y: 0 };
const planets: Record<string, NetPlanet> = {
  A: {
    position: { x: 200, y: -150 },
    links: ['B'],
    roads: { crossings: { B: X_AB }, trails: [{ exits: ['B'], fork: null }] },
  },
  B: {
    position: { x: 0, y: 0 },
    links: ['A', 'C', 'D', 'E'],
    roads: {
      crossings: { A: X_AB, C: X_CB, D: X_DB },
      trails: [
        { exits: ['A', 'C'], fork: F },
        { exits: ['D'], fork: null },
      ],
    },
  },
  C: {
    position: { x: 200, y: 150 },
    links: ['B'],
    roads: { crossings: { B: X_CB }, trails: [{ exits: ['B'], fork: null }] },
  },
  D: {
    position: { x: -300, y: 0 },
    links: ['B'],
    roads: { crossings: { B: X_DB }, trails: [{ exits: ['B'], fork: null }] },
  },
  E: { position: { x: 0, y: 300 }, links: ['B'] },
};

const key = (line: Array<{ x: number; y: number }>): string =>
  line.map((p) => `${p.x},${p.y}`).join(' → ');

describe('сеть дорог на карте', () => {
  it('ствол тропы рисуется ОДИН раз, ветки от развилки — по одной на соседа', () => {
    const lines = roadStrokes(planets).map(key);
    expect(lines.filter((l) => l === '0,0 → 60,0')).toHaveLength(1);
    expect(lines).toContain('60,0 → 100,-75');
    expect(lines).toContain('60,0 → 100,75');
  });

  it('половины лейна сходятся в одной точке перехода', () => {
    const lines = roadStrokes(planets).map(key);
    expect(lines).toContain('200,-150 → 100,-75'); // половина A
    expect(lines).toContain('60,0 → 100,-75'); // половина B, от развилки
  });

  it('тропа без развилки — прямая дорога от мира к переходу', () => {
    expect(roadStrokes(planets).map(key)).toContain('0,0 → -150,0');
  });

  it('лейн без дороги — прямая от мира к миру, и одна', () => {
    const lines = roadStrokes(planets).map(key);
    expect(lines.filter((l) => l === '0,0 → 0,300' || l === '0,300 → 0,0')).toHaveLength(1);
  });

  it('ни один кусок не нарисован дважды', () => {
    const lines = roadStrokes(planets).map(key);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('лейн к неизвестному миру не рисуется', () => {
    const { E: _gone, ...rest } = planets;
    void _gone;
    expect(roadStrokes(rest).some((l) => l.some((p) => p.y === 300))).toBe(false);
  });
});

describe('попадание пальцем по дороге', () => {
  it('кусок дороги знает, какую долю ВСЕЙ дороги он покрывает', () => {
    // A(200,−150) → X(100,−75) → F(60,0) → B(0,0): 125 + 85 + 60 = 270.
    const road = [{ x: 200, y: -150 }, X_AB, F, { x: 0, y: 0 }];
    const pieces = lanePieces('A', 'B', road);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]!.t0).toBe(0);
    expect(pieces[0]!.t1).toBeCloseTo(125 / 270, 12);
    expect(pieces[1]!.t1).toBeCloseTo(210 / 270, 12);
    expect(pieces[2]!.t1).toBe(1);
  });

  it('середина второго куска — это доля всей дороги, а не половина отрезка', () => {
    const road = [{ x: 200, y: -150 }, X_AB, F, { x: 0, y: 0 }];
    const second = lanePieces('A', 'B', road)[1]!;
    expect(lanePieceT(second, 0.5)).toBeCloseTo((125 + 42.5) / 270, 12);
  });
});

describe('ROADS-4 — развилка видна как место', () => {
  it('одна отметка на развилку — там, где тропа ветвится, с её соседями', () => {
    expect(forkMarks(planets)).toEqual([{ province: 'B', at: F, exits: ['A', 'C'] }]);
  });

  it('тропа без развилки и лейн без дороги отметки не дают', () => {
    const marks = forkMarks(planets);
    expect(marks.some((m) => m.exits.includes('D'))).toBe(false);
    expect(marks.some((m) => m.exits.includes('E'))).toBe(false);
  });

  it('развилка, у чьей тропы не осталось рисуемых дорог, не рисуется', () => {
    // Соседей тропы на карте нет (например, партия без них) — значку не над чем висеть.
    const lonely: Record<string, NetPlanet> = { B: planets.B! };
    expect(forkMarks(lonely)).toEqual([]);
  });
});

describe('ROADS-4 — нос корабля смотрит вдоль дороги, а не по прямой между мирами', () => {
  // Дорога A→B: A(200,−150) → переход (100,−75) → развилка (60,0) → B(0,0); 125 + 85 + 60.
  const road = [{ x: 200, y: -150 }, X_AB, F, { x: 0, y: 0 }];

  it('на первом куске — к переходу, на ветке — к развилке, на стволе — к миру', () => {
    expect(roadHeading(road, 0.1)).toEqual({ x: -0.8, y: 0.6 });
    const branch = roadHeading(road, 150 / 270);
    expect(branch.x).toBeCloseTo(-40 / 85, 12);
    expect(branch.y).toBeCloseTo(75 / 85, 12);
    expect(roadHeading(road, 0.95)).toEqual({ x: -1, y: 0 });
  });

  it('ровно на изломе корабль уже повернул; в конце дороги смотрит по последнему куску', () => {
    expect(roadHeading(road, 210 / 270)).toEqual({ x: -1, y: 0 });
    expect(roadHeading(road, 1)).toEqual({ x: -1, y: 0 });
  });

  it('у дороги нулевой длины направления нет', () => {
    expect(
      roadHeading(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        0.5,
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});
