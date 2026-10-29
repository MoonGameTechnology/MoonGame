import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, createKernel, isValidActionPayload } from '@void/shared-core';
import { ActionGate, createActionEnvelope } from '@void/action-layer';
import { MemoryArsenalStore, MemoryDropStore, PostgresArsenalStore, migrate } from './store';
import { MemoryMetaMarket, PostgresMetaMarket } from './metaMarket';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore } from './metaEconomyStore';
import { MetaEconomy } from './metaEconomy';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { createDevMatch, loadDropTables, loadShippedData } from './scenario';
import { registerMetaMarketApi } from './metaMarketApi';
import { registerMetaEconomyApi } from './metaEconomyApi';
import { MatchRoom, type RoomPeer } from './matchRoom';

// Isolated audit harness: real production adapters, fresh synthetic accounts only.
const databaseUrl = process.env.DATABASE_URL;
const pools: pg.Pool[] = [];
const apps: ReturnType<typeof Fastify>[] = [];
const data = loadShippedData();
const catalog = loadMetaEconomyCatalog(data);
const at = catalog.seasons[0]!.startsAt + 86_400_000;
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

async function fixture(backend: 'memory' | 'postgres') {
  if (backend === 'postgres') {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    pools.push(pool);
    await migrate(pool);
    const arsenal = new PostgresArsenalStore(pool);
    const market = new PostgresMetaMarket(pool, () => at);
    const economy = new PostgresMetaEconomyStore(pool);
    market.setEconomy(economy);
    return { arsenal, market, economy, pool };
  }
  const arsenal = new MemoryArsenalStore();
  const market = new MemoryMetaMarket(arsenal, () => at);
  const economy = new MemoryMetaEconomyStore(arsenal, new MemoryDropStore(), market);
  market.setEconomy(economy);
  return { arsenal, market, economy, pool: undefined };
}

const item = (accountId: string) => ({
  itemId: randomUUID(), accountId, kind: 'module' as const, form: 'instance' as const,
  defId: 'shield_booster', soulbound: false, origin: 'drop' as const, acquiredAt: at,
});

for (const backend of ['memory', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !databaseUrl)(`trust boundary economy audit: ${backend}`, () => {
    it('craft and material reservation cannot both consume the same final ingredient', async () => {
      const f = await fixture(backend);
      const service = new MetaEconomy({ store: f.economy, catalog, dropTables: loadDropTables(data), now: () => at });
      const recipe = catalog.recipes.shield_booster!;
      const [materialId, quantity] = Object.entries(recipe.ingredients)[0]!;
      // Exercise either arrival order, not merely the same winner twice.
      for (const listingFirst of [false, true]) {
        const owner = randomUUID();
        await f.economy.transaction([owner], async (tx) => {
          for (const [id, amount] of Object.entries(recipe.ingredients)) {
            tx.account(owner).materials.push({ lotId: randomUUID(), materialId: id, quantity: amount,
              soulbound: false, source: 'match', sourceId: 'audit', acquiredAt: at });
          }
        });
        const craft = () => service.craft(owner, { requestId: 'craft', recipeId: 'shield_booster', allowSoulbound: false });
        const list = () => f.market.listMaterials(owner, 'Audit', materialId, quantity, 10, 'list');
        const outcomes = await Promise.all(listingFirst ? [list(), craft()] : [craft(), list()]);
        expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
        const craftCount = (await f.arsenal.listOf(owner)).length;
        const reserved = (await f.market.materialListings()).filter((lot) => lot.sellerId === owner)
          .reduce((sum, lot) => sum + lot.quantity, 0);
        const loose = (await f.economy.read(owner)).materials.filter((lot) => lot.materialId === materialId)
          .reduce((sum, lot) => sum + lot.quantity, 0);
        expect(craftCount * quantity + reserved + loose).toBe(quantity);
      }
    });

    it('cancel racing eight buyers cannot duplicate the item or debit losing buyers', async () => {
      const f = await fixture(backend);
      const seller = randomUUID();
      const buyers = Array.from({ length: 8 }, () => randomUUID());
      const asset = item(seller);
      await f.arsenal.grant(asset);
      await f.economy.transaction(buyers, async (tx) => {
        for (const buyer of buyers) await tx.creditWarrants(buyer, 100, 'audit', 'seed', at);
      });
      const listed = await f.market.list(seller, 'Audit', asset.itemId, 100);
      if (!listed.ok) throw new Error(listed.code);
      const work = buyers.map((buyer) => f.market.buy(buyer, listed.listing.id, 'same-request-id'));
      const cancellation = f.market.cancel(seller, listed.listing.id);
      const results = await Promise.all(work);
      const cancelled = await cancellation;
      const winners = results.flatMap((result, i) => result.ok ? [buyers[i]!] : []);
      expect(winners.length + Number(cancelled.ok)).toBe(1);
      expect((await f.arsenal.get(asset.itemId))?.accountId).toBe(winners[0] ?? seller);
      expect(await f.market.balance(seller)).toBe(winners.length ? 92 : 0);
      for (const buyer of buyers) expect(await f.market.balance(buyer)).toBe(winners.includes(buyer) ? 0 : 100);
      if (winners[0]) {
        expect((await f.market.buy(winners[0], listed.listing.id, 'same-request-id')).ok).toBe(true);
        expect(await f.market.buy(winners[0], 'changed-listing', 'same-request-id'))
          .toEqual({ ok: false, code: 'E_IDEMPOTENCY_CONFLICT' });
        expect(await f.market.balance(winners[0])).toBe(0);
      }
    });

    it('two different lots cannot spend one buyer balance twice', async () => {
      const f = await fixture(backend);
      const sellerA = randomUUID(), sellerB = randomUUID(), buyer = randomUUID();
      const a = item(sellerA), b = item(sellerB);
      await f.arsenal.grant(a); await f.arsenal.grant(b);
      await f.economy.transaction([buyer], async (tx) => {
        await tx.creditWarrants(buyer, 100, 'audit', 'seed', at);
      });
      const one = await f.market.list(sellerA, 'A', a.itemId, 100);
      const two = await f.market.list(sellerB, 'B', b.itemId, 100);
      if (!one.ok || !two.ok) throw new Error('listing failed');
      const results = await Promise.all([
        f.market.buy(buyer, one.listing.id, 'one'), f.market.buy(buyer, two.listing.id, 'two'),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toEqual({ ok: false, code: 'E_INSUFFICIENT' });
      expect(await f.market.balance(buyer)).toBe(0);
      expect((await f.arsenal.listOf(buyer))).toHaveLength(1);
      expect((await f.market.balance(sellerA)) + (await f.market.balance(sellerB))).toBe(92);
    });
  });
}

describe('trust boundary economy audit: HTTP', () => {
  it('ignores forged market identity, rejects unsafe numbers, and deduplicates after postcommit sync failure', async () => {
    const f = await fixture('memory');
    const victim = 'victim', caller = 'caller';
    const asset = item(victim);
    await f.arsenal.grant(asset);
    await f.economy.transaction([caller], async (tx) => { await tx.creditWarrants(caller, 100, 'audit', 'seed', at); });
    const app = Fastify({ logger: false }); apps.push(app);
    registerMetaMarketApi(app, {
      market: f.market, identify: async () => ({ accountId: caller, login: 'Caller' }),
      onChanged: async () => { throw new Error('private storage detail must not leak'); },
      rateMax: 100,
    });
    const forged = await app.inject({ method: 'POST', url: '/meta-market/list', payload: { itemId: asset.itemId, price: 10, accountId: victim, sellerId: victim } });
    expect(forged.statusCode).toBeGreaterThanOrEqual(400);
    expect((await f.arsenal.get(asset.itemId))?.accountId).toBe(victim);
    for (const price of [-1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1, 1e100]) {
      const response = await app.inject({ method: 'POST', url: '/meta-market/list', payload: { itemId: asset.itemId, price } });
      expect(response.json()).toEqual({ error: 'E_BAD_PRICE' });
    }
    const listed = await f.market.list(victim, 'Victim', asset.itemId, 100);
    if (!listed.ok) throw new Error(listed.code);
    const payload = { listingId: listed.listing.id, tradeId: 'retry-after-response-loss', accountId: victim };
    const first = await app.inject({ method: 'POST', url: '/meta-market/buy', payload });
    const retry = await app.inject({ method: 'POST', url: '/meta-market/buy', payload });
    expect(first.statusCode).toBe(200); expect(retry.json()).toEqual(first.json());
    expect(first.body).not.toContain('private storage detail');
    expect(await f.market.balance(caller)).toBe(0);
    expect(await f.market.balance(victim)).toBe(92);
    expect((await f.arsenal.get(asset.itemId))?.accountId).toBe(caller);
  });

  it('rejects craft identity injection and prototype recipes without consuming materials', async () => {
    const f = await fixture('memory');
    const service = new MetaEconomy({ store: f.economy, catalog, dropTables: loadDropTables(data), now: () => at });
    const app = Fastify({ logger: false }); apps.push(app);
    registerMetaEconomyApi(app, { economy: service, identify: async () => ({ accountId: 'caller', login: 'Caller' }), rateMax: 100 });
    const injected = await app.inject({ method: 'POST', url: '/meta-economy/craft', payload: { requestId: 'audit', recipeId: 'shield_booster', allowSoulbound: false, accountId: 'victim' } });
    expect(injected.statusCode).toBe(400);
    for (const recipeId of ['__proto__', 'constructor', 'toString', 'prototype']) {
      const response = await app.inject({ method: 'POST', url: '/meta-economy/craft', payload: { requestId: 'audit', recipeId, allowSoulbound: false } });
      expect([400, 409]).toContain(response.statusCode);
      expect(response.body).not.toContain('stack');
    }
    expect(await f.arsenal.listOf('caller')).toEqual([]);
    expect((await f.economy.read('caller')).materials).toEqual([]);
  });
});

describe.skipIf(!databaseUrl)('trust boundary economy audit: late PostgreSQL failure', () => {
  it('rolls back a debit and item move when receipt insertion fails, then retries once after adapter restart', async () => {
    const f = await fixture('postgres');
    const pool = f.pool!;
    let failReceipt = true;
    // Inject at the final SQL write, after inventory, wallets and ledger have changed
    // inside the real transaction. No global SQL trigger or production fault injection.
    const faultPool = new Proxy(pool, {
      get(target, property) {
        if (property === 'connect') return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(connection, key) {
              if (key === 'query') return (sql: unknown, ...args: unknown[]) => {
                if (failReceipt && typeof sql === 'string' && sql.startsWith('INSERT INTO meta_market_receipts')) {
                  failReceipt = false;
                  throw new Error('audit injected final receipt failure');
                }
                return Reflect.apply(connection.query, connection, [sql, ...args]);
              };
              const value = Reflect.get(connection, key);
              return typeof value === 'function' ? value.bind(connection) : value;
            },
          });
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const broken = new PostgresMetaMarket(faultPool, () => at);
    broken.setEconomy(new PostgresMetaEconomyStore(faultPool));
    const seller = randomUUID(), buyer = randomUUID(), tradeId = randomUUID();
    const asset = item(seller);
    await f.arsenal.grant(asset);
    await f.economy.transaction([buyer], async (tx) => { await tx.creditWarrants(buyer, 100, 'audit', 'seed', at); });
    const listed = await f.market.list(seller, 'Audit', asset.itemId, 100);
    if (!listed.ok) throw new Error(listed.code);
    await expect(broken.buy(buyer, listed.listing.id, tradeId)).rejects.toThrow('audit injected final receipt failure');
    expect(failReceipt).toBe(false);
    expect((await f.arsenal.get(asset.itemId))?.accountId).toBe(seller);
    expect(await f.market.balance(buyer)).toBe(100);
    expect(await f.market.balance(seller)).toBe(0);
    expect((await f.market.history(buyer)).filter((entry) => entry.reason === 'purchase')).toEqual([]);
    expect((await pool.query('SELECT * FROM meta_market_receipts WHERE account_id=$1 AND trade_id=$2', [buyer, tradeId])).rowCount).toBe(0);
    const restarted = new PostgresMetaMarket(pool, () => at + 1000);
    restarted.setEconomy(new PostgresMetaEconomyStore(pool));
    const first = await restarted.buy(buyer, listed.listing.id, tradeId);
    expect(first.ok).toBe(true);
    expect(await restarted.buy(buyer, listed.listing.id, tradeId)).toEqual(first);
    expect(await restarted.balance(buyer)).toBe(0);
    expect(await restarted.balance(seller)).toBe(92);
  });
});

describe('trust boundary privacy audit: account replacement on a seat', () => {
  it.each(['sender', 'recipient'])('does not replay an old account DM to the new %s-seat owner', async (replaced) => {
    const state = createInitialState({ seed: 'privacy-audit', version: { data: data.version, manifest: 'audit' }, time: 0 });
    state.players = {
      sender: { id: 'sender', name: 'Sender', faction: 'vanguard', status: 'active', resources: {} },
      recipient: { id: 'recipient', name: 'Recipient', faction: 'vanguard', status: 'active', resources: {} },
    };
    const room = new MatchRoom({ id: 'audit', initialState: state, kernel: createKernel([]), data, now: () => 0, singlePeerPerPlayer: true });
    const peer = () => {
      const texts: string[] = [];
      const socket: RoomPeer = { send(raw) {
        const message = JSON.parse(raw) as { type: string; message?: { text: string } };
        if (message.type === 'chat.msg') texts.push(message.message!.text);
      }, close() {} };
      return { socket, texts };
    };
    const sender = peer(), recipient = peer();
    expect(room.addPeer('sender', sender.socket, 'sender-session', undefined, 'sender-account', true)).toBe(true);
    expect(room.addPeer('recipient', recipient.socket, 'recipient-session', undefined, 'recipient-account', true)).toBe(true);
    const secret = 'CANARY_PRIVATE_DM_TO_ORIGINAL_ACCOUNT';
    await room.receive('sender', sender.socket, JSON.stringify({ type: 'chat.send', channel: 'dm', to: 'recipient', text: secret }));
    expect(sender.texts).toContain(secret);
    expect(recipient.texts).toContain(secret);
    expect(room.evict(replaced)).toBe(1);
    const newcomer = peer();
    expect(room.addPeer(replaced, newcomer.socket, 'new-session', undefined, 'different-account', true)).toBe(true);
    // The new account inherits the empire, not private messages of the old human.
    expect(newcomer.texts).not.toContain(secret);
  });
});

describe('trust boundary economy audit: extreme in-match numbers', () => {
  it('finite operands overflowing their product and subnormal quantities cannot poison balances or snapshots', async () => {
    const finite = (value: unknown): void => {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      else if (value && typeof value === 'object') for (const entry of Object.values(value)) finite(entry);
    };
    let writes = 0;
    const room = createDevMatch(data, {
      now: () => 1000, time: 1000,
      gate: new ActionGate({ payloadValidator: isValidActionPayload }),
      persist: async (snapshot) => { finite(snapshot); writes++; },
    });
    const peers = new Map<string, { socket: RoomPeer; codes: string[] }>();
    for (const player of ['green', 'red']) {
      const codes: string[] = [];
      const socket: RoomPeer = { send(raw) {
        const message = JSON.parse(raw) as { type: string; code?: string };
        if (message.code) codes.push(message.code);
      } };
      peers.set(player, { socket, codes });
      room.addPeer(player, socket, `audit-${player}`);
    }
    const send = async (playerId: string, clientSeq: number, type: string, payload: unknown) => {
      const sessionId = `audit-${playerId}`;
      const envelope = createActionEnvelope({ matchId: 'dev', playerId, sessionId, clientSeq, type, payload, issuedAt: 1000 });
      await room.receive(playerId, peers.get(playerId)!.socket, JSON.stringify({ type: 'action.v1', envelope }), sessionId);
      finite(room.state);
    };
    const initialGreen = structuredClone(room.state.players.green!.resources);
    const initialRed = structuredClone(room.state.players.red!.resources);
    await send('green', 1, 'market.list', { side: 'buy', resource: 'metal', amount: 1e308, price: 1e308 });
    expect(peers.get('green')!.codes).toContain('E_INSUFFICIENT');
    await send('green', 2, 'market.list', { side: 'sell', resource: 'metal', amount: 5e-324, price: 1 });
    expect(peers.get('green')!.codes).toContain('E_BAD_PAYLOAD');
    await send('green', 3, 'market.list', { side: 'sell', resource: 'metal', amount: 2, price: 1e308 });
    expect(room.state.market).toHaveLength(1);
    const listingId = room.state.market![0]!.id;
    await send('red', 1, 'market.take', { id: listingId });
    expect(peers.get('red')!.codes).toContain('E_INSUFFICIENT');
    expect(room.state.players.red!.resources).toEqual(initialRed);
    await send('green', 4, 'market.cancel', { id: listingId });
    expect(room.state.players.green!.resources).toEqual(initialGreen);
    expect(room.state.market).toEqual([]);
    expect(writes).toBeGreaterThan(0);
  });
});
