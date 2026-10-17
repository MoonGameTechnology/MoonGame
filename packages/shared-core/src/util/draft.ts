/**
 * Чтение черновика приказа без копии.
 *
 * Черновик приказа (`lazyDraft` в `kernel/kernel.ts`) копирует сущность записи при первом
 * чтении: он не знает, будут ли в неё писать. Проверка, которая лишь перебирает флоты
 * («обстреливает ли кто-то этот мир?»), поэтому копировала каждый флот карты, и так на
 * каждый заказ бота: на FFA-50 к 12-му дню это ~10 мс кадра на ×10.
 *
 * Здесь те же сущности ТОЛЬКО ДЛЯ ЧТЕНИЯ: нетронутая берётся прямо из состояния
 * вызывающего. Писать в полученное нельзя, это вход ядра (инвариант №2), поэтому читатель
 * отдаёт наружу ответ (да или нет, набор id), а не саму сущность. Вне черновика (ход мира,
 * клиент, сервер) это обычное чтение записи.
 */

import { recordValues } from './records';

/** Место сущности, которую шаг ещё не читал. */
export const HOLE: unknown = Object.freeze({});

/** Ленивая запись черновика → её места и запись вызывающего, из которой она копирует. */
export const DRAFT_RECORDS = new WeakMap<
  object,
  { slots: Record<string, unknown>; base: Record<string, unknown> }
>();

/** Сущность `id` записи — только для чтения (см. начало файла). */
export function peek<T>(record: Readonly<Record<string, T>>, id: string): T | undefined {
  const draft = DRAFT_RECORDS.get(record);
  if (!draft) return record[id];
  const value = draft.slots[id];
  return (value === HOLE ? draft.base[id] : value) as T | undefined;
}

/** Сущности записи в порядке её ключей, как `Object.values`, — только для чтения. */
export function peekValues<T>(record: Readonly<Record<string, T>>): T[] {
  const draft = DRAFT_RECORDS.get(record);
  if (!draft) return recordValues(record);
  return Object.keys(draft.slots).map((id) => {
    const value = draft.slots[id];
    return (value === HOLE ? draft.base[id] : value) as T;
  });
}
