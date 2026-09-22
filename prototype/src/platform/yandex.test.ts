// YAG-1.2 — проводка адаптера к SDK площадки. Правила разметки проверены отдельно
// (`decisions/platformLifecycle.test.ts`); здесь — что адаптер правда зовёт SDK, переживает
// его поломки и не обещает возможностей, которых у него ещё нет.
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createYandexPlatform, type YandexSdk } from './yandex';

/** Поддельный `ysdk`: записывает вызовы и умеет отдавать события паузы. */
function fakeSdk(over: Partial<YandexSdk> = {}) {
  const calls: string[] = [];
  const observers: Record<string, (() => void)[]> = {};
  const sdk: YandexSdk = {
    features: {
      LoadingAPI: { ready: () => calls.push('ready') },
      GameplayAPI: { start: () => calls.push('start'), stop: () => calls.push('stop') },
    },
    on: (event, observer) => {
      (observers[event] ??= []).push(observer);
      return () => {
        observers[event] = (observers[event] ?? []).filter((o) => o !== observer);
      };
    },
    getPlayer: async () => ({
      getUniqueID: () => 'u-1',
      getName: () => 'Пилот',
      isAuthorized: () => true,
    }),
    ...over,
  };
  const fire = (event: string): void => {
    for (const observer of observers[event] ?? []) observer();
  };
  return { sdk, calls, fire, observers };
}

describe('разметка доезжает до SDK', () => {
  it('готовность и цикл геймплея зовут методы площадки', () => {
    const { sdk, calls } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    platform.ready();
    platform.gameplayStart();
    platform.gameplayStop();
    expect(calls).toEqual(['ready', 'start', 'stop']);
  });

  it('повторы гасятся до SDK, а не после', () => {
    const { sdk, calls } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    platform.ready();
    platform.ready();
    platform.gameplayStart();
    platform.gameplayStart();
    expect(calls).toEqual(['ready', 'start']);
  });

  // Требование 1.19.2: `ready` привязан к готовности, а не ко времени, и до него геймплея
  // не бывает — иначе индикатор позеленеет раньше, чем игрок сможет играть.
  it('СТАРТ ДО ГОТОВНОСТИ НЕ УХОДИТ В SDK', () => {
    const { sdk, calls } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    platform.gameplayStart();
    expect(calls).toEqual([]);
  });
});

describe('пауза площадки (требование 1.19.4)', () => {
  it('game_api_pause останавливает разметку, resume возвращает', () => {
    const { sdk, calls, fire } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    platform.ready();
    platform.gameplayStart();
    fire('game_api_pause');
    fire('game_api_resume');
    expect(calls).toEqual(['ready', 'start', 'stop', 'start']);
  });

  it('хост узнаёт о паузе подпиской и может отписаться', () => {
    const { sdk, fire } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    const seen: boolean[] = [];
    const off = platform.onPlatformPause((paused) => seen.push(paused));
    fire('game_api_pause');
    fire('game_api_resume');
    off();
    fire('game_api_pause');
    expect(seen).toEqual([true, false]);
  });

  it('dispose снимает подписку на события SDK', () => {
    const { sdk, calls, fire, observers } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    platform.ready();
    platform.gameplayStart();
    platform.dispose();
    fire('game_api_pause');
    expect(observers['game_api_pause']).toEqual([]);
    expect(calls).toEqual(['ready', 'start']);
  });

  it('SDK без отписки-возврата снимается через off', () => {
    const off = vi.fn();
    const { sdk } = fakeSdk({ on: () => undefined, off });
    createYandexPlatform(sdk).dispose();
    expect(off).toHaveBeenCalledTimes(2);
  });
});

describe('чужой SDK не роняет игру', () => {
  it('исключение внутри метода площадки перехватывается и сообщается', () => {
    const onSdkError = vi.fn();
    const { sdk } = fakeSdk({
      features: {
        LoadingAPI: {
          ready: () => {
            throw new Error('sdk boom');
          },
        },
      },
    });
    const platform = createYandexPlatform(sdk, { onSdkError });
    expect(() => platform.ready()).not.toThrow();
    expect(onSdkError).toHaveBeenCalledWith('LoadingAPI.ready', expect.any(Error));
    // Событие считается отправленным: повторять его площадке нельзя (правило 1),
    // а решать, что делать со сбоем, — дело хоста, а не разметки.
    expect(platform.calls).toEqual(['ready']);
  });

  it('SDK без нужных методов не мешает: вызовы просто молчат', () => {
    const platform = createYandexPlatform({});
    expect(() => {
      platform.ready();
      platform.gameplayStart();
      platform.dispose();
    }).not.toThrow();
  });
});

describe('игрок: гость — это норма (требование 1.2.2)', () => {
  it('авторизованный игрок приходит в наших терминах', async () => {
    const { sdk } = fakeSdk();
    const player = await createYandexPlatform(sdk).auth.player();
    expect(player).toEqual({ id: 'u-1', authenticated: true, displayName: 'Пилот' });
  });

  it('НЕУДАЧА ЗАПРОСА ДАЁТ ГОСТЯ, А НЕ ИСКЛЮЧЕНИЕ', async () => {
    const onSdkError = vi.fn();
    const { sdk } = fakeSdk({
      getPlayer: async () => {
        throw new Error('no player');
      },
    });
    const player = await createYandexPlatform(sdk, { onSdkError }).auth.player();
    expect(player).toEqual({ id: 'guest', authenticated: false });
    expect(onSdkError).toHaveBeenCalledWith('getPlayer', expect.any(Error));
  });

  it('SDK без getPlayer — тоже гость', async () => {
    expect(await createYandexPlatform({}).auth.player()).toEqual({
      id: 'guest',
      authenticated: false,
    });
  });
});

describe('возможности объявляются по тому, что умеет АДАПТЕР', () => {
  it('нереализованные кирпичи стоят false, а их вызовы честно недоступны', async () => {
    const { sdk } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    expect(platform.capabilities).toEqual({
      auth: true,
      cloudSave: false,
      rewardedAds: false,
      interstitialAds: false,
      iap: false,
      analytics: false,
    });
    // Ровно та связка, ради которой заведён третий исход: флага нет — кнопки нет, а если
    // вызов всё же случился, он говорит «здесь этого не бывает», а не делает вид.
    expect(await platform.ads.showRewardedAd({ placement: 'p' })).toEqual({
      status: 'unavailable',
    });
    expect(await platform.iap.purchase('x')).toEqual({ status: 'unavailable' });
    expect(await platform.save.load()).toBeNull();
  });

  it('без getPlayer площадка не обещает и авторизацию', () => {
    expect(createYandexPlatform({}).capabilities.auth).toBe(false);
  });
});

describe('аналитика копится, пока её некуда отправлять', () => {
  it('без sink события складываются в адаптер', () => {
    const platform = createYandexPlatform(fakeSdk().sdk);
    platform.analytics.emit('pve_started', { mode: 'sector-zero' });
    expect(platform.events).toEqual([
      { event: 'pve_started', props: { mode: 'sector-zero' } },
    ]);
  });

  it('заданный sink получает событие вместо накопления', () => {
    const sink = vi.fn();
    const platform = createYandexPlatform(fakeSdk().sdk, { sink });
    platform.analytics.emit('session_started');
    expect(sink).toHaveBeenCalledWith('session_started', undefined);
    expect(platform.events).toEqual([]);
  });
});

// Граница из `platform-adapters.md`: «`shared-core` не импортирует SDK площадки»,
// «gameplay не проверяет строку `yandex`». Держим её сторожем, а не бдительностью —
// образец взят у `aiProfile.test.ts`. Сторож графа импортов самой сборки — за `YAG-1.1b`.
describe('граница площадки (platform-adapters.md)', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('чистое решение о жизненном цикле не знает ни про SDK, ни про площадку', () => {
    const src = read('../../../decisions/platformLifecycle.ts');
    expect(src).not.toMatch(/ysdk|YaGames|yandex/i);
    expect(src).not.toContain('import ');
  });

  it('ЯДРО НЕ ЗНАЕТ ПРО ПЛОЩАДКУ ВООБЩЕ', () => {
    const files = globSync('**/*.ts', {
      cwd: fileURLToPath(new URL('../../../packages/shared-core/src', import.meta.url)),
    });
    expect(files.length).toBeGreaterThan(50); // иначе сторож молча проверяет пустоту
    for (const file of files) {
      const src = readFileSync(
        fileURLToPath(new URL(`../../../packages/shared-core/src/${file}`, import.meta.url)),
        'utf8',
      );
      expect([file, /YaGames|ysdk/.test(src)]).toEqual([file, false]);
    }
  });

  it('имя площадки живёт только в её адаптере, а не в игровом коде', () => {
    // Решения принимаются по capability-флагам; `if (platform === 'yandex')` — тот самый
    // приём, который ломается на второй площадке и врёт на первой.
    expect(read('../main.ts')).not.toMatch(/['"]yandex['"]/i);
  });
});
