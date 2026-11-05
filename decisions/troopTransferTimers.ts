/**
 * Погрузка и высадка на карте: свои действующие заявки привязаны к объекту, а не к
 * выбранному флоту. У объекта не больше трёх строк: погрузка, выгрузка, штурмовая
 * высадка. В каждой строке срок последней заявки и число флотов, а не типов войск.
 * Заявка остаётся источником истины: по истечении срока показываем ноль, пока мир
 * не подтвердит завершение; отменённая заявка исчезает вместе со своим таймером.
 * Доля пройденного у строки — от начала первой заявки до конца последней: та же группа,
 * что у отсчёта, поэтому полоса и время не расходятся.
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
  /** Пройденная доля группы, 0…1: от начала первой заявки до конца последней. */
  progress: number;
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
    Map<TroopTransferKind, { startAt: number; doneAt: number; fleets: Set<string> }>
  >();
  const add = (
    f: TransferFleet,
    target: string,
    kind: TroopTransferKind,
    claim: { startAt: number; doneAt: number },
  ) => {
    if (f.location !== target) return;
    let rows = targets.get(target);
    if (!rows) targets.set(target, (rows = new Map()));
    const row = rows.get(kind);
    if (row) {
      row.startAt = Math.min(row.startAt, claim.startAt);
      row.doneAt = Math.max(row.doneAt, claim.doneAt);
      row.fleets.add(f.id);
    } else
      rows.set(kind, { startAt: claim.startAt, doneAt: claim.doneAt, fleets: new Set([f.id]) });
  };
  for (const f of fleets) {
    if (f.owner !== viewer) continue;
    for (const c of f.loading ?? []) add(f, c.from, 'load', c);
    for (const c of f.unloading ?? []) add(f, c.to, 'unload', c);
    if (f.assaultLanding) add(f, f.assaultLanding.planetId, 'assault', f.assaultLanding);
  }
  const order: TroopTransferKind[] = ['load', 'unload', 'assault'];
  return [...targets].map(([target, rows]) => ({
    target,
    rows: order.flatMap((kind) => {
      const row = rows.get(kind);
      if (!row) return [];
      const span = row.doneAt - row.startAt;
      const progress = span > 0 ? Math.max(0, Math.min(1, (now - row.startAt) / span)) : 1;
      return [{ kind, fleets: row.fleets.size, leftMs: Math.max(0, row.doneAt - now), progress }];
    }),
  }));
}
