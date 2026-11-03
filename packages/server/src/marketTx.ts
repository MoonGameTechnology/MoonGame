import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { MetaEconomyStore, MetaEconomyTransaction } from './metaEconomyStore';

/** Origin of a moved item follows it to the new owner inside the economy transaction. */
export function moveSource(
  tx: MetaEconomyTransaction | undefined,
  itemId: string,
  from: string,
  to: string,
): void {
  if (!tx) return;
  const source = tx.account(from).itemSources[itemId];
  if (source) tx.account(to).itemSources[itemId] = source;
  delete tx.account(from).itemSources[itemId];
}

/**
 * Shared Postgres plumbing of the hub market extensions (auction lots, buy orders):
 * one `MetaEconomyStore` transaction per operation, wallets locked in ascending
 * `account_id` order (the same order as `PostgresMetaMarket.buy`, so crossing deals
 * cannot deadlock), every warrant movement journaled in `meta_market_ledger`.
 */
export class PostgresMarketBase {
  constructor(
    protected readonly pool: Pool,
    protected readonly economy: () => MetaEconomyStore | undefined,
    protected readonly now: () => number,
    protected readonly feeRate: number,
    protected readonly faucet: number,
  ) {}

  protected transaction<T>(
    accounts: string[],
    work: (c: PoolClient, tx: MetaEconomyTransaction) => Promise<T>,
  ): Promise<T> {
    const economy = this.economy();
    if (!economy) return Promise.reject(new Error('E_UNAVAILABLE'));
    return economy.transaction(accounts, async (tx) => {
      if (!tx.sql) throw new Error('E_STORAGE_MISMATCH');
      return work(tx.sql, tx);
    });
  }

  protected async lockWallets(c: PoolClient, ids: string[]): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    for (const id of [...new Set(ids)].sort()) {
      const inserted = await c.query(
        'INSERT INTO meta_wallets(account_id, warrants) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING account_id',
        [id, this.faucet],
      );
      if (inserted.rowCount === 1)
        await c.query(
          "INSERT INTO meta_market_ledger(id,account_id,delta,reason,at) VALUES($1,$2,$3,'seed',$4)",
          [randomUUID(), id, this.faucet, this.now()],
        );
      const r = await c.query<{ warrants: string }>(
        'SELECT warrants FROM meta_wallets WHERE account_id=$1 FOR UPDATE',
        [id],
      );
      balances.set(id, Number(r.rows[0]!.warrants));
    }
    return balances;
  }

  protected async move(
    c: PoolClient,
    accountId: string,
    delta: number,
    reason: string,
    listingId: string,
    at: number,
  ): Promise<void> {
    await c.query('UPDATE meta_wallets SET warrants=warrants+$1 WHERE account_id=$2', [
      delta,
      accountId,
    ]);
    await this.ledger(c, accountId, delta, reason, listingId, at);
  }

  protected async ledger(
    c: PoolClient,
    accountId: string,
    delta: number,
    reason: string,
    listingId: string,
    at: number,
  ): Promise<void> {
    await c.query(
      'INSERT INTO meta_market_ledger(id,account_id,delta,reason,listing_id,at) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), accountId, delta, reason, listingId, at],
    );
  }
}
