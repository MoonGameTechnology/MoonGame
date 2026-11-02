import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('сохранение режима кадров', () => {
  it('выбор применяется сразу и переживает перезагрузку модуля', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const prefs = await import('./graphicsPrefs');
    expect(prefs.frameRateMode()).toBe('60');
    prefs.setFrameRate('120');
    expect(prefs.frameRateMode()).toBe('120');
    expect(values.get('void.frameRate')).toBe('120');
    vi.resetModules();
    expect((await import('./graphicsPrefs')).frameRateMode()).toBe('120');
  });

  it('недоступное хранилище не ломает применение выбора', async () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    const prefs = await import('./graphicsPrefs');
    expect(prefs.frameRateMode()).toBe('60');
    expect(() => prefs.setFrameRate('30')).not.toThrow();
    expect(prefs.frameRateMode()).toBe('30');
  });
});
