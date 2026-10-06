import type { GameData, GameState } from '../packages/shared-core/src/index';
import { isOrdnanceFleet } from '../packages/shared-core/src/index';

/**
 * «Флот потерян» (PVR-6.29, решение владельца 2026-09-25). Без флота игрок минутами
 * смотрел, как Рой раз за разом высаживается на его планету: карточка предлагает
 * отстроиться или завершить экспедицию.
 */

/** Сколько кораблей у игрока во всех его флотах (флагман героя — тоже корабль). Мина и
 *  летящая ракета — отряды, но не корабли (SM-3.6, SM-3.7b): флот, от которого остались одни
 *  боеприпасы, потерян, и карточка встаёт сразу, а не когда ракета долетит (замечание Codex
 *  на #1503). */
export function shipCount(state: GameState, me: string, data: GameData): number {
  let n = 0;
  for (const f of Object.values(state.fleets)) {
    if (f.owner !== me || isOrdnanceFleet(f, data)) continue;
    for (const st of f.units) n += Math.max(0, st.count);
  }
  return n;
}

/** Встаёт ли карточка сейчас: на переходе от кораблей к нулю, а не на каждом кадре без них.
 *  `prev` — счёт прошлого кадра; `null` — прошлого кадра в этом забеге не было. */
export function fleetLostPrompt(prev: number | null, now: number): boolean {
  return prev !== null && prev > 0 && now === 0;
}

/**
 * Что карточка «Завершить» обещает при сдаче (решение владельца 2026-09-26: выход показывает,
 * сколько награды заберёшь сейчас). Сдача до первой волны не платит ничего (баг-репорт
 * владельца 2026-09-28), и прежняя карточка тогда противоречила себе: «+0 данных, +0 ⌖»
 * рядом с «Завершить и забрать награду» и «удвоить за ролик».
 * - `double` — упомянуть ×2 за ролик: реклама есть, и итоги его предложат (`doubleReward`
 *   удваивает только забег с данными);
 * - `collect` — кнопке есть что забирать; нет — она просто завершает экспедицию.
 */
export function abandonPromise(
  reward: { research: number; warrants: number },
  ads: boolean,
): { double: boolean; collect: boolean } {
  return {
    double: ads && reward.research > 0,
    collect: reward.research > 0 || reward.warrants > 0,
  };
}
