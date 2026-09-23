/**
 * Контракт площадки (`YAG-1.1a`) — граница, за которую игровой код не заглядывает.
 *
 * Правило одной строкой: игра зовёт `platform.ads.showRewardedAd(...)`, а НЕ `YaGames`.
 * Какой SDK и каким способом выполнит запрос — дело адаптера (`platform-adapters.md`).
 *
 * ## Почему решения принимаются по capability, а не по имени площадки
 *
 * «Не все платформы имеют одинаковые возможности. Нельзя разбрасывать по UI проверки вида
 * `if (platform === 'yandex')`» — прямая цитата контракта. Проверка по имени ломается на
 * второй площадке и врёт на первой же, где возможность выключена настройкой. Поэтому UI
 * спрашивает {@link PlatformCapabilities}, и только её.
 *
 * ## Три исхода, а не два
 *
 * У рекламы и покупки исходов ТРИ: получилось, игрок отказался, площадка не умеет. Свести
 * их к `boolean` — значит потерять разницу между «не захотел» и «здесь этого нет», а она
 * продуктовая: в первом случае кнопка остаётся, во втором её не должно быть вовсе.
 * Отсутствие рекламы — нормальное состояние, а не поломка игрового цикла.
 */

/** Что умеет площадка. UI принимает решения по этим флагам, а не по её названию. */
export interface PlatformCapabilities {
  auth: boolean;
  cloudSave: boolean;
  rewardedAds: boolean;
  interstitialAds: boolean;
  iap: boolean;
  analytics: boolean;
}

/** Исход операции площадки. `unavailable` — площадка не умеет или SDK не поднялся;
 *  `cancelled` — игрок отказался сам. Различать обязательно (см. шапку). */
export type PlatformOutcome = 'ok' | 'cancelled' | 'unavailable';

export interface RewardedAdResult {
  status: PlatformOutcome;
}
export interface InterstitialResult {
  status: PlatformOutcome;
}

/** Игрок площадки в НАШИХ терминах — platform-specific объект наружу не протаскивается. */
export interface PlatformPlayer {
  id: string;
  displayName?: string;
  authenticated: boolean;
}

export interface PlatformPurchase {
  status: PlatformOutcome;
  /** Наш внутренний product id, а не id площадки: маппинг — дело адаптера. */
  productId?: string;
  /** Нормализованная квитанция, если площадка её даёт. Проверяет её сервер, не клиент. */
  receipt?: string;
}

/** Исход входа: что вышло и кто играет ПОСЛЕ попытки (вошёл — уже новый игрок). */
export interface PlatformSignIn {
  status: PlatformOutcome;
  player: PlatformPlayer;
}

export interface PlatformAuth {
  player(): Promise<PlatformPlayer>;
  /** Можно ли предложить вход ЗДЕСЬ. `false` — кнопки быть не должно (capability-правило). */
  canSignIn: boolean;
  /** Открыть окно входа площадки — только по нажатию игрока (требование 1.2.1). Отказ
   *  игрока — `cancelled`, а не ошибка; «здесь входа нет» — `unavailable`. */
  signIn(): Promise<PlatformSignIn>;
}

/** Загрузка/сохранение метапрогресса. Формат наш; квоты и ретраи — забота адаптера. */
export interface PlatformSave {
  load(): Promise<string | null>;
  save(snapshot: string): Promise<void>;
}

export interface PlatformAds {
  /** Награду выдаёт ИГРА и только после `status: 'ok'` — SDK мету не трогает. */
  showRewardedAd(request: { placement: string }): Promise<RewardedAdResult>;
  showInterstitial(request: { placement: string }): Promise<InterstitialResult>;
}

export interface PlatformIAP {
  catalog(): Promise<string[]>;
  purchase(productId: string): Promise<PlatformPurchase>;
  restore(): Promise<PlatformPurchase[]>;
}

/** Словарь продуктовых событий — НАШ, общий для всех площадок: иначе воронки с разных
 *  площадок не сравнить. Куда и в каком формате их отправить, решает адаптер. */
export const PLATFORM_EVENTS = [
  'session_started',
  'onboarding_step',
  'pve_started',
  'pve_completed',
  'pve_failed',
  'rewarded_ad_offered',
  'rewarded_ad_completed',
  'iap_started',
  'iap_completed',
  'meta_unlock',
] as const;
export type PlatformEvent = (typeof PLATFORM_EVENTS)[number];

export interface PlatformAnalytics {
  emit(event: PlatformEvent, props?: Record<string, string | number | boolean>): void;
}

/** Площадка целиком. */
export interface GamePlatform {
  capabilities: PlatformCapabilities;
  /** Язык игрока, как его сообщила площадка: код ISO 639-1, возможно с регионом. Сырой —
   *  выбор локали по нему общий для всех площадок (`decisions/platformLocale.ts`). Нет
   *  поля — площадка язык не сообщает, и остаётся язык браузера (`YAG-1.3`). */
  language?: string;
  auth: PlatformAuth;
  save: PlatformSave;
  ads: PlatformAds;
  iap: PlatformIAP;
  analytics: PlatformAnalytics;
}
