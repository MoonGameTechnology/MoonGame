import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ArsenalItem } from '@void/shared-core';
import type { ArsenalStore } from './store';
import type { MetaEconomyTransaction } from './metaEconomyStore';
import type { MetaMarketLedgerEntry, MetaMarketListing, MetaMarketResult } from './metaMarket';
import { moveSource, PostgresMarketBase } from './marketTx';

/**
 * Торги со ставками на аукционе хаба (макет владельца 2026-11-03, вкладка «Торги»).
 *
 * Торговый лот живёт в той же книге, что и лот по фиксированной цене: в памяти — тот же
 * `lots` у `MemoryMetaMarket` с полем `auction`, в Postgres — та же строка
 * `meta_market_listings` с `ends_at`. Поэтому без единой новой проверки предмет на торгах
 * нельзя улучшить, разобрать или выставить второй раз (`isItemListed`), а торговый лот
 * занимает место на той же полке продавца.
 *
 * Правила честности, одобренные владельцем:
 * 1. Ставка сразу списывается с кошелька и держится, пока лидирует. Перебили — сумма
 *    тут же возвращается прежнему лидеру в той же транзакции.
 * 2. Следующая ставка не меньше текущей плюс 5% (целочисленно, минимум +1).
 * 3. Ставка в последние 2 минуты переносит конец на 2 минуты от ставки: лот нельзя
 *    выхватить в последнюю секунду.
 * 4. Лот со ставками снять нельзя — покупатель уже держит деньги под него.
 * 5. Имя лидера наружу не отдаётся: видно сумму, число ставок и «вы лидируете».
 * Комиссия та же, что у продажи по цене (`META_MARKET_FEE`), и так же сгорает.
 */

export const AUCTION_HOURS: readonly number[] = [12, 24, 48];
export const BID_STEP_PERCENT = 5;
export const SNIPE_WINDOW_MS = 120_000;
const HOUR_MS = 3_600_000;

export interface AuctionLeader {
  accountId: string;
  login: string;
  amount: number;
}
export interface AuctionState {
  endsAt: number;
  buyout?: number;
  bids: number;
  leader?: AuctionLeader;
}
export type AuctionListing = MetaMarketListing & { auction: AuctionState };

/** Что видит игрок: без имени и id лидера. */
export interface AuctionLotView {
  id: string;
  sellerLogin: string;
  item: ArsenalItem;
  start: number;
  buyout?: number;
  endsAt: number;
  bids: number;
  current?: number;
  minimum: number;
  leading: boolean;
  mine: boolean;
  createdAt: number;
}

export interface AuctionSettlement {
  listingId: string;
  sellerId: string;
  sellerLogin: string;
  winner?: { accountId: string; login: string };
}

export interface BidResult {
  balance: number;
  tradeId: string;
  /** Ставка дошла до выкупа: предмет уже у покупателя. */
  won: boolean;
  /** При выкупе — продавец, чей игровой арсенал надо пересобрать. Наружу не отдаётся. */
  seller?: { accountId: string; login: string };
}

/** Минимальная следующая ставка (правило 2). */
export function minimumBid(start: number, auction: AuctionState): number {
  if (!auction.leader) return start;
  const amount = auction.leader.amount;
  return amount + Math.max(1, Math.ceil((amount * BID_STEP_PERCENT) / 100));
}

/** Конец торгов после ставки в момент `now` (правило 3). */
export function extendedEnd(endsAt: number, now: number): number {
  return endsAt - now < SNIPE_WINDOW_MS ? now + SNIPE_WINDOW_MS : endsAt;
}

export function auctionView(lot: AuctionListing, viewer: string): AuctionLotView {
  const a = lot.auction;
  return {
    id: lot.id,
    sellerLogin: lot.sellerLogin,
    item: lot.item,
    start: lot.price,
    ...(a.buyout === undefined ? {} : { buyout: a.buyout }),
    endsAt: a.endsAt,
    bids: a.bids,
    ...(a.leader ? { current: a.leader.amount } : {}),
    minimum: minimumBid(lot.price, a),
    leading: a.leader?.accountId === viewer,
    mine: lot.sellerId === viewer,
    createdAt: lot.createdAt,
  };
}

/** Проверка условий нового лота: целые цены, выкуп выше старта, длительность из списка. */
export function validAuctionTerms(
  start: number,
  buyout: number | undefined,
  hours: number,
): string | null {
  if (!Number.isSafeInteger(start) || start < 1) return 'E_BAD_PRICE';
  if (buyout !== undefined && (!Number.isSafeInteger(buyout) || buyout <= start))
    return 'E_BAD_PRICE';
  if (!AUCTION_HOURS.includes(hours)) return 'E_BAD_DURATION';
  return null;
}

export interface MetaAuctions {
  /** Идущие торги, ближайший конец первым. Просроченные сначала закрывает `settleDue`. */
  lots(): Promise<AuctionListing[]>;
  open(
    accountId: string,
    login: string,
    itemId: string,
    start: number,
    buyout: number | undefined,
    hours: number,
    limit: number,
  ): Promise<MetaMarketResult<{ listing: AuctionListing }>>;
  bid(
    accountId: string,
    login: string,
    listingId: string,
    amount: number,
    tradeId: string,
  ): Promise<MetaMarketResult<BidResult>>;
  /** Закрыть торги, чьё время вышло к `now`: предмет лидеру, выручка продавцу. */
  settleDue(): Promise<AuctionSettlement[]>;
}

const validTradeId = (tradeId: string): boolean => tradeId.length > 0 && tradeId.length <= 128;
const isAuction = (lot: MetaMarketListing | undefined): lot is AuctionListing => !!lot?.auction;

type MarketReceipt = { fingerprint: string; result: unknown };
type Journal = Omit<MetaMarketLedgerEntry, 'id'>;

/** Доступ торгов к книге, кошелькам и журналу `MemoryMetaMarket` (`auctionPort`). */
export interface MemoryAuctionPort {
  now(): number;
  feeRate: number;
  lots: Map<string, MetaMarketListing>;
  sellerLots(accountId: string): number;
  receipts: Map<string, MarketReceipt>;
  arsenal: ArsenalStore;
  wallet(accountId: string): Promise<number>;
  setWallet(accountId: string, amount: number): void;
  journal(...entries: Journal[]): void;
  locked<T>(work: () => Promise<T>): Promise<T>;
  run<T>(accounts: string[], work: (tx?: MetaEconomyTransaction) => Promise<T>): Promise<T>;
}


export class MemoryMetaAuctions implements MetaAuctions {
  constructor(private readonly p: MemoryAuctionPort) {}

  lots(): Promise<AuctionListing[]> {
    return this.p.locked(async () =>
      structuredClone(
        [...this.p.lots.values()]
          .filter(isAuction)
          .sort((a, b) => a.auction.endsAt - b.auction.endsAt || a.id.localeCompare(b.id)),
      ),
    );
  }

  open(
    accountId: string,
    login: string,
    itemId: string,
    start: number,
    buyout: number | undefined,
    hours: number,
    limit: number,
  ): Promise<MetaMarketResult<{ listing: AuctionListing }>> {
    const bad = validAuctionTerms(start, buyout, hours);
    if (bad) return Promise.resolve({ ok: false, code: bad });
    return this.p.locked(async () => {
      const item = await this.p.arsenal.get(itemId);
      if (!item || item.accountId !== accountId) return { ok: false, code: 'E_NOT_OWNER' };
      if (item.soulbound) return { ok: false, code: 'E_SOULBOUND' };
      if ([...this.p.lots.values()].some((x) => x.item.itemId === itemId))
        return { ok: false, code: 'E_ALREADY_LISTED' };
      if (this.p.sellerLots(accountId) >= limit) return { ok: false, code: 'E_ORDER_LIMIT' };
      const { accountId: _owner, preferred: _preference, ...asset } = item;
      const now = this.p.now();
      const listing: AuctionListing = {
        id: randomUUID(),
        sellerId: accountId,
        sellerLogin: login,
        item: asset,
        price: start,
        createdAt: now,
        auction: {
          endsAt: now + hours * HOUR_MS,
          bids: 0,
          ...(buyout === undefined ? {} : { buyout }),
        },
      };
      this.p.lots.set(listing.id, listing);
      return { ok: true, listing: structuredClone(listing) };
    });
  }

  bid(
    accountId: string,
    login: string,
    listingId: string,
    amount: number,
    tradeId: string,
  ): Promise<MetaMarketResult<BidResult>> {
    if (!validTradeId(tradeId)) return Promise.resolve({ ok: false, code: 'E_BAD_REQUEST' });
    if (!Number.isSafeInteger(amount) || amount < 1)
      return Promise.resolve({ ok: false, code: 'E_BAD_PRICE' });
    const discovered = this.p.lots.get(listingId);
    const accounts = discovered ? [accountId, discovered.sellerId] : [accountId];
    return this.p.run(accounts, async (tx) => {
      const key = JSON.stringify([accountId, tradeId]);
      const fingerprint = JSON.stringify(['bid', listingId, amount]);
      const previous = this.p.receipts.get(key);
      if (previous)
        return previous.fingerprint === fingerprint
          ? (structuredClone(previous.result) as MetaMarketResult<BidResult>)
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      const lot = this.p.lots.get(listingId);
      if (!isAuction(lot)) return { ok: false, code: 'E_NO_LISTING' };
      const now = this.p.now();
      if (now >= lot.auction.endsAt) return { ok: false, code: 'E_AUCTION_ENDED' };
      if (lot.sellerId === accountId) return { ok: false, code: 'E_OWN_LISTING' };
      if (lot.auction.leader?.accountId === accountId) return { ok: false, code: 'E_LEADING' };
      const buyout = lot.auction.buyout !== undefined && amount >= lot.auction.buyout;
      const pay = buyout ? lot.auction.buyout! : amount;
      if (!buyout && pay < minimumBid(lot.price, lot.auction))
        return { ok: false, code: 'E_BID_TOO_LOW' };
      const balance = await this.p.wallet(accountId);
      if (balance < pay) return { ok: false, code: 'E_INSUFFICIENT' };
      const leader = lot.auction.leader;
      if (leader) {
        const held = await this.p.wallet(leader.accountId);
        if (!Number.isSafeInteger(held + leader.amount))
          return { ok: false, code: 'E_BALANCE_LIMIT' };
        this.p.setWallet(leader.accountId, held + leader.amount);
        this.p.journal({
          accountId: leader.accountId,
          delta: leader.amount,
          reason: 'bid-refund',
          listingId,
          at: now,
        });
      }
      this.p.setWallet(accountId, balance - pay);
      this.p.journal({ accountId, delta: -pay, reason: 'bid-hold', listingId, at: now });
      if (buyout) {
        const done = await this.finish(lot, { accountId, login, amount: pay }, tx);
        if (!done) return { ok: false, code: 'E_NOT_OWNER' };
      } else
        lot.auction = {
          ...lot.auction,
          bids: lot.auction.bids + 1,
          leader: { accountId, login, amount: pay },
          endsAt: extendedEnd(lot.auction.endsAt, now),
        };
      const result = {
        ok: true as const,
        balance: balance - pay,
        tradeId,
        won: buyout,
        ...(buyout ? { seller: { accountId: lot.sellerId, login: lot.sellerLogin } } : {}),
      };
      this.p.receipts.set(key, { fingerprint, result });
      return structuredClone(result);
    });
  }

  /** Предмет победителю и выручка продавцу; деньги победителя уже держатся с его ставки.
   *  Предмета у продавца нет (передан мимо аукциона) — ставка возвращается, лот снят. */
  private async finish(
    lot: AuctionListing,
    winner: AuctionLeader,
    tx?: MetaEconomyTransaction,
  ): Promise<boolean> {
    const at = this.p.now();
    this.p.lots.delete(lot.id);
    const moved = await this.p.arsenal.transfer(lot.item.itemId, lot.sellerId, winner.accountId);
    if (!moved.ok) {
      this.p.setWallet(winner.accountId, (await this.p.wallet(winner.accountId)) + winner.amount);
      this.p.journal({
        accountId: winner.accountId,
        delta: winner.amount,
        reason: 'bid-refund',
        listingId: lot.id,
        at,
      });
      return false;
    }
    const fee = Math.ceil(winner.amount * this.p.feeRate);
    const net = winner.amount - fee;
    this.p.setWallet(lot.sellerId, (await this.p.wallet(lot.sellerId)) + net);
    this.p.journal(
      { accountId: lot.sellerId, delta: net, reason: 'sale', listingId: lot.id, at },
      { accountId: 'system', delta: fee, reason: 'fee', listingId: lot.id, at },
    );
    moveSource(tx, lot.item.itemId, lot.sellerId, winner.accountId);
    return true;
  }

  async settleDue(): Promise<AuctionSettlement[]> {
    const now = this.p.now();
    const due = [...this.p.lots.values()].filter(
      (l): l is AuctionListing => isAuction(l) && l.auction.endsAt <= now,
    );
    const settled: AuctionSettlement[] = [];
    for (const found of due) {
      const accounts = [
        found.sellerId,
        ...(found.auction.leader ? [found.auction.leader.accountId] : []),
      ];
      const done = await this.p.run(accounts, async (tx) => {
        const lot = this.p.lots.get(found.id);
        if (!isAuction(lot) || lot.auction.endsAt > this.p.now()) return null;
        const leader = lot.auction.leader;
        if (!leader) {
          this.p.lots.delete(lot.id);
          return { listingId: lot.id, sellerId: lot.sellerId, sellerLogin: lot.sellerLogin };
        }
        const ok = await this.finish(lot, leader, tx);
        return {
          listingId: lot.id,
          sellerId: lot.sellerId,
          sellerLogin: lot.sellerLogin,
          ...(ok ? { winner: { accountId: leader.accountId, login: leader.login } } : {}),
        };
      });
      if (done) settled.push(done);
    }
    return settled;
  }
}

type AuctionRow = {
  id: string;
  seller_id: string;
  seller_login: string;
  item_id: string;
  price: string;
  created_at: string;
  ends_at: string;
  buyout: string | null;
  bids: number;
  bid_account: string | null;
  bid_login: string | null;
  bid_amount: string | null;
  kind: ArsenalItem['kind'];
  form: ArsenalItem['form'];
  def_id: string;
  grade: number | null;
  progression: Pick<ArsenalItem, 'rarity' | 'upgrade'>;
  soulbound: boolean;
  durability: number | null;
  origin: ArsenalItem['origin'];
  acquired_at: string;
};
const AUCTION_SELECT =
  'SELECT l.*,a.kind,a.form,a.def_id,a.grade,a.soulbound,a.durability,a.origin,a.acquired_at,a.progression FROM meta_market_listings l JOIN arsenal a ON a.item_id=l.item_id';
// Готовые запросы: значения идут только параметрами $n.
const AUCTION_LOTS = AUCTION_SELECT + ' WHERE l.ends_at IS NOT NULL ORDER BY l.ends_at,l.id';
const AUCTION_BY_ID = AUCTION_SELECT + ' WHERE l.id=$1';
const AUCTION_LOCK = AUCTION_SELECT + ' WHERE l.id=$1 AND l.ends_at IS NOT NULL FOR UPDATE OF l';

const fromAuctionRow = (r: AuctionRow): AuctionListing => ({
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
    ...(r.progression?.rarity ? { rarity: r.progression.rarity } : {}),
    ...(r.progression?.upgrade ? { upgrade: r.progression.upgrade } : {}),
  },
  auction: {
    endsAt: Number(r.ends_at),
    bids: r.bids,
    ...(r.buyout === null ? {} : { buyout: Number(r.buyout) }),
    ...(r.bid_account && r.bid_amount !== null
      ? {
          leader: {
            accountId: r.bid_account,
            login: r.bid_login ?? '',
            amount: Number(r.bid_amount),
          },
        }
      : {}),
  },
});

/**
 * Postgres: каждая операция — одна транзакция `MetaEconomyStore` (как покупка лота).
 * Лот запирается `FOR UPDATE`, кошельки — по возрастанию `account_id`, тот же порядок,
 * что у `PostgresMetaMarket.buy`, поэтому встречные сделки не ловят дедлок.
 */
export class PostgresMetaAuctions extends PostgresMarketBase implements MetaAuctions {
  async lots(): Promise<AuctionListing[]> {
    const r = await this.pool.query<AuctionRow>(AUCTION_LOTS);
    return r.rows.map(fromAuctionRow);
  }

  async open(
    accountId: string,
    login: string,
    itemId: string,
    start: number,
    buyout: number | undefined,
    hours: number,
    limit: number,
  ): Promise<MetaMarketResult<{ listing: AuctionListing }>> {
    const bad = validAuctionTerms(start, buyout, hours);
    if (bad) return { ok: false, code: bad };
    const id = randomUUID();
    const at = this.now();
    return this.transaction([accountId], async (c) => {
      // Тот же замок продавца, что у `PostgresMetaMarket.list`: полка общая.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_list'), hashtext($1))", [
        accountId,
      ]);
      await c.query('SELECT item_id FROM arsenal WHERE item_id=$1 FOR UPDATE', [itemId]);
      const r = await c.query<{ id: string }>(
        `INSERT INTO meta_market_listings(id,seller_id,seller_login,item_id,price,created_at,ends_at,buyout,bids)
         SELECT $1,$2,$3,a.item_id,$4,$5,$6,$7,0 FROM arsenal a WHERE a.item_id=$8 AND a.account_id=$2 AND NOT a.soulbound
         AND ((SELECT count(*) FROM meta_market_listings WHERE seller_id=$2)+(SELECT count(*) FROM meta_material_listings WHERE seller_id=$2))<$9
         ON CONFLICT DO NOTHING RETURNING id`,
        [id, accountId, login, start, at, at + hours * HOUR_MS, buyout ?? null, itemId, limit],
      );
      if (!r.rows[0]) return { ok: false, code: 'E_NOT_TRADABLE' };
      const row = await c.query<AuctionRow>(AUCTION_BY_ID, [id]);
      return { ok: true, listing: fromAuctionRow(row.rows[0]!) };
    });
  }

  async bid(
    accountId: string,
    login: string,
    listingId: string,
    amount: number,
    tradeId: string,
  ): Promise<MetaMarketResult<BidResult>> {
    if (!validTradeId(tradeId)) return { ok: false, code: 'E_BAD_REQUEST' };
    if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, code: 'E_BAD_PRICE' };
    const found = await this.pool.query<{ seller_id: string }>(
      'SELECT seller_id FROM meta_market_listings WHERE id=$1',
      [listingId],
    );
    const sellerId = found.rows[0]?.seller_id;
    return this.transaction(sellerId ? [accountId, sellerId] : [accountId], async (c, tx) => {
      const fingerprint = JSON.stringify(['bid', listingId, amount]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('meta_market_receipt'), hashtext($1))", [
        JSON.stringify([accountId, tradeId]),
      ]);
      const receipt = await c.query<{ fingerprint: string; result: MetaMarketResult<BidResult> }>(
        'SELECT fingerprint,result FROM meta_market_receipts WHERE account_id=$1 AND trade_id=$2',
        [accountId, tradeId],
      );
      if (receipt.rows[0])
        return receipt.rows[0].fingerprint === fingerprint
          ? receipt.rows[0].result
          : { ok: false, code: 'E_IDEMPOTENCY_CONFLICT' };
      const q = await c.query<AuctionRow>(AUCTION_LOCK, [listingId]);
      if (!q.rows[0]) return { ok: false, code: 'E_NO_LISTING' };
      const lot = fromAuctionRow(q.rows[0]);
      const now = this.now();
      if (now >= lot.auction.endsAt) return { ok: false, code: 'E_AUCTION_ENDED' };
      if (lot.sellerId === accountId) return { ok: false, code: 'E_OWN_LISTING' };
      const leader = lot.auction.leader;
      if (leader?.accountId === accountId) return { ok: false, code: 'E_LEADING' };
      const buyout = lot.auction.buyout !== undefined && amount >= lot.auction.buyout;
      const pay = buyout ? lot.auction.buyout! : amount;
      if (!buyout && pay < minimumBid(lot.price, lot.auction))
        return { ok: false, code: 'E_BID_TOO_LOW' };
      const wallets = await this.lockWallets(c, [
        accountId,
        lot.sellerId,
        ...(leader ? [leader.accountId] : []),
      ]);
      const balance = wallets.get(accountId)!;
      if (balance < pay) return { ok: false, code: 'E_INSUFFICIENT' };
      if (leader) await this.move(c, leader.accountId, leader.amount, 'bid-refund', listingId, now);
      await this.move(c, accountId, -pay, 'bid-hold', listingId, now);
      if (buyout) {
        const done = await this.finish(c, tx, lot, { accountId, login, amount: pay });
        if (!done) return { ok: false, code: 'E_NOT_OWNER' };
      } else
        await c.query(
          'UPDATE meta_market_listings SET bids=bids+1,bid_account=$2,bid_login=$3,bid_amount=$4,ends_at=$5 WHERE id=$1',
          [listingId, accountId, login, pay, extendedEnd(lot.auction.endsAt, now)],
        );
      const result = {
        ok: true as const,
        balance: balance - pay,
        tradeId,
        won: buyout,
        ...(buyout ? { seller: { accountId: lot.sellerId, login: lot.sellerLogin } } : {}),
      };
      await c.query(
        'INSERT INTO meta_market_receipts(account_id,trade_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',
        [accountId, tradeId, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  }

  private async finish(
    c: PoolClient,
    tx: MetaEconomyTransaction,
    lot: AuctionListing,
    winner: AuctionLeader,
  ): Promise<boolean> {
    const at = this.now();
    await c.query('DELETE FROM meta_market_listings WHERE id=$1', [lot.id]);
    const moved = await c.query(
      "UPDATE arsenal SET account_id=$1,acquired_at=$2,progression=progression-'preferred' WHERE item_id=$3 AND account_id=$4 AND NOT soulbound",
      [winner.accountId, at, lot.item.itemId, lot.sellerId],
    );
    if (moved.rowCount !== 1) {
      await this.move(c, winner.accountId, winner.amount, 'bid-refund', lot.id, at);
      return false;
    }
    const fee = Math.ceil(winner.amount * this.feeRate);
    await this.move(c, lot.sellerId, winner.amount - fee, 'sale', lot.id, at);
    await this.ledger(c, 'system', fee, 'fee', lot.id, at);
    moveSource(tx, lot.item.itemId, lot.sellerId, winner.accountId);
    return true;
  }

  async settleDue(): Promise<AuctionSettlement[]> {
    const due = await this.pool.query<{
      id: string;
      seller_id: string;
      bid_account: string | null;
    }>(
      'SELECT id,seller_id,bid_account FROM meta_market_listings WHERE ends_at IS NOT NULL AND ends_at<=$1 ORDER BY ends_at LIMIT 100',
      [this.now()],
    );
    const settled: AuctionSettlement[] = [];
    for (const found of due.rows) {
      const accounts = [found.seller_id, ...(found.bid_account ? [found.bid_account] : [])];
      const done = await this.transaction(accounts, async (c, tx) => {
        const q = await c.query<AuctionRow>(AUCTION_LOCK, [found.id]);
        if (!q.rows[0]) return null;
        const lot = fromAuctionRow(q.rows[0]);
        if (lot.auction.endsAt > this.now()) return null;
        const leader = lot.auction.leader;
        const base = { listingId: lot.id, sellerId: lot.sellerId, sellerLogin: lot.sellerLogin };
        if (!leader) {
          await c.query('DELETE FROM meta_market_listings WHERE id=$1', [lot.id]);
          return base;
        }
        await this.lockWallets(c, [lot.sellerId, leader.accountId]);
        const ok = await this.finish(c, tx, lot, leader);
        return ok
          ? { ...base, winner: { accountId: leader.accountId, login: leader.login } }
          : base;
      });
      if (done) settled.push(done);
    }
    return settled;
  }
}
