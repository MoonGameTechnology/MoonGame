/**
 * Защита, которую постройки дают тому, на чём стоят. Правило одно на два модуля:
 * `construction` прикрывает им МИР (штурм и обстрел), `station` — ОРУДИЯ крепости,
 * которой эти постройки принадлежат. Модули друг друга не импортируют, поэтому число
 * живёт здесь, в нейтральном слое, — иначе у крепости завелась бы своя копия правила,
 * и досье обещало бы одно, а бой срезал бы другое. Чистые функции, без состояния.
 */
import { buildingLevel, type GameData } from '../data/schemas';
import type { Planet } from '../state/gameState';
import { MITIGATION_CAP } from './combat';

/**
 * На какую долю постройки мира снижают урон по нему (решение владельца 2026-09-26):
 * «Крепость на планетах даёт снижение получаемого урона. Как и каждое здание. Максимум
 * 90%… при разрушении здания бонус начинает уменьшаться».
 *
 * Каждая СТОЯЩАЯ постройка даёт свою долю `defenseBonus`: обычная — 5%
 * (`BASE_BUILDING_DEFENSE`, дефолт схемы), крепость — 15/30/45% по уровню. Доли складываются, сумма
 * упирается в потолок пула {@link MITIGATION_CAP}: форт III и девять других построек — уже
 * 90%. Разрушенная (hp 0) не прикрывает, поэтому обстрел, сносящий постройки, снимает защиту
 * по одной доле.
 */
export function worldDamageReduction(planet: Pick<Planet, 'buildings'>, data: GameData): number {
  let share = 0;
  for (const b of planet.buildings) {
    if (!(b.hp > 0)) continue;
    const def = data.buildings[b.type];
    if (def) share += buildingLevel(def, b.level).defenseBonus;
  }
  return Math.min(MITIGATION_CAP, Math.max(0, share));
}

/** Доля защиты → очки пула `combat.mitigation`. Очки `r / (1 − r)` выбраны так, чтобы одна
 *  лишь эта защита давала ровно r (1 / (1 + очки) = 1 − r), а с другими источниками пула
 *  (корпус ветерана, тип планеты) складывалась по правилу пула под его единым потолком. */
export function coverPoints(reduction: number): number {
  return reduction > 0 ? reduction / (1 - reduction) : 0;
}
