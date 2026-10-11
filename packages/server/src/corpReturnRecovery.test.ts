import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  migrate,
  PostgresArsenalStore,
  PostgresCorpRentStore,
  PostgresCorpStore,
  PostgresAvaSessionStore,
  PostgresAvaChallengeStore,
  PostgresAvaRosterStore,
} from './store';
import { createDevMatch, loadShippedData } from './scenario';
import { snapshotOf } from './persistence';
import { createCorporationServer } from './corporationServer';
import { CorpArsenalService } from './corpArsenalService';
import { PostgresMatchStore } from './store';

const sourceUrl = process.env.DATABASE_URL;
let url: string | undefined = sourceUrl;
let admin: Pool | undefined;
const database = `corp_fault_${crypto.randomUUID().replaceAll('-', '')}`;
// DDL and failure triggers must never lock another test file's live tables.
beforeAll(async () => {
  if (!sourceUrl) return;
  admin = new Pool({ connectionString: sourceUrl });
  await admin.query(`CREATE DATABASE "${database}"`);
  // Preserve pg's empty-host Unix-socket URLs, which WHATWG URL rejects.
  const queryAt = sourceUrl.indexOf('?');
  const connection = queryAt < 0 ? sourceUrl : sourceUrl.slice(0, queryAt);
  const query = queryAt < 0 ? '' : sourceUrl.slice(queryAt);
  url = connection.replace(/\/[^/]*$/, `/${database}`) + query;
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
});
afterAll(async () => {
  if (!admin) return;
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  } finally {
    await admin.end();
  }
});
describe.skipIf(!url)('durable corporate handoff', () => {
  it('rejects a signed request replayed after the corporate process restarts', async () => {
    const pool = new Pool({ connectionString: url });
    const key = 'synthetic-corporate-restart-key-32-characters';
    const claims = JSON.stringify({
      at: Date.now(),
      nonce: randomUUID(),
      who: { accountId: 'restart-probe', login: 'Synthetic Pilot' },
      ip: '127.0.0.1',
    });
    const headers = {
      'x-corp-claims': Buffer.from(claims).toString('base64url'),
      'x-corp-signature': createHmac('sha256', key)
        .update(`${claims}\nGET\n/corps\n${createHash('sha256').update('null').digest('hex')}`)
        .digest('hex'),
    };
    const first = createCorporationServer(pool, key),
      restarted = createCorporationServer(pool, key);
    try {
      expect((await first.inject({ url: '/corps', headers })).statusCode).toBe(200);
      await first.close();
      expect((await restarted.inject({ url: '/corps', headers })).statusCode).toBe(401);
    } finally {
      await Promise.all([first.close(), restarted.close()]);
      await pool.end();
    }
  });
  it('keeps the rental active on wear failure and queues a deduplicated return audit', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const id = randomUUID(),
        itemId = `item-${id}`,
        corpId = `corp-${id}`;
      const arsenal = new PostgresArsenalStore(pool),
        rentals = new PostgresCorpRentStore(pool),
        corps = new PostgresCorpStore(pool);
      await arsenal.grant({
        itemId,
        accountId: corpId,
        kind: 'hull',
        form: 'instance',
        defId: 'cruiser',
        soulbound: false,
        durability: 5,
        origin: 'auction',
        acquiredAt: 0,
      });
      await rentals.rent({ itemId, corpId, matchupId: id, accountId: 'fighter', rentedAt: 0 });
      await pool.query(
        `CREATE OR REPLACE FUNCTION corp_wear_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.item_id='${itemId}' THEN RAISE EXCEPTION 'synthetic inventory failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER corp_wear_test_failure BEFORE UPDATE ON arsenal FOR EACH ROW EXECUTE FUNCTION corp_wear_test_failure()',
      );
      try {
        await expect(rentals.completeReturn(id, itemId, 10)).rejects.toThrow();
        expect(await rentals.activeForMatchup(id)).toHaveLength(1);
        expect((await arsenal.get(itemId))?.durability).toBe(5);
      } finally {
        await pool.query('DROP TRIGGER corp_wear_test_failure ON arsenal');
        await pool.query('DROP FUNCTION corp_wear_test_failure()');
      }
      const service = new CorpArsenalService({
        corpStore: new Proxy(corps, {
          get(target, name) {
            if (name === 'appendAudit')
              return async () => {
                throw Error('synthetic corporate outage');
              };
            return Reflect.get(target, name);
          },
        }),
        arsenalStore: arsenal,
        rentStore: rentals,
        challengeStore: new PostgresAvaChallengeStore(pool),
        rosterStore: new PostgresAvaRosterStore(pool),
        now: () => 10,
      });
      await expect(service.returnWar(id)).rejects.toThrow('synthetic corporate outage');
      expect(await rentals.activeForMatchup(id)).toHaveLength(0);
      await expect(service.returnWar(id)).rejects.toThrow('synthetic corporate outage');
      const entries = await rentals.pendingReturnAudits(id);
      expect(entries).toHaveLength(1);
      expect((await arsenal.get(itemId))?.durability).toBe(4);
      await corps.appendAudit(entries[0]!);
      await corps.appendAudit(entries[0]!);
      expect(await corps.auditOf(corpId)).toHaveLength(1);
      await rentals.markReturnAudited(entries[0]!.eventId!);
      expect(await rentals.pendingReturnAudits(id)).toHaveLength(0);
      expect(await rentals.completeReturn(id, itemId, 20)).toBe(false);
      expect((await arsenal.get(itemId))?.durability).toBe(4);
    } finally {
      await pool.end();
    }
  });
  it('recovers an ended match after restart without relying on an enqueue hook', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const id = randomUUID(),
        matchId = `ava-delivery-${id}`;
      const room = createDevMatch(loadShippedData(), { id: matchId });
      const snap = snapshotOf(room);
      snap.status = 'ended';
      snap.state.match.status = 'ended';
      snap.state.match.winner = 'p1';
      await new PostgresMatchStore(pool).save(snap);
      await new PostgresAvaSessionStore(pool).create({
        matchId,
        matchupId: id,
        mapId: 'ava-duel-1',
        seats: { a: 'p1' },
        at: 0,
      });
      const restarted = new PostgresAvaSessionStore(pool);
      expect((await restarted.pendingResults()).find((r) => r.matchId === matchId)).toEqual({
        matchId,
        matchupId: id,
        winner: 'p1',
      });
      await restarted.markResultDelivered(matchId);
      expect((await restarted.pendingResults()).some((r) => r.matchId === matchId)).toBe(false);
    } finally {
      await pool.end();
    }
  });
});
