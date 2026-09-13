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
    'keeps frequent-read sprites separate from default and legacy targets',
    (draw) => {
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
      const surfaces: {
        width: number;
        height: number;
        getContext: ReturnType<typeof vi.fn>;
      }[] = [];
      vi.stubGlobal('document', {
        createElement: () => {
          const surface = Object.assign(new EventTarget(), {
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
          });
          surfaces.push(surface);
          return surface;
        },
      });
      const defaultTarget = {
        ...context,
        getContextAttributes: () => ({ willReadFrequently: false }),
        drawImage: vi.fn(),
      };
      const frequentReadTarget = {
        ...context,
        getContextAttributes: () => ({ willReadFrequently: true }),
        drawImage: vi.fn(),
      };
      const paint = (target: typeof context) =>
        draw(target as unknown as CanvasRenderingContext2D, 2, '#35d6e6', 50, 50, 20, 1);

      paint(defaultTarget);
      paint(defaultTarget);
      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]!.getContext.mock.calls).toEqual([['2d']]);
      expect(defaultTarget.drawImage.mock.calls.map(([sprite]) => sprite)).toEqual([
        surfaces[0],
        surfaces[0],
      ]);

      paint(frequentReadTarget);
      paint(frequentReadTarget);
      expect(surfaces).toHaveLength(2);
      expect(surfaces[1]!.getContext.mock.calls).toEqual([['2d', { willReadFrequently: true }]]);
      expect(frequentReadTarget.drawImage.mock.calls.map(([sprite]) => sprite)).toEqual([
        surfaces[1],
        surfaces[1],
      ]);

      paint(defaultTarget);
      paint(context); // A target without getContextAttributes uses the default cache.
      expect(surfaces).toHaveLength(2);
      expect(defaultTarget.drawImage.mock.lastCall?.[0]).toBe(surfaces[0]);
      expect(context.drawImage.mock.lastCall?.[0]).toBe(surfaces[0]);
    },
  );
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
