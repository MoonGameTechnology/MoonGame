import type { Battle, BattleSide, GameState, PlanetId } from './gameState';

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


/**
 * Идёт ли бой на этом узле — ЛЮБОЙ фазы (решение владельца 17: пока идёт бой, узел не
 * работает — ни производство, ни лечение, ни ремонт).
 *
 * Почему любой, а не только орбитальной: узел, на земле которого режутся десанты, тоже не
 * доводит заказ до стапеля. Прежде это правило существовало, но было привязано НЕ К ТОМУ:
 * производство глушила БОМБАРДИРОВКА, лечение гарнизона — только наземный бой, а корабль
 * не чинился, лишь когда сам был в бою. То есть орбитальный бой у крепости не
 * останавливал ничего: верфь строила, госпиталь лечил, док чинил стоящий рядом флот.
 *
 * Для перебора многих узлов бери {@link battleLocations} — один проход вместо прохода на
 * каждый узел.
 */
export function battleAt(state: GameState, planetId: PlanetId): boolean {
  for (const b of Object.values(state.battles)) {
    if (b.location === planetId) return true;
  }
  return false;
}

/** Все узлы, на которых идёт бой, одним проходом. */
export function battleLocations(state: GameState): Set<PlanetId> {
  const set = new Set<PlanetId>();
  for (const b of Object.values(state.battles)) set.add(b.location);
  return set;
}
