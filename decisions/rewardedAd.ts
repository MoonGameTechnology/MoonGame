/**
 * Исход rewarded-ролика по колбэкам площадки (`YAG-3.1`).
 *
 * SDK площадки показывает ролик колбэками, а не промисом (`onOpen`, `onRewarded`,
 * `onClose`, `onError`), а наш контракт `PlatformAds` отвечает одним исходом из трёх. Этот
 * перевод — единственное место, где можно раздать товар за ничего, поэтому он вынесен
 * сюда, без SDK и без таймеров.
 *
 * 1. **Закрытие ролика наградой НЕ является.** `onClose` приходит и тогда, когда игрок
 *    нажал крестик на третьей секунде. Награда — только `onRewarded`; `close` без неё —
 *    `cancelled`, игрок передумал.
 * 2. **Исход — по закрытию, а не по награде.** Выдачу делает игра, и делает её ПОСЛЕ
 *    ролика: иначе анимация выдачи или следующее окно всплыли бы под рекламой.
 * 3. **Сбой до награды — `unavailable`, после — `ok`.** Не загрузился ролик — рекламы нет,
 *    игрок не отказывался. Заработанное же не отнимается сбоем, случившимся после.
 * 4. **Исход один.** Колбэки после него не меняют ничего: второй исход означал бы вторую
 *    выдачу или отзыв уже выданного.
 * 5. **Ролик, который так и не начался, — `unavailable`** (AUD-28). Срок до открытия
 *    отсчитывает хост; вышел он раньше `onOpen` — рекламы нет. Без срока SDK, не приславший
 *    ни одного колбэка, держал флаг «ролик идёт» вечно, и кнопки рекламы молчали до конца
 *    сессии. Открытый ролик срок не обрывает: игрок его смотрит, исход даст закрытие.
 */

/** Колбэки площадки в наших терминах плюс срок до открытия, который ставит хост. */
export type RewardedEvent = 'open' | 'rewarded' | 'close' | 'error' | 'timeout';

/** Исход в терминах контракта площадки. Свой тип: `decisions/` прототип не импортирует. */
export type RewardedOutcome = 'ok' | 'cancelled' | 'unavailable';

export interface RewardedAdState {
  /** Ролик открылся — значит звук заглушён и паузу потом надо снять. */
  opened: boolean;
  /** Площадка подтвердила награду (`onRewarded`). */
  rewarded: boolean;
  /** Исход; `null` — ролик ещё идёт. */
  outcome: RewardedOutcome | null;
}

export const initialRewarded: RewardedAdState = { opened: false, rewarded: false, outcome: null };

export function rewardedStep(s: RewardedAdState, event: RewardedEvent): RewardedAdState {
  if (s.outcome) return s;
  switch (event) {
    case 'open':
      return { ...s, opened: true };
    case 'rewarded':
      return { ...s, rewarded: true };
    case 'close':
      return { ...s, outcome: s.rewarded ? 'ok' : 'cancelled' };
    case 'error':
      return { ...s, outcome: s.rewarded ? 'ok' : 'unavailable' };
    case 'timeout':
      return s.opened ? s : { ...s, outcome: s.rewarded ? 'ok' : 'unavailable' };
  }
}
