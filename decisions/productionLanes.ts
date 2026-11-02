/**
 * Какие очереди производства показать на мире (BLD-2.2). С BLD-2.1 у каждой
 * производственной постройки своя полоса (`orderLane` ядра): верфь, космопорт, казармы,
 * завод. Карточка мира рисует конвейер на полосу, а не один общий.
 *
 * 1. **Полоса видна, если мир может в ней строить.** «Может» спрашивается у ядра:
 *    есть хоть один заказываемый юнит этой полосы, для которого `unitBuildSiteBlocker`
 *    молчит. Своей таблицы «полоса → здание» здесь нет — новая постройка в данных
 *    получит конвейер без правки этого файла.
 * 2. **Полоса с делом видна всегда.** Идущий, ждущий или приостановленный заказ не
 *    прячется оттого, что его постройку снесли: игроку надо видеть, что он стоит, и
 *    уметь его отменить.
 * 3. **Порядок — тот, в котором полосы переданы** (хозяин передаёт `UNIT_LANES` ядра или
 *    их срез), чтобы конвейеры не прыгали местами.
 * 4. **Ничего не подошло — первая полоса вкладки.** Вкладка без конвейера читается как
 *    поломка панели; простаивающий конвейер честно говорит «здесь ничего не строится».
 */
import {
  orderLane,
  unitBuildSiteBlocker,
  unitLane,
  type BuildLane,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';

/** Есть ли у мира хоть один юнит этой полосы, который здесь можно заложить (правило 1). */
function canProduce(state: GameState, planetId: string, lane: BuildLane, data: GameData): boolean {
  const planet = state.planets[planetId];
  if (!planet) return false;
  return Object.values(data.units).some(
    (def) =>
      unitLane(def) === lane &&
      !def.traits.includes('issued') &&
      unitBuildSiteBlocker(planet, def, data) === null,
  );
}

/** Есть ли в полосе идущий, ждущий или приостановленный заказ (правило 2). */
function hasWork(state: GameState, planetId: string, lane: BuildLane, data: GameData): boolean {
  const planet = state.planets[planetId];
  const inLane = (o: { kind?: string; unit?: string }): boolean => orderLane(data, o) === lane;
  return (
    state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const p = e.payload as { planetId?: string; kind?: string; unit?: string };
      return p.planetId === planetId && inLane(p);
    }) ||
    (planet?.buildQueue ?? []).some(inLane) ||
    (planet?.pausedConstruction ?? []).some(inLane)
  );
}

/** Полосы из `lanes` (порядок сохраняется), чей конвейер показать на этом мире. */
export function shownProductionLanes(
  state: GameState,
  planetId: string,
  lanes: readonly BuildLane[],
  data: GameData,
): BuildLane[] {
  const shown = lanes.filter(
    (l) => canProduce(state, planetId, l, data) || hasWork(state, planetId, l, data),
  );
  return shown.length > 0 || lanes.length === 0 ? shown : [lanes[0]!];
}
