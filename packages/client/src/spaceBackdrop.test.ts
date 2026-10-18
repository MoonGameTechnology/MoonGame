import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
/** Device pixels to two places; `+ 0` makes a −0 the 0 it is. */
const rounded = (values: unknown[]): number[] => values.map((v) => Math.round((v as number) * 100) / 100 + 0);

it('decodes the embedded backdrop once and shares preparation with repeated map entries', async () => {
  const decode = vi.fn(async () => {});
  vi.stubGlobal(
    'Image',
    class {
      complete = true;
      naturalWidth = 1200;
      decode = decode;
    },
  );
  const { prepareSpaceBackdrop, spaceBackdropReady } = await import('./spaceBackdrop');
  const first = prepareSpaceBackdrop(true);
  expect(prepareSpaceBackdrop(true)).toBe(first);
  await first;
  expect(spaceBackdropReady(true)).toBe(true);
  expect(decode).toHaveBeenCalledOnce();
});

it('finishes with the existing dark fallback when image decoding fails', async () => {
  vi.stubGlobal(
    'Image',
    class {
      complete = true;
      naturalWidth = 0;
      decode = async () => {
        throw Error('decode');
      };
    },
  );
  const { prepareSpaceBackdrop, spaceBackdropReady } = await import('./spaceBackdrop');
  await expect(prepareSpaceBackdrop()).resolves.toBeUndefined();
  expect(spaceBackdropReady()).toBe(false);
});

it('with a device pixel ratio, scales the sky once and copies it at whole device pixels', async () => {
  vi.stubGlobal(
    'Image',
    class {
      complete = true;
      naturalWidth = 1200;
      naturalHeight = 800;
    },
  );
  const listeners = new Map<string, () => void>();
  const scaled: unknown[][] = [];
  const cover = {
    width: 0,
    height: 0,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    getContext: () => ({ fillRect() {}, drawImage: (...args: unknown[]) => scaled.push(args) }),
  };
  vi.stubGlobal('document', { createElement: () => cover });
  const { drawSpaceBackdrop } = await import('./spaceBackdrop');
  const copies: unknown[][] = [];
  const g = {
    fillRect() {},
    save() {},
    restore() {},
    setTransform() {},
    drawImage: (...args: unknown[]) => copies.push(args),
  } as unknown as CanvasRenderingContext2D;
  drawSpaceBackdrop(g, 100, 50, 0, 0, true, false, 2);
  drawSpaceBackdrop(g, 100, 50, 0, 0, true, false, 2);
  expect(scaled).toHaveLength(1);
  // The sky scaled to 148 × 98.67 is cut to what the screen and its parallax margin show:
  // 148 × 98, its middle.
  expect([cover.width, cover.height]).toEqual([296, 196]);
  expect(rounded(scaled[0]!.slice(1))).toEqual([0, -0.67, 296, 197.33]);
  // (100 − 148)/2 · 2 = −48 and (50 − 98)/2 · 2 = −48: whole device pixels.
  expect(copies).toEqual([
    [cover, -48, -48],
    [cover, -48, -48],
  ]);
  // A lost GPU context keeps the canvas but drops its pixels.
  listeners.get('contextrestored')!();
  drawSpaceBackdrop(g, 100, 50, 0, 0, true, false, 2);
  expect(scaled).toHaveLength(2);
});

it('on a portrait phone keeps only the slice of a landscape sky the screen can show', async () => {
  vi.stubGlobal(
    'Image',
    class {
      complete = true;
      naturalWidth = 1200;
      naturalHeight = 800;
    },
  );
  const scaled: unknown[][] = [];
  const cover = {
    width: 0,
    height: 0,
    addEventListener() {},
    getContext: () => ({ fillRect() {}, drawImage: (...args: unknown[]) => scaled.push(args) }),
  };
  vi.stubGlobal('document', { createElement: () => cover });
  const { drawSpaceBackdrop } = await import('./spaceBackdrop');
  const copies: unknown[][] = [];
  const g = {
    fillRect() {},
    save() {},
    restore() {},
    setTransform() {},
    drawImage: (...args: unknown[]) => copies.push(args),
  } as unknown as CanvasRenderingContext2D;
  // 412 × 915 at 2×: the sky covers 963 px of height, so it is 1444.5 px wide.
  drawSpaceBackdrop(g, 412, 915, 0, 0, true, true, 2);
  expect([cover.width, cover.height]).toEqual([920, 1926]);
  // Its middle, the image's own centre on the screen's centre.
  expect(rounded(scaled[0]!.slice(1))).toEqual([-984.5, 0, 2889, 1926]);
  expect(copies).toEqual([[cover, -48, -48]]);
  // Panned as far as the parallax goes, the slice still covers the screen.
  for (const pan of [-1e6, 1e6]) {
    copies.length = 0;
    drawSpaceBackdrop(g, 412, 915, pan, pan, true, true, 2);
    const [, x, y] = copies[0] as [unknown, number, number];
    expect(x).toBeLessThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(0);
    expect(x + cover.width).toBeGreaterThanOrEqual(412 * 2);
    expect(y + cover.height).toBeGreaterThanOrEqual(915 * 2);
  }
});
