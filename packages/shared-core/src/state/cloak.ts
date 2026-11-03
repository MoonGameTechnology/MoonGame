import type { GameData } from '../data/schemas';
import type { Fleet, GameState } from './gameState';
import type { SightCircle } from './sensorView';
import { effectiveStat } from '../util/loadout';

/**
 * МАСКИРОВОЧНОЕ ПОЛЕ (SM-4.3, выбор владельца 2026-11-03): легендарный модуль флагмана
 * героя. Пока поле работает, чужие глаза и радары замечают весь флот героя только с
 * меньшего расстояния: их радиус для этого флота умножается на `1 − cloak`.
 *
 * Поле снимают бой, обстрел и вылет шаттлов флота: в бою оно не работает, а после — ещё
 * {@link CLOAK_BREAK_MS} (`Fleet.cloakBrokenUntil` пишет модуль `cloakField`). Шпион на
 * мире, собственный бой и скан героя (`reveal`) маскировку не замечают — это контрмеры.
 *
 * Здесь только правило; туман (`visibility.ts`) спрашивает его в тех же местах, где решает
 * про флот: круг зрения по позиции, опознанный узел и радарная отметка.
 */

/** Модульный стат маскировки: доля, на которую сжимается чужой радиус. */
export const CLOAK_STAT = 'cloak';
/** Потолок доли: даже лучшее поле не делает флот невидимым вплотную. */
export const CLOAK_CAP = 0.9;
/** Сколько поле не работает после боя, обстрела или вылета шаттлов. */
export const CLOAK_BREAK_MS = 3_600_000;

const cloakModules = new WeakMap<GameData['modules'], ReadonlySet<string>>();

/** Модули каталога, несущие маскировку, — один раз на каталог. Без них проверка флота —
 *  просмотр стеков без счёта характеристик, туман на большой карте этого не замечает. */
function modulesWithCloak(data: GameData): ReadonlySet<string> {
  let ids = cloakModules.get(data.modules);
  if (!ids) {
    ids = new Set(
      Object.keys(data.modules).filter((id) => {
        const m = data.modules[id]!;
        if ((m.effects.stats[CLOAK_STAT] ?? 0) > 0) return true;
        return Object.values(m.rarityBonus ?? {}).some((bag) => (bag?.[CLOAK_STAT] ?? 0) > 0);
      }),
    );
    cloakModules.set(data.modules, ids);
  }
  return ids;
}

/** Сила поля, которое флот несёт, — без учёта срыва. Действует лучший носитель: второе
 *  поле в том же флоте не складывается. 0 — поля нет. */
export function fleetCloakRating(fleet: Pick<Fleet, 'units'>, data: GameData): number {
  const ids = modulesWithCloak(data);
  if (ids.size === 0) return 0;
  let best = 0;
  for (const stack of fleet.units) {
    if (stack.count <= 0 || !stack.modules?.some((id) => ids.has(id))) continue;
    const def = data.units[stack.unit];
    if (!def) continue;
    best = Math.max(best, effectiveStat(def, stack, data, CLOAK_STAT) ?? 0);
  }
  return Math.min(CLOAK_CAP, best);
}

/** Сорвано ли поле сейчас: флот в бою, ведёт обстрел или ещё не прошёл час после боя,
 *  залпа или вылета. */
export function cloakBroken(state: Pick<GameState, 'time'>, fleet: Fleet): boolean {
  return fleet.battleId != null || fleet.bombarding === true || (fleet.cloakBrokenUntil ?? 0) > state.time;
}

/** Доля, на которую чужие глаза и радары сжимаются для этого флота прямо сейчас. 0 —
 *  флот виден как обычно. */
export function fleetCloak(state: Pick<GameState, 'time'>, fleet: Fleet, data: GameData): number {
  const rating = fleetCloakRating(fleet, data);
  return rating > 0 && !cloakBroken(state, fleet) ? rating : 0;
}

/** Радиус чужого глаза или радара для флота с полем `cloak`. */
export function cloakedReach(radius: number, cloak: number): number {
  return cloak > 0 ? radius * (1 - cloak) : radius;
}

/** Радиус опознания круга зрения для флота с маскировкой `cloak`. Скан героя (`reveal`)
 *  поле не обманывает: это и есть контрмера. */
export function eyeReach(c: SightCircle, cloak: number): number {
  return c.source.kind === 'reveal' ? c.identify : cloakedReach(c.identify, cloak);
}
