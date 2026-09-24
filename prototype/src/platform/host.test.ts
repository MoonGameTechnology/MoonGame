import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPlatform, getPlatform, setPlatform, SDK_INIT_TIMEOUT_MS } from './host';
import { createWebPlatform } from './web';

/** Минимальный `ysdk`, которого хватает адаптеру, чтобы объявить `auth`. */
const sdk = { getPlayer: () => Promise.resolve({ getUniqueID: () => 'u-1' }) };

describe('YAG-1.1b — хост выбирает площадку, а не игра', () => {
  it('без лоадера SDK поднимается веб-адаптер', async () => {
    const platform = await createPlatform({ simulate: false });
    // Веб-сборка без симуляции честно не умеет ни рекламы, ни покупок.
    expect(platform.capabilities.rewardedAds).toBe(false);
    expect(platform.capabilities.iap).toBe(false);
  });

  it('`simulate` доезжает до фолбэка — иначе дев-сборка теряет симуляцию', async () => {
    const platform = await createPlatform({ simulate: true });
    expect(platform.capabilities.rewardedAds).toBe(true);
  });

  it('лоадер есть — поднимается адаптер площадки', async () => {
    const platform = await createPlatform({
      simulate: false,
      yaGames: { init: () => Promise.resolve(sdk) },
    });
    // Признак адаптера площадки, а не фолбэка: `auth` поднят живым `getPlayer`.
    expect(platform.capabilities.auth).toBe(true);
    expect(platform.capabilities.rewardedAds).toBe(false); // до YAG-3.1
  });

  it('`init()` отклонился — игра не падает, а получает веб-адаптер', async () => {
    const onSdkError = vi.fn();
    const platform = await createPlatform({
      simulate: false,
      yaGames: { init: () => Promise.reject(new Error('no sdk')) },
      onSdkError,
    });
    expect(platform.capabilities.auth).toBe(false);
    // Молчать тоже нельзя: хост сообщает хозяину, а не глотает.
    expect(onSdkError).toHaveBeenCalledWith('init', expect.any(Error));
  });

  it('`init()` бросил синхронно — тот же исход, а не падение загрузки', async () => {
    const onSdkError = vi.fn();
    const platform = await createPlatform({
      simulate: false,
      yaGames: {
        init: () => {
          throw new Error('boom');
        },
      },
      onSdkError,
    });
    expect(platform.capabilities.auth).toBe(false);
    expect(onSdkError).toHaveBeenCalledWith('init', expect.any(Error));
  });

  it('лоадер есть, но без `init` — фолбэк, и это не ошибка', async () => {
    const onSdkError = vi.fn();
    const platform = await createPlatform({ simulate: false, yaGames: {}, onSdkError });
    expect(platform.capabilities.auth).toBe(false);
    // Отсутствие метода — не сбой SDK: сообщать хозяину не о чем.
    expect(onSdkError).not.toHaveBeenCalled();
  });

  it('`init()` не ответил — по сроку веб-адаптер, а не вечный экран загрузки (AUD-27)', async () => {
    vi.useFakeTimers();
    try {
      const onSdkError = vi.fn();
      const created = createPlatform({
        simulate: false,
        yaGames: { init: () => new Promise(() => {}) },
        onSdkError,
      });
      await vi.advanceTimersByTimeAsync(SDK_INIT_TIMEOUT_MS);
      const platform = await created;
      expect(platform.capabilities.auth).toBe(false);
      expect(onSdkError).toHaveBeenCalledWith('init', new Error('E_SDK_INIT_TIMEOUT'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('`init()` вернул не объект — фолбэк, а не адаптер поверх мусора', async () => {
    const platform = await createPlatform({
      simulate: false,
      yaGames: { init: () => Promise.resolve(null as unknown as object) },
    });
    expect(platform.capabilities.auth).toBe(false);
  });
});

describe('YAG-1.1b — шов между хостом и игрой', () => {
  it('до подстановки `getPlatform` отдаёт рабочий фолбэк, а не null', () => {
    const platform = getPlatform();
    expect(typeof platform.ads.showRewardedAd).toBe('function');
    expect(platform.capabilities.rewardedAds).toBe(false);
  });

  it('`setPlatform` подменяет площадку до импорта игры', () => {
    const mine = createWebPlatform({ simulate: true });
    setPlatform(mine);
    expect(getPlatform()).toBe(mine);
    setPlatform(createWebPlatform({ simulate: false })); // вернуть как было
  });
});

describe('YAG-1.1b — сторож границы: SDK приходит из разметки, не из графа импортов', () => {
  const src = readFileSync(new URL('./host.ts', import.meta.url), 'utf8');

  it('хост не импортирует SDK площадки — его кладёт тег <script>', () => {
    // Требование 1.19.1: лоадер подключается тегом строго как в документации. Импорт
    // пакета вместо тега — другая версия лоадера (`IF` на debug-панели) и отказ модерации.
    expect(src).not.toMatch(/^import .*(?:ya-?games|ysdk)/im);
  });

  it('хост не знает имён площадок в ветвлениях — решает наличие лоадера', () => {
    // `if (platform === 'yandex')` — ровно тот запрет, ради которого заведены capability.
    expect(src).not.toMatch(/===\s*['"]yandex['"]/);
  });
});
