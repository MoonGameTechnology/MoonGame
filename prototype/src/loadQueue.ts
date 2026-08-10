/**
 * Очередь часовой погрузки десанта (REFM-97).
 *
 * Наземная часть не прыгает в трюм мгновенно: заказ час висит в клиентской очереди, и
 * только потом уходит настоящий `army.load`. Правила этой очереди лежали россыпью в
 * четырёх функциях рядом с живым состоянием, поэтому не читалось главное — почему записи
 * ПОШТУЧНЫЕ и почему резерв гарнизона считается по миру, а не по флоту.
 *
 * 1. **Погрузка занимает игровой ЧАС, а не мгновение** — иначе трюм наполнялся бы
 *    щелчком и «везти армию» перестало бы что-то стоить.
 * 2. **Записи ПОШТУЧНЫЕ, а не одной партией.** Ядро грузит «всё или ничего»: пять
 *    отдельных приказов доедут частично, если за этот час гарнизон обмелел, а партия
 *    одним действием отскочила бы целиком.
 * 3. **Идущая погрузка занимает место в трюме ЗАРАНЕЕ:** без этого два заказа подряд
 *    пообещали бы один и тот же объём и трюм оказался бы переполнен.
 * 4. **Резерв гарнизона считается по МИРУ, а не по флоту.** У пришвартованных к одному
 *    миру флотов гарнизон общий, поэтому обещанные единицы складываются по всем ним —
 *    иначе два флота вычерпают одну и ту же роту.
 * 5. **Носитель ушёл, вступил в бой или исчез — заказ ОТМЕНЯЕТСЯ,** а не ждёт: везти
 *    уже некому и незачем.
 * 6. **Созревшая погрузка уходит приказом и покидает очередь** — ровно один раз.
 */

/** Одна поштучная погрузка в пути. */
export interface PendingLoad {
  fleetId: string;
  unit: string;
  /** Мировое время заказа. */
  startAt: number;
  /** Мировое время готовности. */
  doneAt: number;
}

/** Состояние носителя, важное для очереди. */
export interface Carrier {
  movement?: unknown;
  battleId?: unknown;
  location?: string | null;
}

/** Занятый заранее объём трюма по идущим погрузкам этого флота (правило 3). */
export function queuedCargo(
  loads: readonly PendingLoad[],
  fleetId: string,
  cargoSizeOf: (unit: string) => number,
): number {
  let n = 0;
  for (const p of loads) if (p.fleetId === fleetId) n += cargoSizeOf(p.unit);
  return n;
}

/** Сколько единиц `unit` уже обещано погрузками ИЗ ЭТОГО мира — по всем флотам у него
 *  на приколе (правило 4). */
export function queuedFromWorld(
  loads: readonly PendingLoad[],
  planetId: string,
  unit: string,
  locationOf: (fleetId: string) => string | null | undefined,
): number {
  let n = 0;
  for (const p of loads) {
    if (p.unit !== unit) continue;
    if (locationOf(p.fleetId) === planetId) n++;
  }
  return n;
}

/** Сколько погрузок этого флота с этим типом уже в очереди. */
export function queuedOf(loads: readonly PendingLoad[], fleetId: string, unit: string): number {
  return loads.filter((p) => p.fleetId === fleetId && p.unit === unit).length;
}

/** Новые записи очереди: по одной на единицу, все с общим сроком (правила 1–2). */
export function makeLoads(
  fleetId: string,
  unit: string,
  count: number,
  now: number,
  span: number,
): PendingLoad[] {
  const out: PendingLoad[] = [];
  for (let i = 0; i < count; i++) out.push({ fleetId, unit, startAt: now, doneAt: now + span });
  return out;
}

/** Может ли этот носитель ещё везти заказ (правило 5). */
export function carrierHolds(c: Carrier | undefined): boolean {
  return !!c && !c.movement && !c.battleId && !!c.location;
}

/** Что сделать с очередью в этом кадре: какие погрузки пора выполнить и что остаётся.
 *  Отменённые не попадают ни туда, ни туда (правила 5–6). */
export function loadStep(
  loads: readonly PendingLoad[],
  now: number,
  carrierOf: (fleetId: string) => Carrier | undefined,
): { fire: PendingLoad[]; keep: PendingLoad[] } {
  const fire: PendingLoad[] = [];
  const keep: PendingLoad[] = [];
  for (const p of loads) {
    if (!carrierHolds(carrierOf(p.fleetId))) continue; // отменено
    if (now >= p.doneAt) fire.push(p);
    else keep.push(p);
  }
  return { fire, keep };
}
