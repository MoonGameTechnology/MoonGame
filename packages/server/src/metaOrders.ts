import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { MetaEconomyTransaction } from './metaEconomyStore';
import type { MetaMarketListing, MetaMarketResult } from './metaMarket';
import type { MemoryAuctionPort } from './metaAuction';
import { moveSource, PostgresMarketBase } from './marketTx';

/**
 * Заказы на покупку (макет владельца 2026-11-03, «Оставить заказ»): игрок называет тип
 * предмета, цену за штуку и число штук, и заказ сам выкупает первое подходящее
 * предложение по фиксированной цене.
 *
 * Правила честности, одобренные владельцем:
 * 1. Заказ сразу замораживает `цена × штук` варрантов; отмена возвращает остаток.
 * 2. Не больше `MAX_BUY_ORDERS` открытых заказов на игрока.
 * 3. Лот дешевле заказа покупается по цене лота, разница тут же возвращается.
 * 4. Свой лот заказ не покупает; торговый лот (со ставками) — тоже: у него свой исход.
 * Комиссия та же, что у обычной продажи (`META_MARKET_FEE`), и так же сгорает.
 *
 * Тип — ключ `kind:form:defId` (как плитка «Купить» в `prototype/src/marketParts.ts`):
 * заказ на «Ионный двигатель» берёт любую продаваемую копию этого модуля.
 */

export const MAX_BUY_ORDERS = 10;
export const MAX_ORDER_QUANTITY = 10;
const ORDER_KEY = /^(module|hull):(instance|blueprint):[a-z0-9_]{1,64}$/;

export interface BuyOrder {
  id: string;
  accountId: string;
  login: string;
  key: string;
  price: number;
  quantity: number;
  filled: number;
  createdAt: number;
}

/** Исполненная штука заказа: обеим сторонам пересобрать игровой арсенал. */
export interface OrderFill {
  orderId: string;
  listingId: string;
  buyer: { accountId: string; login: string };
  seller: { accountId: string; login: string };
}

export interface OrderPlaced {
  order: BuyOrder;
  balance: number;
  fills: OrderFill[];
}

export interface MetaOrders {
  /** Открытые заказы игрока, новые сверху. */
  mine(accountId: string): Promise<BuyOrder[]>;
  place(
    accountId: string,
    login: string,
    key: string,
    price: number,
    quantity: number,
    requestId: string,
  ): Promise<MetaMarketResult<OrderPlaced>>;
  cancel(accountId: string, orderId: string): Promise<MetaMarketResult<{ balance: number }>>;
  /** Только что выставленный лот по цене: выкупить лучшим заказом, если он есть. */
  matchListing(listingId: string): Promise<OrderFill | null>;
}

export const listingKey = (lot: Pick<MetaMarketListing, 'item'>): string =>
  `${lot.item.kind}:${lot.item.form}:${lot.item.defId}`;

export function validOrderTerms(key: string, price: number, quantity: number): string | null {
  if (!ORDER_KEY.test(key)) return 'E_BAD_REQUEST';
  if (!Number.isSafeInteger(price) || price < 1) return 'E_BAD_PRICE';
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY)
    return 'E_BAD_QUANTITY';
  if (!Number.isSafeInteger(price * quantity)) return 'E_BAD_PRICE';
  return null;
}

const validRequestId = (id: string): boolean => id.length > 0 && id.length <= 128;
const remaining = (o: BuyOrder): number => o.quantity - o.filled;
/** Лучший заказ — дороже, при равной цене — раньше. */
const byBest = (a: BuyOrder, b: BuyOrder): number =>
  b.price - a.price || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
/** Лучший лот для заказа — дешевле, при равной цене — раньше. */
const byCheapest = (a: MetaMarketListing, b: MetaMarketListing): number =>
  a.price - b.price || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
const fillOf = (order: BuyOrder, lot: MetaMarketListing): OrderFill => ({
  orderId: order.id,
  listingId: lot.id,
  buyer: { accountId: order.accountId, login: order.login },
  seller: { accountId: lot.sellerId, login: lot.sellerLogin },
});

export class MemoryMetaOrders implements MetaOrders {
  constructor(
    private readonly p: MemoryAuctionPort,
    private readonly orders: Map<string, BuyOrder>,
  ) {}

  mine(accountId: string): Promise<BuyOrder[]> {
    return this.p.locked(async () =>
      structuredClone(
        [...this.orders.values()]
          .filter((o) => o.accountId === accountId)
          .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
      ),
    );
  }

  place(
    accountId: string,
    login: string,
    key: string,
    price: number,
    quantity: number,
    requestId: string,
  ): Promise<MetaMarketResult<OrderPlaced>> {
    const bad = validOrderTerms(key, price, quantity);
    if (bad) return Promise.resolve({ ok: false, code: bad });
    if (!validRequestId(requestId)) return Promise.resolve({ ok: false, code: 'E_BAD_REQUEST' });
    const sellers = [...this.p.lots.values()]
      .filter((l) => listingKey(l) === key)
      .map((l) => l.sellerId);
    return this.p.run([accountId, ...sellers], async (tx) => {
      const receiptKey = JSON.stringify([accountId, requestId]);
      const fingerprint = JSON.stringify(['order', key, price, quantity]);
      const previous = this.p.receipts.get(receiptKey);
      if (previous)
        return previous.fingerprint === fingerprint
          ? (structuredClone(previous.result) as MetaMarketResult<OrderPlaced>)
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      const open = [...this.orders.values()].filter((o) => o.accountId === accountId).length;
      if (open >= MAX_BUY_ORDERS) return { ok: false, code: 'E_BUY_ORDER_LIMIT' };
      const total = price * quantity;
      const balance = await this.p.wallet(accountId);
      if (balance < total) return { ok: false, code: 'E_INSUFFICIENT' };
      const at = this.p.now();
      const order: BuyOrder = {
        id: randomUUID(),
        accountId,
        login,
        key,
        price,
        quantity,
        filled: 0,
        createdAt: at,
      };
      this.p.setWallet(accountId, balance - total);
      this.p.journal({ accountId, delta: -total, reason: 'order-hold', listingId: order.id, at });
      this.orders.set(order.id, order);
      const fills: OrderFill[] = [];
      const offers = [...this.p.lots.values()]
        .filter((l) => !l.auction && listingKey(l) === key && l.price <= price)
        .filter((l) => l.sellerId !== accountId)
        .sort(byCheapest);
      for (const lot of offers) {
        if (!this.orders.has(order.id)) break;
        if (await this.fill(order, lot, tx)) fills.push(fillOf(order, lot));
      }
      const result = {
        ok: true as const,
        order: structuredClone(order),
        balance: await this.p.wallet(accountId),
        fills,
      };
      this.p.receipts.set(receiptKey, { fingerprint, result });
      return structuredClone(result);
    });
  }

  cancel(accountId: string, orderId: string): Promise<MetaMarketResult<{ balance: number }>> {
    return this.p.run([accountId], async () => {
      const order = this.orders.get(orderId);
      if (!order) return { ok: false, code: 'E_NO_BUY_ORDER' };
      if (order.accountId !== accountId) return { ok: false, code: 'E_FORBIDDEN' };
      this.orders.delete(orderId);
      const back = order.price * remaining(order);
      const balance = (await this.p.wallet(accountId)) + back;
      this.p.setWallet(accountId, balance);
      this.p.journal({
        accountId,
        delta: back,
        reason: 'order-refund',
        listingId: orderId,
        at: this.p.now(),
      });
      return { ok: true, balance };
    });
  }

  matchListing(listingId: string): Promise<OrderFill | null> {
    const found = this.p.lots.get(listingId);
    if (!found || found.auction) return Promise.resolve(null);
    const buyers = [...this.orders.values()]
      .filter((o) => o.key === listingKey(found))
      .map((o) => o.accountId);
    return this.p.run([found.sellerId, ...buyers], async (tx) => {
      const lot = this.p.lots.get(listingId);
      if (!lot || lot.auction) return null;
      const order = [...this.orders.values()]
        .filter((o) => o.key === listingKey(lot) && o.price >= lot.price)
        .filter((o) => o.accountId !== lot.sellerId)
        .sort(byBest)[0];
      if (!order) return null;
      return (await this.fill(order, lot, tx)) ? fillOf(order, lot) : null;
    });
  }

  /** Одна штука заказа за этот лот. Предмета у продавца уже нет — лот снят, заказ цел. */
  private async fill(
    order: BuyOrder,
    lot: MetaMarketListing,
    tx?: MetaEconomyTransaction,
  ): Promise<boolean> {
    const at = this.p.now();
    this.p.lots.delete(lot.id);
    const moved = await this.p.arsenal.transfer(lot.item.itemId, lot.sellerId, order.accountId);
    if (!moved.ok) return false;
    const fee = Math.ceil(lot.price * this.p.feeRate);
    const net = lot.price - fee;
    const change = order.price - lot.price;
    this.p.setWallet(lot.sellerId, (await this.p.wallet(lot.sellerId)) + net);
    if (change > 0)
      this.p.setWallet(order.accountId, (await this.p.wallet(order.accountId)) + change);
    this.p.journal(
      { accountId: lot.sellerId, delta: net, reason: 'sale', listingId: lot.id, at },
      { accountId: 'system', delta: fee, reason: 'fee', listingId: lot.id, at },
      ...(change > 0
        ? [
            {
              accountId: order.accountId,
              delta: change,
              reason: 'order-refund',
              listingId: lot.id,
              at,
            },
          ]
        : []),
    );
    moveSource(tx, lot.item.itemId, lot.sellerId, order.accountId);
    order.filled += 1;
    if (remaining(order) <= 0) this.orders.delete(order.id);
    return true;
  }
}

type OrderRow = {
  id: string;
  account_id: string;
  login: string;
  key: string;
  price: string;
  quantity: number;
  filled: number;
  created_at: string;
};
type LotRow = {
  id: string;
  seller_id: string;
  seller_login: string;
  item_id: string;
  price: string;
};

const fromOrderRow = (r: OrderRow): BuyOrder => ({
  id: r.id,
  accountId: r.account_id,
  login: r.login,
  key: r.key,
  price: Number(r.price),
  quantity: r.quantity,
  filled: r.filled,
  createdAt: Number(r.created_at),
});

const ORDER_COLS = 'id,account_id,login,key,price,quantity,filled,created_at';
const ORDERS_OF =
  'SELECT ' +
  ORDER_COLS +
  ' FROM meta_market_orders WHERE account_id=$1 ORDER BY created_at DESC,id';
const ORDER_LOCK = 'SELECT ' + ORDER_COLS + ' FROM meta_market_orders WHERE id=$1 FOR UPDATE';
// Лоты по цене (ends_at IS NULL) нужного типа: ключ — kind:form:def_id предмета.
const OFFER_SELECT =
  "SELECT l.id,l.seller_id,l.seller_login,l.item_id,l.price FROM meta_market_listings l JOIN arsenal a ON a.item_id=l.item_id WHERE l.ends_at IS NULL AND a.kind||':'||a.form||':'||a.def_id=$1";
const OFFERS_FOR =
  OFFER_SELECT + ' AND l.price<=$2 AND l.seller_id<>$3 ORDER BY l.price,l.created_at,l.id';
const OFFER_LOCK = OFFER_SELECT + ' AND l.id=$2 FOR UPDATE OF l';
const BEST_ORDER =
  'SELECT ' +
  ORDER_COLS +
  ' FROM meta_market_orders WHERE key=$1 AND price>=$2 AND account_id<>$3 ORDER BY price DESC,created_at,id LIMIT 1';

/** Подходящий лот выставил продавец вне области транзакции: повторить с ним. */
class ScopeGrew extends Error {
  constructor(readonly sellers: string[]) {
    super('E_ORDER_SCOPE');
  }
}
const ORDER_GONE = Symbol('order-gone');

/** Postgres: заказ, его исполнения и возвраты — в одной транзакции с кошельками. */
export class PostgresMetaOrders extends PostgresMarketBase implements MetaOrders {
  async mine(accountId: string): Promise<BuyOrder[]> {
    const r = await this.pool.query<OrderRow>(ORDERS_OF, [accountId]);
    return r.rows.map(fromOrderRow);
  }

  async place(
    accountId: string,
    login: string,
    key: string,
    price: number,
    quantity: number,
    requestId: string,
  ): Promise<MetaMarketResult<OrderPlaced>> {
    const bad = validOrderTerms(key, price, quantity);
    if (bad) return { ok: false, code: bad };
    if (!validRequestId(requestId)) return { ok: false, code: 'E_BAD_REQUEST' };
    const seen = await this.pool.query<{ seller_id: string }>(OFFERS_FOR, [key, price, accountId]);
    const scope = new Set(seen.rows.map((r) => r.seller_id));
    // Продавец мог выставить подходящий лот между чтением и транзакцией: тогда область
    // транзакции расширяется и она повторяется. Лот не пропускается: его `matchListing`
    // мог уже отработать, не увидев незакоммиченный заказ. Не сошлось за 5 попыток —
    // отказ, транзакция откачена, ничего не заморожено.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.placeOnce(accountId, login, key, price, quantity, requestId, scope);
      } catch (e) {
        if (!(e instanceof ScopeGrew)) throw e;
        for (const seller of e.sellers) scope.add(seller);
      }
    }
    return { ok: false, code: 'E_UNAVAILABLE' };
  }

  private placeOnce(
    accountId: string,
    login: string,
    key: string,
    price: number,
    quantity: number,
    requestId: string,
    scope: ReadonlySet<string>,
  ): Promise<MetaMarketResult<OrderPlaced>> {
    const sellers = [...scope];
    return this.transaction([accountId, ...sellers], async (c, tx) => {
      const fingerprint = JSON.stringify(['order', key, price, quantity]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_receipt'), hashtext($1))", [
        JSON.stringify([accountId, requestId]),
      ]);
      const receipt = await c.query<{ fingerprint: string; result: MetaMarketResult<OrderPlaced> }>(
        'SELECT fingerprint,result FROM meta_market_receipts WHERE account_id=$1 AND trade_id=$2',
        [accountId, requestId],
      );
      if (receipt.rows[0])
        return receipt.rows[0].fingerprint === fingerprint
          ? receipt.rows[0].result
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      // Лимит заказов под замком игрока: два параллельных заказа не обойдут его.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_order'), hashtext($1))", [
        accountId,
      ]);
      const open = await c.query<{ n: string }>(
        'SELECT count(*) AS n FROM meta_market_orders WHERE account_id=$1',
        [accountId],
      );
      if (Number(open.rows[0]!.n) >= MAX_BUY_ORDERS)
        return { ok: false, code: 'E_BUY_ORDER_LIMIT' };
      const wallets = await this.lockWallets(c, [accountId, ...sellers]);
      const total = price * quantity;
      if (wallets.get(accountId)! < total) return { ok: false, code: 'E_INSUFFICIENT' };
      const at = this.now();
      const order: BuyOrder = {
        id: randomUUID(),
        accountId,
        login,
        key,
        price,
        quantity,
        filled: 0,
        createdAt: at,
      };
      await c.query(
        'INSERT INTO meta_market_orders(id,account_id,login,key,price,quantity,filled,created_at) VALUES($1,$2,$3,$4,$5,$6,0,$7)',
        [order.id, accountId, login, key, price, quantity, at],
      );
      await this.move(c, accountId, -total, 'order-hold', order.id, at);
      const fills: OrderFill[] = [];
      const offers = await c.query<LotRow>(OFFERS_FOR, [key, price, accountId]);
      const outside = offers.rows.filter((r) => !scope.has(r.seller_id)).map((r) => r.seller_id);
      if (outside.length) throw new ScopeGrew(outside);
      for (const row of offers.rows) {
        if (order.filled >= quantity) break;
        const fill = await this.fill(c, tx, order, row);
        if (fill) fills.push(fill);
      }
      const balance = await c.query<{ warrants: string }>(
        'SELECT warrants FROM meta_wallets WHERE account_id=$1',
        [accountId],
      );
      const result = {
        ok: true as const,
        order,
        balance: Number(balance.rows[0]!.warrants),
        fills,
      };
      await c.query(
        'INSERT INTO meta_market_receipts(account_id,trade_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',
        [accountId, requestId, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  }

  cancel(accountId: string, orderId: string): Promise<MetaMarketResult<{ balance: number }>> {
    return this.transaction([accountId], async (c) => {
      const q = await c.query<OrderRow>(ORDER_LOCK, [orderId]);
      const row = q.rows[0];
      if (!row) return { ok: false, code: 'E_NO_BUY_ORDER' };
      if (row.account_id !== accountId) return { ok: false, code: 'E_FORBIDDEN' };
      const order = fromOrderRow(row);
      const wallets = await this.lockWallets(c, [accountId]);
      await c.query('DELETE FROM meta_market_orders WHERE id=$1', [orderId]);
      const back = order.price * remaining(order);
      await this.move(c, accountId, back, 'order-refund', orderId, this.now());
      return { ok: true, balance: wallets.get(accountId)! + back };
    });
  }

  async matchListing(listingId: string): Promise<OrderFill | null> {
    const lot = await this.pool.query<LotRow & { key: string }>(
      "SELECT l.id,l.seller_id,l.seller_login,l.item_id,l.price,a.kind||':'||a.form||':'||a.def_id AS key FROM meta_market_listings l JOIN arsenal a ON a.item_id=l.item_id WHERE l.id=$1 AND l.ends_at IS NULL",
      [listingId],
    );
    const found = lot.rows[0];
    if (!found) return null;
    // Лучший заказ мог исполниться параллельным лотом между выбором и блокировкой —
    // тогда выбираем следующий, а не оставляем лот и чужую заморозку висеть.
    for (let attempt = 0; attempt < 3; attempt++) {
      const best = await this.pool.query<OrderRow>(BEST_ORDER, [
        found.key,
        Number(found.price),
        found.seller_id,
      ]);
      const candidate = best.rows[0];
      if (!candidate) return null;
      const result = await this.fillCandidate(listingId, found.seller_id, candidate);
      if (result !== ORDER_GONE) return result;
    }
    return null;
  }

  private fillCandidate(
    listingId: string,
    sellerId: string,
    candidate: OrderRow,
  ): Promise<OrderFill | null | typeof ORDER_GONE> {
    return this.transaction([sellerId, candidate.account_id], async (c, tx) => {
      const locked = await c.query<OrderRow>(ORDER_LOCK, [candidate.id]);
      if (!locked.rows[0]) return ORDER_GONE;
      const order = fromOrderRow(locked.rows[0]);
      const offer = await c.query<LotRow>(OFFER_LOCK, [order.key, listingId]);
      const row = offer.rows[0];
      if (!row || Number(row.price) > order.price || row.seller_id === order.accountId) return null;
      await this.lockWallets(c, [row.seller_id, order.accountId]);
      return this.fill(c, tx, order, row);
    });
  }

  /** Одна штука заказа за этот лот: кошельки обеих сторон уже заперты вызывающим. */
  private async fill(
    c: PoolClient,
    tx: MetaEconomyTransaction,
    order: BuyOrder,
    row: LotRow,
  ): Promise<OrderFill | null> {
    const at = this.now();
    const price = Number(row.price);
    const removed = await c.query(
      'DELETE FROM meta_market_listings WHERE id=$1 AND ends_at IS NULL',
      [row.id],
    );
    if (removed.rowCount !== 1) return null;
    const moved = await c.query(
      "UPDATE arsenal SET account_id=$1,acquired_at=$2,progression=progression-'preferred' WHERE item_id=$3 AND account_id=$4 AND NOT soulbound",
      [order.accountId, at, row.item_id, row.seller_id],
    );
    // Предмет ушёл мимо рынка после выставления: устаревший лот снят, заказ цел.
    if (moved.rowCount !== 1) return null;
    const fee = Math.ceil(price * this.feeRate);
    await this.move(c, row.seller_id, price - fee, 'sale', row.id, at);
    await this.ledger(c, 'system', fee, 'fee', row.id, at);
    if (order.price > price)
      await this.move(c, order.accountId, order.price - price, 'order-refund', row.id, at);
    moveSource(tx, row.item_id, row.seller_id, order.accountId);
    order.filled += 1;
    if (remaining(order) <= 0)
      await c.query('DELETE FROM meta_market_orders WHERE id=$1', [order.id]);
    else
      await c.query('UPDATE meta_market_orders SET filled=$2 WHERE id=$1', [
        order.id,
        order.filled,
      ]);
    return {
      orderId: order.id,
      listingId: row.id,
      buyer: { accountId: order.accountId, login: order.login },
      seller: { accountId: row.seller_id, login: row.seller_login },
    };
  }
}
