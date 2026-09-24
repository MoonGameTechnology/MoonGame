/**
 * Сложность ЗАБЕГА — чистое решение клиента (PVR-2.1).
 *
 * У обычной соло-партии сложность выбирается строкой места: кнопка гоняет его по кругу
 * «выкл → слабый → сильный» (`setupSeats.nextSeatRole`). У забега такой строки нет и быть
 * не может — место в нём РОВНО ОДНО, Рой, и выключить его нельзя: выключенный Рой это не
 * лёгкий забег, это отсутствующий забег. Поэтому у него свой круг из двух значений.
 *
 * Здесь только ВЫБОР: что показать на кнопке, что будет следующим и что делать со
 * строкой, приехавшей из чужого хранилища. Ни DOM, ни localStorage, ни сети — их
 * подключает тот клиент, который эту кнопку рисует.
 */

/** Сила Роя в забеге. Совпадает по форме с `AiProfile` прототипа намеренно: значение
 *  уезжает четвёртым аргументом `aiOrders` как есть, без перевода на полпути. */
export type RunDifficulty = 'weak' | 'strong';

/** Значение по умолчанию: первый забег игрок встречает обычным Роем. */
export const DEFAULT_RUN_DIFFICULTY: RunDifficulty = 'weak';

/** Все значения в порядке круга — им же пользуется {@link nextRunDifficulty}. */
export const RUN_DIFFICULTIES: readonly RunDifficulty[] = ['weak', 'strong'];

/** Следующее значение по кругу: один тап переключает, второй возвращает. */
export function nextRunDifficulty(current: RunDifficulty): RunDifficulty {
  return current === 'weak' ? 'strong' : 'weak';
}

/** Ключ локализации подписи кнопки. Текста здесь нет — он в `/localization`. */
export function runDifficultyKey(value: RunDifficulty): string {
  return `setup.pve.difficulty.${value}`;
}

/**
 * Ключ пояснения под кнопками: чем уровень отличается для игрока (заказ владельца
 * 2026-09-23: «написать, в чём разница между сложностью Роя»).
 *
 * Пояснение описывает то, что уровень ДЕЛАЕТ сегодня: он переключает мозг бота Роя
 * (`AiProfile` в `prototype/src/ai.ts`) — волны по расписанию и награда у обоих одни.
 * Глубина памяти Роя из §0.4 роадмапа к уровню ещё не подключена (AUD-20); подключат —
 * меняется текст, а не этот выбор.
 */
export function runDifficultyAboutKey(value: RunDifficulty): string {
  return value === 'strong' ? 'sector-zero.difficulty.about.strong' : 'sector-zero.difficulty.about.weak';
}

/**
 * Разбор сохранённого выбора. Хранилище браузера — ВНЕШНИЙ вход: там может лежать что
 * угодно (чужая версия, ручная правка, повреждение), поэтому всё непонятное сводится к
 * дефолту, а не роняет запуск и не уезжает в `aiOrders` строкой-самозванцем.
 */
export function parseRunDifficulty(raw: string | null | undefined): RunDifficulty {
  return RUN_DIFFICULTIES.includes(raw as RunDifficulty)
    ? (raw as RunDifficulty)
    : DEFAULT_RUN_DIFFICULTY;
}
