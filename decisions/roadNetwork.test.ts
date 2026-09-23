import { describe, expect, it } from 'vitest';
import { lanePieceT, lanePieces, roadStrokes, type NetPlanet } from './roadNetwork';

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
