/**
 * Список языков для переключателя (заказ владельца 2026-09-25): «кнопка смены языка в
 * главном меню, чтобы открывался списочек для выбора». Раньше язык был только на экране
 * входа, и кнопка переключала RU ⇄ EN по кругу: с третьим языком круг перестал бы
 * работать, а игрок не видел, что вообще можно выбрать.
 *
 * 1. **Порядок — порядок `LOCALE_IDS`**, а не «текущий первым»: пункт не прыгает по списку
 *    от того, какой язык выбран сейчас.
 * 2. **Текущий язык отмечен**, но остаётся в списке: игрок видит, где он.
 * 3. **Выбор текущего языка ничего не делает.** Смена языка перезагружает страницу, и
 *    перезагрузка ради того же языка — потерянные секунды без причины.
 */
import { LOCALE_IDS, LOCALE_LABEL, type LocaleId } from '../localization/index';

export interface LocaleOption {
  id: LocaleId;
  /** Подпись на самом языке (`LOCALE_LABEL`). */
  label: string;
  current: boolean;
}

/** Пункты списка (правила 1–2). */
export function localeOptions(current: LocaleId): LocaleOption[] {
  return LOCALE_IDS.map((id) => ({ id, label: LOCALE_LABEL[id], current: id === current }));
}

/** Нужна ли смена языка (правило 3). */
export function localeChanges(current: LocaleId, picked: LocaleId): boolean {
  return picked !== current;
}
