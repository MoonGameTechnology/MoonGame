import { describe, expect, it } from 'vitest';
import { SPHERE_FRAMES, sphereFrame, sphereWire } from './holoSphere';

describe('holographic sphere', () => {
  it('keeps every projected stroke inside the selectable sphere, at every atlas phase', () => {
    for (let frame = 0; frame < SPHERE_FRAMES; frame++) {
      const { front, back } = sphereWire(frame);
      expect(front.length).toBeGreaterThan(0);
      expect(back.length).toBeGreaterThan(0);
      for (const [x0, y0, x1, y1] of [...front, ...back]) {
        expect(Math.hypot(x0, y0)).toBeLessThanOrEqual(1.000001);
        expect(Math.hypot(x1, y1)).toBeLessThanOrEqual(1.000001);
      }
    }
  });

  it('moves the wire geometry while the silhouette stays fixed', () => {
    expect(sphereWire(0)).not.toEqual(sphereWire(8));
  });

  it('reuses a finite atlas even over long sessions and wraps without an invalid crop', () => {
    for (const time of [-1000, 0, 96, 1535, 1536, 1000 * 60 * 60 * 24 * 30]) {
      expect(sphereFrame(time)).toBeGreaterThanOrEqual(0);
      expect(sphereFrame(time)).toBeLessThan(SPHERE_FRAMES);
      expect(sphereFrame(time + 96 * SPHERE_FRAMES)).toBe(sphereFrame(time));
    }
  });
});
