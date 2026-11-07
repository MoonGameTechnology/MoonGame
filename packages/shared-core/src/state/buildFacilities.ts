import type { BuildingDef, GameData, UnitDef } from '../data/schemas';
import type { Planet } from './gameState';
import { shuttleBayAt } from './shuttle';

/** Строительные способности здания — те, что гейтят `unit.build`. */
type ConstructionCapability =
  'enablesShipConstruction' | 'enablesInfantryConstruction' | 'enablesVehicleConstruction';

/** Открыта ли способность у здания ЭТОГО уровня. База — флаг самого здания; дальше
 *  способность может открыть любой ПРОЙДЕННЫЙ апгрейд, и назад она не выключается
 *  (см. `BuildingLevelSchema`: «уровень открывает», а не «уровень умеет»).
 *
 *  Раньше здесь читался только базовый def, и это делало данные немой опечаткой:
 *  здание объявляет способность в апгрейдах — «второй уровень открывает», — а гейт
 *  этого не видел, и юнит оказывался непостроим вовсе. Та же ловушка сторожится для
 *  вместимости ангара (`shuttleBay`, SHU-1.1), которую читает `shuttleBayAt`. */
function capabilityAt(def: BuildingDef, level: number, key: ConstructionCapability): boolean {
  if (def[key]) return true;
  for (let l = 2; l <= level; l++) {
    if (def.upgrades[l - 2]?.[key]) return true;
  }
  return false;
}

/** True if some standing (undestroyed) building on the planet has the capability at
 *  its current level. */
function hasCapability(planet: Planet, data: GameData, key: ConstructionCapability): boolean {
  return planet.buildings.some((b) => {
    if (b.hp <= 0) return false;
    const def = data.buildings[b.type];
    return def ? capabilityAt(def, b.level, key) : false;
  });
}

/** The yard a space-domain hull needs to be laid down (shipyard/spaceport). Ground
 *  units never check this. Exported for the client's rally-point offer (RALLY-1): the
 *  button belongs to worlds that can lay down a hull, by the same rule. */
export function hasShipyard(planet: Planet, data: GameData): boolean {
  return hasCapability(planet, data, 'enablesShipConstruction');
}

/** Какой уровень верфи нужен корпусу этого класса (решение владельца 15). Класс не
 *  объявлен — корабль довольствуется любой верфью, как было до FORT-5.5. */
const YARD_LEVEL_FOR: Record<string, number> = { light: 1, medium: 2, heavy: 3 };

/** Самый большой СТАПЕЛЬ узла: максимальный уровень среди живых верфей. Максимум, а не
 *  сумма: две верфи первого уровня не собирают линкор — нужен один стапель нужного
 *  размера. (Ср. `shuttleBay`, где вместимость как раз СКЛАДЫВАЕТСЯ: причалов может быть
 *  много, а стапель для корпуса нужен один.) */
function yardLevelAt(planet: Planet, data: GameData): number {
  let best = 0;
  for (const b of planet.buildings) {
    if (b.hp <= 0) continue;
    const def = data.buildings[b.type];
    // Способность читается через `capabilityAt`, а НЕ через `buildingLevel`: разбор
    // уровня отдаёт числовые поля, а флаги способностей в него не входят вовсе, и
    // `buildingLevel(def, 1).enablesShipConstruction` молча равен `undefined`. На этом
    // первая версия и попалась — лёгкий корпус не проходил на верфи первого уровня.
    if (def && capabilityAt(def, b.level, 'enablesShipConstruction'))
      best = Math.max(best, b.level);
  }
  return best;
}

/** Здание, без которого наземный юнит не заложить: КАЗАРМЫ для пехоты, ЗАВОД для
 *  техники (ROS-1.1). Род войск живёт в данных (`UnitDef.kind`), поэтому новый род
 *  вводится юнитом и зданием, а не правкой этой функции. */
export const GROUND_FACILITY = {
  infantry: { capability: 'enablesInfantryConstruction', code: 'E_NO_BARRACKS' },
  vehicle: { capability: 'enablesVehicleConstruction', code: 'E_NO_FACTORY' },
} as const satisfies Record<string, { capability: ConstructionCapability; code: string }>;

export function hasGroundFacility(planet: Planet, data: GameData, kind: UnitDef['kind']): boolean {
  return hasCapability(planet, data, GROUND_FACILITY[kind].capability);
}

/**
 * ГДЕ ЭТОТ ЮНИТ ВООБЩЕ МОЖНО ЗАЛОЖИТЬ — тот же гейт зданий, что применяет `unit.build`,
 * вынесенный наружу чистой функцией. Возвращает код отказа или `null`, если мир годится.
 *
 * Экспортируется РАДИ ИНТЕРФЕЙСА (ROS-3.1):
 * экран «Производство» показывает список миров, где заказ пройдёт, и своя копия этих
 * правил разъехалась бы на первой же правке — игрок выбирал бы мир, на котором ядро
 * отвечает отказом. Спрашивать надо ту функцию, по которой ядро и решает.
 *
 * С SHU-5.1 гейт весь постоянный: космопорт держит сколько угодно челноков, и предела
 * «ангар полон», зависевшего бы от очереди заказов, больше нет.
 */
export function unitBuildSiteBlocker(
  planet: Planet,
  def: UnitDef,
  data: GameData,
): 'E_NO_PORT' | 'E_NO_SHIPYARD' | 'E_NO_BARRACKS' | 'E_NO_FACTORY' | null {
  if (def.traits.includes('shuttle')) {
    return shuttleBayAt(planet, data) > 0 ? null : 'E_NO_PORT';
  }
  if (def.domain === 'space') {
    return hasShipyard(planet, data) ? null : 'E_NO_SHIPYARD';
  }
  if (def.domain === 'ground') {
    return hasGroundFacility(planet, data, def.kind) ? null : GROUND_FACILITY[def.kind].code;
  }
  return null;
}

/** Canonical yard-class gate, also used when presenting a facility upgrade. */
export function unitYardLevelBlocker(
  planet: Planet,
  def: UnitDef,
  data: GameData,
): 'E_YARD_TOO_SMALL' | null {
  if (def.traits.includes('shuttle') || def.domain !== 'space' || !def.hullClass) return null;
  return yardLevelAt(planet, data) < (YARD_LEVEL_FOR[def.hullClass] ?? 1)
    ? 'E_YARD_TOO_SMALL'
    : null;
}
