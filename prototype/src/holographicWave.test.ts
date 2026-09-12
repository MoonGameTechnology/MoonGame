import { describe, expect, it } from 'vitest';
import { drawGlassWave } from './holographicSurface';
import type { HoloRect } from './holographicLayout';

function curves(frame: HoloRect, viewport = [1400, 960]): number[][] {
  const paths: number[][] = [];
  const context = new Proxy({}, {
    get: (_, name) => name === 'bezierCurveTo'
      ? (...points: number[]) => paths.push(points)
      : name === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {},
  }) as CanvasRenderingContext2D;
  drawGlassWave(context, frame, viewport[0]!, viewport[1]!, 15000);
  return paths;
}

describe('glass reflection belongs to the projected world', () => {
  const frame = { x: -100, y: 160, width: 1800, height: 1200 };
  it('does not move when only the browser viewport changes', () => {
    const original = curves(frame);
    expect(original.length).toBeGreaterThan(0);
    expect(curves(frame, [900, 700])).toEqual(original);
  });
  it('travels by exactly the same amount as the map during a camera pan', () => {
    const original = curves(frame);
    const moved = curves({ ...frame, x: frame.x + 137, y: frame.y - 81 });
    moved.forEach((path, i) => path.forEach((value, j) => {
      expect(value).toBeCloseTo(original[i]![j]! + (j % 2 ? -81 : 137), 8);
    }));
  });
  it('scales its shape around the map origin during zoom', () => {
    const original = curves(frame);
    const zoomed = curves({ ...frame, width: frame.width * 1.5, height: frame.height * 1.5 });
    zoomed.forEach((path, i) => path.forEach((value, j) => {
      const origin = j % 2 ? frame.y : frame.x;
      expect(value).toBeCloseTo(origin + (original[i]![j]! - origin) * 1.5, 8);
    }));
  });
});
