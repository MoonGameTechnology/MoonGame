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
 * capability-флагами: UI нарисует кнопку, а нажатие ничего не сделает, пока не закрыт
 * `YAG-3.1`. Здесь флаг значит «эта игра умеет это ЗДЕСЬ И СЕЙЧАС». Реклама, покупки и
 * облачный сейв поднимут свои флаги в своих кирпичах; до тех пор их вызовы честно отвечают
 * `unavailable` — документированный третий исход, а не заглушка-обман.
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
import type {
  GamePlatform,
  PlatformCapabilities,
  PlatformEvent,
  PlatformPlayer,
  PlatformPurchase,
  PlatformSignIn,
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
  getPlayer?: (opts?: { signed?: boolean }) => Promise<YandexPlayer>;
  /** Окно входа Яндекс ID. Отказ игрока ОТКЛОНЯЕТ промис (страница «Авторизация»). */
  auth?: { openAuthDialog?: () => Promise<unknown> };
  environment?: { i18n?: { lang?: string; tld?: string } };
  deviceInfo?: { isMobile?: () => boolean; isDesktop?: () => boolean; isTV?: () => boolean };
}

export interface YandexPlayer {
  getUniqueID?: () => string;
  getName?: () => string;
  isAuthorized?: () => boolean;
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
  /** Снять подписки на события SDK. */
  dispose(): void;
  /** Что адаптер уже отправил площадке — для тестов и debug-обзора. */
  readonly calls: LifecycleCall[];
  /** Накопленная аналитика, если не задан `sink`. */
  events: { event: PlatformEvent; props?: Record<string, string | number | boolean> }[];
}

const UNAVAILABLE: PlatformPurchase = { status: 'unavailable' };

/**
 * Возможности на СЕГОДНЯ. `auth` и `cloudSave` — свойства площадки, но флаг поднимает
 * только реализованное: облачный сейв ждёт `YAG-2.2`, реклама — `YAG-3.1`, покупки —
 * `YAG-4.2`. Отдельно про покупки: даже когда кирпич будет закрыт, флаг придётся
 * проверять живым запросом — покупки подключаются заявкой и могут быть не включены у
 * конкретной игры (требование 1.12/1.13).
 */
function capabilitiesOf(sdk: YandexSdk): PlatformCapabilities {
  return {
    auth: typeof sdk.getPlayer === 'function',
    cloudSave: false,
    rewardedAds: false,
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
  const offPause = sdk.on?.('game_api_pause', onPause);
  const offResume = sdk.on?.('game_api_resume', onResume);

  /** Кто играет — СВЕЖИМ запросом: после входа прежний объект игрока остаётся гостем. */
  const readPlayer = async (): Promise<PlatformPlayer> => {
    // Гость — это НОРМА, а не ошибка (требование 1.2.2): игра обязана работать без
    // авторизации, поэтому неудача запроса даёт гостя, а не исключение.
    if (typeof sdk.getPlayer !== 'function') return { id: 'guest', authenticated: false };
    try {
      const player = await sdk.getPlayer();
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

  const lang = sdk.environment?.i18n?.lang;

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
    dispose() {
      pauseListeners.clear();
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
    // Ниже — то, чьи кирпичи ещё не закрыты. Честное `unavailable` вместо заглушки,
    // которая делает вид, что получилось: capability-флаги выше стоят `false`, поэтому
    // UI этих путей и не предлагает.
    save: {
      load: async () => null,
      save: async () => undefined,
    },
    ads: {
      showRewardedAd: async () => ({ status: 'unavailable' }),
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
  };
}
