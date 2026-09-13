import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('canvas compatibility preference', () => {
  it('keeps every context on the startup policy until a new page loads', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    let mode = await import('./canvasCompatibility');
    expect(mode.canvasCompatibilityOptions()).toBeUndefined();
    mode.setCanvasCompatibility(true);
    expect(mode.canvasCompatibilityRequested()).toBe(true);
    expect(mode.canvasCompatibilityActive()).toBe(false);
    expect(mode.canvasCompatibilityOptions()).toBeUndefined();

    vi.resetModules();
    mode = await import('./canvasCompatibility');
    expect(mode.canvasCompatibilityActive()).toBe(true);
    expect(mode.canvasCompatibilityOptions()).toEqual({ willReadFrequently: true });
    mode.setCanvasCompatibility(false);
    expect(mode.canvasCompatibilityRequested()).toBe(false);
    expect(mode.canvasCompatibilityOptions()).toEqual({ willReadFrequently: true });

    vi.resetModules();
    mode = await import('./canvasCompatibility');
    expect(mode.canvasCompatibilityActive()).toBe(false);
  });

  it('does not promise a restart change when storage refuses the write', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });
    const mode = await import('./canvasCompatibility');
    expect(() => mode.setCanvasCompatibility(true)).not.toThrow();
    expect(mode.canvasCompatibilityRequested()).toBe(false);
    expect(mode.canvasCompatibilityOptions()).toBeUndefined();
  });
});
