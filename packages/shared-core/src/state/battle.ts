import type { Battle, BattleSide } from './gameState';

/**
 * MSB-1 — ОДИН доступ к сторонам боя на все поверхности.
 *
 * Бой держит СПИСОК сторон (`Battle.sides`), а не два именованных поля: форма
 * `{ attacker, defender }` выражала ровно двоих, и третью сторону вместить не могла
 * физически. Решение владельца — бой на N сторон, где «три» частный случай, а не цель.
 *
 * Роль при этом не исчезла, а переехала В САМУ СТОРОНУ (`role`): от неё зависит, бьёт
 * сторона своим `attack` или отвечает `defense`. Свойством ПАРЫ роль быть перестала —
 * при пяти участниках атакующими могут оказаться сразу четверо.
 *
 * Спрашивают роль ЭТИМИ функциями, а не индексом в массиве: порядок в списке — это
 * порядок вступления в бой (по нему MSB-4 решает, чей мир после совместного штурма), и
 * завязывать на него роль значило бы связать две независимые вещи. Своя копия
 * `sides.find(...)` в каждой поверхности — ровно тот форк правил, против которого
 * заведён RULES-1.
 */

/** Все стороны боя, в порядке вступления. */
export function sidesOf(battle: Battle): readonly BattleSide[] {
  return battle.sides;
}

/** Первая сторона с ролью `role`, или `undefined`. */
function sideByRole(battle: Battle, role: BattleSide['role']): BattleSide | undefined {
  return battle.sides.find((s) => s.role === role);
}

/** Атакующая сторона дуэли. При N сторонах атакующих может быть несколько — тогда это
 *  ПЕРВАЯ из них, и звать её стоит только там, где бой заведомо парный. */
export function attackerOf(battle: Battle): BattleSide | undefined {
  return sideByRole(battle, 'attacker');
}

/** Обороняющаяся сторона дуэли — зеркало {@link attackerOf}. */
export function defenderOf(battle: Battle): BattleSide | undefined {
  return sideByRole(battle, 'defender');
}
