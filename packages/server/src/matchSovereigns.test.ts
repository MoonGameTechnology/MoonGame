import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchSovereignLedger, type MatchQuote } from './matchSovereigns';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore, type MetaEconomyStore } from './metaEconomyStore';
import { MemoryMetaMarket } from './metaMarket';
import { MemoryArsenalStore, MemoryDropStore, migrate } from './store';

/** TEC-3.1: ◆ for an order inside a match — debit under a receipt, settle once. Runs on
 *  both stores; the Postgres one only where `DATABASE_URL` is set (CI). */
const databaseUrl = process.env.DATABASE_URL;
const pools: pg.Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

type Backend = 'memory' | 'postgres';

async function storeFor(backend: Backend): Promise<MetaEconomyStore> {
  if (backend === 'postgres') {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    pools.push(pool);
    await migrate(pool);
    return new PostgresMetaEconomyStore(pool);
  }
  const arsenal = new MemoryArsenalStore();
  return new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), new MemoryMetaMarket(arsenal, () => 0));
}

/** Fresh account ids per test: a Postgres database outlives a single test. */
async function fixture(backend: Backend, balance = 100) {
  const store = await storeFor(backend);
  const run = randomUUID();
  const acc = `acc-${run}`;
  const other = `other-${run}`;
  const fund = (id: string, amount: number) =>
    store.transaction([id], async (tx) => {
      tx.account(id).sovereigns = amount;
    });
  await fund(acc, balance);
  const balanceOf = async (id = acc) => (await store.read(id)).sovereigns ?? 0;
  return { ledger: new MatchSovereignLedger(store), fund, balanceOf, acc, other };
}

const order = { kind: 'construction', seq: 7, hours: 2 };
const priced = (amount: number) => () => ({ ok: true, amount }) as MatchQuote;

for (const backend of ['memory', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !databaseUrl)(`match Sovereign ledger (TEC-3.1) — ${backend}`, () => {
    it('debits once: a retry with the same request returns the first amount', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      expect(await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) })).toEqual({ ok: true, amount: 22 });
      let quoted = false;
      const retry = await ledger.spend(acc, {
        matchId: 'm',
        requestId: 'r1',
        order,
        quote: () => {
          quoted = true;
          return { ok: true, amount: 30 };
        },
      });
      expect(retry).toEqual({ ok: true, amount: 22 });
      expect(quoted).toBe(false);
      expect(await balanceOf()).toBe(78);
    });

    it('the same request with another order is a conflict and debits nothing', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) });
      const other = await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order: { ...order, hours: 3 }, quote: priced(35) });
      expect(other).toEqual({ ok: false, code: 'E_IDEMPOTENCY_CONFLICT' });
      expect(await balanceOf()).toBe(78);
    });

    it('too few ◆ leaves no receipt: the same request goes through after a top-up', async () => {
      const { ledger, fund, balanceOf, acc } = await fixture(backend, 10);
      expect(await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) })).toEqual({ ok: false, code: 'E_SOVEREIGNS' });
      expect(await balanceOf()).toBe(10);
      await fund(acc, 50);
      expect(await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) })).toEqual({ ok: true, amount: 22 });
      expect(await balanceOf()).toBe(28);
    });

    it('a refused quote debits nothing and leaves no receipt', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      const refused = await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: () => ({ ok: false, code: 'E_GOLD_OFF' }) });
      expect(refused).toEqual({ ok: false, code: 'E_GOLD_OFF' });
      expect(await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(5) })).toEqual({ ok: true, amount: 5 });
      expect(await balanceOf()).toBe(95);
    });

    it('a non-positive or fractional price is refused', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      for (const amount of [0, -3, 1.5, Number.NaN]) {
        expect(await ledger.spend(acc, { matchId: 'm', requestId: `r${amount}`, order, quote: priced(amount) })).toEqual({ ok: false, code: 'E_BAD_REQUEST' });
      }
      expect(await balanceOf()).toBe(100);
    });

    it('an accepted order keeps the ◆; the first settlement is final', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) });
      const request = { matchId: 'm', requestId: 'r1', order };
      expect(await ledger.replay(acc, request)).toBeNull();
      expect(await ledger.settle(acc, 'm', 'r1', { ok: true })).toEqual({ ok: true, amount: 22 });
      // A later refusal for the same request does not refund what the room applied.
      expect(await ledger.settle(acc, 'm', 'r1', { ok: false, code: 'E_PRICE_CHANGED' })).toEqual({ ok: true, amount: 22 });
      expect(await ledger.replay(acc, request)).toEqual({ ok: true, amount: 22 });
      // The same request id cannot replay its outcome for another order.
      expect(await ledger.replay(acc, { ...request, order: { ...order, hours: 3 } })).toEqual({ ok: false, code: 'E_IDEMPOTENCY_CONFLICT' });
      expect(await balanceOf()).toBe(78);
    });

    it('a refused order returns the ◆ exactly once', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) });
      const refunded = { ok: false, code: 'E_NOT_ACTIVE', refunded: 22 };
      expect(await ledger.settle(acc, 'm', 'r1', { ok: false, code: 'E_NOT_ACTIVE' })).toEqual(refunded);
      expect(await ledger.settle(acc, 'm', 'r1', { ok: false, code: 'E_NOT_ACTIVE' })).toEqual(refunded);
      expect(await ledger.settle(acc, 'm', 'r1', { ok: true })).toEqual(refunded);
      expect(await balanceOf()).toBe(100);
    });

    it('a request id belongs to one account and one match', async () => {
      const { ledger, fund, balanceOf, acc, other } = await fixture(backend);
      await fund(other, 40);
      await ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) });
      expect(await ledger.spend(other, { matchId: 'm', requestId: 'r1', order, quote: priced(11) })).toEqual({ ok: true, amount: 11 });
      expect(await ledger.spend(acc, { matchId: 'm2', requestId: 'r1', order, quote: priced(11) })).toEqual({ ok: true, amount: 11 });
      await ledger.settle(other, 'm', 'r1', { ok: false, code: 'E_NOT_ACTIVE' });
      expect(await ledger.replay(acc, { matchId: 'm', requestId: 'r1', order })).toBeNull();
      expect(await balanceOf(acc)).toBe(67);
      expect(await balanceOf(other)).toBe(40);
    });

    it('settling a request that spent nothing is a host bug', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      await expect(ledger.settle(acc, 'm', 'nothing', { ok: false, code: 'E_NOT_ACTIVE' })).rejects.toThrow('E_NOTHING_SPENT');
      expect(await balanceOf()).toBe(100);
    });

    it('concurrent retries of one request debit once', async () => {
      const { ledger, balanceOf, acc } = await fixture(backend);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => ledger.spend(acc, { matchId: 'm', requestId: 'r1', order, quote: priced(22) })),
      );
      expect(results).toEqual(Array.from({ length: 5 }, () => ({ ok: true, amount: 22 })));
      expect(await balanceOf()).toBe(78);
    });
  });
}
