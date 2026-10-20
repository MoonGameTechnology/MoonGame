import { describe, expect, it, vi } from 'vitest';
import { FLEET_COUNT_FONT, countTextWidth, drawFleetSign, fleetCountWidth } from './fleetCountBadge';

/** A context that measures 10 px per character and records the font of each measure. */
function measuring(font = '9px serif') {
  const fonts: string[] = [];
  const cx = {
    font,
    measureText: vi.fn((text: string) => {
      fonts.push(cx.font);
      return { width: text.length * 10 };
    }),
  };
  return { cx, fonts, ctx: cx as unknown as CanvasRenderingContext2D };
}

describe('fleet count badge', () => {
  it('measures a text once per context, in the count font, and leaves the font as it was', () => {
    // Every badge is drawn on every frame; a measure and a font switch each leave heap garbage.
    const { cx, fonts, ctx } = measuring();
    expect(countTextWidth(ctx, '42')).toBe(20);
    expect(countTextWidth(ctx, '42')).toBe(20);
    expect(fleetCountWidth(ctx, 42)).toBe(48);
    expect(fleetCountWidth(ctx, 7)).toBe(38);
    expect(cx.measureText.mock.calls).toEqual([['42'], ['7']]);
    expect(fonts).toEqual([FLEET_COUNT_FONT, FLEET_COUNT_FONT]);
    expect(cx.font).toBe('9px serif');
    // Another context keeps widths of its own.
    const other = measuring();
    expect(countTextWidth(other.ctx, '42')).toBe(20);
    expect(other.cx.measureText).toHaveBeenCalledTimes(1);
  });

  it('keeps a bounded number of widths per context', () => {
    const { cx, ctx } = measuring();
    for (let i = 0; i <= 512; i++) countTextWidth(ctx, String(i));
    expect(cx.measureText).toHaveBeenCalledTimes(513);
    // The 513th text started the cache over, so the first one is measured again.
    countTextWidth(ctx, '0');
    expect(cx.measureText).toHaveBeenCalledTimes(514);
  });

  it('draws the fleet sign as a stroked parallelogram where the glyph stood', () => {
    const calls: unknown[][] = [];
    const ctx = new Proxy(
      {},
      { get: (_, name) => (...args: unknown[]) => calls.push([name, ...args]) },
    ) as unknown as CanvasRenderingContext2D;
    drawFleetSign(ctx, 10, 20);
    expect(calls).toEqual([
      ['beginPath'],
      ['moveTo', 10.75, 21.75],
      ['lineTo', 12.75, 18.75],
      ['lineTo', 18.25, 18.75],
      ['lineTo', 16.25, 21.75],
      ['closePath'],
      ['stroke'],
    ]);
  });
});
