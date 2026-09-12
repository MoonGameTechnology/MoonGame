import { describe, expect, it } from 'vitest';
import { reframePresentation, supportsHolography } from './holographicLayout';
import { worldToScreen } from '../../packages/client/src/camera';

it('changing the skin preserves map positions and physical zoom in both directions', () => {
  const before = { left: 160, right: 1000, top: 180, bottom: 680 };
  const after = { left: 20, right: 1346, top: 138, bottom: 692 };
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 800 };
  const cam = { x: -900, y: -350, scale: 3 };
  const next = reframePresentation(cam, before, after, bounds);
  for (const point of [
    { x: 120, y: 220 },
    { x: 450, y: 680 },
  ]) {
    const a = worldToScreen(point, cam, before, bounds);
    const b = worldToScreen(point, next, after, bounds);
    expect(b.x).toBeCloseTo(a.x, 8);
    expect(b.y).toBeCloseTo(a.y, 8);
  }
  const restored = reframePresentation(next, after, before, bounds);
  expect(restored.x).toBeCloseTo(cam.x, 8);
  expect(restored.y).toBeCloseTo(cam.y, 8);
  expect(restored.scale).toBeCloseTo(cam.scale, 8);
});

describe('holographic appearance is limited to computers and tablets', () => {
  it.each([
    [414, 896],
    [896, 414],
    [720, 1024],
  ])('keeps phone %s × %s simple', (w, h) => {
    expect(supportsHolography(w, h, true)).toBe(false);
  });
  it.each([
    [834, 1112, true],
    [1194, 834, true],
    [1366, 768, false],
    [1280, 500, false],
  ])('supports %s × %s', (w, h, coarse) => {
    expect(supportsHolography(Number(w), Number(h), Boolean(coarse))).toBe(true);
  });
});
