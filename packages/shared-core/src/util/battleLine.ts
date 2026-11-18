/**
 * ОДНА ЛИНИЯ НА ДЕРЖАВУ (MSB-11, резолюция владельца 2026-11-18).
 *
 * Предел линии `min(1, L/N)` (GDD §7.2) считался по одной стороне боя, а сторона — это
 * флот. Поэтому 50 кораблей одним флотом стреляли как 10, а пятью флотами по 10 — как 50.
 * Теперь N — все живые юниты ДЕРЖАВЫ в этом бою: сколько бы флотов игрок ни привёл, у него
 * одна линия. Пока юнитов не больше L, штрафа нет вовсе; сверх — слабеют все его флоты
 * одинаково.
 *
 * 1. **Держава — это владелец.** Союзник делит бой, но не линию: у каждой державы своя.
 * 2. **У стороны без хозяина (пираты, Рой) линия своя у каждой стороны**, как прежде: это не
 *    игроки, дробиться ради выгоды им незачем, а общий «ничей» владелец слил бы чужие банды.
 * 3. **Внутри флота правило прежнее** — та же формула, только N шире.
 *
 * Читателей трое: живой залп и ответ (`battleExchanges.ts`), цифры окна боя
 * (`state/battleReadout.ts`) и прогноз (`state/previewBattle.ts`, своими входами).
 */
import type { GameData } from '../data/schemas';
import type { Battle, BattleSide, GameState } from '../state/gameState';
import { sideAlive, sideUnits } from './combat';
import { liveUnitCount } from './stacks';

/** N линии стороны `side` в бою `battle` — все живые юниты её державы; `undefined` — у
 *  стороны без хозяина линия своя (правило 2). */
export function battleLineCount(
  state: GameState,
  data: GameData,
  battle: Battle,
  side: BattleSide,
): number | undefined {
  if (side.owner === null) return undefined;
  let count = 0;
  for (const other of battle.sides) {
    if (other.owner !== side.owner || !sideAlive(state, other.ref)) continue;
    count += liveUnitCount(sideUnits(state, other.ref) ?? [], data);
  }
  return count;
}
