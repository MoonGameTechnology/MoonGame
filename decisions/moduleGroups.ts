import {
  RARITIES,
  SHIP_SLOT_TYPES,
  type GameData,
  type Rarity,
  type ShipSlotType,
} from '../packages/shared-core/src/index';

/**
 * Модули группами по типу слота (заказ владельца 2026-09-26: «разбить по группам модули, а
 * то они вперемешку и глаза разбегаются»). Одно решение на подготовку Sector Zero и на
 * верфь основной игры: оба экрана показывали каталог в порядке `data/modules.json`, где
 * оружие, защита и системы идут вперемешку.
 *
 * ## Порядок групп — как у слотов корабля
 *
 * Оружие, защита, система — порядок `SHIP_SLOT_TYPES`, в котором корабль раскладывает свои
 * слоты (`hullSlotTypes`). Группы идут в том же порядке, что плитки слотов над ними, и глаз
 * не перестраивается. Порядок ФИКСИРОВАННЫЙ: группа без слотов у выбранного корпуса не
 * уезжает в конец — купленная звезда корабля иначе переставила бы список.
 *
 * ## Внутри группы — сначала то, что встаёт на корпус, потом по редкости
 *
 * Ключи сортировки не зависят от того, надет модуль или нет: частое действие (надеть, снять)
 * не двигает карточки под пальцем. «Встаёт ли на корпус» меняется только сменой корпуса,
 * редкость — только редким осознанным шагом (подъём за чертёж), и тогда карточка честно
 * встаёт выше. Равные сохраняют порядок вызывающего — каталожный, одинаковый у всех игроков.
 */
export interface ModuleGroup {
  slot: ShipSlotType;
  ids: string[];
}

export interface ModuleGroupKeys {
  /** Ступень, которую видит игрок: в Sector Zero её поднимает профиль (`profileRarity`).
   *  Нет — каталожная. */
  rarity?: (id: string) => Rarity;
  /** Встаёт ли модуль на выбранный корпус вообще (`moduleAllowed`). Верфь показывает и
   *  запертые с причиной — они уходят в конец своей группы, чтобы не заслонять доступные.
   *  Нет — встаёт всё. */
  fits?: (id: string) => boolean;
}

/**
 * Разложить модули по типу слота и отсортировать внутри группы. Пустые группы не
 * возвращаются, неизвестный id выпадает (карточку ему рисовать не из чего).
 */
export function moduleGroups(
  ids: readonly string[],
  data: GameData,
  keys: ModuleGroupKeys = {},
): ModuleGroup[] {
  const rarity = keys.rarity ?? ((id: string) => data.modules[id]?.rarity ?? 'simple');
  const fits = keys.fits ?? (() => true);
  const rank = (id: string): number =>
    (fits(id) ? RARITIES.length : 0) + RARITIES.indexOf(rarity(id));
  return SHIP_SLOT_TYPES.map((slot) => ({
    slot,
    // `sort` стабилен (ES2019): равные остаются в порядке вызывающего.
    ids: ids.filter((id) => data.modules[id]?.slot === slot).sort((a, b) => rank(b) - rank(a)),
  })).filter((group) => group.ids.length > 0);
}
