import { describe, expect, it } from 'vitest';
import { placeFleetPanel, reframePresentation, supportsHolography } from './holographicLayout';
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

const area = { x: 16, y: 110, width: 1334, height: 700 };
const size = { width: 292, height: 340 };

describe('holographic fleet commands stay usable beside the selection', () => {
  it('opens to the right without covering the selected marker', () => {
    const panel = placeFleetPanel({ x: 600, y: 350 }, size, area);
    expect(panel.x).toBe(626);
    expect(panel.attach.x).toBe(panel.x);
    expect(panel.anchorVisible).toBe(true);
  });
  it('flips to the left at the right edge', () => {
    const panel = placeFleetPanel({ x: 1300, y: 350 }, size, area);
    expect(panel.x + panel.width).toBeLessThan(1300);
  });
  it('avoids the independent inspector when the other side is free', () => {
    const panel = placeFleetPanel({ x: 890, y: 350 }, size, area, [
      { x: 960, y: 110, width: 390, height: 700 },
    ]);
    expect(panel.x + panel.width).toBeLessThan(890);
  });
  it('keeps all controls inside the usable tablet height', () => {
    const tablet = { x: 12, y: 154, width: 810, height: 380 };
    const panel = placeFleetPanel({ x: 800, y: 520 }, { width: 300, height: 700 }, tablet);
    expect(panel.x).toBeGreaterThanOrEqual(tablet.x);
    expect(panel.y).toBeGreaterThanOrEqual(tablet.y);
    expect(panel.y + panel.height).toBeLessThanOrEqual(tablet.y + tablet.height);
  });
  it('keeps commands reachable for a fleet panned off screen, without a false leader', () => {
    const panel = placeFleetPanel({ x: -500, y: -100 }, size, area);
    expect(panel.anchorVisible).toBe(false);
    expect(panel.x).toBeGreaterThanOrEqual(area.x);
    expect(panel.y).toBeGreaterThanOrEqual(area.y);
  });
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
