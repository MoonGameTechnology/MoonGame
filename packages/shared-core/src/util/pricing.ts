import type { ResourceBag, UnitDef } from '../data/schemas';
import type { GameState, MatchPricing } from '../state/gameState';

/**
 * Цены партии (резолюция владельца 2026-10-18: «я только про основную игру»).
 *
 * Каталог `data/*.json` один на основную игру и Sector Zero, а дорогими корабли, юниты,
 * здания и технологии должны стать только в основной. Поэтому каталог держит базовую
 * цену, а карта основной игры объявляет множители (`MatchMap.pricing`), которые
 * `buildStateFromMap` закрепляет в состоянии при создании партии — как `techRules`.
 * Партия без поля (Sector Zero, старые сохранения) платит цену каталога.
 *
 * Здесь ОДНО правило пересчёта: его читают и ядро (списание, срок, возврат при отмене,
 * обломки), и окна клиента, и бот. Две копии правила разошлись бы молча: окно показало
 * бы одну цену, а ядро списало бы другую.
 */

/** Множитель ресурса в этой партии; нет записи или поле битое ⇒ ×1. */
function factor(table: Record<string, number> | undefined, res: string): number {
  const f = table?.[res];
  return f !== undefined && Number.isFinite(f) && f > 0 ? f : 1;
}

/** Цена в этой партии: каждая строка каталога × множитель своего ресурса, вверх до
 *  целого (дробной цены у игрока не бывает). Без цен партии — тот же объект. */
export function matchCost(state: Pick<GameState, 'pricing'>, cost: ResourceBag): ResourceBag;
export function matchCost(
  state: Pick<GameState, 'pricing'>,
  cost: ResourceBag | undefined,
): ResourceBag | undefined;
export function matchCost(
  state: Pick<GameState, 'pricing'>,
  cost: ResourceBag | undefined,
): ResourceBag | undefined {
  const table = state.pricing?.cost;
  if (!cost || !table) return cost;
  const out: ResourceBag = {};
  for (const res of Object.keys(cost)) {
    const amount = cost[res] ?? 0;
    out[res] = amount > 0 ? Math.ceil(amount * factor(table, res)) : amount;
  }
  return out;
}

/** Price of a unit's hull, before modules/cargo and quantity. Only buildable ship
 * hulls carry the ship premium: shuttles, ground troops, ordnance and issued/hero
 * units keep their ordinary match price. Both factors are applied before rounding
 * once, so UI, payment, cancellation and salvage use the same integer price.
 * Older matches without `shipCost` retain their pinned prices. */
export function matchUnitCost(state: Pick<GameState, 'pricing'>, unit: UnitDef): ResourceBag;
export function matchUnitCost(
  state: Pick<GameState, 'pricing'>,
  unit: UnitDef | undefined,
): ResourceBag | undefined;
export function matchUnitCost(
  state: Pick<GameState, 'pricing'>,
  unit: UnitDef | undefined,
): ResourceBag | undefined {
  if (!unit) return undefined;
  const premium = state.pricing?.shipCost;
  if (
    !premium ||
    !unit.hullClass ||
    unit.domain !== 'space' ||
    unit.traits.includes('hero') ||
    unit.traits.includes('issued')
  )
    return matchCost(state, unit.cost);
  const out: ResourceBag = {};
  for (const res of Object.keys(unit.cost)) {
    const amount = unit.cost[res] ?? 0;
    out[res] =
      amount > 0
        ? Math.ceil(amount * factor(state.pricing?.cost, res) * factor(premium, res))
        : amount;
  }
  return out;
}

/** Срок постройки или исследования в этой партии, в игровых часах. */
export function matchHours(state: Pick<GameState, 'pricing'>, hours: number): number {
  const f = state.pricing?.hours;
  return f !== undefined && Number.isFinite(f) && f > 0 ? hours * f : hours;
}

/** Стартовый запас места в этой партии: строка × множитель `pricing.start`. */
export function matchStart(pricing: MatchPricing | undefined, bag: ResourceBag): ResourceBag {
  const table = pricing?.start;
  if (!table) return { ...bag };
  const out: ResourceBag = {};
  for (const res of Object.keys(bag)) out[res] = Math.round((bag[res] ?? 0) * factor(table, res));
  return out;
}
