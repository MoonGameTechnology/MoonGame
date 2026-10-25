/**
 * В какой единице игрок читает скорость ресурса: «в час» или «в сутки» (заказ владельца
 * 2026-10-25, переключатель в настройках). Чистое решение обоих клиентов.
 *
 * Ядро считает в двух единицах: выработка зданий лежит в данных за игровой ЧАС, содержание
 * юнитов и зданий — за игровые СУТКИ (`economy.ts` ядра). Экран печатал число в той единице,
 * в какой оно лежит в данных, поэтому рядом жили «+12/ч» и «−16/д», а стройка и досье
 * подписывали суточное содержание здания часовым суффиксом — в 24 раза больше правды.
 *
 * 1. **Место показа называет, в какой единице пришло число, а единицу показа выбирает
 *    игрок.** Пересчёт один — {@link rateIn}; суффикс и слово берутся из той же единицы,
 *    поэтому число и подпись разойтись не могут.
 * 2. **Часы забега сильнее настройки.** В забеге Sector Zero скорость читается за реальную
 *    минуту (`runClock.ts`, решение владельца 2026-09-24): игровые сутки забега длятся
 *    минуты, и «в сутки» там ничего не говорит.
 * 3. **Чужое значение в хранилище — «в час»**, как было до настройки: испорченный ключ не
 *    должен молча умножить все числа на экране на 24.
 */
import { runPerMinute } from './runClock';

/** Единица, которую выбирает игрок. */
export type RateUnit = 'hour' | 'day';

/** Порядок кнопок в настройках. */
export const RATE_UNITS: readonly RateUnit[] = ['hour', 'day'];

/** До настройки всё читалось в час — так и остаётся по умолчанию. */
export const DEFAULT_RATE_UNIT: RateUnit = 'hour';

/** Единица на экране: выбор игрока или минута забега (правило 2). */
export type ShownRate = RateUnit | 'minute';

const HOURS_PER_DAY = 24;

/** Значение из хранилища → единица (правило 3). */
export function parseRateUnit(raw: string | null | undefined): RateUnit {
  return raw === 'day' ? 'day' : DEFAULT_RATE_UNIT;
}

/** Что показывать сейчас: в забеге — минуту, иначе выбор игрока (правило 2). */
export function shownRate(unit: RateUnit, runClock: boolean): ShownRate {
  return runClock ? 'minute' : unit;
}

/** Скорость `value` в единице `from` → в единице показа `to` (правило 1). */
export function rateIn(value: number, from: RateUnit, to: ShownRate): number {
  if (from === to) return value;
  const perHour = from === 'day' ? value / HOURS_PER_DAY : value;
  if (to === 'day') return perHour * HOURS_PER_DAY;
  return to === 'minute' ? runPerMinute(perHour) : perHour;
}

/** Суффикс при числе: «/ч», «/д», «/мин». */
export const RATE_SUFFIX_KEY: Readonly<Record<ShownRate, string>> = {
  hour: 'res.per.hour',
  day: 'res.per.day',
  minute: 'res.per.minute',
};

/** Слово для прозы досье и кнопок настройки: «в час», «в сутки», «в минуту». */
export const RATE_WORD_KEY: Readonly<Record<ShownRate, string>> = {
  hour: 'res.rate.hour',
  day: 'res.rate.day',
  minute: 'res.rate.minute',
};
