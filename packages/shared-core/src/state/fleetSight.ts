import type { GameData } from '../data/schemas';
import { effectiveStat } from '../util/loadout';
import type { Fleet } from './gameState';

/** Прямой обзор, который флот добавляет к базовому `rules.fleet` модулями: его лучший
 *  корабль (`sightRange` модулей стака суммируется, по флоту — максимум, как у радара).
 *  Это глаза, а не радар: множители радара и блэкаут его не трогают. Экспортирован, чтобы
 *  клиент рисовал тот же круг, что считает туман. */
export function fleetSightBonus(fleet: Pick<Fleet, 'units'>, data: GameData): number {
  let bonus = 0;
  for (const stack of fleet.units) {
    const def = data.units[stack.unit];
    if (def && stack.count > 0) bonus = Math.max(bonus, effectiveStat(def, stack, data, 'sightRange') ?? 0);
  }
  return bonus;
}
