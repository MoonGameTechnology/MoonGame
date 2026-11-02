/** The build-permission snapshot of a seat (see `Player.arsenal`): unique, sorted
 *  catalog ids per kind — the shape both the core gate and the UI filter read. */
export interface PlayerArsenal {
  /** Buildable hulls → `data.units` ids. */
  hulls: string[];
  /** Installable ship modules → `data.modules` ids. */
  modules: string[];
  /** Звёздность модулей этого места (SZE-1.1), `id → ★` — снимок меты Sector Zero,
   *  из которого верфь штампует {@link UnitStack.moduleStars} на всё, что построит за
   *  забег. Без него стартовый флот летал бы на ★N, а построенное на верфи — на ★0:
   *  один модуль с двумя разными числами в одном матче. Отсутствует = ★0 у всех
   *  (обычные матчи — мягкая деградация, как и у самого арсенала). */
  stars?: Record<string, number>;
  /** Поднятая редкость модулей этого места (SZE-5.1), `id → ступень` — снимок, из
   *  которого верфь штампует {@link UnitStack.moduleRarity}. Та же причина, что у
   *  {@link PlayerArsenal.stars}: иначе стартовый флот и построенное за забег несли бы
   *  один модуль с разными числами. Отсутствует = базовая редкость у всех. */
  rarity?: Record<string, string>;
  /** Лишние слоты корпусов этого места, `корпус → { weapon, defense, utility }` —
   *  снимок звёзд кораблей Sector Zero (решение владельца 2026-09-26). Верфь проверяет
   *  набор модулей против слотов корпуса С ЭТОЙ прибавкой. Отсутствует = слоты каталога. */
  slots?: Record<string, { weapon?: number; defense?: number; utility?: number }>;
}
