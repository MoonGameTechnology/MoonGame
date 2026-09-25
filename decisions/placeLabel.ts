/**
 * Как назвать игроку место на карте (SZ-map-ids).
 *
 * Id сектора — идентификатор данных, а не текст. На картах Фронтира это координата сетки
 * («C2R1»), и как обозначение она честна. На картах из `data/maps/` id — английские слова
 * (`home_a`, `pirate_den`, `drift`): карта забега Sector Zero писала их на холсте и в
 * журнале одинаково на обоих языках — п. 8.2.3 требований Яндекс Игр.
 *
 * 1. **Ключ ВЫВОДИТСЯ из id**, как у `refusalText`: `home_a` → `place.home-a`. Новое место
 *    требует одной правки — имени в локали; сторож в тесте рядом требует его у каждого
 *    сектора каждой шипнутой карты.
 * 2. **Без имени место показывается своим id.** Координате имя не нужно, а подпись
 *    `place.c2r1` выглядела бы поломкой.
 *
 * Импорт из `core`, а не `runtime` — по той же причине, что в `refusalText.ts`: клиент и
 * архив площадки грузят ровно один язык.
 */
import { hasKey, t } from '../localization/core';

/** Ключ имени места (правило 1). */
export function placeKey(id: string): string {
  return `place.${id.replace(/_/g, '-')}`;
}

/** Имя места на языке игрока или `null`, если у места имени нет (правило 2). */
export function placeName(id: string): string | null {
  const key = placeKey(id);
  return hasKey(key) ? t(key) : null;
}

/** Подпись места для карты и текста: имя, а без него — сам id. */
export function placeLabel(id: string): string {
  return placeName(id) ?? id;
}
