import { describe, expect, it } from 'vitest';
import { drawGlassRim } from './holographicSurface';

function capture(frame = { x: 100, y: 80, width: 900, height: 600 }, clock = 7000, glow = true) {
  const points: number[][] = [];
  const strokes: { alpha: number; width: number }[] = [];
  const context = {
    globalAlpha: 1, lineWidth: 1,
    save() {}, restore() {}, beginPath() {},
    moveTo(x: number, y: number) { points.push([x, y]); },
    lineTo(x: number, y: number) { points.push([x, y]); },
    stroke() { strokes.push({ alpha: this.globalAlpha, width: this.lineWidth }); },
  };
  drawGlassRim(context as unknown as CanvasRenderingContext2D, frame, clock, glow);
  return { points, strokes };
}
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
  it('stays in a narrow edge band and never paints the interior', () => {
    for (const time of [0, 5000, 17000, 51000]) {
      const sample = capture(undefined, time);
      expect(sample.points.length).toBe(648);
      for (const [x, y] of sample.points) {
        const nx = (x! - 100) / 900, ny = (y! - 80) / 600;
        expect(Math.min(Math.abs(nx), Math.abs(nx - 1), Math.abs(ny), Math.abs(ny - 1))).toBeLessThan(0.004);
        expect(nx).toBeGreaterThan(-0.004); expect(nx).toBeLessThan(1.004);
        expect(ny).toBeGreaterThan(-0.004); expect(ny).toBeLessThan(1.004);
      }
    }
  });
  it('disables the wide glow while retaining a faint thin filament', () => {
    expect(capture().strokes).toHaveLength(9);
    const quiet = capture(undefined, 7000, false);
    expect(quiet.strokes).toHaveLength(3);
    expect(quiet.strokes.every((s) => s.alpha <= 0.085 && s.width < 1)).toBe(true);
  });
});
