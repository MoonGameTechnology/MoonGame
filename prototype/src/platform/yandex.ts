/**
 * `YandexGamesAdapter` — жизненный цикл (`YAG-1.2`).
 *
 * Адаптер получает УЖЕ поднятый `ysdk` и переводит его в наш контракт `GamePlatform`.
 * Сам `YaGames.init()` сюда не входит намеренно (см. «Чего здесь нет»).
 *
 * ## Что проверяет модерация — и почему это диктует форму
 *
 * Требование 1.19 проверяется debug-панелью покадрово: индикатор Game Ready обязан
 * позеленеть ровно тогда, когда игрок может начать, — и в ДВУХ сценариях, когда
 * загрузочный экран площадки скрыт тапом и когда он исчез сам. Значит `ready()` нельзя
 * вешать на таймер: сценарии различаются только моментом готовности, и привязка ко времени
 * пройдёт один, провалив другой. Поэтому момент выбирает хост, а адаптер лишь гарантирует
 * «один раз» (`decisions/platformLifecycle.ts`).
 *
 * Разметка геймплея (`GameplayAPI.start/stop`) проверяется по сценариям: запуск и конец
 * уровня, открытие меню и меню покупок, показ рекламы, **потеря фокуса**. Все они
 * приходят в адаптер извне — правила парности и приоритета чужой паузы живут в том же
 * чистом модуле, а здесь только проводка к SDK.
 *
 * ## Возможности объявляются по тому, что УМЕЕТ АДАПТЕР, а не по тому, что есть у SDK
 *
 * Соблазн выставить `rewardedAds: true` только потому, что у `ysdk.adv` есть метод,
 * велик — и это ровно тот баг, от которого `platform-adapters.md` защищает
 * capability-флагами: UI нарисует кнопку, а нажатие ничего не сделает. Здесь флаг значит
 * «эта игра умеет это ЗДЕСЬ И СЕЙЧАС». Rewarded поднят `YAG-3.1`; покупки и облачный сейв
 * поднимут свои флаги в своих кирпичах, а интерстишлов не будет вовсе (резолюция владельца
 * 2026-09-22). До тех пор их вызовы честно отвечают `unavailable` — документированный
 * третий исход, а не заглушка-обман.
 *
 * ## Чего здесь нет, и это не забывчивость
 *
 * **Загрузки самого SDK.** Требование 1.19.1 обязывает инициализировать SDK «строго так,
 * как указано на странице Подключение и использование», и модерация отдельно смотрит
 * ВЕРСИЮ лоадера (на debug-панели `IT` — новый, `IF` — старый). Точный сниппет страницы у
 * нас пока не сверен, а угадывать его нельзя: это прямой отказ модерации. Сниппет живёт в
 * разметке сборки, поэтому его место — `YAG-1.1b` (цель сборки), а адаптер принимает
 * готовый объект. Заодно это делает его тестируемым без сети.
 *
 * **Выбора локали.** Адаптер отдаёт `environment.i18n.lang` сырым (`language`), а какую
 * локаль показать игроку, чьего языка у нас нет, решает `decisions/platformLocale.ts` —
 * одно правило на все площадки, а не своё в каждом адаптере (`YAG-1.3`).
 */
import {
  initialLifecycle,
  lifecyclePlatformPause,
  lifecyclePlatformResume,
  lifecycleReady,
  lifecycleStart,
  lifecycleStop,
  type LifecycleCall,
  type LifecycleState,
} from '../../../decisions/platformLifecycle';
import { initialRewarded, rewardedStep, type RewardedEvent } from '../../../decisions/rewardedAd';
import { createCloudWriter } from './cloudWriter';
import type {
  GamePlatform,
  PlatformCapabilities,
  PlatformEvent,
  PlatformPlayer,
  PlatformPurchase,
  PlatformSignIn,
  RewardedAdResult,
} from './types';

/**
 * Ровно та часть SDK площадки, которой мы пользуемся. Свой структурный тип, а не зависимость
 * на `@types/ysdk`: на границе с чужим SDK репозиторий держит СВОЁ описание — так видно,
 * что именно мы трогаем, и обновление чужих деклараций не ломает сборку молча.
 * Формы сверены по `@types/ysdk@1.2.0` (§1.1 роадмапа).
 */
export interface YandexSdk {
  features?: {
    LoadingAPI?: { ready?: () => void };
    GameplayAPI?: { start?: () => void; stop?: () => void };
  };
  on?: (event: 'game_api_pause' | 'game_api_resume', observer: () => void) => (() => void) | void;
  off?: (event: 'game_api_pause' | 'game_api_resume', observer: () => void) => void;
  /** «Назад» и выход площадки (`YAG-6.4`); возвращает отписку. */
  onEvent?: (event: 'HISTORY_BACK' | 'EXIT', listener: () => void) => () => void;
  getPlayer?: (opts?: { signed?: boolean }) => Promise<YandexPlayer>;
  /** Окно входа Яндекс ID. Отказ игрока ОТКЛОНЯЕТ промис (страница «Авторизация»). */
  auth?: { openAuthDialog?: () => Promise<unknown> };
  /** Реклама — колбэками, возврат `void`, а не промис (§1.1 роадмапа). */
  adv?: {
    showRewardedVideo?: (opts?: { callbacks?: YandexRewardedCallbacks }) => void;
    showFullscreenAdv?: (opts?: { callbacks?: Record<string, unknown> }) => void;
  };
  environment?: { i18n?: { lang?: string; tld?: string } };
  /** Удалённые флаги из консоли (`YAG-6.3`): имя → строка. */
  getFlags?: (params?: { defaultFlags?: Record<string, string> }) => Promise<Record<string, unknown>>;
  deviceInfo?: { isMobile?: () => boolean; isDesktop?: () => boolean; isTV?: () => boolean };
}

export interface YandexRewardedCallbacks {
  onOpen?: () => void;
  onRewarded?: () => void;
  onClose?: () => void;
  onError?: (error?: unknown) => void;
}

export interface YandexPlayer {
  getUniqueID?: () => string;
  getName?: () => string;
  isAuthorized?: () => boolean;
  /** Облачные данные игрока: 200 КБ, 100 запросов за 5 минут (§1.1). `flush: false` ставит
   *  запись в очередь SDK, и промис говорит о валидности данных, а не об отправке. */
  setData?: (data: Record<string, unknown>, flush?: boolean) => Promise<void>;
  getData?: (keys?: string[]) => Promise<Record<string, unknown>>;
}

export interface YandexPlatformOptions {
  /** Куда складывать продуктовые события. Своей аналитики у площадки нет (§1.1), поэтому
   *  по умолчанию они копятся в {@link YandexPlatform.events} — их заберёт `YAG-5.1`. */
  sink?: (event: PlatformEvent, props?: Record<string, string | number | boolean>) => void;
  /** Куда писать о сбоях SDK. По умолчанию молча: падать из-за чужого SDK игра не должна. */
  onSdkError?: (where: string, error: unknown) => void;
}

export interface YandexPlatform extends GamePlatform {
  /** Игрок может начать играть. Отправляет `LoadingAPI.ready()` — один раз за сессию. */
  ready(): void;
  /** Геймплей пошёл: начался уровень/волна, закрылось меню, кончилась реклама. */
  gameplayStart(): void;
  /** Геймплей встал: конец уровня, открылось меню или меню покупок, показ рекламы, уход фокуса. */
  gameplayStop(): void;
  /** Подписка на паузу ПЛОЩАДКИ: мир обязан встать, а по `resume` — вернуться как был. */
  onPlatformPause(listener: (paused: boolean) => void): () => void;
  /** Кнопка «назад» площадки (`YAG-6.4`) — на телефоне это системная кнопка. */
  onHistoryBack(listener: () => void): () => void;
  /** Площадка сообщает, что игрок выходит из игры (`YAG-6.4`): сохранить всё сейчас. */
  onExit(listener: () => void): () => void;
  /** Снять подписки на события SDK. */
  dispose(): void;
  /** Что адаптер уже отправил площадке — для тестов и debug-обзора. */
  readonly calls: LifecycleCall[];
  /** Накопленная аналитика, если не задан `sink`. */
  events: { event: PlatformEvent; props?: Record<string, string | number | boolean> }[];
}

const UNAVAILABLE: PlatformPurchase = { status: 'unavailable' };

/**
 * Сколько ждать, пока ролик откроется (AUD-34). Щедро: медленная сеть грузит ролик
 * секундами, а ролик, открывшийся ПОСЛЕ срока, награды уже не даст. Цена молчания SDK без
 * срока выше: флаг «ролик идёт» не снимался никогда, и кнопки рекламы молчали до конца сессии.
 */
export const AD_START_TIMEOUT_MS = 30_000;

/**
 * Сколько ждать флаги площадки (`YAG-6.3`). Их ждёт СТАРТ игры: каталог собирается с ними
 * один раз. Поэтому срок короткий — не ответили вовремя, игра идёт на числах поставки, а
 * поздний ответ уже ничего не меняет.
 */
export const FLAGS_TIMEOUT_MS = 2_000;

/** Ключ облачных данных игры. Одно поле: формат снимка — наш (`PlatformSave`). */
export const CLOUD_KEY = 'meta';
/** Лимит `setData` — 200 КБ на игрока (§1.1). Считаем в байтах UTF-8 ЦЕЛОГО объекта, как
 *  его отправит SDK, и берём тысячи, а не 1024: трактовку «КБ» площадка не уточняет. */
export const CLOUD_LIMIT_BYTES = 200_000;

/**
 * Возможности на СЕГОДНЯ. `auth` и `cloudSave` — свойства площадки, но флаг поднимает
 * только реализованное: облачный сейв поднят `YAG-2.2`, покупки ждут `YAG-4.2`. Интерстишлов
 * нет по резолюции владельца, даже если SDK их умеет. Отдельно про покупки: даже когда кирпич будет закрыт, флаг придётся
 * проверять живым запросом — покупки подключаются заявкой и могут быть не включены у
 * конкретной игры (требование 1.12/1.13).
 */
function capabilitiesOf(sdk: YandexSdk): PlatformCapabilities {
  return {
    auth: typeof sdk.getPlayer === 'function',
    // Облако — у вошедшего игрока (`YAG-2.2`); есть ли вход у ЭТОГО — `auth.player()`.
    cloudSave: typeof sdk.getPlayer === 'function',
    rewardedAds: typeof sdk.adv?.showRewardedVideo === 'function',
    interstitialAds: false,
    iap: false,
    analytics: false,
  };
}

export function createYandexPlatform(
  sdk: YandexSdk,
  options: YandexPlatformOptions = {},
): YandexPlatform {
  let state: LifecycleState = initialLifecycle;
  const calls: LifecycleCall[] = [];
  const events: YandexPlatform['events'] = [];
  const pauseListeners = new Set<(paused: boolean) => void>();

  /** Позвать SDK, не дав чужому исключению уронить игру (инвариант «fail-secure»). */
  const guard = (where: string, fn: (() => void) | undefined): void => {
    if (typeof fn !== 'function') return;
    try {
      fn();
    } catch (error) {
      options.onSdkError?.(where, error);
    }
  };

  const apply = (next: { state: LifecycleState; call: LifecycleCall }): void => {
    state = next.state;
    if (!next.call) return;
    calls.push(next.call);
    if (next.call === 'ready') guard('LoadingAPI.ready', sdk.features?.LoadingAPI?.ready);
    if (next.call === 'start') guard('GameplayAPI.start', sdk.features?.GameplayAPI?.start);
    if (next.call === 'stop') guard('GameplayAPI.stop', sdk.features?.GameplayAPI?.stop);
  };

  // Пауза площадки приходит событием и обязана останавливать разметку сама, без участия
  // хоста: между `game_api_pause` и нашей реакцией игрок уже не играет.
  const onPause = (): void => {
    apply(lifecyclePlatformPause(state));
    for (const listener of pauseListeners) listener(true);
  };
  const onResume = (): void => {
    apply(lifecyclePlatformResume(state));
    for (const listener of pauseListeners) listener(false);
  };
  // `on` в декларациях возвращает отписку, но не у всех сборок SDK — поэтому держим и
  // запасной путь через `off`, а не доверяем одному способу.
  /** Отписки от `onEvent` — `dispose` снимает их все. */
  const eventOffs = new Set<() => void>();
  /** Подписка на событие площадки. Нет `onEvent` или он упал — пустая отписка: без
   *  «назад» площадки игра не ломается, у неё остаётся свой (`popstate`). */
  const subscribe = (event: 'HISTORY_BACK' | 'EXIT', listener: () => void): (() => void) => {
    let off: (() => void) | undefined;
    try {
      const got = sdk.onEvent?.(event, listener);
      if (typeof got === 'function') off = got;
    } catch (error) {
      options.onSdkError?.('onEvent', error);
    }
    const drop = (): void => {
      eventOffs.delete(drop);
      off?.();
    };
    eventOffs.add(drop);
    return drop;
  };
  const offPause = sdk.on?.('game_api_pause', onPause);
  const offResume = sdk.on?.('game_api_resume', onResume);

  /** Последний полученный объект игрока. Облако берёт его отсюда, а не новым запросом:
   *  у `getPlayer` своя квота — 20 запросов за 5 минут (§1.1), а пишем мы по событиям. */
  let lastPlayer: YandexPlayer | null = null;

  /** Кто играет — СВЕЖИМ запросом: после входа прежний объект игрока остаётся гостем. */
  const readPlayer = async (): Promise<PlatformPlayer> => {
    // Гость — это НОРМА, а не ошибка (требование 1.2.2): игра обязана работать без
    // авторизации, поэтому неудача запроса даёт гостя, а не исключение.
    if (typeof sdk.getPlayer !== 'function') return { id: 'guest', authenticated: false };
    try {
      const player = await sdk.getPlayer();
      lastPlayer = player;
      const authenticated = player.isAuthorized?.() ?? false;
      const name = player.getName?.();
      return {
        id: player.getUniqueID?.() ?? 'guest',
        authenticated,
        ...(name ? { displayName: name } : {}),
      };
    } catch (error) {
      options.onSdkError?.('getPlayer', error);
      return { id: 'guest', authenticated: false };
    }
  };

  const canSignIn =
    typeof sdk.getPlayer === 'function' && typeof sdk.auth?.openAuthDialog === 'function';
  /** Окно уже открыто: второй тап ждёт его исхода, а не открывает второе окно. */
  let signingIn: Promise<PlatformSignIn> | null = null;

  const signInOnce = async (): Promise<PlatformSignIn> => {
    const before = await readPlayer();
    if (!canSignIn) return { status: 'unavailable', player: before };
    if (before.authenticated) return { status: 'ok', player: before };
    try {
      await sdk.auth?.openAuthDialog?.();
    } catch {
      // Отклонение — это отказ игрока, по нему площадка и различает исходы. Отличить его
      // от сбоя SDK по тексту ошибки нельзя, поэтому любое отклонение читается как
      // `cancelled`: кнопка входа остаётся, игрок ничего не теряет. В журнал сбоев не
      // пишем — иначе туда лёг бы каждый «не сейчас».
      return { status: 'cancelled', player: before };
    }
    // Игрок запрашивается ЗАНОВО — прежний объект остаётся гостем и после входа.
    const after = await readPlayer();
    // Окно закрылось «успехом», а игрок всё ещё гость — `ok` обещал бы то, чего нет.
    return { status: after.authenticated ? 'ok' : 'cancelled', player: after };
  };

  /**
   * Rewarded-ролик: колбэки SDK → один исход (правила — `decisions/rewardedAd.ts`).
   * Промис не отклоняется никогда: сбой площадки — это `unavailable`, а не исключение в
   * магазине. На время ролика звук глушится и геймплей встаёт (п. 4.7) — сами, а не в
   * расчёте на `game_api_pause`: требование проверяет модерация, и держать его должна
   * игра. Двойная пауза безопасна — переходы жизненного цикла идемпотентны.
   *
   * Пауза следует за роликом НА ЭКРАНЕ, а не за исходом (AUD-34): ролик, открывшийся после
   * срока {@link AD_START_TIMEOUT_MS}, исхода уже не меняет, но звук на его время глушится
   * и возвращается на закрытии — ровно как у вовремя открытого.
   */
  const showRewardedAd = (): Promise<RewardedAdResult> =>
    new Promise((resolve) => {
      const show = sdk.adv?.showRewardedVideo;
      if (typeof show !== 'function') return resolve({ status: 'unavailable' });
      let ad = initialRewarded;
      let onScreen = false;
      const on = (event: RewardedEvent): void => {
        if (event === 'open' && !onScreen) {
          onScreen = true;
          onPause();
        } else if ((event === 'close' || event === 'error') && onScreen) {
          onScreen = false;
          onResume();
        }
        const settled = ad.outcome !== null;
        ad = rewardedStep(ad, event);
        if (ad.opened || ad.outcome) clearTimeout(deadline);
        if (!settled && ad.outcome) resolve({ status: ad.outcome });
      };
      const deadline = setTimeout(() => on('timeout'), AD_START_TIMEOUT_MS);
      try {
        show.call(sdk.adv, {
          callbacks: {
            onOpen: () => on('open'),
            onRewarded: () => on('rewarded'),
            onClose: () => on('close'),
            onError: (error) => {
              options.onSdkError?.('showRewardedVideo', error);
              on('error');
            },
          },
        });
      } catch (error) {
        options.onSdkError?.('showRewardedVideo', error);
        on('error');
      }
    });

  /**
   * Облачный сейв (`YAG-2.2`) — только у ВОШЕДШЕГО игрока. Гость живёт локально
   * (`YAG-1.4`): его прогресс не пишется в облако вовсе, и то, как площадка хранит данные
   * неавторизованных, на игру не влияет. Объект игрока — последний полученный; первый раз
   * он запрашивается здесь же.
   */
  let cloudAsked = false;
  const cloudPlayer = async (): Promise<YandexPlayer | null> => {
    // Сам облачный путь спрашивает игрока один раз: упади этот запрос, повтор на каждую
    // запись выжег бы квоту `getPlayer`. Дальше объект обновляют вход и `auth.player()`.
    if (!lastPlayer && !cloudAsked) {
      cloudAsked = true;
      await readPlayer();
    }
    const player = lastPlayer;
    if (!player || !(player.isAuthorized?.() ?? false)) return null;
    if (typeof player.setData !== 'function' || typeof player.getData !== 'function') return null;
    return player;
  };
  const cloud = createCloudWriter({
    send: async (snapshot, flush) => {
      const player = await cloudPlayer();
      if (player) await player.setData!({ [CLOUD_KEY]: snapshot }, flush);
    },
    onError: (error) => options.onSdkError?.('setData', error),
  });
  const cloudBytes = (snapshot: string): number =>
    new TextEncoder().encode(JSON.stringify({ [CLOUD_KEY]: snapshot })).length;

  const lang = sdk.environment?.i18n?.lang;

  /** Флаги площадки строками. Любой сбой — пустой набор, а не ошибка запуска. */
  const readFlags = async (): Promise<Record<string, string>> => {
    if (typeof sdk.getFlags !== 'function') return {};
    let stop: ReturnType<typeof setTimeout> | undefined;
    try {
      const late = new Promise<'late'>((resolve) => {
        stop = setTimeout(() => resolve('late'), FLAGS_TIMEOUT_MS);
      });
      const got = await Promise.race([sdk.getFlags({ defaultFlags: {} }), late]);
      if (got === 'late') {
        options.onSdkError?.('getFlags', new Error('E_FLAGS_TIMEOUT'));
        return {};
      }
      const flags: Record<string, string> = {};
      if (got && typeof got === 'object') {
        for (const [name, value] of Object.entries(got)) {
          if (typeof value === 'string') flags[name] = value;
        }
      }
      return flags;
    } catch (error) {
      options.onSdkError?.('getFlags', error);
      return {};
    } finally {
      clearTimeout(stop);
    }
  };

  return {
    capabilities: capabilitiesOf(sdk),
    ...(typeof lang === 'string' ? { language: lang } : {}),
    calls,
    events,
    ready: () => apply(lifecycleReady(state)),
    gameplayStart: () => apply(lifecycleStart(state)),
    gameplayStop: () => apply(lifecycleStop(state)),
    onPlatformPause(listener) {
      pauseListeners.add(listener);
      return () => pauseListeners.delete(listener);
    },
    onHistoryBack: (listener) => subscribe('HISTORY_BACK', listener),
    onExit: (listener) => subscribe('EXIT', listener),
    dispose() {
      pauseListeners.clear();
      for (const off of [...eventOffs]) off();
      if (typeof offPause === 'function') offPause();
      else sdk.off?.('game_api_pause', onPause);
      if (typeof offResume === 'function') offResume();
      else sdk.off?.('game_api_resume', onResume);
    },
    auth: {
      player: readPlayer,
      canSignIn,
      signIn() {
        signingIn ??= signInOnce().finally(() => {
          signingIn = null;
        });
        return signingIn;
      },
    },
    save: {
      async load() {
        const player = await cloudPlayer();
        if (!player) return null;
        try {
          const value = (await player.getData!([CLOUD_KEY]))?.[CLOUD_KEY];
          return typeof value === 'string' ? value : null;
        } catch (error) {
          options.onSdkError?.('getData', error);
          return null;
        }
      },
      fits: (snapshot) => cloudBytes(snapshot) <= CLOUD_LIMIT_BYTES,
      save(snapshot, saveOptions) {
        // Сверх лимита площадка запись отвергнет — не тратим на неё квоту. Локальная копия
        // остаётся источником, а сбой уходит в журнал разработчика.
        if (cloudBytes(snapshot) > CLOUD_LIMIT_BYTES) {
          options.onSdkError?.('setData', new Error('E_CLOUD_SAVE_TOO_BIG'));
          return Promise.resolve();
        }
        return cloud.save(snapshot, saveOptions?.flush ?? false);
      },
    },
    // Ниже — то, чего адаптер не умеет. Честное `unavailable` вместо заглушки, которая
    // делает вид, что получилось: capability-флаги выше стоят `false`, поэтому UI этих
    // путей и не предлагает.
    ads: {
      showRewardedAd,
      showInterstitial: async () => ({ status: 'unavailable' }),
    },
    iap: {
      catalog: async () => [],
      purchase: async () => UNAVAILABLE,
      restore: async () => [],
    },
    analytics: {
      emit(event, props) {
        if (options.sink) options.sink(event, props);
        else events.push(props ? { event, props } : { event });
      },
    },
    config: { flags: readFlags },
  };
}
