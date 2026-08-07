/**
 * Что делать по подтверждению войны и чем марш по лейну отличается от хода (REFM-59).
 *
 * Игрок увидел «это объявит войну …» и нажал «да». Дальше важен ПОРЯДОК: сначала война,
 * потом приказы. И отдельно — марш не в мир, а на точку посреди лейна.
 *
 * 1. **Война объявляется ПЕРВОЙ, до единого приказа движения.** Приказ, применённый
 *    раньше объявления, упирается в те же запертые лейны и отвергается ядром: игрок
 *    нажал «да», война началась, а флоты остались стоять. В соло приказы применяются
 *    последовательно, в сети сервер применяет их в порядке отправки — в обоих случаях
 *    решает именно порядок, а не «примерно одновременно».
 * 2. **Объявляют КАЖДОМУ виновнику, а не первому.** Маршрут может упираться в двоих;
 *    объявишь одному — второй по-прежнему запирает дорогу, и приказ снова отвергнут.
 * 3. **Марш по лейну упирается в ОБА конца ребра.** Флот идёт по отрезку между двумя
 *    мирами и стоит на нём; хозяин любого из концов запирает марш. Проверить только
 *    «пункт назначения» значит пропустить марш, который ядро всё равно отвергнет.
 */

/** Точка на лейне: отрезок между двумя мирами и доля пути по нему. */
export interface LaneEdge {
  from: string;
  to: string;
  t: number;
}

/** Оба конца лейна — оба и проверяются (правило 3). */
export function laneEnds(edge: LaneEdge): [string, string] {
  return [edge.from, edge.to];
}

/** Удержанный приказ вместе с теми, кому придётся объявить войну. */
export interface StagedOrder {
  fleetIds: readonly string[];
  destId: string;
  blockers: readonly string[];
  /** Марш на точку лейна вместо хода в мир. */
  edge?: LaneEdge;
  /** Приказ был штурмом, а не ходом. */
  assault?: boolean;
}

/** Шаг исполнения: объявление войны либо само движение. */
export type WarStep =
  | { kind: 'declare-war'; on: string }
  | { kind: 'assault'; fleetIds: readonly string[]; destId: string }
  | { kind: 'move'; fleetIds: readonly string[]; destId: string }
  | { kind: 'move-edge'; fleetIds: readonly string[]; edge: LaneEdge };

/**
 * Разложить подтверждённый приказ в шаги. Все объявления войны идут ПЕРВЫМИ и в том
 * порядке, в каком виновники названы игроку (правила 1–2), затем ровно один шаг
 * движения — штурм, ход или марш по лейну.
 */
export function warConfirmPlan(order: StagedOrder): WarStep[] {
  const steps: WarStep[] = order.blockers.map((on) => ({ kind: 'declare-war', on }) as WarStep);
  if (order.assault) {
    steps.push({ kind: 'assault', fleetIds: order.fleetIds, destId: order.destId });
  } else if (order.edge) {
    steps.push({ kind: 'move-edge', fleetIds: order.fleetIds, edge: order.edge });
  } else {
    steps.push({ kind: 'move', fleetIds: order.fleetIds, destId: order.destId });
  }
  return steps;
}
