/** В памяти: арсенал игрока и выпавшая добыча (SLIM-5). */
import { memoryEconomyLock, type MemoryEconomyLock } from '../../memoryEconomyLock';
import type { DropStore, OwnedArsenalItem, ArsenalStore } from '../types';
import type { ArsenalItem } from '@void/shared-core';

/** In-memory arsenal store (ARS-2) — `itemId → owned item`, plus the structural
 *  invariants: idempotent grant (first write wins), owner-guarded transfer/consume,
 *  soulbound never transfers. */
export class MemoryArsenalStore implements ArsenalStore {
  private items = new Map<string, OwnedArsenalItem>();
  private readonly lock = memoryEconomyLock(this);

  /** Transaction checkpoints are only used while holding the shared economy gate. */
  snapshotState(): Array<[string, OwnedArsenalItem]> {
    return structuredClone([...this.items]);
  }
  restoreState(rows: Array<[string, OwnedArsenalItem]>): void {
    this.items = new Map(structuredClone(rows));
  }

  grant(item: OwnedArsenalItem): Promise<void> {
    return this.lock.run(async () => {
      if (!this.items.has(item.itemId)) this.items.set(item.itemId, structuredClone(item));
    });
  }
  update(item: OwnedArsenalItem): Promise<boolean> {
    return this.lock.run(async () => {
      if (this.items.get(item.itemId)?.accountId !== item.accountId) return false;
      this.items.set(item.itemId, structuredClone(item));
      return true;
    });
  }
  get(itemId: string): Promise<OwnedArsenalItem | null> {
    return this.lock.run(async () => {
      const row = this.items.get(itemId);
      return row ? structuredClone(row) : null;
    });
  }
  listOf(accountId: string): Promise<ArsenalItem[]> {
    return this.lock.run(async () =>
      [...this.items.values()]
        .filter((r) => r.accountId === accountId)
        .sort(
          (a, b) =>
            a.kind.localeCompare(b.kind) ||
            a.defId.localeCompare(b.defId) ||
            a.itemId.localeCompare(b.itemId),
        )
        .map(({ accountId: _owner, ...item }) => structuredClone(item)),
    );
  }
  transfer(
    itemId: string,
    from: string,
    to: string,
  ): Promise<{ ok: true } | { ok: false; code: 'E_NOT_OWNER' | 'E_SOULBOUND' }> {
    return this.lock.run(async () => {
      const row = this.items.get(itemId);
      if (!row || row.accountId !== from) return { ok: false, code: 'E_NOT_OWNER' };
      if (row.soulbound) return { ok: false, code: 'E_SOULBOUND' };
      row.accountId = to;
      delete row.preferred;
      return { ok: true };
    });
  }
  consume(itemId: string, accountId: string): Promise<boolean> {
    return this.lock.run(async () => {
      const row = this.items.get(itemId);
      if (!row || row.accountId !== accountId) return false;
      this.items.delete(itemId);
      return true;
    });
  }
  wear(itemId: string, by: number): Promise<{ durability?: number } | null> {
    return this.lock.run(async () => {
      const row = this.items.get(itemId);
      if (!row) return null;
      if (row.durability === undefined) return { durability: undefined };
      row.durability = Math.max(0, row.durability - by);
      return { durability: row.durability };
    });
  }
}

/** In-memory drop-loop store (ARS-4): exactly-once per-(match, account) roll claims,
 *  the pity counter and the salvage-shard balance. */
export class MemoryDropStore implements DropStore {
  private claims = new Set<string>();
  private pity = new Map<string, number>();
  private shards = new Map<string, number>();
  private lock: MemoryEconomyLock = memoryEconomyLock(this);

  bindEconomyLock(owner: object): void { this.lock = memoryEconomyLock(owner); }
  snapshotState(): { claims: string[]; pity: Array<[string, number]>; shards: Array<[string, number]> } {
    return { claims: [...this.claims], pity: [...this.pity], shards: [...this.shards] };
  }
  restoreState(state: ReturnType<MemoryDropStore['snapshotState']>): void {
    this.claims = new Set(state.claims);
    this.pity = new Map(state.pity);
    this.shards = new Map(state.shards);
  }
  claim(matchId: string, accountId: string): Promise<boolean> {
    return this.lock.run(async () => {
      const key = JSON.stringify([matchId, accountId]);
      if (this.claims.has(key)) return false;
      this.claims.add(key);
      return true;
    });
  }
  pityOf(accountId: string): Promise<number> {
    return this.lock.run(async () => this.pity.get(accountId) ?? 0);
  }
  setPity(accountId: string, value: number): Promise<void> {
    return this.lock.run(async () => { this.pity.set(accountId, value); });
  }
  stepPity(accountId: string, hit: boolean, pityAfter: number): Promise<number> {
    return this.lock.run(async () => {
      const pity = this.pity.get(accountId) ?? 0;
      this.pity.set(accountId, hit || pity + 1 >= pityAfter ? 0 : pity + 1);
      return pity;
    });
  }
  addShards(accountId: string, delta: number): Promise<void> {
    return this.lock.run(async () => { this.shards.set(accountId, (this.shards.get(accountId) ?? 0) + delta); });
  }
  shardsOf(accountId: string): Promise<number> {
    return this.lock.run(async () => this.shards.get(accountId) ?? 0);
  }
}
