import { describe, it, expect } from 'vitest';
import { createWebPlatform } from './web';
import { PLATFORM_EVENTS } from './types';

describe('WebPlatformAdapter — площадка по умолчанию', () => {
  it('в сборке игрока рекламы и покупок НЕТ, и это нормальное состояние', () => {
    // Обычный браузер не показывает rewarded и не проводит платежи. Поднять флаги
    // «пока не сделали» значило бы обещать механику, которой у игрока не будет.
    const p = createWebPlatform();
    expect(p.capabilities).toEqual({
      auth: false,
      cloudSave: false,
      rewardedAds: false,
      interstitialAds: false,
      iap: false,
      analytics: true,
    });
  });

  it('без симуляции реклама и покупка отвечают `unavailable`, а не падают', async () => {
    const p = createWebPlatform();
    expect((await p.ads.showRewardedAd({ placement: 'shop' })).status).toBe('unavailable');
    expect((await p.iap.purchase('sovereigns.small')).status).toBe('unavailable');
    expect(await p.iap.catalog()).toEqual([]);
  });

  it('симуляция покрывает ВСЕ ТРИ исхода по очереди сценария', async () => {
    // Ради этого адаптер и существует: «игрок отказался» на живой площадке в CI не
    // воспроизвести, а различать отказ и отсутствие обязательно.
    const p = createWebPlatform({ simulate: true, outcomes: ['ok', 'cancelled', 'unavailable'] });
    const got = [
      (await p.ads.showRewardedAd({ placement: 'a' })).status,
      (await p.ads.showRewardedAd({ placement: 'b' })).status,
      (await p.ads.showRewardedAd({ placement: 'c' })).status,
    ];
    expect(got).toEqual(['ok', 'cancelled', 'unavailable']);
    expect((await p.ads.showRewardedAd({ placement: 'd' })).status).toBe('ok'); // сценарий кончился
  });

  it('квитанция бывает ТОЛЬКО у успешной покупки', async () => {
    // Пустая квитанция у отказа однажды доедет до проверки и сойдёт за настоящую.
    const p = createWebPlatform({ simulate: true, outcomes: ['ok', 'cancelled'] });
    const good = await p.iap.purchase('sovereigns.small');
    expect([good.status, good.receipt !== undefined]).toEqual(['ok', true]);
    const bad = await p.iap.purchase('sovereigns.small');
    expect([bad.status, bad.receipt]).toEqual(['cancelled', undefined]);
  });

  it('аналитика собирает НАШ словарь событий', () => {
    const seen: string[] = [];
    const p = createWebPlatform({ sink: (e) => seen.push(e) });
    p.analytics.emit('pve_started', { difficulty: 'strong' });
    p.analytics.emit('rewarded_ad_offered');
    expect(p.events).toEqual([
      { event: 'pve_started', props: { difficulty: 'strong' } },
      { event: 'rewarded_ad_offered' },
    ]);
    expect(seen).toEqual(['pve_started', 'rewarded_ad_offered']);
    // Словарь один на все площадки — иначе воронки с разных площадок не сравнить.
    expect(PLATFORM_EVENTS).toContain('iap_completed');
  });

  it('входа нет: кнопки быть не должно, а вызов честно `unavailable` (YAG-1.4)', async () => {
    // Логин нашего сервера сюда не подставляется: для площадки он «сторонний сервис»
    // (п. 1.2), а вне площадки аккаунта площадки нет по определению.
    const p = createWebPlatform({ simulate: true });
    expect(p.auth.canSignIn).toBe(false);
    expect(await p.auth.signIn()).toEqual({
      status: 'unavailable',
      player: { id: 'web:guest', authenticated: false },
    });
  });

  it('языка не подсказывает: язык браузера рантайм локализации уже взял сам (YAG-1.3)', () => {
    // Повторить здесь `navigator.language` значило бы завести второе правило выбора
    // языка рядом с `detect()` — и двум правилам недолго разойтись.
    expect(createWebPlatform({ simulate: true }).language).toBeUndefined();
  });

  it('недоступное хранилище не роняет игру', async () => {
    // В node (а равно в приватном окне и при запрете сайту) `localStorage` нет вовсе.
    // Инвариант: сейв не переживёт вкладку, но игра идёт — ни одного исключения наружу.
    expect('localStorage' in globalThis).toBe(false);
    const p = createWebPlatform({ saveKey: 'void.test.save' });
    await expect(p.save.save('{"v":1}')).resolves.toBeUndefined();
    expect(await p.save.load()).toBeNull();
  });

  it('когда хранилище есть — сейв ходит туда и обратно', async () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    try {
      const p = createWebPlatform({ saveKey: 'void.test.save' });
      await p.save.save('{"v":1}');
      expect(await p.save.load()).toBe('{"v":1}');
    } finally {
      delete g.localStorage;
    }
  });
});
