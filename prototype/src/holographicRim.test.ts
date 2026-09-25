import { describe, expect, it } from 'vitest';
import { BURN_ALPHA, drawGlassRim, rimHeat } from './holographicSurface';

interface Stroke {
  alpha: number;
  width: number;
  /** Обводка конической заливкой — это тление; остальные — ореол и нить. */
  conic: boolean;
}
interface Conic {
  conic: true;
  center: [number, number];
  stops: [number, string][];
}
function capture(frame = { x: 100, y: 80, width: 900, height: 600 }, clock = 7000, glow = true) {
  const points: number[][] = [];
  const paths: number[][][] = [];
  const strokes: Stroke[] = [];
  const conics: Conic[] = [];
  const context = {
    globalAlpha: 1, lineWidth: 1, lineCap: 'round', strokeStyle: {} as unknown,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createConicGradient(_angle: number, x: number, y: number) {
      const c: Conic = { conic: true, center: [x, y], stops: [] };
      conics.push(c);
      return { ...c, addColorStop: (at: number, color: string) => c.stops.push([at, color]) };
    },
    moveTo(x: number, y: number) { points.push([x, y]); paths.push([[x, y]]); },
    lineTo(x: number, y: number) { points.push([x, y]); paths.at(-1)!.push([x, y]); },
    stroke() {
      const conic = (this.strokeStyle as { conic?: boolean }).conic === true;
      strokes.push({ alpha: this.globalAlpha, width: this.lineWidth, conic });
    },
  };
  drawGlassRim(context as unknown as CanvasRenderingContext2D, frame, clock, glow);
  const rim = strokes.filter((s) => !s.conic);
  const burn = strokes.filter((s) => s.conic);
  return { points, paths, strokes, rim, burn, conics };
}
/** Прозрачность остановки тления из её цвета `rgba(…, a)`. */
const stopAlpha = (color: string): number => Number(/,([\d.]+)\)$/.exec(color)![1]);
/** Знаковое расстояние до скруглённой рамки кадра по умолчанию: снаружи — плюс. */
function rimDistance(x: number, y: number): number {
  const radius = 600 * 0.026;
  const dx = Math.abs(x - 550) - (450 - radius);
  const dy = Math.abs(y - 380) - (300 - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}
const widest = (strokes: Stroke[]): number => Math.max(...strokes.map((s) => s.width));
const strokeArea = (strokes: Stroke[]): number => strokes.reduce((sum, s) => sum + s.width, 0);

describe('world-bound holographic rim', () => {
  it('freezes exactly with the existing visual clock', () => {
    expect(capture()).toEqual(capture());
    expect(capture(undefined, 8000).points).not.toEqual(capture().points);
  });
  it('translates and scales with the map plane', () => {
    const before = capture();
    const after = capture({ x: 250, y: 180, width: 1800, height: 1200 });
    before.points.forEach(([x, y], i) => {
      expect(after.points[i]![0]).toBeCloseTo(250 + (x! - 100) * 2);
      expect(after.points[i]![1]).toBeCloseTo(180 + (y! - 80) * 2);
    });
    before.strokes.forEach((stroke, i) => expect(after.strokes[i]!.width).toBeCloseTo(stroke.width * 2));
  });
  it('traces the whole rounded boundary, with a continuous seam and a narrow displacement', () => {
    for (const time of [0, 5000, 17000, 51000]) {
      const sample = capture(undefined, time);
      const outline = sample.paths[0]!;
      expect(outline.length).toBe(321);
      expect(outline.at(-1)).toEqual(outline[0]);
      for (const [x, y] of outline) expect(Math.abs(rimDistance(x!, y!))).toBeLessThan(1.24);
      // Broad outer strokes softly extend beyond the line, not into a second frame.
      expect(widest(sample.rim)).toBeCloseTo(16.8);
    }
  });
  it('без свечения ореол лёгкий, а не никакой: два узких прохода и ясная нить', () => {
    // Заказ владельца 2026-09-25: на телефоне (свечение по умолчанию выключено) рамка
    // теряла ореол целиком и гасла до волоска. Лёгкий ореол вернулся — узкий и дешёвый.
    const full = capture();
    expect(full.rim).toHaveLength(6);
    const quiet = capture(undefined, 7000, false);
    expect(quiet.rim).toHaveLength(3);
    expect(widest(quiet.rim)).toBeLessThan(widest(full.rim) / 2);
    expect(strokeArea(quiet.rim)).toBeLessThan(strokeArea(full.rim) / 3);
    // Нить не волосок: даже на выдохе дыхания вдвое ярче прежних 0,15.
    for (const t of [0, 2575, 5150, 7000]) {
      expect(capture(undefined, t, false).rim.at(-1)!.alpha).toBeGreaterThan(0.3);
    }
  });
});

describe('рамка тлеет — «небольшое слабое горение»', () => {
  // Заказ владельца 2026-09-25: вместо искр — слабое горение по краю.
  it('тление — одна обводка горячих отрезков той же линии рамки, без искр', () => {
    for (const glow of [true, false])
      for (const t of [0, 7000, 23_000]) {
        const sample = capture(undefined, t, glow);
        const [outline, ...stretches] = sample.paths;
        const onRim = new Set(outline!.map(([x, y]) => `${x},${y}`));
        // Каждый узел тления — точка самой рамки: ничего не отходит от края.
        for (const path of stretches) for (const [x, y] of path) expect(onRim.has(`${x},${y}`)).toBe(true);
        expect(stretches.length).toBeGreaterThan(0);
        expect(stretches.length).toBeLessThan(10);
        // Горит часть длины — пятна, а не ровная полоса по всему краю.
        const burning = stretches.reduce((n, path) => n + path.length, 0) / outline!.length;
        expect(burning).toBeGreaterThan(0.15);
        expect(burning).toBeLessThan(0.8);
        expect(sample.burn).toHaveLength(1);
        expect(sample.conics).toHaveLength(1);
        expect(sample.conics[0]!.center).toEqual([550, 380]);
        // Тоньше ореола на ПК, но заметнее нити: полоса, а не волосок.
        expect(sample.burn[0]!.width).toBeCloseTo(600 * 0.007);
      }
  });

  it('горит пятнами и слабо: часть круга холодная, жар не ярче своего потолка', () => {
    for (const t of [0, 3000, 11_000, 47_000]) {
      const [conic] = capture(undefined, t, false).conics;
      const alphas = conic!.stops.map(([, c]) => stopAlpha(c));
      const hot = alphas.filter((a) => a > 0.005).length / alphas.length;
      expect(hot).toBeGreaterThan(0.2);
      expect(hot).toBeLessThan(0.75);
      for (const a of alphas) expect(a).toBeLessThanOrEqual(BURN_ALPHA + 1e-9);
      // Круг замкнут: начало и конец заливки — одного цвета, шва нет.
      expect(conic!.stops[0]![1]).toBe(conic!.stops.at(-1)![1]);
    }
  });

  it('жар — от 0 до 1, пятна плывут плавно и со временем уходят', () => {
    const at = (t: number) => Array.from({ length: 96 }, (_, k) => rimHeat(k / 96, t));
    for (const h of [...at(0), ...at(9.9)]) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
    // За кадр (1/60 с) жар почти не меняется — горение, а не мигание…
    const a = at(20);
    const b = at(20 + 1 / 60);
    for (let k = 0; k < 96; k++) expect(Math.abs(a[k]! - b[k]!)).toBeLessThan(0.05);
    // …а за полминуты рисунок пятен становится другим.
    const c = at(50);
    const moved = a.filter((h, k) => (h > 0.02) !== (c[k]! > 0.02)).length;
    expect(moved).toBeGreaterThan(12);
  });
});
