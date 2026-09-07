import { randomUUID } from 'node:crypto';
import type { ArsenalItem } from '@void/shared-core';
import type { Pool, PoolClient } from 'pg';
import type { ArsenalStore } from './store';

export const META_MARKET_FEE = 0.08;
/**
 * Alpha-фаусет: сколько Варрантов получает кошелёк при первом обращении.
 *
 * ДЕФОЛТ 0 — выключен, и это не перестраховка. Стартовые предметы сделаны soulbound
 * именно потому, что торгуемая выдача на аккаунт превращает регистрацию в монетный
 * двор для аукциона (`arsenal.ts`, ARS-0 anti-RMT). Фаусет на ВАЛЮТУ открывает ту же
 * дверь: N регистраций → N×номинал → слив на основной аккаунт. Пока нет гейта по
 * уровню аккаунта и детекта аномалий (`economy-roadmap.md` EC-0.3 / EC-6.1),
 * включать его можно только осознанно и только на стенде.
 *
 * Значение приходит ПАРАМЕТРОМ, а не из `process.env` внутри модуля: env читает
 * композиционный корень (`main.ts` / `netserver.ts`, переменная `META_MARKET_FAUCET`),
 * поэтому тесты задают его явно и не зависят от порядка загрузки модулей.
 */
export const DEFAULT_FAUCET = 0;
export const MAX_META_LISTINGS = 20;

export interface MetaMarketListing {
  id: string;
  sellerId: string;
  sellerLogin: string;
  item: ArsenalItem;
  price: number;
  createdAt: number;
}

export interface MetaMarketLedgerEntry {
  id: string;
  accountId: string;
  delta: number;
  reason: 'seed' | 'sale' | 'purchase' | 'fee';
  listingId?: string;
  at: number;
}

export type MetaMarketResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : T)) | { ok: false; code: string };

export interface MetaMarket {
  ensureWallet(accountId: string): Promise<number>;
  balance(accountId: string): Promise<number>;
  listings(): Promise<MetaMarketListing[]>;
  history(accountId: string): Promise<MetaMarketLedgerEntry[]>;
  list(
    accountId: string,
    login: string,
    itemId: string,
    price: number,
  ): Promise<MetaMarketResult<{ listing: MetaMarketListing }>>;
  buy(accountId: string, listingId: string): Promise<MetaMarketResult<{ balance: number }>>;
  cancel(accountId: string, listingId: string): Promise<MetaMarketResult>;
}

/** Development adapter. Mutations share one promise tail, mirroring a DB transaction. */
export class MemoryMetaMarket implements MetaMarket {
  private readonly wallets = new Map<string, number>();
  private readonly lots = new Map<string, MetaMarketListing>();
  private readonly journal: MetaMarketLedgerEntry[] = [];
  private tail = Promise.resolve();

  constructor(
    private readonly arsenal: ArsenalStore,
    private readonly now = (): number => Date.now(),
    private readonly faucet: number = DEFAULT_FAUCET,
  ) {}

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async ensureWallet(accountId: string): Promise<number> {
    if (!this.wallets.has(accountId)) {
      this.wallets.set(accountId, this.faucet);
      this.journal.push({
        id: randomUUID(),
        accountId,
        delta: this.faucet,
        reason: 'seed',
        at: this.now(),
      });
    }
    return this.wallets.get(accountId)!;
  }
  async balance(accountId: string): Promise<number> {
    return this.ensureWallet(accountId);
  }
  async listings(): Promise<MetaMarketListing[]> {
    return [...this.lots.values()].sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
  }
  async history(accountId: string): Promise<MetaMarketLedgerEntry[]> {
    return this.journal
      .filter((x) => x.accountId === accountId)
      .slice(-100)
      .reverse();
  }

  list(
    accountId: string,
    login: string,
    itemId: string,
    price: number,
  ): Promise<MetaMarketResult<{ listing: MetaMarketListing }>> {
    return this.locked(async () => {
      if (!Number.isSafeInteger(price) || price < 1) return { ok: false, code: 'E_BAD_PRICE' };
      const item = await this.arsenal.get(itemId);
      if (!item || item.accountId !== accountId) return { ok: false, code: 'E_NOT_OWNER' };
      if (item.soulbound) return { ok: false, code: 'E_SOULBOUND' };
      if (item.form !== 'instance') return { ok: false, code: 'E_BLUEPRINT' };
      if ([...this.lots.values()].some((x) => x.item.itemId === itemId))
        return { ok: false, code: 'E_ALREADY_LISTED' };
      if (
        [...this.lots.values()].filter((x) => x.sellerId === accountId).length >= MAX_META_LISTINGS
      )
        return { ok: false, code: 'E_ORDER_LIMIT' };
      const listing = {
        id: randomUUID(),
        sellerId: accountId,
        sellerLogin: login,
        item,
        price,
        createdAt: this.now(),
      };
      this.lots.set(listing.id, listing);
      return { ok: true, listing };
    });
  }

  buy(accountId: string, listingId: string): Promise<MetaMarketResult<{ balance: number }>> {
    return this.locked(async () => {
      const lot = this.lots.get(listingId);
      if (!lot) return { ok: false, code: 'E_NO_LISTING' };
      if (lot.sellerId === accountId) return { ok: false, code: 'E_OWN_LISTING' };
      const balance = await this.ensureWallet(accountId);
      if (balance < lot.price) return { ok: false, code: 'E_INSUFFICIENT' };
      const moved = await this.arsenal.transfer(lot.item.itemId, lot.sellerId, accountId);
      if (!moved.ok) {
        this.lots.delete(listingId);
        return { ok: false, code: moved.code };
      }
      const fee = Math.ceil(lot.price * META_MARKET_FEE);
      const sellerNet = lot.price - fee;
      this.wallets.set(accountId, balance - lot.price);
      this.wallets.set(lot.sellerId, (await this.ensureWallet(lot.sellerId)) + sellerNet);
      const at = this.now();
      this.journal.push(
        { id: randomUUID(), accountId, delta: -lot.price, reason: 'purchase', listingId, at },
        {
          id: randomUUID(),
          accountId: lot.sellerId,
          delta: sellerNet,
          reason: 'sale',
          listingId,
          at,
        },
        { id: randomUUID(), accountId: 'system', delta: fee, reason: 'fee', listingId, at },
      );
      this.lots.delete(listingId);
      return { ok: true, balance: balance - lot.price };
    });
  }

  cancel(accountId: string, listingId: string): Promise<MetaMarketResult> {
    return this.locked(async () => {
      const lot = this.lots.get(listingId);
      if (!lot) return { ok: false, code: 'E_NO_LISTING' };
      if (lot.sellerId !== accountId) return { ok: false, code: 'E_FORBIDDEN' };
      this.lots.delete(listingId);
      return { ok: true };
    });
  }
}

type LotRow = {
  id: string;
  seller_id: string;
  seller_login: string;
  item_id: string;
  price: string;
  created_at: string;
  kind: ArsenalItem['kind'];
  form: ArsenalItem['form'];
  def_id: string;
  grade: number | null;
  soulbound: boolean;
  durability: number | null;
  origin: ArsenalItem['origin'];
  acquired_at: string;
};
const fromRow = (r: LotRow): MetaMarketListing => ({
  id: r.id,
  sellerId: r.seller_id,
  sellerLogin: r.seller_login,
  price: Number(r.price),
  createdAt: Number(r.created_at),
  item: {
    itemId: r.item_id,
    kind: r.kind,
    form: r.form,
    defId: r.def_id,
    ...(r.grade === null ? {} : { grade: r.grade }),
    soulbound: r.soulbound,
    ...(r.durability === null ? {} : { durability: r.durability }),
    origin: r.origin,
    acquiredAt: Number(r.acquired_at),
  },
});

export class PostgresMetaMarket implements MetaMarket {
  constructor(
    private readonly pool: Pool,
    private readonly now = (): number => Date.now(),
    private readonly faucet: number = DEFAULT_FAUCET,
  ) {}
  /** Читает баланс, создавая кошелёк при первом обращении.
   *
   *  `lock` обязателен ВНУТРИ транзакции покупки: без `FOR UPDATE` строка кошелька не
   *  блокируется, и один аккаунт, покупающий два РАЗНЫХ лота одновременно, читает
   *  один и тот же баланс дважды. Лот заперт своим `FOR UPDATE`, поэтому гонка за
   *  ОДИН лот сериализуется и без этого, а гонка за разные — нет. Раньше от неё
   *  спасал только `CHECK (warrants >= 0)`: деньги не уходили в минус, но нарушение
   *  ограничения вылетало исключением и доезжало до клиента как 500 (инвариант #4).
   *  Читатели вне транзакции (`balance`, `ensureWallet`) блокировку не берут. */
  private async wallet(
    c: Pool | PoolClient,
    accountId: string,
    lock = false,
  ): Promise<number> {
    const inserted = await c.query(
      'INSERT INTO meta_wallets(account_id, warrants) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING account_id',
      [accountId, this.faucet],
    );
    if (inserted.rowCount === 1) {
      await c.query(
        "INSERT INTO meta_market_ledger(id,account_id,delta,reason,at) VALUES($1,$2,$3,'seed',$4)",
        [randomUUID(), accountId, this.faucet, this.now()],
      );
    }
    const r = await c.query<{ warrants: string }>(
      `SELECT warrants FROM meta_wallets WHERE account_id=$1${lock ? ' FOR UPDATE' : ''}`,
      [accountId],
    );
    return Number(r.rows[0]!.warrants);
  }
  ensureWallet(accountId: string): Promise<number> {
    return this.wallet(this.pool, accountId);
  }
  balance(accountId: string): Promise<number> {
    return this.wallet(this.pool, accountId);
  }
  async listings(): Promise<MetaMarketListing[]> {
    const r = await this.pool.query<LotRow>(
      'SELECT l.*,a.kind,a.form,a.def_id,a.grade,a.soulbound,a.durability,a.origin,a.acquired_at FROM meta_market_listings l JOIN arsenal a ON a.item_id=l.item_id ORDER BY l.price,l.created_at',
    );
    return r.rows.map(fromRow);
  }
  async history(accountId: string): Promise<MetaMarketLedgerEntry[]> {
    const r = await this.pool.query<{
      id: string;
      account_id: string;
      delta: string;
      reason: MetaMarketLedgerEntry['reason'];
      listing_id: string | null;
      at: string;
    }>(
      'SELECT id,account_id,delta,reason,listing_id,at FROM meta_market_ledger WHERE account_id=$1 ORDER BY at DESC LIMIT 100',
      [accountId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      accountId: x.account_id,
      delta: Number(x.delta),
      reason: x.reason,
      ...(x.listing_id ? { listingId: x.listing_id } : {}),
      at: Number(x.at),
    }));
  }
  async list(
    accountId: string,
    login: string,
    itemId: string,
    price: number,
  ): Promise<MetaMarketResult<{ listing: MetaMarketListing }>> {
    if (!Number.isSafeInteger(price) || price < 1) return { ok: false, code: 'E_BAD_PRICE' };
    const id = randomUUID(),
      at = this.now();
    const r = await this.pool.query<LotRow>(
      `INSERT INTO meta_market_listings(id,seller_id,seller_login,item_id,price,created_at) SELECT $1,$2,$3,a.item_id,$4,$5 FROM arsenal a WHERE a.item_id=$6 AND a.account_id=$2 AND NOT a.soulbound AND a.form='instance' AND (SELECT count(*) FROM meta_market_listings WHERE seller_id=$2)<$7 ON CONFLICT DO NOTHING RETURNING *, (SELECT kind FROM arsenal WHERE item_id=$6), (SELECT form FROM arsenal WHERE item_id=$6), (SELECT def_id FROM arsenal WHERE item_id=$6), (SELECT grade FROM arsenal WHERE item_id=$6), (SELECT soulbound FROM arsenal WHERE item_id=$6), (SELECT durability FROM arsenal WHERE item_id=$6), (SELECT origin FROM arsenal WHERE item_id=$6), (SELECT acquired_at FROM arsenal WHERE item_id=$6)`,
      [id, accountId, login, price, at, itemId, MAX_META_LISTINGS],
    );
    if (!r.rows[0]) return { ok: false, code: 'E_NOT_TRADABLE' };
    return { ok: true, listing: fromRow(r.rows[0]) };
  }
  async buy(accountId: string, listingId: string): Promise<MetaMarketResult<{ balance: number }>> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const q = await c.query<LotRow>(
        'SELECT l.*,a.kind,a.form,a.def_id,a.grade,a.soulbound,a.durability,a.origin,a.acquired_at FROM meta_market_listings l JOIN arsenal a ON a.item_id=l.item_id WHERE l.id=$1 FOR UPDATE',
        [listingId],
      );
      const lot = q.rows[0];
      if (!lot) {
        await c.query('ROLLBACK');
        return { ok: false, code: 'E_NO_LISTING' };
      }
      if (lot.seller_id === accountId) {
        await c.query('ROLLBACK');
        return { ok: false, code: 'E_OWN_LISTING' };
      }
      // Оба кошелька запираются в ОДНОМ И ТОМ ЖЕ порядке (по account_id), а не
      // «сначала свой, потом чужой»: иначе встречные покупки (A берёт лот B, B берёт
      // лот A) захватывают строки в противоположном порядке и Postgres убивает одну
      // из транзакций по дедлоку. Лоты у них разные, поэтому `FOR UPDATE` на лоте от
      // этого не спасает. Порядок детерминированный — значит дедлока нет by design.
      for (const id of [accountId, lot.seller_id].sort()) {
        await this.wallet(c, id, true);
      }
      const balance = await this.wallet(c, accountId, true);
      if (balance < Number(lot.price)) {
        await c.query('ROLLBACK');
        return { ok: false, code: 'E_INSUFFICIENT' };
      }
      const fee = Math.ceil(Number(lot.price) * META_MARKET_FEE),
        net = Number(lot.price) - fee,
        at = this.now();
      const moved = await c.query(
        "UPDATE arsenal SET account_id=$1,origin='auction',acquired_at=$2 WHERE item_id=$3 AND account_id=$4 AND NOT soulbound",
        [accountId, at, lot.item_id, lot.seller_id],
      );
      if (moved.rowCount !== 1) {
        // The owner transferred/consumed the item outside the market after listing.
        // Retire the stale lot in the same locked transaction so it cannot poison
        // the public book forever.
        await c.query('DELETE FROM meta_market_listings WHERE id=$1', [listingId]);
        await c.query('COMMIT');
        return { ok: false, code: 'E_NOT_OWNER' };
      }
      await c.query('UPDATE meta_wallets SET warrants=warrants-$1 WHERE account_id=$2', [
        Number(lot.price),
        accountId,
      ]);
      await c.query('UPDATE meta_wallets SET warrants=warrants+$1 WHERE account_id=$2', [
        net,
        lot.seller_id,
      ]);
      for (const [owner, delta, reason] of [
        [accountId, -Number(lot.price), 'purchase'],
        [lot.seller_id, net, 'sale'],
        ['system', fee, 'fee'],
      ] as const)
        await c.query(
          'INSERT INTO meta_market_ledger(id,account_id,delta,reason,listing_id,at) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), owner, delta, reason, listingId, at],
        );
      await c.query('DELETE FROM meta_market_listings WHERE id=$1', [listingId]);
      await c.query('COMMIT');
      return { ok: true, balance: balance - Number(lot.price) };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async cancel(accountId: string, listingId: string): Promise<MetaMarketResult> {
    const r = await this.pool.query(
      'DELETE FROM meta_market_listings WHERE id=$1 AND seller_id=$2',
      [listingId, accountId],
    );
    return r.rowCount === 1 ? { ok: true } : { ok: false, code: 'E_NO_LISTING' };
  }
}
