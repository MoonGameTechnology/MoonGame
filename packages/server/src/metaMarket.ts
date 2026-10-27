import { randomUUID } from 'node:crypto';
import type { ArsenalItem } from '@void/shared-core';
import type { Pool, PoolClient } from 'pg';
import type { ArsenalStore } from './store';
import type { MaterialLot, MetaMaterialListing, MetaMarketPurchase } from '@void/protocol';
export type { MetaMaterialListing, MetaMarketPurchase } from '@void/protocol';
import type { MetaEconomyStore, MetaEconomyTransaction } from './metaEconomyStore';
import { memoryEconomyLock } from './memoryEconomyLock';

export const META_MARKET_FEE = 0.08;
/**
 * Alpha-фаусет: сколько Варрантов получает кошелёк при первом обращении.
 *
 * ДЕФОЛТ 0 — выключен, и это не перестраховка. Стартовые предметы сделаны soulbound
 * именно потому, что торгуемая выдача на аккаунт превращает регистрацию в монетный
 * двор для аукциона (`arsenal.ts`, ARS-0 anti-RMT). Фаусет на ВАЛЮТУ открывает ту же
 * дверь: N регистраций → N×номинал → слив на основной аккаунт. Даже с гейтом по
 * опыту аккаунта это не источник валюты основной игры: она выдаётся за участие
 * в матчах с дневным лимитом. Фаусет разрешён только на отдельном тестовом стенде.
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

type ReservedMaterialListing = MetaMaterialListing & { reserved: MaterialLot[] };
type MarketReceipt = {
  fingerprint: string;
  result: MetaMarketResult<MetaMarketPurchase | { listing: MetaMaterialListing }>;
};

export interface MemoryMetaMarketState {
  wallets: [string, number][];
  lots: [string, MetaMarketListing][];
  materialLots: [string, ReservedMaterialListing][];
  journal: MetaMarketLedgerEntry[];
  receipts: [string, MarketReceipt][];
}

/** Reserve only earned, unbound stock. Provenance survives every split and transfer. */
function reserveMaterials(
  materials: MaterialLot[],
  materialId: string,
  quantity: number,
  listingId: string,
): MaterialLot[] | undefined {
  const eligible = materials.filter(
    (lot) =>
      lot.materialId === materialId &&
      !lot.soulbound &&
      lot.source !== 'commerce' &&
      lot.source !== 'ad',
  );
  if (eligible.reduce((sum, lot) => sum + lot.quantity, 0) < quantity) return undefined;
  const reserved: MaterialLot[] = [];
  let remaining = quantity;
  for (const lot of eligible) {
    if (!remaining) break;
    const taken = Math.min(lot.quantity, remaining);
    reserved.push({ ...lot, lotId: `${listingId}:${reserved.length}`, quantity: taken });
    lot.quantity -= taken;
    remaining -= taken;
  }
  return reserved;
}

function publicMaterialListing(lot: ReservedMaterialListing): MetaMaterialListing {
  const { reserved: _reserved, ...listing } = lot;
  return listing;
}

export interface MetaMarketLedgerEntry {
  id: string;
  accountId: string;
  delta: number;
  reason: string;
  listingId?: string;
  at: number;
}

export type MetaMarketResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : T)) | { ok: false; code: string };

const validTradeId = (tradeId: string): boolean => tradeId.length > 0 && tradeId.length <= 128;
const tradeFingerprint = (kind: 'item' | 'material', listingId: string): string =>
  JSON.stringify([kind, listingId]);

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
  buy(
    accountId: string,
    listingId: string,
    tradeId?: string,
  ): Promise<MetaMarketResult<MetaMarketPurchase>>;
  cancel(accountId: string, listingId: string): Promise<MetaMarketResult>;
  setEconomy(store: MetaEconomyStore): void;
  materialListings(): Promise<MetaMaterialListing[]>;
  listMaterials(
    accountId: string,
    login: string,
    materialId: string,
    quantity: number,
    price: number,
    requestId: string,
  ): Promise<MetaMarketResult<{ listing: MetaMaterialListing }>>;
  buyMaterial(
    accountId: string,
    listingId: string,
    tradeId: string,
  ): Promise<MetaMarketResult<MetaMarketPurchase>>;
  cancelMaterial(accountId: string, listingId: string): Promise<MetaMarketResult>;
}

/** Development adapter. Mutations share one promise tail, mirroring a DB transaction. */
export class MemoryMetaMarket implements MetaMarket {
  private readonly wallets = new Map<string, number>();
  private readonly lots = new Map<string, MetaMarketListing>();
  private readonly journal: MetaMarketLedgerEntry[] = [];
  private readonly receipts = new Map<string, MarketReceipt>();
  private readonly materialLots = new Map<string, ReservedMaterialListing>();
  private economy?: MetaEconomyStore;

  constructor(
    private readonly arsenal: ArsenalStore,
    private readonly now = (): number => Date.now(),
    private readonly faucet: number = DEFAULT_FAUCET,
  ) {}

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    return memoryEconomyLock(this.arsenal).run(fn);
  }

  setEconomy(store: MetaEconomyStore): void {
    this.economy = store;
  }

  snapshotState(): MemoryMetaMarketState {
    return structuredClone({
      wallets: [...this.wallets],
      lots: [...this.lots],
      materialLots: [...this.materialLots],
      journal: this.journal,
      receipts: [...this.receipts],
    });
  }

  restoreState(state: MemoryMetaMarketState): void {
    this.wallets.clear();
    this.lots.clear();
    this.materialLots.clear();
    this.receipts.clear();
    for (const [key, value] of state.wallets) this.wallets.set(key, value);
    for (const [key, value] of state.lots) this.lots.set(key, value);
    for (const [key, value] of state.materialLots) this.materialLots.set(key, value);
    for (const [key, value] of state.receipts) this.receipts.set(key, value);
    this.journal.splice(0, this.journal.length, ...state.journal);
  }

  async ensureWallet(accountId: string): Promise<number> {
    return this.locked(async () => {
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
    });
  }
  async creditWarrants(
    accountId: string,
    amount: number,
    reason: string,
    sourceId: string,
    at: number,
  ): Promise<number> {
    return this.locked(async () => {
      const balance = await this.ensureWallet(accountId);
      if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(balance + amount))
        throw new Error('E_BALANCE_LIMIT');
      this.wallets.set(accountId, balance + amount);
      this.journal.push({
        id: randomUUID(),
        accountId,
        delta: amount,
        reason,
        listingId: sourceId,
        at,
      });
      return balance + amount;
    });
  }

  async balance(accountId: string): Promise<number> {
    return this.ensureWallet(accountId);
  }
  async listings(): Promise<MetaMarketListing[]> {
    return this.locked(async () =>
      structuredClone(
        [...this.lots.values()].sort((a, b) => a.price - b.price || a.createdAt - b.createdAt),
      ),
    );
  }
  async history(accountId: string): Promise<MetaMarketLedgerEntry[]> {
    return this.locked(async () =>
      structuredClone(
        this.journal
          .filter((x) => x.accountId === accountId)
          .slice(-100)
          .reverse(),
      ),
    );
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
      if ([...this.lots.values()].some((x) => x.item.itemId === itemId))
        return { ok: false, code: 'E_ALREADY_LISTED' };
      if (
        [...this.lots.values(), ...this.materialLots.values()].filter(
          (x) => x.sellerId === accountId,
        ).length >= MAX_META_LISTINGS
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

  buy(
    accountId: string,
    listingId: string,
    tradeId: string = randomUUID(),
  ): Promise<MetaMarketResult<MetaMarketPurchase>> {
    const discovered = this.lots.get(listingId);
    const work = async (
      tx?: MetaEconomyTransaction,
    ): Promise<MetaMarketResult<MetaMarketPurchase>> => {
      if (!validTradeId(tradeId)) return { ok: false, code: 'E_BAD_REQUEST' };
      const receiptKey = JSON.stringify([accountId, tradeId]);
      const fingerprint = tradeFingerprint('item', listingId);
      const previous = this.receipts.get(receiptKey);
      if (previous)
        return previous.fingerprint === fingerprint
          ? (structuredClone(previous.result) as MetaMarketResult<MetaMarketPurchase>)
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      const lot = this.lots.get(listingId);
      if (!lot) return { ok: false, code: 'E_NO_LISTING' };
      if (lot.sellerId === accountId) return { ok: false, code: 'E_OWN_LISTING' };
      const balance = await this.ensureWallet(accountId);
      if (balance < lot.price) return { ok: false, code: 'E_INSUFFICIENT' };
      const fee = Math.ceil(lot.price * META_MARKET_FEE);
      const sellerNet = lot.price - fee;
      const sellerBalance = await this.ensureWallet(lot.sellerId);
      if (!Number.isSafeInteger(sellerBalance + sellerNet))
        return { ok: false, code: 'E_BALANCE_LIMIT' };
      const moved = await this.arsenal.transfer(lot.item.itemId, lot.sellerId, accountId);
      if (!moved.ok) {
        this.lots.delete(listingId);
        return { ok: false, code: moved.code };
      }
      this.wallets.set(accountId, balance - lot.price);
      this.wallets.set(lot.sellerId, sellerBalance + sellerNet);
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
      if (tx) {
        const source = tx.account(lot.sellerId).itemSources[lot.item.itemId];
        if (source) tx.account(accountId).itemSources[lot.item.itemId] = source;
        delete tx.account(lot.sellerId).itemSources[lot.item.itemId];
      }
      this.lots.delete(listingId);
      const result = { ok: true as const, balance: balance - lot.price, tradeId };
      this.receipts.set(receiptKey, { fingerprint, result });
      return structuredClone(result);
    };
    return this.economy
      ? this.economy.transaction(discovered ? [accountId, discovered.sellerId] : [accountId], work)
      : this.locked(work);
  }

  async materialListings(): Promise<MetaMaterialListing[]> {
    return this.locked(async () =>
      [...this.materialLots.values()]
        .sort((a, b) => a.price - b.price || a.createdAt - b.createdAt)
        .map(publicMaterialListing),
    );
  }

  async listMaterials(
    accountId: string,
    login: string,
    materialId: string,
    quantity: number,
    price: number,
    requestId: string,
  ): Promise<MetaMarketResult<{ listing: MetaMaterialListing }>> {
    if (!this.economy) return { ok: false, code: 'E_UNAVAILABLE' };
    if (
      !validTradeId(requestId) ||
      !materialId ||
      materialId.length > 128 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    )
      return { ok: false, code: 'E_BAD_REQUEST' };
    if (!Number.isSafeInteger(price) || price < 1) return { ok: false, code: 'E_BAD_PRICE' };
    return this.economy.transaction([accountId], async (tx) => {
      const key = JSON.stringify([accountId, requestId]);
      const fingerprint = JSON.stringify(['material-list', materialId, quantity, price]);
      const previous = this.receipts.get(key);
      if (previous)
        return previous.fingerprint === fingerprint
          ? (structuredClone(previous.result) as MetaMarketResult<{ listing: MetaMaterialListing }>)
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      if (
        [...this.lots.values(), ...this.materialLots.values()].filter(
          (lot) => lot.sellerId === accountId,
        ).length >= MAX_META_LISTINGS
      )
        return { ok: false, code: 'E_ORDER_LIMIT' };
      const account = tx.account(accountId);
      const id = randomUUID();
      const reserved = reserveMaterials(account.materials, materialId, quantity, id);
      if (!reserved) return { ok: false, code: 'E_INSUFFICIENT_MATERIALS' };
      account.materials = account.materials.filter((lot) => lot.quantity > 0);
      const listing = {
        id,
        sellerId: accountId,
        sellerLogin: login,
        materialId,
        quantity,
        price,
        createdAt: this.now(),
      };
      this.materialLots.set(id, { ...listing, reserved });
      const result = { ok: true as const, listing };
      this.receipts.set(key, { fingerprint, result });
      return structuredClone(result);
    });
  }

  async buyMaterial(
    accountId: string,
    listingId: string,
    tradeId: string,
  ): Promise<MetaMarketResult<MetaMarketPurchase>> {
    if (!this.economy) return { ok: false, code: 'E_UNAVAILABLE' };
    if (!validTradeId(tradeId)) return { ok: false, code: 'E_BAD_REQUEST' };
    const discovered = this.materialLots.get(listingId);
    return this.economy.transaction(
      discovered ? [accountId, discovered.sellerId] : [accountId],
      async (tx) => {
        const key = JSON.stringify([accountId, tradeId]);
        const fingerprint = tradeFingerprint('material', listingId);
        const previous = this.receipts.get(key);
        if (previous)
          return previous.fingerprint === fingerprint
            ? (structuredClone(previous.result) as MetaMarketResult<MetaMarketPurchase>)
            : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
        const lot = this.materialLots.get(listingId);
        if (!lot) return { ok: false, code: 'E_NO_LISTING' };
        if (lot.sellerId === accountId) return { ok: false, code: 'E_OWN_LISTING' };
        const balance = await this.ensureWallet(accountId);
        if (balance < lot.price) return { ok: false, code: 'E_INSUFFICIENT' };
        const fee = Math.ceil(lot.price * META_MARKET_FEE);
        const net = lot.price - fee;
        const sellerBalance = await this.ensureWallet(lot.sellerId);
        if (!Number.isSafeInteger(sellerBalance + net))
          return { ok: false, code: 'E_BALANCE_LIMIT' };
        tx.account(accountId).materials.push(...structuredClone(lot.reserved));
        this.wallets.set(accountId, balance - lot.price);
        this.wallets.set(lot.sellerId, sellerBalance + net);
        const at = this.now();
        this.journal.push(
          { id: randomUUID(), accountId, delta: -lot.price, reason: 'purchase', listingId, at },
          { id: randomUUID(), accountId: lot.sellerId, delta: net, reason: 'sale', listingId, at },
          { id: randomUUID(), accountId: 'system', delta: fee, reason: 'fee', listingId, at },
        );
        this.materialLots.delete(listingId);
        const result = { ok: true as const, balance: balance - lot.price, tradeId };
        this.receipts.set(key, { fingerprint, result });
        return structuredClone(result);
      },
    );
  }

  async cancelMaterial(accountId: string, listingId: string): Promise<MetaMarketResult> {
    if (!this.economy) return { ok: false, code: 'E_UNAVAILABLE' };
    return this.economy.transaction([accountId], async (tx) => {
      const lot = this.materialLots.get(listingId);
      if (!lot) return { ok: false, code: 'E_NO_LISTING' };
      if (lot.sellerId !== accountId) return { ok: false, code: 'E_FORBIDDEN' };
      tx.account(accountId).materials.push(...structuredClone(lot.reserved));
      this.materialLots.delete(listingId);
      return { ok: true };
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

type MaterialLotRow = {
  id: string;
  seller_id: string;
  seller_login: string;
  material_id: string;
  quantity: string;
  reserved: MaterialLot[];
  price: string;
  created_at: string;
};

function materialFromRow(row: MaterialLotRow): MetaMaterialListing {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerLogin: row.seller_login,
    materialId: row.material_id,
    quantity: Number(row.quantity),
    price: Number(row.price),
    createdAt: Number(row.created_at),
  };
}

export class PostgresMetaMarket implements MetaMarket {
  private economy?: MetaEconomyStore;

  setEconomy(store: MetaEconomyStore): void {
    this.economy = store;
  }
  constructor(
    private readonly pool: Pool,
    private readonly now = (): number => Date.now(),
    private readonly faucet: number = DEFAULT_FAUCET,
  ) {}
  private async transaction<T>(
    accountIds: string[],
    work: (c: PoolClient, tx?: MetaEconomyTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.economy)
      return this.economy.transaction(accountIds, async (tx) => {
        if (!tx.sql) throw new Error('E_STORAGE_MISMATCH');
        return work(tx.sql, tx);
      });
    for (let attempt = 0; ; attempt++) {
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        const result = await work(c);
        await c.query('COMMIT');
        return result;
      } catch (error) {
        await c.query('ROLLBACK').catch(() => undefined);
        // Сериализация или deadlock сняли попытку — Postgres просит её повторить. Работа трогает
        // только базу, а откат вернул базу как было, поэтому повтор безопасен (тот же приём, что
        // в `corporateTransactions.ts`). Любая другая ошибка и третий отказ уходят наверх.
        const code = (error as { code?: unknown }).code;
        if (attempt < 2 && (code === '40001' || code === '40P01')) continue;
        throw error;
      } finally {
        c.release();
      }
    }
  }

  /** Читает баланс, создавая кошелёк при первом обращении.
   *
   *  `lock` обязателен ВНУТРИ транзакции покупки: без `FOR UPDATE` строка кошелька не
   *  блокируется, и один аккаунт, покупающий два РАЗНЫХ лота одновременно, читает
   *  один и тот же баланс дважды. Лот заперт своим `FOR UPDATE`, поэтому гонка за
   *  ОДИН лот сериализуется и без этого, а гонка за разные — нет. Раньше от неё
   *  спасал только `CHECK (warrants >= 0)`: деньги не уходили в минус, но нарушение
   *  ограничения вылетало исключением и доезжало до клиента как 500 (инвариант #4).
   *  Читатели вне транзакции (`balance`, `ensureWallet`) блокировку не берут. */
  private async wallet(c: Pool | PoolClient, accountId: string, lock = false): Promise<number> {
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
    // Две ГОТОВЫЕ строки вместо интерполяции в шаблон. Значение здесь было бы
    // фиксированным литералом, но правило `no-sql-string-interpolation` (SD-1.3)
    // запрещает сам приём: как только в шаблон однажды пустили `${}`, следующая правка
    // подставит туда уже не константу. Дешевле не заводить исключение, а не
    // интерполировать вовсе.
    const r = await c.query<{ warrants: string }>(
      lock
        ? 'SELECT warrants FROM meta_wallets WHERE account_id=$1 FOR UPDATE'
        : 'SELECT warrants FROM meta_wallets WHERE account_id=$1',
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
    return this.transaction([accountId], async (c) => {
      // Лимит лотов на продавца — подзапрос count(*) в том же INSERT. Без замка
      // параллельные выставления одного продавца видят один и тот же счёт и все
      // проходят: пачка запросов выставляла больше MAX_META_LISTINGS. Транзакционный
      // advisory-замок по продавцу ставит их в очередь; чужие продавцы не ждут.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_list'), hashtext($1))", [
        accountId,
      ]);
      await c.query('SELECT item_id FROM arsenal WHERE item_id=$1 FOR UPDATE', [itemId]);
      const r = await c.query<LotRow>(
        `INSERT INTO meta_market_listings(id,seller_id,seller_login,item_id,price,created_at) SELECT $1,$2,$3,a.item_id,$4,$5 FROM arsenal a WHERE a.item_id=$6 AND a.account_id=$2 AND NOT a.soulbound AND ((SELECT count(*) FROM meta_market_listings WHERE seller_id=$2)+(SELECT count(*) FROM meta_material_listings WHERE seller_id=$2))<$7 ON CONFLICT DO NOTHING RETURNING *, (SELECT kind FROM arsenal WHERE item_id=$6), (SELECT form FROM arsenal WHERE item_id=$6), (SELECT def_id FROM arsenal WHERE item_id=$6), (SELECT grade FROM arsenal WHERE item_id=$6), (SELECT soulbound FROM arsenal WHERE item_id=$6), (SELECT durability FROM arsenal WHERE item_id=$6), (SELECT origin FROM arsenal WHERE item_id=$6), (SELECT acquired_at FROM arsenal WHERE item_id=$6)`,
        [id, accountId, login, price, at, itemId, MAX_META_LISTINGS],
      );
      if (!r.rows[0]) return { ok: false, code: 'E_NOT_TRADABLE' };
      return { ok: true, listing: fromRow(r.rows[0]) };
    });
  }
  async buy(
    accountId: string,
    listingId: string,
    tradeId: string = randomUUID(),
  ): Promise<MetaMarketResult<MetaMarketPurchase>> {
    if (!validTradeId(tradeId)) return { ok: false, code: 'E_BAD_REQUEST' };
    const fingerprint = tradeFingerprint('item', listingId);
    const discovery = await this.pool.query<{ seller_id: string }>(
      'SELECT seller_id FROM meta_market_listings WHERE id=$1',
      [listingId],
    );
    const sellerId = discovery.rows[0]?.seller_id;
    return this.transaction(sellerId ? [accountId, sellerId] : [accountId], async (c, tx) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_receipt'), hashtext($1))", [
        JSON.stringify([accountId, tradeId]),
      ]);
      const receipt = await c.query<{
        fingerprint: string;
        result: MetaMarketResult<MetaMarketPurchase>;
      }>(
        'SELECT fingerprint,result FROM meta_market_receipts WHERE account_id=$1 AND trade_id=$2',
        [accountId, tradeId],
      );
      if (receipt.rows[0]) {
        return receipt.rows[0].fingerprint === fingerprint
          ? receipt.rows[0].result
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      }
      const q = await c.query<LotRow>(
        'SELECT l.*,a.kind,a.form,a.def_id,a.grade,a.soulbound,a.durability,a.origin,a.acquired_at FROM meta_market_listings l JOIN arsenal a ON a.item_id=l.item_id WHERE l.id=$1 FOR UPDATE',
        [listingId],
      );
      const lot = q.rows[0];
      if (!lot) {
        return { ok: false, code: 'E_NO_LISTING' };
      }
      if (lot.seller_id === accountId) {
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
        return { ok: false, code: 'E_INSUFFICIENT' };
      }
      const fee = Math.ceil(Number(lot.price) * META_MARKET_FEE),
        net = Number(lot.price) - fee,
        at = this.now();
      const sellerBalance = await this.wallet(c, lot.seller_id, true);
      if (!Number.isSafeInteger(sellerBalance + net)) {
        return { ok: false, code: 'E_BALANCE_LIMIT' };
      }
      const moved = await c.query(
        'UPDATE arsenal SET account_id=$1,acquired_at=$2 WHERE item_id=$3 AND account_id=$4 AND NOT soulbound',
        [accountId, at, lot.item_id, lot.seller_id],
      );
      if (moved.rowCount !== 1) {
        // The owner transferred/consumed the item outside the market after listing.
        // Retire the stale lot in the same locked transaction so it cannot poison
        // the public book forever.
        await c.query('DELETE FROM meta_market_listings WHERE id=$1', [listingId]);
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
      if (tx) {
        const source = tx.account(lot.seller_id).itemSources[lot.item_id];
        if (source) tx.account(accountId).itemSources[lot.item_id] = source;
        delete tx.account(lot.seller_id).itemSources[lot.item_id];
      }
      await c.query('DELETE FROM meta_market_listings WHERE id=$1', [listingId]);
      const result = { ok: true as const, balance: balance - Number(lot.price), tradeId };
      await c.query(
        'INSERT INTO meta_market_receipts(account_id,trade_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',
        [accountId, tradeId, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  }
  async materialListings(): Promise<MetaMaterialListing[]> {
    const result = await this.pool.query<MaterialLotRow>(
      'SELECT id,seller_id,seller_login,material_id,quantity,price,created_at FROM meta_material_listings ORDER BY price,created_at',
    );
    return result.rows.map(materialFromRow);
  }

  private async receipt(
    c: PoolClient,
    accountId: string,
    requestId: string,
  ): Promise<MarketReceipt | undefined> {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_receipt'), hashtext($1))", [
      JSON.stringify([accountId, requestId]),
    ]);
    const result = await c.query<MarketReceipt>(
      'SELECT fingerprint,result FROM meta_market_receipts WHERE account_id=$1 AND trade_id=$2',
      [accountId, requestId],
    );
    return result.rows[0];
  }

  private async saveReceipt(
    c: PoolClient,
    accountId: string,
    requestId: string,
    fingerprint: string,
    result: MarketReceipt['result'],
  ): Promise<void> {
    await c.query(
      'INSERT INTO meta_market_receipts(account_id,trade_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',
      [accountId, requestId, fingerprint, JSON.stringify(result)],
    );
  }

  async listMaterials(
    accountId: string,
    login: string,
    materialId: string,
    quantity: number,
    price: number,
    requestId: string,
  ): Promise<MetaMarketResult<{ listing: MetaMaterialListing }>> {
    if (!this.economy) return { ok: false, code: 'E_UNAVAILABLE' };
    if (
      !validTradeId(requestId) ||
      !materialId ||
      materialId.length > 128 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    )
      return { ok: false, code: 'E_BAD_REQUEST' };
    if (!Number.isSafeInteger(price) || price < 1) return { ok: false, code: 'E_BAD_PRICE' };
    return this.economy.transaction([accountId], async (tx) => {
      const c = tx.sql;
      if (!c) throw new Error('E_STORAGE_MISMATCH');
      const fingerprint = JSON.stringify(['material-list', materialId, quantity, price]);
      const previous = await this.receipt(c, accountId, requestId);
      if (previous)
        return previous.fingerprint === fingerprint
          ? (previous.result as MetaMarketResult<{ listing: MetaMaterialListing }>)
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_list'), hashtext($1))", [
        accountId,
      ]);
      const count = await c.query<{ total: string }>(
        'SELECT (SELECT count(*) FROM meta_market_listings WHERE seller_id=$1)+(SELECT count(*) FROM meta_material_listings WHERE seller_id=$1) AS total',
        [accountId],
      );
      if (Number(count.rows[0]!.total) >= MAX_META_LISTINGS)
        return { ok: false, code: 'E_ORDER_LIMIT' };
      const account = tx.account(accountId);
      const id = randomUUID();
      const reserved = reserveMaterials(account.materials, materialId, quantity, id);
      if (!reserved) return { ok: false, code: 'E_INSUFFICIENT_MATERIALS' };
      account.materials = account.materials.filter((lot) => lot.quantity > 0);
      const listing = {
        id,
        sellerId: accountId,
        sellerLogin: login,
        materialId,
        quantity,
        price,
        createdAt: this.now(),
      };
      await c.query(
        'INSERT INTO meta_material_listings(id,seller_id,seller_login,material_id,quantity,reserved,price,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
        [
          id,
          accountId,
          login,
          materialId,
          quantity,
          JSON.stringify(reserved),
          price,
          listing.createdAt,
        ],
      );
      const result = { ok: true as const, listing };
      await this.saveReceipt(c, accountId, requestId, fingerprint, result);
      return result;
    });
  }

  async buyMaterial(
    accountId: string,
    listingId: string,
    tradeId: string,
  ): Promise<MetaMarketResult<MetaMarketPurchase>> {
    if (!this.economy) return { ok: false, code: 'E_UNAVAILABLE' };
    if (!validTradeId(tradeId)) return { ok: false, code: 'E_BAD_REQUEST' };
    const discovery = await this.pool.query<{ seller_id: string }>(
      'SELECT seller_id FROM meta_material_listings WHERE id=$1',
      [listingId],
    );
    const sellerId = discovery.rows[0]?.seller_id;
    return this.economy.transaction(sellerId ? [accountId, sellerId] : [accountId], async (tx) => {
      const c = tx.sql;
      if (!c) throw new Error('E_STORAGE_MISMATCH');
      const fingerprint = tradeFingerprint('material', listingId);
      const previous = await this.receipt(c, accountId, tradeId);
      if (previous)
        return previous.fingerprint === fingerprint
          ? (previous.result as MetaMarketResult<MetaMarketPurchase>)
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      const query = await c.query<MaterialLotRow>(
        'SELECT * FROM meta_material_listings WHERE id=$1 FOR UPDATE',
        [listingId],
      );
      const lot = query.rows[0];
      if (!lot) return { ok: false, code: 'E_NO_LISTING' };
      if (lot.seller_id === accountId) return { ok: false, code: 'E_OWN_LISTING' };
      for (const id of [accountId, lot.seller_id].sort()) await this.wallet(c, id, true);
      const balance = await this.wallet(c, accountId, true);
      const price = Number(lot.price);
      if (balance < price) return { ok: false, code: 'E_INSUFFICIENT' };
      const fee = Math.ceil(price * META_MARKET_FEE);
      const net = price - fee;
      const sellerBalance = await this.wallet(c, lot.seller_id, true);
      if (!Number.isSafeInteger(sellerBalance + net)) return { ok: false, code: 'E_BALANCE_LIMIT' };
      tx.account(accountId).materials.push(...lot.reserved);
      await c.query('UPDATE meta_wallets SET warrants=warrants-$1 WHERE account_id=$2', [
        price,
        accountId,
      ]);
      await c.query('UPDATE meta_wallets SET warrants=warrants+$1 WHERE account_id=$2', [
        net,
        lot.seller_id,
      ]);
      for (const [owner, delta, reason] of [
        [accountId, -price, 'purchase'],
        [lot.seller_id, net, 'sale'],
        ['system', fee, 'fee'],
      ] as const) {
        await c.query(
          'INSERT INTO meta_market_ledger(id,account_id,delta,reason,listing_id,at) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), owner, delta, reason, listingId, this.now()],
        );
      }
      await c.query('DELETE FROM meta_material_listings WHERE id=$1', [listingId]);
      const result = { ok: true as const, balance: balance - price, tradeId };
      await this.saveReceipt(c, accountId, tradeId, fingerprint, result);
      return result;
    });
  }

  async cancelMaterial(accountId: string, listingId: string): Promise<MetaMarketResult> {
    if (!this.economy) return { ok: false, code: 'E_UNAVAILABLE' };
    return this.economy.transaction([accountId], async (tx) => {
      const c = tx.sql;
      if (!c) throw new Error('E_STORAGE_MISMATCH');
      const query = await c.query<MaterialLotRow>(
        'SELECT * FROM meta_material_listings WHERE id=$1 FOR UPDATE',
        [listingId],
      );
      const lot = query.rows[0];
      if (!lot) return { ok: false, code: 'E_NO_LISTING' };
      if (lot.seller_id !== accountId) return { ok: false, code: 'E_FORBIDDEN' };
      tx.account(accountId).materials.push(...lot.reserved);
      await c.query('DELETE FROM meta_material_listings WHERE id=$1', [listingId]);
      return { ok: true };
    });
  }

  async cancel(accountId: string, listingId: string): Promise<MetaMarketResult> {
    const r = await this.pool.query(
      'DELETE FROM meta_market_listings WHERE id=$1 AND seller_id=$2',
      [listingId, accountId],
    );
    return r.rowCount === 1 ? { ok: true } : { ok: false, code: 'E_NO_LISTING' };
  }
}
