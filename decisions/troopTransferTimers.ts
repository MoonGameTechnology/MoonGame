/**
 * Погрузка и высадка на карте: свои действующие заявки привязаны к объекту, а не к
 * выбранному флоту. У объекта не больше трёх строк: погрузка, выгрузка, штурмовая
 * высадка. В каждой строке срок последней заявки и число флотов, а не типов войск.
 * Заявка остаётся источником истины: по истечении срока показываем ноль, пока мир
 * не подтвердит завершение; отменённая заявка исчезает вместе со своим таймером.
 */
import type { Fleet } from '../packages/shared-core/src/index';

export type TroopTransferKind = 'load' | 'unload' | 'assault';
type TransferFleet = Pick<
  Fleet,
  'id' | 'owner' | 'location' | 'loading' | 'unloading' | 'assaultLanding'
>;

export interface TroopTransferRow {
  kind: TroopTransferKind;
  fleets: number;
  leftMs: number;
}

export interface TroopTransferMarker {
  target: string;
  rows: TroopTransferRow[];
}

/** Чужие заявки не показываются даже в соло, где клиент имеет полный мир. */
export function troopTransferTimers(
  fleets: readonly TransferFleet[],
  viewer: string,
  now: number,
): TroopTransferMarker[] {
  const targets = new Map<
    string,
    Map<TroopTransferKind, { doneAt: number; fleets: Set<string> }>
  >();
  const add = (f: TransferFleet, target: string, kind: TroopTransferKind, doneAt: number) => {
    if (f.location !== target) return;
    let rows = targets.get(target);
    if (!rows) targets.set(target, (rows = new Map()));
    const row = rows.get(kind);
    if (row) {
      row.doneAt = Math.max(row.doneAt, doneAt);
      row.fleets.add(f.id);
    } else rows.set(kind, { doneAt, fleets: new Set([f.id]) });
  };
  for (const f of fleets) {
    if (f.owner !== viewer) continue;
    for (const c of f.loading ?? []) add(f, c.from, 'load', c.doneAt);
    for (const c of f.unloading ?? []) add(f, c.to, 'unload', c.doneAt);
    if (f.assaultLanding) add(f, f.assaultLanding.planetId, 'assault', f.assaultLanding.doneAt);
  }
  const order: TroopTransferKind[] = ['load', 'unload', 'assault'];
  return [...targets].map(([target, rows]) => ({
    target,
    rows: order.flatMap((kind) => {
      const row = rows.get(kind);
      return row ? [{ kind, fleets: row.fleets.size, leftMs: Math.max(0, row.doneAt - now) }] : [];
    }),
  }));
}
