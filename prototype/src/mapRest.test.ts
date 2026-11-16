import { afterEach, describe, expect, it, vi } from 'vitest';
import { REST_AFTER_MS } from '../../decisions/simClock';

/** Свежий модуль: часы ввода живут в нём, и каждый тест начинает с тишины. */
async function load(now: () => number) {
  vi.resetModules();
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('performance', { now });
  vi.stubGlobal('addEventListener', (type: string, fn: () => void, opts: AddEventListenerOptions) => {
    expect(opts).toEqual({ capture: true, passive: true });
    listeners.set(type, fn);
  });
  const rest = await import('./mapRest');
  return { rest, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('покой карты — часы ввода (правило 10 `simClock.ts`)', () => {
  const still = { motion: false, mapIdle: true };

  it('касание, ход мыши, колесо и клавиша будят кадр сразу', async () => {
    const { rest, listeners } = await load(() => 0);
    const ask = vi.fn();
    rest.wakeOnInput(ask);
    expect([...listeners.keys()].sort()).toEqual(['keydown', 'pointerdown', 'pointermove', 'wheel']);
    for (const wake of listeners.values()) wake();
    expect(ask).toHaveBeenCalledTimes(4);
  });

  it('ввод отодвигает покой на REST_AFTER_MS, и побудка смены экрана — тоже ввод', async () => {
    let now = 10_000;
    const { rest, listeners } = await load(() => now);
    const wakeScreen = rest.wakeOnInput(() => {});
    expect(rest.mapRestsAt(now, still)).toBe(true);
    listeners.get('pointermove')!();
    expect(rest.mapRestsAt(now + REST_AFTER_MS - 1, still)).toBe(false);
    expect(rest.mapRestsAt(now + REST_AFTER_MS, still)).toBe(true);
    now += 5000;
    wakeScreen();
    expect(rest.mapRestsAt(now + 1, still)).toBe(false);
  });

  it('движение и недопечённая карта держат каждый кадр и в тишине', async () => {
    const { rest } = await load(() => 0);
    expect(rest.mapRestsAt(REST_AFTER_MS, { motion: true, mapIdle: true })).toBe(false);
    expect(rest.mapRestsAt(REST_AFTER_MS, { motion: false, mapIdle: false })).toBe(false);
  });
});
