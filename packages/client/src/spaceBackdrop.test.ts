import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

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
  expect([cover.width, cover.height]).toEqual([296, 198]);
  // (100 − 148)/2 · 2 = −48 and (50 − 98.67)/2 · 2 = −48.67 → the nearest device pixel.
  expect(copies).toEqual([
    [cover, -48, -49],
    [cover, -48, -49],
  ]);
  // A lost GPU context keeps the canvas but drops its pixels.
  listeners.get('contextrestored')!();
  drawSpaceBackdrop(g, 100, 50, 0, 0, true, false, 2);
  expect(scaled).toHaveLength(2);
});
