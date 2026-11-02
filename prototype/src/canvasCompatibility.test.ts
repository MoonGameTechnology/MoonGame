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

describe('canvas compatibility after the slow-device verdict (decisions/mapSharpness.ts, rule 6)', () => {
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 15; RMX3890)' };
  const storage = (init: Record<string, string> = {}): Map<string, string> => {
    const values = new Map(Object.entries(init));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    return values;
  };

  it('a stored verdict starts an untouched Android device in the mode', async () => {
    storage({ 'void.mapSlow': '1' });
    vi.stubGlobal('navigator', android);
    const mode = await import('./canvasCompatibility');
    expect(mode.canvasCompatibilityChosen()).toBeNull();
    expect(mode.canvasCompatibilityActive()).toBe(true);
    expect(mode.canvasCompatibilityRequested()).toBe(true);
    expect(mode.canvasCompatibilityOptions()).toEqual({ willReadFrequently: true });
  });

  it("the player's choice beats the verdict, and where there is no switch the verdict asks nothing", async () => {
    storage({ 'void.mapSlow': '1', 'void.canvasCompatibility': '0' });
    vi.stubGlobal('navigator', android);
    let mode = await import('./canvasCompatibility');
    expect(mode.canvasCompatibilityChosen()).toBe(false);
    expect(mode.canvasCompatibilityActive()).toBe(false);

    vi.resetModules();
    storage({ 'void.mapSlow': '1' });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    mode = await import('./canvasCompatibility');
    expect(mode.canvasCompatibilitySupported()).toBe(false);
    expect(mode.canvasCompatibilityActive()).toBe(false);
    expect(mode.canvasCompatibilityRequested()).toBe(false);
  });

  it('a verdict of this session asks the next start for the mode, not this one', async () => {
    const values = storage();
    vi.stubGlobal('navigator', android);
    const mode = await import('./canvasCompatibility');
    const prefs = await import('./graphicsPrefs');
    expect(mode.canvasCompatibilityRequested()).toBe(false);
    prefs.markMapSlow();
    expect(mode.canvasCompatibilityRequested()).toBe(true);
    expect(mode.canvasCompatibilityActive()).toBe(false);
    expect(mode.canvasCompatibilityOptions()).toBeUndefined();

    vi.resetModules();
    storage(Object.fromEntries(values));
    const next = await import('./canvasCompatibility');
    expect(next.canvasCompatibilityActive()).toBe(true);
  });

  it('a verdict the storage refused promises no change after restart', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });
    vi.stubGlobal('navigator', android);
    const mode = await import('./canvasCompatibility');
    const prefs = await import('./graphicsPrefs');
    prefs.markMapSlow();
    expect(prefs.mapSlowSeen()).toBe(true);
    expect(mode.canvasCompatibilityRequested()).toBe(false);
  });
});
