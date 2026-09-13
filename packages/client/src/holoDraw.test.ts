import { afterEach, describe, it, expect, vi } from 'vitest';
import { blitGlow, blitSphere, clearHolographicSprites, rgba } from './holoDraw';

// The sprite/blit primitives need a canvas (verified end-to-end via the prototype render);
// rgba is pure, so it's covered here.
describe('holoDraw — rgba', () => {
  it('converts hex + alpha to an rgba() string', () => {
    expect(rgba('#35d6e6', 0.5)).toBe('rgba(53,214,230,0.5)');
    expect(rgba('#000000', 1)).toBe('rgba(0,0,0,1)');
    expect(rgba('#ffffff', 0)).toBe('rgba(255,255,255,0)');
  });

  it('tolerates a missing leading #', () => {
    expect(rgba('ff8800', 0.25)).toBe('rgba(255,136,0,0.25)');
  });
});

describe('holographic sprite context recovery', () => {
  afterEach(() => {
    clearHolographicSprites();
    vi.unstubAllGlobals();
  });
  it.each([blitGlow, blitSphere])(
    'repaints a lost sprite without evicting a later replacement',
    (draw) => {
      const surfaces: (EventTarget & { width: number; height: number })[] = [];
      const noop = () => {};
      const context = {
        globalAlpha: 1,
        setTransform: noop,
        save: noop,
        restore: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        stroke: noop,
        arc: noop,
        fillRect: noop,
        createRadialGradient: () => ({ addColorStop: noop }),
        drawImage: vi.fn(),
      };
      vi.stubGlobal('document', {
        createElement: () => {
          const surface = Object.assign(new EventTarget(), {
            width: 0,
            height: 0,
            getContext: () => context,
          });
          surfaces.push(surface);
          return surface;
        },
      });
      const paint = () =>
        draw(context as unknown as CanvasRenderingContext2D, 2, '#35d6e6', 50, 50, 20, 1);
      paint();
      paint();
      expect(surfaces).toHaveLength(1);
      surfaces[0]!.dispatchEvent(new Event('contextlost'));
      paint();
      expect(surfaces).toHaveLength(2);
      surfaces[0]!.dispatchEvent(new Event('contextrestored'));
      paint();
      expect(surfaces).toHaveLength(2);
      surfaces[1]!.dispatchEvent(new Event('contextrestored'));
      paint();
      expect(surfaces).toHaveLength(3);
      clearHolographicSprites();
      expect(surfaces[2]!.width).toBe(0);
      paint();
      expect(surfaces).toHaveLength(4);
    },
  );
});
