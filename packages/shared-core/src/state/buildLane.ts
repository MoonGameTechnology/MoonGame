import type { GameData, UnitDef } from '../data/schemas';

/**
 * ПОЛОСА КОНВЕЙЕРА мира (BLD-2.1). На мире идёт ОДНА стройка на полосу, остальное ждёт
 * в `Planet.buildQueue` (BLD-1). Полос четыре, и они независимы:
 *
 *   · `buildings` — здание и апгрейд: они спорят за одну стройплощадку;
 *   · `ships`     — корабли верфи;
 *   · `shuttles`  — челноки космопорта (десантный челнок с бойцом — тоже здесь: его
 *                   собирает порт, казармы он не занимает);
 *   · `mobilization` — пехота, техника и герои в общей FIFO-очереди.
 * Legacy infantry/vehicles pump events are accepted when restoring old saves.
 *
 * До BLD-2.1 все юниты стояли в одной полосе `units`, и пехота ждала крейсер. Полоса
 * юнита — это ЕГО ПРОИЗВОДСТВЕННАЯ ПОСТРОЙКА, и решается она по тем же полям данных,
 * по которым `unitBuildSiteBlocker` проверяет, есть ли эта постройка на мире: трейт
 * `shuttle` → порт, `domain: 'space'` → верфь, наземный `kind` → казармы или завод.
 * Две копии этого правила разошлись бы — заказ встал бы не в ту очередь, где его ждут.
 *
 * Чистая функция данных: её же читает клиент, чтобы нарисовать заказ в том конвейере,
 * где ядро его и ведёт.
 */
export type BuildLane = 'buildings' | 'ships' | 'shuttles' | 'mobilization' | 'infantry' | 'vehicles';

/** Полосы юнитов в фиксированном порядке. Порядок значим: в нём будятся полосы после
 *  освобождения (детерминизм), и в нём же клиент рисует конвейеры. */
export const UNIT_LANES = [
  'ships',
  'shuttles',
  'mobilization',
] as const satisfies readonly BuildLane[];

/** Все полосы мира: стройка первой, потом юниты. */
export const BUILD_LANES = ['buildings', ...UNIT_LANES] as const satisfies readonly BuildLane[];

export function isBuildLane(v: unknown): v is BuildLane {
  return typeof v === 'string' && (BUILD_LANES as readonly string[]).includes(v);
}

/** Полоса юнита по его определению. Неизвестный юнит (снят из данных) — в полосу
 *  кораблей: заказ всё равно отбросит `orderSpec`, а полоса нужна детерминированная. */
export function unitLane(def: Pick<UnitDef, 'domain' | 'kind' | 'traits'> | undefined): BuildLane {
  if (!def) return 'ships';
  if (def.traits.includes('shuttle')) return 'shuttles';
  if (def.domain === 'ground') return 'mobilization';
  return 'ships';
}

/** Полоса заказа: стройки, апгрейда или юнита. Заказ без внятного `kind` считается
 *  стройкой — в сторону «занято», как и до BLD-2.1 (инвариант #4). */
export function orderLane(
  data: Pick<GameData, 'units'>,
  order: { kind?: string; unit?: string },
): BuildLane {
  if (order.kind !== 'unit') return 'buildings';
  return unitLane(typeof order.unit === 'string' ? data.units[order.unit] : undefined);
}
