import type { GameState } from '../packages/shared-core/src/index';

/**
 * «Флот потерян» (PVR-6.29, решение владельца 2026-09-25). Без флота игрок минутами
 * смотрел, как Рой раз за разом высаживается на его планету: карточка предлагает
 * отстроиться или завершить экспедицию.
 */

/** Сколько кораблей у игрока во всех его флотах (флагман героя — тоже корабль). */
export function shipCount(state: GameState, me: string): number {
  let n = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.owner !== me) continue;
    for (const st of f.units) n += Math.max(0, st.count);
  }
  return n;
}

/** Встаёт ли карточка сейчас: на переходе от кораблей к нулю, а не на каждом кадре без них.
 *  `prev` — счёт прошлого кадра; `null` — прошлого кадра в этом забеге не было. */
export function fleetLostPrompt(prev: number | null, now: number): boolean {
  return prev !== null && prev > 0 && now === 0;
}
