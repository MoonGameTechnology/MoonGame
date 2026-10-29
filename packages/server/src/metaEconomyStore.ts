import type { MetaEconomyAccount, MetaEconomyReceipt } from '@void/protocol';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  MemoryArsenalStore,
  MemoryDropStore,
  PostgresArsenalStore,
  type ArsenalStore,
  type DropStore,
} from './store';
import type { MemoryMetaMarket } from './metaMarket';
import type { PlayerMedalNews } from '@void/protocol';
import { memoryEconomyLock } from './memoryEconomyLock';

export interface MetaEconomyTransaction {
  account(accountId: string): MetaEconomyAccount;
  arsenal: ArsenalStore;
  drops: DropStore;
  receipt(key: string): Promise<MetaEconomyReceipt | null>;
  saveReceipt(key: string, fingerprint: string, response: unknown): Promise<void>;
  creditWarrants(
    accountId: string,
    amount: number,
    reason: string,
    sourceId: string,
    at: number,
  ): Promise<number>;
  isItemListed(itemId: string): Promise<boolean>;
  announcePlayerMedal(event: PlayerMedalNews, accountId: string): Promise<void>;
  /** Internal auction adapter only: participates in this exact local transaction. */
  sql?: PoolClient;
}

export interface MetaEconomyStore {
  transaction<T>(
    accountIds: readonly string[],
    work: (tx: MetaEconomyTransaction) => Promise<T>,
  ): Promise<T>;
  read(accountId: string): Promise<MetaEconomyAccount>;
  receipt(key: string): Promise<MetaEconomyReceipt | null>;
  claimNonce(nonce: string, expiresAt: number): Promise<boolean>;
  recentPlayerMedals(limit: number, before?: number, corpId?: string | null): Promise<PlayerMedalNews[]>;
}

export function emptyMetaEconomyAccount(): MetaEconomyAccount {
  return {
    materials: [],
    season: {},
    cosmetics: [],
    counters: {},
    operations: {},
    itemSources: {},
  };
}

function accountFrom(accounts: Map<string, MetaEconomyAccount>, id: string): MetaEconomyAccount {
  const account = accounts.get(id);
  if (!account) throw Error('E_ECONOMY_ACCOUNT_SCOPE');
  return account;
}

function validAccount(account: MetaEconomyAccount): void {
  if (
    account.sovereigns !== undefined &&
    (!Number.isSafeInteger(account.sovereigns) || account.sovereigns < 0)
  )
    throw Error('E_ECONOMY_STATE');
  if (account.premiumUntil !== undefined && !Number.isSafeInteger(account.premiumUntil))
    throw Error('E_ECONOMY_STATE');
  const ids = new Set<string>();
  for (const lot of account.materials) {
    if (
      !lot.lotId ||
      ids.has(lot.lotId) ||
      !lot.materialId ||
      !Number.isSafeInteger(lot.quantity) ||
      lot.quantity <= 0
    )
      throw Error('E_ECONOMY_STATE');
    if ((lot.source === 'commerce' || lot.source === 'ad') && !lot.soulbound)
      throw Error('E_SOULBOUND');
    ids.add(lot.lotId);
  }
}

/** Local adapter: a failure restores inventory, pity, wallets, lots and receipts together. */
export class MemoryMetaEconomyStore implements MetaEconomyStore {
  private readonly accounts = new Map<string, MetaEconomyAccount>();
  private readonly receipts = new Map<string, MetaEconomyReceipt>();
  private readonly nonces = new Map<string, number>();
  private readonly playerMedals = new Map<string, PlayerMedalNews>();
  private readonly lock;

  constructor(
    private readonly arsenal: MemoryArsenalStore,
    private readonly drops: MemoryDropStore,
    private readonly market: MemoryMetaMarket,
  ) {
    this.lock = memoryEconomyLock(arsenal);
    drops.bindEconomyLock(arsenal);
  }

  read(accountId: string): Promise<MetaEconomyAccount> {
    return this.lock.run(async () =>
      structuredClone(this.accounts.get(accountId) ?? emptyMetaEconomyAccount()),
    );
  }
  recentPlayerMedals(limit: number, before?: number, corpId?: string | null): Promise<PlayerMedalNews[]> {
    return this.lock.run(async () => structuredClone([...this.playerMedals.values()]
      .filter((e) => (before === undefined || e.at < before) && (e.grade === 1 || (corpId != null && e.corp?.id === corpId)))
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, limit)));
  }
  claimNonce(nonce: string, expiresAt: number): Promise<boolean> {
    return this.lock.run(async () => {
      const now = Date.now();
      for (const [key, expiry] of this.nonces) if (expiry <= now) this.nonces.delete(key);
      if (this.nonces.has(nonce)) return false;
      this.nonces.set(nonce, expiresAt);
      return true;
    });
  }
  receipt(key: string): Promise<MetaEconomyReceipt | null> {
    return this.lock.run(async () => structuredClone(this.receipts.get(key) ?? null));
  }

  transaction<T>(
    accountIds: readonly string[],
    work: (tx: MetaEconomyTransaction) => Promise<T>,
  ): Promise<T> {
    return this.lock.run(async () => {
      const staged = new Map(
        [...new Set(accountIds)].map((id) => [
          id,
          structuredClone(this.accounts.get(id) ?? emptyMetaEconomyAccount()),
        ]),
      );
      const receipts = new Map<string, MetaEconomyReceipt>();
      const news = new Map<string, PlayerMedalNews>();
      const arsenal = this.arsenal.snapshotState();
      const drops = this.drops.snapshotState();
      const market = this.market.snapshotState();
      try {
        const result = await work({
          account: (id) => accountFrom(staged, id),
          announcePlayerMedal: async (event, id) => {
            accountFrom(staged, id);
            const key = JSON.stringify([id, event.medalId, event.grade]);
            if (!this.playerMedals.has(key) && !news.has(key)) news.set(key, structuredClone(event));
          },
          arsenal: this.arsenal,
          drops: this.drops,
          receipt: async (key) =>
            structuredClone(receipts.get(key) ?? this.receipts.get(key) ?? null),
          saveReceipt: async (key, fingerprint, response) => {
            const old = receipts.get(key) ?? this.receipts.get(key);
            if (old && old.fingerprint !== fingerprint) throw Error('E_IDEMPOTENCY_CONFLICT');
            if (!old) receipts.set(key, structuredClone({ fingerprint, response }));
          },
          creditWarrants: async (id, amount, reason, sourceId, at) => {
            accountFrom(staged, id);
            return this.market.creditWarrants(id, amount, reason, sourceId, at);
          },
          isItemListed: async (itemId) =>
            (await this.market.listings()).some((lot) => lot.item.itemId === itemId),
        });
        const output = structuredClone(result);
        for (const account of staged.values()) validAccount(account);
        for (const [id, account] of staged) this.accounts.set(id, structuredClone(account));
        for (const [key, receipt] of receipts) this.receipts.set(key, structuredClone(receipt));
        for (const [key, event] of news) this.playerMedals.set(key, event);
        return output;
      } catch (error) {
        this.arsenal.restoreState(arsenal);
        this.drops.restoreState(drops);
        this.market.restoreState(market);
        throw error;
      }
    });
  }
}

/** Drop operations scoped to the caller's transaction: never BEGIN/COMMIT here. */
class TransactionDrops implements DropStore {
  constructor(private readonly db: PoolClient) {}
  async claim(matchId: string, accountId: string): Promise<boolean> {
    const result = await this.db.query(
      'INSERT INTO drop_claims(match_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [matchId, accountId],
    );
    return result.rowCount === 1;
  }
  async pityOf(accountId: string): Promise<number> {
    const result = await this.db.query<{ pity: number }>(
      'SELECT pity FROM drop_meta WHERE account_id=$1',
      [accountId],
    );
    return result.rows[0]?.pity ?? 0;
  }
  async setPity(accountId: string, value: number): Promise<void> {
    await this.db.query(
      'INSERT INTO drop_meta(account_id,pity) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET pity=EXCLUDED.pity',
      [accountId, value],
    );
  }
  async stepPity(accountId: string, hit: boolean, pityAfter: number): Promise<number> {
    await this.db.query('INSERT INTO drop_meta(account_id) VALUES($1) ON CONFLICT DO NOTHING', [
      accountId,
    ]);
    const result = await this.db.query<{ pity: number }>(
      'SELECT pity FROM drop_meta WHERE account_id=$1 FOR UPDATE',
      [accountId],
    );
    const pity = result.rows[0]!.pity;
    await this.db.query('UPDATE drop_meta SET pity=$2 WHERE account_id=$1', [
      accountId,
      hit || pity + 1 >= pityAfter ? 0 : pity + 1,
    ]);
    return pity;
  }
  async addShards(accountId: string, delta: number): Promise<void> {
    await this.db.query(
      'INSERT INTO drop_meta(account_id,shards) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET shards=drop_meta.shards+EXCLUDED.shards',
      [accountId, delta],
    );
  }
  async shardsOf(accountId: string): Promise<number> {
    const result = await this.db.query<{ shards: number }>(
      'SELECT shards FROM drop_meta WHERE account_id=$1',
      [accountId],
    );
    return result.rows[0]?.shards ?? 0;
  }
}

export class PostgresMetaEconomyStore implements MetaEconomyStore {
  constructor(private readonly pool: Pool) {}

  async recentPlayerMedals(limit: number, before?: number, corpId?: string | null): Promise<PlayerMedalNews[]> {
    const result = await this.pool.query<{ id: string; at: string; medal_id: PlayerMedalNews['medalId']; grade: PlayerMedalNews['grade']; login: string | null; corp: PlayerMedalNews['corp'] }>(
      `SELECT id,at,medal_id,grade,login,corp FROM player_medal_news
       WHERE ($1::bigint IS NULL OR at<$1) AND (grade=1 OR ($2::text IS NOT NULL AND corp->>'id'=$2))
       ORDER BY at DESC,id DESC LIMIT $3`, [before ?? null, corpId ?? null, limit]);
    return result.rows.map((r) => ({ id: r.id, at: Number(r.at), kind: 'player_medal', medalId: r.medal_id, grade: r.grade, login: r.login, corp: r.corp }));
  }

  async claimNonce(nonce: string, expiresAt: number): Promise<boolean> {
    await this.pool.query('DELETE FROM meta_entitlement_nonces WHERE expires_at<=$1', [Date.now()]);
    const result = await this.pool.query(
      'INSERT INTO meta_entitlement_nonces(nonce,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [nonce, expiresAt],
    );
    return result.rowCount === 1;
  }

  async read(accountId: string): Promise<MetaEconomyAccount> {
    const result = await this.pool.query<{ state: MetaEconomyAccount }>(
      'SELECT state FROM meta_economy_accounts WHERE account_id=$1',
      [accountId],
    );
    return result.rows[0]?.state ?? emptyMetaEconomyAccount();
  }
  async receipt(key: string): Promise<MetaEconomyReceipt | null> {
    const result = await this.pool.query<MetaEconomyReceipt>(
      'SELECT fingerprint,response FROM meta_economy_receipts WHERE receipt_key=$1',
      [key],
    );
    return result.rows[0] ?? null;
  }

  async transaction<T>(
    accountIds: readonly string[],
    work: (tx: MetaEconomyTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const accounts = new Map<string, MetaEconomyAccount>();
      for (const id of [...new Set(accountIds)].sort()) {
        await db.query(
          'INSERT INTO meta_economy_accounts(account_id,state) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',
          [id, JSON.stringify(emptyMetaEconomyAccount())],
        );
        const row = await db.query<{ state: MetaEconomyAccount }>(
          'SELECT state FROM meta_economy_accounts WHERE account_id=$1 FOR UPDATE',
          [id],
        );
        accounts.set(id, row.rows[0]!.state);
      }
      const result = await work({
        account: (id) => accountFrom(accounts, id),
        announcePlayerMedal: async (event, id) => {
          accountFrom(accounts, id);
          // A deletion request takes an UPDATE lock on this row before erasure.
          // A delayed reward must not recreate the erased recipient's identity.
          const live = await db.query<{ login: string }>('SELECT login FROM users WHERE id=$1 AND deletion_requested_at IS NULL FOR SHARE', [id]);
          if (!live.rows[0]) return;
          await db.query(`INSERT INTO player_medal_news(id,account_id,medal_id,grade,at,login,corp)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(account_id,medal_id,grade) DO NOTHING`,
          [event.id, id, event.medalId, event.grade, event.at, live.rows[0].login, JSON.stringify(event.corp)]);
        },
        arsenal: new PostgresArsenalStore(db),
        drops: new TransactionDrops(db),
        sql: db,
        receipt: async (key) => {
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtext('meta_economy_receipt'),hashtext($1))",
            [key],
          );
          const found = await db.query<MetaEconomyReceipt>(
            'SELECT fingerprint,response FROM meta_economy_receipts WHERE receipt_key=$1',
            [key],
          );
          return found.rows[0] ?? null;
        },
        saveReceipt: async (key, fingerprint, response) => {
          const inserted = await db.query(
            'INSERT INTO meta_economy_receipts(receipt_key,fingerprint,response,account_ids) VALUES($1,$2,$3::jsonb,$4::text[]) ON CONFLICT DO NOTHING',
            [key, fingerprint, JSON.stringify(response), [...new Set(accountIds)]],
          );
          if (!inserted.rowCount) {
            const old = await db.query<{ fingerprint: string }>(
              'SELECT fingerprint FROM meta_economy_receipts WHERE receipt_key=$1',
              [key],
            );
            if (old.rows[0]?.fingerprint !== fingerprint) throw Error('E_IDEMPOTENCY_CONFLICT');
          }
        },
        creditWarrants: async (id, amount, reason, sourceId, at) => {
          accountFrom(accounts, id);
          if (!Number.isSafeInteger(amount) || amount < 0) throw Error('E_BAD_AMOUNT');
          await db.query(
            'INSERT INTO meta_wallets(account_id,warrants) VALUES($1,0) ON CONFLICT DO NOTHING',
            [id],
          );
          const old = await db.query<{ warrants: string }>(
            'SELECT warrants FROM meta_wallets WHERE account_id=$1 FOR UPDATE',
            [id],
          );
          const balance = Number(old.rows[0]!.warrants) + amount;
          if (!Number.isSafeInteger(balance)) throw Error('E_BAD_AMOUNT');
          await db.query('UPDATE meta_wallets SET warrants=$2 WHERE account_id=$1', [id, balance]);
          await db.query(
            'INSERT INTO meta_market_ledger(id,account_id,delta,reason,listing_id,at) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), id, amount, reason, sourceId, at],
          );
          return balance;
        },
        isItemListed: async (itemId) => {
          await db.query('SELECT item_id FROM arsenal WHERE item_id=$1 FOR UPDATE', [itemId]);
          const found = await db.query('SELECT id FROM meta_market_listings WHERE item_id=$1', [
            itemId,
          ]);
          return found.rowCount !== 0;
        },
      });
      for (const [id, account] of accounts) {
        validAccount(account);
        await db.query('UPDATE meta_economy_accounts SET state=$2::jsonb WHERE account_id=$1', [
          id,
          JSON.stringify(account),
        ]);
      }
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  }
}
