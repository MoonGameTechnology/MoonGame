/**
 * `WebPlatformAdapter` (`YAG-1.1a`) — площадка по умолчанию: обычный браузер, локальная
 * разработка и тесты. Внешнего SDK не требует и требовать не должен.
 *
 * ## Зачем он, если «ничего не умеет»
 *
 * Две причины, и обе практические.
 *
 * **Первая — игра обязана работать без площадки.** Прототип открывают с диска, из
 * `file://`, из тестов. Если бы код звал SDK напрямую, каждый такой запуск падал бы или
 * требовал заглушку на месте вызова. Здесь заглушка ОДНА и живёт за контрактом.
 *
 * **Вторая — только на нём и можно детерминированно проверить три исхода** рекламы и
 * покупки (получилось / отказался / недоступно). На настоящей площадке «игрок отказался»
 * не воспроизвести в CI.
 *
 * ## ⚠️ `simulate` — это про РАЗРАБОТКУ, а не про «пока не сделали»
 *
 * В сборке игрока возможностей НЕТ: обычный браузер не показывает rewarded-рекламу и не
 * проводит платежи. `capabilities.rewardedAds` и `.iap` там `false`, и магазин по ним
 * просто не рисует такие кнопки.
 *
 * Включённая симуляция (`simulate: true`, дев-сборки) поднимает те же флаги в `true` и
 * отдаёт управляемые исходы — чтобы путь «посмотрел рекламу → товар выдан» проходился
 * целиком, а не только в юнит-тесте. Пускать симуляцию в сборку игрока нельзя: это ровно
 * «обещать механику, которой у игрока не будет».
 */
import type {
  GamePlatform,
  PlatformCapabilities,
  PlatformEvent,
  PlatformOutcome,
  PlatformPurchase,
} from './types';

export interface WebPlatformOptions {
  /** Поднять управляемые реклама/покупки для разработки и тестов. В сборке игрока — `false`. */
  simulate?: boolean;
  /** Очередь исходов для симуляции: берётся по одному на вызов, кончилась → `'ok'`.
   *  Так тест задаёт сценарий, не подменяя сам адаптер. */
  outcomes?: PlatformOutcome[];
  /** Куда складывать аналитику. По умолчанию — в массив {@link WebPlatform.events}. */
  sink?: (event: PlatformEvent, props?: Record<string, string | number | boolean>) => void;
  /** Ключ localStorage для сейва. */
  saveKey?: string;
}

export interface WebPlatform extends GamePlatform {
  /** Всё, что игра отправила в аналитику — для тестов и дев-обзора. */
  events: { event: PlatformEvent; props?: Record<string, string | number | boolean> }[];
}

const GUEST_ID = 'web:guest';

/** Хранилище может быть недоступно (приватное окно, запрет сайту) — это НЕ повод падать:
 *  сейв просто не переживёт вкладку, а игра идёт. */
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* хранилище недоступно — молча продолжаем, см. комментарий выше */
  }
}

export function createWebPlatform(options: WebPlatformOptions = {}): WebPlatform {
  const simulate = options.simulate === true;
  const queue = [...(options.outcomes ?? [])];
  const nextOutcome = (): PlatformOutcome =>
    simulate ? (queue.shift() ?? 'ok') : 'unavailable';
  const saveKey = options.saveKey ?? 'void.platform.save.v1';
  const events: WebPlatform['events'] = [];

  const capabilities: PlatformCapabilities = {
    auth: false, // гостя даём, но это не авторизация площадки
    cloudSave: false, // localStorage переживает вкладку, а не устройство
    rewardedAds: simulate,
    interstitialAds: simulate,
    iap: simulate,
    analytics: true, // собрать события мы умеем всегда, вопрос только куда их слать
  };

  return {
    capabilities,
    events,
    auth: {
      player: () => Promise.resolve({ id: GUEST_ID, authenticated: false }),
    },
    save: {
      load: () => Promise.resolve(readLocal(saveKey)),
      save: (snapshot) => {
        writeLocal(saveKey, snapshot);
        return Promise.resolve();
      },
    },
    ads: {
      showRewardedAd: () => Promise.resolve({ status: nextOutcome() }),
      showInterstitial: () => Promise.resolve({ status: nextOutcome() }),
    },
    iap: {
      catalog: () => Promise.resolve(simulate ? ['sovereigns.small', 'sovereigns.large'] : []),
      purchase: (productId): Promise<PlatformPurchase> => {
        const status = nextOutcome();
        // Квитанция появляется ТОЛЬКО при успехе: пустая квитанция у отказа однажды
        // доедет до проверки и будет принята за настоящую.
        return Promise.resolve(
          status === 'ok' ? { status, productId, receipt: `web:${productId}` } : { status },
        );
      },
      restore: () => Promise.resolve([]),
    },
    analytics: {
      emit: (event, props) => {
        events.push(props === undefined ? { event } : { event, props });
        options.sink?.(event, props);
      },
    },
  };
}
