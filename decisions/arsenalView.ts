import {
  moduleAllowed,
  SHIP_SLOT_TYPES,
  type ArsenalItem,
  type GameData,
} from '../packages/shared-core/src/index';
import type { CommerceOffer } from '../packages/protocol/src/commerce';
import type {
  MetaDropOddsView,
  MetaRecipeView,
  MetaSeasonView,
} from '../packages/protocol/src/metaEconomyView';
import { splitSupport } from './supportShips';

/**
 * «Арсенал» хаба (переделка по макету, заказ владельца 2026-10-19): что экран показывает и
 * что разрешает, без разметки.
 *
 * 1. **Каталог — что арсенал вообще перечисляет.** Корабли — стартовый набор аккаунта, всё,
 *    чем игрок уже владеет, и то, что сервер может выдать наградой (таблица наград): такой
 *    корабль виден до получения. Модули — каждый, который встаёт хотя бы на один из этих
 *    кораблей или на флагман, плюс то, что лежит в коллекции или в таблице наград. Крепостные щиты и выводки
 *    Роя сюда не попадают сами: ни один корабль игрока их не несёт. Новый модуль для кораблей
 *    игрока появляется правкой `data/modules.json`, без списка в коде. Предмет, которого нет
 *    в данных клиента, не показывается: карточку ему рисовать не из чего (так же поступает
 *    `moduleGroups` верфи).
 * 2. **Владение — любая копия.** Верфь сетевой партии спрашивает «есть ли этот defId»,
 *    поэтому копии одного предмета сводятся в одну карточку, а лишние нужны только для
 *    продажи или разбора. Убрать ПОСЛЕДНЮЮ копию — значит убрать модуль с верфи, и экран
 *    предупреждает об этом до действия. Владение ищется по одному `defId`: корабль и модуль
 *    с одинаковым id в данных запрещены (тест каталога), иначе их копии смешались бы.
 * 3. **Продать можно то же, что берёт аукцион:** не личное, не стартовое, не арендованное.
 *    Разобрать — только то, что сервер назвал в `salvageableItemIds`: там уже учтены рецепт
 *    и выставленный лот, и второй копии этого правила здесь нет.
 * 4. **Шансы награды — с сервера** (`MetaEconomyView.drops`): экран раскрывает таблицу, по
 *    которой сервер бросает, а не свою копию файла, которая могла бы разойтись с ней.
 */

/** Корпус флагмана: модули героя показываются отдельной отметкой «Флагман». */
export const FLAGSHIP_HULL = 'hero';

export interface StarterEntry {
  kind: ArsenalItem['kind'];
  defId: string;
}

/** Несёт ли корпус модуль: правило модуля (`allowed`) и отсек его типа или универсальный. */
export function hullCarries(unit: string, moduleId: string, data: GameData): boolean {
  const def = data.units[unit];
  const mod = data.modules[moduleId];
  if (!def || !mod || !moduleAllowed(unit, def, mod)) return false;
  return (def.slots[mod.slot] ?? 0) > 0 || (def.slots.universal ?? 0) > 0;
}

/** Корабли из `hulls`, которые несут модуль, и встаёт ли он на флагман. */
export function fitsOf(
  moduleId: string,
  hulls: readonly string[],
  data: GameData,
): { hulls: string[]; flagship: boolean } {
  return {
    hulls: hulls.filter((h) => hullCarries(h, moduleId, data)),
    flagship: hullCarries(FLAGSHIP_HULL, moduleId, data),
  };
}

/** Модули из `modules`, которые несёт корабль, — в порядке каталога. */
export function modulesFor(hull: string, modules: readonly string[], data: GameData): string[] {
  return modules.filter((m) => hullCarries(hull, m, data));
}

/** Правило 1: корабли и модули, которые перечисляет арсенал, в порядке каталога. */
export function arsenalCatalog(input: {
  starter: readonly StarterEntry[];
  items: readonly ArsenalItem[];
  /** Что сервер может выдать наградой (`MetaEconomyView.drops.pool`). */
  obtainable?: readonly StarterEntry[];
  data: GameData;
}): { hulls: string[]; modules: string[] } {
  const { starter, items, obtainable = [], data } = input;
  const entries = [...starter, ...items, ...obtainable];
  const hulls: string[] = [];
  for (const entry of entries)
    if (entry.kind === 'hull' && data.units[entry.defId] && !hulls.includes(entry.defId))
      hulls.push(entry.defId);
  const listed = new Set(entries.filter((i) => i.kind === 'module').map((i) => i.defId));
  const carriers = [...hulls, FLAGSHIP_HULL];
  const modules = Object.keys(data.modules).filter(
    (id) => listed.has(id) || carriers.some((h) => hullCarries(h, id, data)),
  );
  return { hulls, modules };
}

/** Отсеки корабля по типам, в порядке верфи; универсальные — последними. */
export function hullBays(unit: string, data: GameData): Array<{ slot: string; count: number }> {
  const slots = data.units[unit]?.slots;
  if (!slots) return [];
  return [...SHIP_SLOT_TYPES, 'universal' as const]
    .map((slot) => ({ slot, count: slots[slot] ?? 0 }))
    .filter((b) => b.count > 0);
}

export type HullGroup = 'line' | 'support' | 'shuttles';

/** Корабли группами вкладок «Производства»: боевые, поддержка, шаттлы. */
export function hullGroups(
  hulls: readonly string[],
  data: GameData,
): Array<{ group: HullGroup; ids: string[] }> {
  const split = splitSupport(hulls, data);
  return (['line', 'support', 'shuttles'] as const)
    .map((group) => ({ group, ids: split[group] }))
    .filter((g) => g.ids.length > 0);
}

/** Копии одного предмета, самая свежая первой. */
export function copiesOf(items: readonly ArsenalItem[], defId: string): ArsenalItem[] {
  return items.filter((i) => i.defId === defId).sort((a, b) => b.acquiredAt - a.acquiredAt);
}

export function owns(items: readonly ArsenalItem[], defId: string): boolean {
  return items.some((i) => i.defId === defId);
}

/** Правило 3: копию можно выставить на аукцион. */
export function canSell(item: ArsenalItem): boolean {
  return !item.soulbound && item.origin !== 'starter' && item.origin !== 'rent';
}

/** Правило 2: после продажи или разбора этой копии модуля в арсенале не останется. */
export function isLastCopy(items: readonly ArsenalItem[], item: ArsenalItem): boolean {
  return items.every((i) => i.itemId === item.itemId || i.defId !== item.defId);
}

export interface RecipeProgress {
  got: number;
  need: number;
  /** Сервер разрешает сборку (`canCraft`): его ответ, а не пересчёт здесь. */
  ready: boolean;
  short: Array<{ materialId: string; missing: number }>;
}

/** Сколько материалов рецепта уже есть: в сумму идёт не больше нужного по каждому. */
export function recipeProgress(recipe: MetaRecipeView): RecipeProgress {
  let got = 0;
  let need = 0;
  const short: RecipeProgress['short'] = [];
  for (const i of recipe.ingredients) {
    const have = i.tradable + i.soulbound;
    got += Math.min(have, i.required);
    need += i.required;
    if (have < i.required) short.push({ materialId: i.materialId, missing: i.required - have });
  }
  return { got, need, ready: recipe.canCraft, short };
}

/** Доля процентом, округлённая до целого: полоска прогресса и подписи шансов. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((Math.min(part, whole) / whole) * 100) : 0;
}

/** Строка, покрывающая места дальше любой карты (в самой большой — 50), читается «остальные». */
const REST_PLACE = 100;

export interface DropOdds {
  /** Доля этого предмета среди наград, %; null — предмета нет в пуле. */
  share: number | null;
  /** Шанс по местам: `to: null` — «остальные места». */
  places: Array<{ from: number; to: number | null; chance: number }>;
  /** Сколько пустых партий подряд до гарантированной; null — гарантии нет. */
  dryRun: number | null;
}

/** Правило 4: шансы награды для модуля или корабля по таблице сервера. */
export function dropOdds(
  drops: MetaDropOddsView,
  defId: string,
  kind: 'hull' | 'module' = 'module',
): DropOdds {
  const total = drops.pool.reduce((s, l) => s + l.weight, 0);
  const own = drops.pool
    .filter((l) => l.kind === kind && l.defId === defId)
    .reduce((s, l) => s + l.weight, 0);
  const rows = [...drops.byPlace].sort((a, b) => a.maxPlace - b.maxPlace);
  let from = 1;
  const places: DropOdds['places'] = [];
  rows.forEach((row, i) => {
    if (row.maxPlace < from) return;
    const rest = i === rows.length - 1 && row.maxPlace >= REST_PLACE;
    places.push({ from, to: rest ? null : row.maxPlace, chance: Math.round(row.chance * 100) });
    from = row.maxPlace + 1;
  });
  return {
    share: own > 0 ? percent(own, total) : null,
    places,
    dryRun: drops.pityAfter > 1 ? drops.pityAfter - 1 : null,
  };
}

export interface SeasonWay {
  seasonId: string;
  nameKey: string;
  /** Уровень награды, текущий уровень игрока и последний уровень сезона. */
  level: number;
  current: number;
  levels: number;
  /** Из скольких модулей выбирают на этом уровне; 1 — уровень выдаёт сам модуль. */
  choices: number;
  /** Уровень достигнут, награда не забрана. */
  claimable: boolean;
}

/** Уровни сезонов, на которых модуль выдают. Забранная награда и закончившийся сезон, где
 *  уровень так и не набран, — уже не способ получить модуль. */
export function seasonWays(seasons: readonly MetaSeasonView[], defId: string): SeasonWay[] {
  const out: SeasonWay[] = [];
  for (const season of seasons) {
    for (const m of season.milestones) {
      const choice = m.choices.includes(defId);
      if ((!choice && m.module !== defId) || m.freeClaimed) continue;
      const claimable = season.level >= m.level;
      if (season.archived && !claimable) continue;
      out.push({
        seasonId: season.id,
        nameKey: season.nameKey,
        level: m.level,
        current: season.level,
        levels: season.levels,
        choices: choice ? m.choices.length : 1,
        claimable,
      });
    }
  }
  return out;
}

/** Предложения магазина, которые выдают этот модуль. */
export function shopOffersFor(offers: readonly CommerceOffer[], defId: string): CommerceOffer[] {
  return offers.filter((o) => o.contents.moduleId === defId);
}

/** Что открыть во вкладке «Модули», пока игрок ничего не выбрал: цель мастерской, иначе
 *  первый недостающий модуль, иначе первый по списку. */
export function defaultModule(
  modules: readonly string[],
  items: readonly ArsenalItem[],
  goalDefId: string | null,
): string | undefined {
  if (goalDefId && modules.includes(goalDefId)) return goalDefId;
  return modules.find((m) => !owns(items, m)) ?? modules[0];
}
