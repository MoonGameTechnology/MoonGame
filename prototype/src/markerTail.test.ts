// Регресс живого плейтеста: пипсы трюма стоящего флота ложились на диск планеты.
// Инвариант: у стоящей (радиальной) позы ВСЕ ячейки хвоста дальше от центра планеты,
// чем сам корабль; в полёте хвост по-прежнему тянется строго за корму.
import { describe, it, expect } from 'vitest';
import { tailTheta, tailAt } from './markerTail';

const dist = (x: number, y: number): number => Math.hypot(x, y);

describe('хвост маркера флота', () => {
  it('стоящий флот: каждая ячейка хвоста ДАЛЬШЕ от центра планеты, чем корабль', () => {
    const RING = 15.5; // кольцо на дальнем зуме после ужатия (31 × 0.5) — худший случай
    // по кругу: 12 радиальных поз, все ряды хвоста (пипсы ly=5/13, «×N» ly=21/29)
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * 2 * Math.PI;
      const ax = Math.cos(a0) * RING;
      const ay = Math.sin(a0) * RING;
      const th = tailTheta(a0, true); // радиальная поза, разворот наружу
      for (const ly of [5, 13, 21, 29]) {
        for (const lx of [-14, 0, 14]) {
          const p = tailAt(ax, ay, th, lx, ly);
          expect(dist(p.x, p.y), `a0=${k} ly=${ly} lx=${lx}`).toBeGreaterThan(RING - 1e-9);
        }
      }
    }
  });

  it('без разворота хвост шёл ВНУТРЬ — ровно воспроизведение бага', () => {
    const RING = 15.5;
    const th = tailTheta(0, false); // старое поведение для радиальной позы
    const p = tailAt(RING, 0, th, 0, 13);
    expect(dist(p.x, p.y)).toBeLessThan(RING); // ячейка внутри кольца → на диске планеты
  });

  it('в полёте хвост тянется строго за корму (разворота нет)', () => {
    // курс вправо (ang=0): корма — влево, т.е. −x от якоря
    const th = tailTheta(0, false);
    const p = tailAt(100, 50, th, 0, 13);
    expect(p.x).toBeCloseTo(100 - 13, 9);
    expect(p.y).toBeCloseTo(50, 9);
  });

  it('локальный x (ряд пипсов) перпендикулярен хвосту в обеих позах', () => {
    for (const dock of [true, false]) {
      const th = tailTheta(Math.PI / 3, dock);
      const c = tailAt(0, 0, th, 0, 10);
      const l = tailAt(0, 0, th, -4, 10);
      const r = tailAt(0, 0, th, 4, 10);
      // середина между крайними ячейками ряда — сама точка хвоста
      expect((l.x + r.x) / 2).toBeCloseTo(c.x, 9);
      expect((l.y + r.y) / 2).toBeCloseTo(c.y, 9);
    }
  });
});
