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
