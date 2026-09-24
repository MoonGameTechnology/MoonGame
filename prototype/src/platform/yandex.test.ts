// YAG-1.2 — проводка адаптера к SDK площадки. Правила разметки проверены отдельно
// (`decisions/platformLifecycle.test.ts`); здесь — что адаптер правда зовёт SDK, переживает
// его поломки и не обещает возможностей, которых у него ещё нет.
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_KEY, CLOUD_LIMIT_BYTES, createYandexPlatform, type YandexSdk } from './yandex';

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

describe('вход по кнопке (YAG-1.4, требование 1.2.1)', () => {
  /** Площадка, где игрок — гость, пока окно входа не закрылось успехом. */
  function signInSdk(dialog: () => Promise<void>) {
    let authorized = false;
    let getPlayerCalls = 0;
    const openAuthDialog = vi.fn(async () => {
      await dialog();
      authorized = true;
    });
    const sdk: YandexSdk = {
      getPlayer: async () => {
        getPlayerCalls += 1;
        // Снимок, а не живой объект: так ведёт себя площадка — прежний объект игрока
        // остаётся неавторизованным и после входа (страница «Авторизация», `YAG-0.2`).
        const now = authorized;
        return { getUniqueID: () => (now ? 'u-7' : 'anon-7'), isAuthorized: () => now };
      },
      auth: { openAuthDialog },
    };
    return { sdk, openAuthDialog, getPlayerCalls: () => getPlayerCalls };
  }

  it('кнопку есть кому показать, только когда у площадки есть и окно входа, и игрок', () => {
    expect(createYandexPlatform(signInSdk(async () => undefined).sdk).auth.canSignIn).toBe(true);
    expect(createYandexPlatform({ getPlayer: fakeSdk().sdk.getPlayer }).auth.canSignIn).toBe(false);
    expect(
      createYandexPlatform({ auth: { openAuthDialog: async () => undefined } }).auth.canSignIn,
    ).toBe(false);
  });

  it('успешный вход — игрок запрашивается ЗАНОВО, иначе интерфейс покажет гостя', async () => {
    const { sdk, getPlayerCalls } = signInSdk(async () => undefined);
    const result = await createYandexPlatform(sdk).auth.signIn();
    expect(result).toEqual({ status: 'ok', player: { id: 'u-7', authenticated: true } });
    // Первый запрос — узнать, что игрок гость; второй — уже ПОСЛЕ окна.
    expect(getPlayerCalls()).toBe(2);
  });

  it('отказ игрока — `cancelled`, а не ошибка и не сбой SDK', async () => {
    const onSdkError = vi.fn();
    const { sdk } = signInSdk(() => Promise.reject(new Error('closed')));
    const result = await createYandexPlatform(sdk, { onSdkError }).auth.signIn();
    expect(result).toEqual({ status: 'cancelled', player: { id: 'anon-7', authenticated: false } });
    // Отказ — нормальный исход: писать его в журнал сбоев значило бы засорить журнал
    // каждым «не сейчас».
    expect(onSdkError).not.toHaveBeenCalled();
  });

  it('окно бросило синхронно — тоже `cancelled`: кнопка остаётся, игра не падает', async () => {
    const { sdk } = signInSdk(async () => undefined);
    sdk.auth = {
      openAuthDialog: () => {
        throw new Error('boom');
      },
    };
    const result = await createYandexPlatform(sdk).auth.signIn();
    expect(result.status).toBe('cancelled');
  });

  it('уже вошедшему окно не показывается вовсе', async () => {
    const { sdk, openAuthDialog } = fakeSdkWithDialog();
    const result = await createYandexPlatform(sdk).auth.signIn();
    expect(result.status).toBe('ok');
    expect(openAuthDialog).not.toHaveBeenCalled();
  });

  it('окно закрылось «успехом», а игрок всё ещё гость — не `ok`: обещать вход нечем', async () => {
    const { sdk } = signInSdk(async () => undefined);
    sdk.getPlayer = async () => ({ getUniqueID: () => 'anon-7', isAuthorized: () => false });
    const result = await createYandexPlatform(sdk).auth.signIn();
    expect(result).toEqual({ status: 'cancelled', player: { id: 'anon-7', authenticated: false } });
  });

  it('площадка не умеет входа — `unavailable`, окно не зовётся', async () => {
    const result = await createYandexPlatform(fakeSdk().sdk).auth.signIn();
    expect(result.status).toBe('unavailable');
  });

  it('двойной тап по кнопке открывает ОДНО окно, и оба ждут его исхода', async () => {
    let finish = (): void => undefined;
    const { sdk, openAuthDialog } = signInSdk(() => new Promise<void>((r) => (finish = r)));
    const auth = createYandexPlatform(sdk).auth;
    const first = auth.signIn();
    const second = auth.signIn();
    await vi.waitFor(() => expect(openAuthDialog).toHaveBeenCalledTimes(1));
    finish();
    expect((await first).status).toBe('ok');
    expect((await second).status).toBe('ok');
    expect(openAuthDialog).toHaveBeenCalledTimes(1);
  });

  it('после исхода окно снова можно открыть — «в полёте» не залипает', async () => {
    const { sdk, openAuthDialog } = signInSdk(() => Promise.reject(new Error('closed')));
    const auth = createYandexPlatform(sdk).auth;
    await auth.signIn();
    await auth.signIn();
    expect(openAuthDialog).toHaveBeenCalledTimes(2);
  });
});

/** Уже авторизованный игрок и окно входа, которое звать незачем. */
function fakeSdkWithDialog() {
  const openAuthDialog = vi.fn(async () => undefined);
  const { sdk } = fakeSdk({ auth: { openAuthDialog } });
  return { sdk, openAuthDialog };
}

describe('возможности объявляются по тому, что умеет АДАПТЕР', () => {
  it('нереализованные кирпичи стоят false, а их вызовы честно недоступны', async () => {
    const { sdk } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    expect(platform.capabilities).toEqual({
      auth: true,
      cloudSave: true, // YAG-2.2: облако вошедшего игрока (у фейка нет getData — см. ниже)
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

describe('облачный сейв (YAG-2.2)', () => {
  /** Игрок с облаком: запоминает записи и отдаёт их на чтение, как SDK. */
  const cloudPlayer = (authorized: boolean, store: Record<string, unknown> = {}) => {
    const writes: { data: Record<string, unknown>; flush?: boolean }[] = [];
    const reads: (string[] | undefined)[] = [];
    return {
      writes,
      reads,
      player: {
        getUniqueID: () => (authorized ? 'u-1' : 'guest-1'),
        isAuthorized: () => authorized,
        setData: async (data: Record<string, unknown>, flush?: boolean) => {
          writes.push({ data, flush });
          Object.assign(store, data);
        },
        getData: async (keys?: string[]) => {
          reads.push(keys);
          return store;
        },
      },
    };
  };

  it('гость в облако не пишет и из него не читает — его прогресс живёт локально', async () => {
    const guest = cloudPlayer(false);
    const platform = createYandexPlatform(fakeSdk({ getPlayer: async () => guest.player }).sdk);
    await platform.save.save('{"v":1}');
    expect(await platform.save.load()).toBeNull();
    expect(guest.writes).toEqual([]);
    expect(guest.reads).toEqual([]);
  });

  it('вошедший: снимок пишется под своим ключом и читается обратно', async () => {
    const me = cloudPlayer(true);
    const platform = createYandexPlatform(fakeSdk({ getPlayer: async () => me.player }).sdk);
    await platform.save.save('{"v":1,"runs":3}');
    expect(me.writes).toEqual([{ data: { [CLOUD_KEY]: '{"v":1,"runs":3}' }, flush: false }]);
    expect(await platform.save.load()).toBe('{"v":1,"runs":3}');
    expect(me.reads).toEqual([[CLOUD_KEY]]);
  });

  it('уход со страницы передаёт SDK `flush`', async () => {
    const me = cloudPlayer(true);
    const platform = createYandexPlatform(fakeSdk({ getPlayer: async () => me.player }).sdk);
    await platform.save.save('a', { flush: true });
    expect(me.writes.at(-1)?.flush).toBe(true);
  });

  it('объект игрока запрашивается один раз — у getPlayer своя квота', async () => {
    const me = cloudPlayer(true);
    let asked = 0;
    const platform = createYandexPlatform(
      fakeSdk({
        getPlayer: async () => {
          asked += 1;
          return me.player;
        },
      }).sdk,
    );
    await platform.save.load();
    await platform.save.save('a');
    await platform.save.load();
    expect(asked).toBe(1);
  });

  it('упал запрос игрока — облако не переспрашивает его на каждую запись', async () => {
    let asked = 0;
    const platform = createYandexPlatform(
      fakeSdk({
        getPlayer: async () => {
          asked += 1;
          throw new Error('offline');
        },
      }).sdk,
    );
    await platform.save.save('a');
    await platform.save.load();
    await platform.save.load();
    expect(asked).toBe(1);
  });

  it('вошёл посреди сессии — облако берёт уже вошедшего игрока', async () => {
    const guest = cloudPlayer(false);
    const me = cloudPlayer(true);
    let authorized = false;
    const platform = createYandexPlatform(
      fakeSdk({
        getPlayer: async () => (authorized ? me.player : guest.player),
        auth: {
          openAuthDialog: async () => {
            authorized = true;
          },
        },
      }).sdk,
    );
    await platform.save.save('before');
    expect(await platform.auth.signIn()).toMatchObject({ status: 'ok' });
    await platform.save.save('after', { flush: true });
    expect(guest.writes).toEqual([]);
    expect(me.writes.map((w) => w.data[CLOUD_KEY])).toEqual(['after']);
  });

  it('снимок сверх лимита площадки не отправляется, сбой — в журнал', async () => {
    const me = cloudPlayer(true);
    const errors: string[] = [];
    const platform = createYandexPlatform(fakeSdk({ getPlayer: async () => me.player }).sdk, {
      onSdkError: (where, error) => errors.push(`${where}:${(error as Error).message}`),
    });
    await platform.save.save('x'.repeat(CLOUD_LIMIT_BYTES));
    expect(me.writes).toEqual([]);
    expect(errors).toEqual(['setData:E_CLOUD_SAVE_TOO_BIG']);
  });

  it('AUD-24: «влезет ли» — тем же подсчётом, каким запись потом режется', () => {
    // Хост спрашивает это ДО записи, чтобы отправить конверт без мира забега, а не
    // потерять запись целиком. Два разных правила подсчёта здесь разошлись бы на
    // экранировании кавычек: снимок едет строкой внутри JSON.
    const platform = createYandexPlatform(fakeSdk({}).sdk);
    const overhead = JSON.stringify({ [CLOUD_KEY]: '' }).length;
    expect(platform.save.fits?.('x'.repeat(CLOUD_LIMIT_BYTES - overhead))).toBe(true);
    expect(platform.save.fits?.('x'.repeat(CLOUD_LIMIT_BYTES - overhead + 1))).toBe(false);
    // Кавычки удваиваются экранированием — их считает тот же подсчёт, а не длина строки.
    expect(platform.save.fits?.('"'.repeat(CLOUD_LIMIT_BYTES / 2))).toBe(false);
  });

  it('сбой чтения — «сохранения нет», сбой записи — промис не отклоняется', async () => {
    const errors: string[] = [];
    const broken = {
      isAuthorized: () => true,
      setData: async () => {
        throw new Error('offline');
      },
      getData: async () => {
        throw new Error('offline');
      },
    };
    const platform = createYandexPlatform(fakeSdk({ getPlayer: async () => broken }).sdk, {
      onSdkError: (where) => errors.push(where),
    });
    expect(await platform.save.load()).toBeNull();
    const pending = platform.save.save('a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(['getData', 'setData']);
    void pending; // закроется повтором или отказом, но не исключением
  });

  it('в облаке не строка — это не наш сейв, «сохранения нет»', async () => {
    const me = cloudPlayer(true, { [CLOUD_KEY]: { foreign: true } });
    const platform = createYandexPlatform(fakeSdk({ getPlayer: async () => me.player }).sdk);
    expect(await platform.save.load()).toBeNull();
  });
});

describe('язык игрока (YAG-1.3, требование 2.14)', () => {
  it('язык площадки доезжает как есть — решение о локали принимает не адаптер', () => {
    const { sdk } = fakeSdk({ environment: { i18n: { lang: 'tr', tld: 'com.tr' } } });
    // `tr` нарочно: локали у нас такой нет, и адаптер обязан не «помогать» — выбор
    // резерва живёт в `decisions/platformLocale.ts`, одно правило на все площадки.
    expect(createYandexPlatform(sdk).language).toBe('tr');
  });

  it('площадка языка не сообщила — поля нет, а не пустая строка или мусор', () => {
    expect(createYandexPlatform({}).language).toBeUndefined();
    expect(createYandexPlatform({ environment: {} }).language).toBeUndefined();
    const junk = { environment: { i18n: { lang: 7 as unknown as string } } };
    expect(createYandexPlatform(junk).language).toBeUndefined();
  });
});

describe('rewarded-реклама (YAG-3.1)', () => {
  type Callbacks = Partial<
    Record<'onOpen' | 'onRewarded' | 'onClose' | 'onError', (e?: Error) => void>
  >;
  /** Площадка, которая проигрывает ролик по сценарию: имена колбэков по порядку. */
  function adSdk(script: (keyof Callbacks)[]) {
    const fullscreen = vi.fn();
    const { sdk, calls } = fakeSdk({
      adv: {
        showRewardedVideo: ({ callbacks }: { callbacks?: Callbacks } = {}) => {
          for (const name of script)
            callbacks?.[name]?.(name === 'onError' ? new Error('no fill') : undefined);
        },
        showFullscreenAdv: fullscreen,
      },
    });
    return { sdk, calls, fullscreen };
  }

  it('площадка умеет rewarded — флаг поднят; интерстишлов нет по решению владельца', () => {
    const { capabilities } = createYandexPlatform(adSdk([]).sdk);
    expect(capabilities.rewardedAds).toBe(true);
    // Резолюция 2026-09-22: в Sector Zero реклама только по нажатию игрока.
    expect(capabilities.interstitialAds).toBe(false);
  });

  it('досмотрел — `ok`', async () => {
    const platform = createYandexPlatform(adSdk(['onOpen', 'onRewarded', 'onClose']).sdk);
    expect(await platform.ads.showRewardedAd({ placement: 'shop.lot' })).toEqual({ status: 'ok' });
  });

  it('ЗАКРЫЛ КРЕСТИКОМ — `cancelled`, а не награда', async () => {
    const platform = createYandexPlatform(adSdk(['onOpen', 'onClose']).sdk);
    expect(await platform.ads.showRewardedAd({ placement: 'shop.lot' })).toEqual({
      status: 'cancelled',
    });
  });

  it('ролика нет — `unavailable`, и сбой уходит в журнал разработчика', async () => {
    const onSdkError = vi.fn();
    const platform = createYandexPlatform(adSdk(['onError']).sdk, { onSdkError });
    expect(await platform.ads.showRewardedAd({ placement: 'shop.lot' })).toEqual({
      status: 'unavailable',
    });
    expect(onSdkError).toHaveBeenCalledWith('showRewardedVideo', expect.any(Error));
  });

  it('SDK бросил синхронно — `unavailable`, а не отклонённый промис', async () => {
    const onSdkError = vi.fn();
    const { sdk } = fakeSdk({
      adv: {
        showRewardedVideo: () => {
          throw new Error('boom');
        },
      },
    });
    const result = await createYandexPlatform(sdk, { onSdkError }).ads.showRewardedAd({
      placement: 'shop.lot',
    });
    expect(result).toEqual({ status: 'unavailable' });
    expect(onSdkError).toHaveBeenCalledWith('showRewardedVideo', expect.any(Error));
  });

  it('на время ролика звук глушится и геймплей стоит, после — возвращаются (п. 4.7)', async () => {
    const { sdk, calls } = adSdk(['onOpen', 'onRewarded', 'onClose']);
    const platform = createYandexPlatform(sdk);
    const paused: boolean[] = [];
    platform.onPlatformPause((p) => paused.push(p));
    platform.ready();
    platform.gameplayStart();
    await platform.ads.showRewardedAd({ placement: 'run.double' });
    // Не полагаемся на то, что площадка сама пришлёт `game_api_pause`: требование
    // проверяет модерация, и держать его должна игра.
    expect(paused).toEqual([true, false]);
    expect(calls).toEqual(['ready', 'start', 'stop', 'start']);
  });

  it('ролик не открылся — глушить было нечего и снимать нечего', async () => {
    const platform = createYandexPlatform(adSdk(['onError']).sdk);
    const paused: boolean[] = [];
    platform.onPlatformPause((p) => paused.push(p));
    await platform.ads.showRewardedAd({ placement: 'shop.lot' });
    expect(paused).toEqual([]);
  });

  it('колбэки после исхода не выдают вторую награду и не снимают паузу дважды', async () => {
    const platform = createYandexPlatform(
      adSdk(['onOpen', 'onClose', 'onRewarded', 'onClose']).sdk,
    );
    const paused: boolean[] = [];
    platform.onPlatformPause((p) => paused.push(p));
    expect(await platform.ads.showRewardedAd({ placement: 'shop.lot' })).toEqual({
      status: 'cancelled',
    });
    expect(paused).toEqual([true, false]);
  });

  it('интерстишл честно `unavailable`, даже если SDK его умеет', async () => {
    const { sdk, fullscreen } = adSdk([]);
    const result = await createYandexPlatform(sdk).ads.showInterstitial({ placement: 'x' });
    expect(result).toEqual({ status: 'unavailable' });
    expect(fullscreen).not.toHaveBeenCalled();
  });
});

describe('аналитика копится, пока её некуда отправлять', () => {
  it('без sink события складываются в адаптер', () => {
    const platform = createYandexPlatform(fakeSdk().sdk);
    platform.analytics.emit('pve_started', { mode: 'sector-zero' });
    expect(platform.events).toEqual([{ event: 'pve_started', props: { mode: 'sector-zero' } }]);
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

describe('YAG-6.4 — «назад» и выход площадки', () => {
  /** SDK с `onEvent`: помнит подписчиков и умеет прислать событие. */
  function withEvents() {
    const listeners: Record<string, (() => void)[]> = {};
    const base = fakeSdk({
      onEvent: (name, listener) => {
        (listeners[name] ??= []).push(listener);
        return () => {
          listeners[name] = (listeners[name] ?? []).filter((l) => l !== listener);
        };
      },
    });
    const send = (name: string): void => {
      for (const l of listeners[name] ?? []) l();
    };
    return { ...base, listeners, send };
  }

  it('«назад» площадки доходит до игры, отписка его снимает', () => {
    const { sdk, send } = withEvents();
    const platform = createYandexPlatform(sdk);
    const seen: string[] = [];
    const off = platform.onHistoryBack(() => seen.push('back'));
    send('HISTORY_BACK');
    off();
    send('HISTORY_BACK');
    expect(seen).toEqual(['back']);
  });

  it('выход площадки доходит до игры отдельным событием', () => {
    const { sdk, send } = withEvents();
    const platform = createYandexPlatform(sdk);
    const seen: string[] = [];
    platform.onHistoryBack(() => seen.push('back'));
    platform.onExit(() => seen.push('exit'));
    send('EXIT');
    expect(seen).toEqual(['exit']);
  });

  it('`dispose` снимает и эти подписки', () => {
    const { sdk, send, listeners } = withEvents();
    const platform = createYandexPlatform(sdk);
    platform.onHistoryBack(() => {});
    platform.onExit(() => {});
    platform.dispose();
    send('HISTORY_BACK');
    expect((listeners.HISTORY_BACK ?? []).length + (listeners.EXIT ?? []).length).toBe(0);
  });

  it('SDK без `onEvent` — подписка пустая, а не падение', () => {
    const { sdk } = fakeSdk();
    const platform = createYandexPlatform(sdk);
    expect(() => platform.onHistoryBack(() => {})()).not.toThrow();
  });

  it('сбой `onEvent` уходит в журнал сбоев, игра продолжает', () => {
    const errors: string[] = [];
    const { sdk } = fakeSdk({
      onEvent: () => {
        throw new Error('sdk');
      },
    });
    const platform = createYandexPlatform(sdk, { onSdkError: (where) => errors.push(where) });
    expect(() => platform.onExit(() => {})()).not.toThrow();
    expect(errors).toEqual(['onEvent']);
  });
});
