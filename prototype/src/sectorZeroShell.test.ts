/**
 * Оболочка Sector Zero (REFM-211) — прямой тест того, что живёт без DOM.
 *
 * Меню, подготовка и кошелёк строят настоящую разметку, и их стык с игрой держат сторожа по
 * тексту (`comicWiring`, `runWallet`, `adPlacementGuard`, `leaveMatchWiring`, `tabLockWiring`)
 * и робот `sectorzerotest.mjs`. Здесь — две функции модуля, которым DOM не нужен: дверь к
 * ролику площадки и сутки магазина. Каждый тест — свежая загрузка модулей над своим хранилищем.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GamePlatform } from './platform/types';

const DAY_MS = 24 * 60 * 60 * 1000;
let cell: Map<string, string>;

beforeEach(() => {
  cell = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('addEventListener', () => {});
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Площадка с роликом, который отвечает `status`, и журналом аналитики. */
async function withPlatform(status: 'ok' | 'cancelled' | 'unavailable') {
  const host = await import('./platform/host');
  const events: Array<[string, Record<string, unknown> | undefined]> = [];
  const shown: string[] = [];
  host.setPlatform({
    ...host.getPlatform(),
    ads: {
      showRewardedAd: async ({ placement }) => {
        shown.push(placement);
        return { status };
      },
      showInterstitial: async () => ({ status: 'unavailable' }),
    },
    analytics: { emit: (event, props) => void events.push([event, props]) },
  } as GamePlatform);
  return { events, shown };
}

describe('REFM-211 — дверь к ролику площадки', () => {
  it('досмотренный ролик: предложение, показ и завершение — с местом и свойствами', async () => {
    const shell = await import('./sectorZeroShell');
    // Площадка ставится ПОСЛЕ импорта модуля — как телом `main.ts` в дев-сборке.
    const { events, shown } = await withPlatform('ok');
    expect(await shell.watchAd('run.double', { chapter: 'pve-1' })).toBe('ok');
    expect(shown).toEqual(['run.double']);
    expect(events).toEqual([
      ['rewarded_ad_offered', { placement: 'run.double', chapter: 'pve-1' }],
      ['rewarded_ad_completed', { placement: 'run.double', chapter: 'pve-1' }],
    ]);
  });

  it('недосмотренный или недоступный ролик — только предложение, исход отдаётся как есть', async () => {
    const shell = await import('./sectorZeroShell');
    for (const status of ['cancelled', 'unavailable'] as const) {
      const { events } = await withPlatform(status);
      expect(await shell.watchAd('run.sovereigns')).toBe(status);
      expect(events.map(([event]) => event)).toEqual(['rewarded_ad_offered']);
    }
  });
});

describe('REFM-211 — сутки магазина', () => {
  it('номер дня идёт вперёд по часам игрока и никогда не назад', async () => {
    vi.useFakeTimers();
    const profile = await import('./sectorProfile');
    const shell = await import('./sectorZeroShell');
    vi.setSystemTime(100 * DAY_MS + 5);
    shell.syncShopDay();
    expect(profile.sectorProgress.day).toBe(100);
    // Часы перевели назад — витрина не откатывается.
    vi.setSystemTime(90 * DAY_MS);
    const kept = profile.sectorProgress;
    shell.syncShopDay();
    expect(profile.sectorProgress).toBe(kept);
    expect(profile.sectorProgress.day).toBe(100);
    // Новые сутки — новая витрина: счётчики дня обнуляются.
    profile.saveSectorProgress({ ...profile.sectorProgress, adSovereignsToday: 2 });
    vi.setSystemTime(101 * DAY_MS);
    shell.syncShopDay();
    expect(profile.sectorProgress.day).toBe(101);
    expect(profile.sectorProgress.adSovereignsToday).toBe(0);
  });
});
