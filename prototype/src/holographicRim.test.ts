import { describe, expect, it } from 'vitest';
import { drawGlassRim } from './holographicSurface';

function capture(frame = { x: 100, y: 80, width: 900, height: 600 }, clock = 7000, glow = true) {
  const points: number[][] = [];
  const strokes: { alpha: number; width: number }[] = [];
  const context = {
    globalAlpha: 1, lineWidth: 1,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    createLinearGradient() { return { addColorStop() {} }; },
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
  it('traces the whole rounded boundary, with a continuous seam and a narrow displacement', () => {
    for (const time of [0, 5000, 17000, 51000]) {
      const sample = capture(undefined, time);
      expect(sample.points.length).toBe(321);
      expect(sample.points.at(-1)).toEqual(sample.points[0]);
      const radius = 600 * 0.026;
      for (const [x, y] of sample.points) {
        // Signed distance to the same rounded rectangle used by the glass plane.
        const dx = Math.abs(x! - 550) - (450 - radius);
        const dy = Math.abs(y! - 380) - (300 - radius);
        const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
        expect(Math.abs(distance)).toBeLessThan(1.24);
      }
      // Broad outer strokes softly extend beyond the line, not into a second frame.
      expect(Math.max(...sample.strokes.map((stroke) => stroke.width))).toBeCloseTo(16.8);
    }
  });
  it('disables the wide glow while retaining a faint thin filament', () => {
    expect(capture().strokes).toHaveLength(6);
    const quiet = capture(undefined, 7000, false);
    expect(quiet.strokes).toHaveLength(1);
    expect(quiet.strokes.every((s) => s.alpha <= 0.15 && s.width < 1)).toBe(true);
  });
});
