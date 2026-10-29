import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { migrate, PostgresCorpStore } from './store';
import { CorpService } from './corpService';
import { CORP_NAME_COUNT, generatedCorpName } from './corpNames';
import { createCorporateServices } from './corporateTransactions';

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
describe.skipIf(!url)('corporate service transactions', () => {
  it.each([{ format: 2, balance: 82 }, { format: 3, balance: 132 }])(
    'settles income and charges a base $format-on-$format challenge in the corporate transaction',
    async ({ format, balance }) => {
      const pool = new Pool({ connectionString: url });
      try {
        const services = createCorporateServices(pool);
        const suffix = crypto.randomUUID();
        const actor = { accountId: `income-a-${suffix}`, login: 'A' };
        const target = { accountId: `income-b-${suffix}`, login: 'B' };
        const a = await services.corp.create(actor);
        const b = await services.corp.create(target);
        if (!a.ok || !b.ok) throw Error('fixture');
        await pool.query('UPDATE corps SET influence=$2, infrastructure=$3::jsonb WHERE id=$1', [
          a.corpId, balance, JSON.stringify({ levels: { headquarters: 1 }, construction: null,
            accruedAt: Date.now() - 86_400_000, remainder: 0 }),
        ]);
        await services.ava.setCorpReady(actor, [format]);
        await services.ava.setCorpReady(target, [format]);
        expect((await services.ava.challenge(actor, b.corpId, format)).ok).toBe(true);
        const corp = await new PostgresCorpStore(pool).getCorp(a.corpId);
        expect(corp?.influence).toBe(6);
        expect(await services.ava.challenge(actor, b.corpId, format)).toMatchObject({
          ok: false, code: 'E_INSUFFICIENT', influence: 6,
        });
      } finally { await pool.end(); }
    },
  );
  it('concurrent founders get distinct allowed names, while SQL failures are not retried as collisions', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const store = new PostgresCorpStore(pool);
      const occupied = new Set((await store.listCorps()).map(c => c.name));
      const start = Array.from({ length: CORP_NAME_COUNT - 1 }, (_, i) => i)
        .find(i => !occupied.has(generatedCorpName(i)) && !occupied.has(generatedCorpName(i + 1)))!;
      const service = new CorpService({ store, nameIndex: () => start });
      const a = { accountId: `name-a-${crypto.randomUUID()}`, login: 'A' };
      const b = { accountId: `name-b-${crypto.randomUUID()}`, login: 'B' };
      const made = await Promise.all([service.create(a, undefined, 'falcon'), service.create(b, undefined, 'wolf')]);
      const names: string[] = [];
      for (const result of made) {
        if (!result.ok) throw Error('creation failed');
        names.push((await new PostgresCorpStore(pool).getCorp(result.corpId))!.name);
      }
      expect(new Set(names)).toEqual(new Set([generatedCorpName(start), generatedCorpName(start + 1)]));
      const failing = { accountId: `name-fail-${crypto.randomUUID()}`, login: 'C' };
      await pool.query(`CREATE FUNCTION corp_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic insert failure'; END $$`);
      await pool.query('CREATE TRIGGER corp_insert_failure BEFORE INSERT ON corps FOR EACH ROW EXECUTE FUNCTION corp_insert_failure()');
      const calls = vi.spyOn(store, 'createCorp');
      try {
        await expect(service.create(failing)).rejects.toThrow('synthetic insert failure');
        expect(calls).toHaveBeenCalledTimes(1);
        expect(await store.membershipOf(failing.accountId)).toBeNull();
      } finally {
        calls.mockRestore();
        await pool.query('DROP TRIGGER corp_insert_failure ON corps');
        await pool.query('DROP FUNCTION corp_insert_failure()');
      }
      expect((await service.create(failing)).ok).toBe(true);
    } finally { await pool.end(); }
  });

  it('rolls back an emblem when audit fails, and persists the successful choice across store instances', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const actor = { accountId: `emblem-${crypto.randomUUID()}`, login: 'Head' };
      // The integrated host uses the plain service: it must be atomic there too.
      const service = new CorpService({ store: new PostgresCorpStore(pool) });
      const made = await service.create(actor, undefined, 'falcon');
      if (!made.ok) throw Error('fixture');
      await pool.query(`CREATE FUNCTION emblem_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='emblem' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
      await pool.query('CREATE TRIGGER emblem_audit_failure BEFORE INSERT ON corp_audit FOR EACH ROW EXECUTE FUNCTION emblem_audit_failure()');
      try {
        await expect(service.setEmblem(actor, made.corpId, 'wolf')).rejects.toThrow();
        expect(await new PostgresCorpStore(pool).getCorp(made.corpId)).toMatchObject({ emblemId: 'falcon' });
      } finally {
        await pool.query('DROP TRIGGER emblem_audit_failure ON corp_audit');
        await pool.query('DROP FUNCTION emblem_audit_failure()');
      }
      expect(await service.setEmblem(actor, made.corpId, 'wolf')).toEqual({ ok: true });
      expect(await new PostgresCorpStore(pool).getCorp(made.corpId)).toMatchObject({ emblemId: 'wolf' });
    } finally { await pool.end(); }
  });

  it('rolls back a funded challenge when recording it fails', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const services = createCorporateServices(pool);
      const suffix = crypto.randomUUID();
      const a = { accountId: `a-${suffix}`, login: 'Alpha' };
      const b = { accountId: `b-${suffix}`, login: 'Beta' };
      const ca = await services.corp.create(a, `Alpha ${suffix.slice(0, 12)}`);
      const cb = await services.corp.create(b, `Beta ${suffix.slice(0, 12)}`);
      expect(ca.ok && cb.ok).toBe(true);
      if (!ca.ok || !cb.ok) throw new Error('fixture');
      await pool.query('UPDATE corps SET influence=500 WHERE id=$1', [ca.corpId]);
      await services.ava.setCorpReady(a);
      await services.ava.setCorpReady(b);
      await pool.query(
        `CREATE OR REPLACE FUNCTION corp_audit_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor='${a.accountId}' AND NEW.action='influence' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER corp_audit_test_failure BEFORE INSERT ON corp_audit FOR EACH ROW EXECUTE FUNCTION corp_audit_test_failure()',
      );
      try {
        await expect(services.ava.challenge(a, cb.corpId)).rejects.toThrow();
        expect(
          Number(
            (await pool.query('SELECT influence FROM corps WHERE id=$1', [ca.corpId])).rows[0]
              .influence,
          ),
        ).toBe(500);
        expect(
          (await pool.query('SELECT id FROM ava_challenges WHERE challenger_corp=$1', [ca.corpId]))
            .rows,
        ).toHaveLength(0);
      } finally {
        await pool.query('DROP TRIGGER corp_audit_test_failure ON corp_audit');
        await pool.query('DROP FUNCTION corp_audit_test_failure()');
      }
      expect((await services.ava.challenge(a, cb.corpId)).ok).toBe(true);
    } finally {
      await pool.end();
    }
  });
});

describe.skipIf(!url)('corporate settlement recovery', () => {
  it('rolls back the end marker, outcome and reward together, then retries once', async () => {
    const pool = new Pool({ connectionString: url });
    try {
      const services = createCorporateServices(pool);
      const id = crypto.randomUUID();
      const a = await services.corp.create(
        { accountId: `winner-${id}`, login: 'Winner' },
        `Winner ${id.slice(0, 12)}`,
      );
      const b = await services.corp.create(
        { accountId: `loser-${id}`, login: 'Loser' },
        `Loser ${id.slice(0, 12)}`,
      );
      if (!a.ok || !b.ok) throw Error('fixture');
      await pool.query('UPDATE corps SET influence=500 WHERE id=$1', [a.corpId]);
      await pool.query(
        "INSERT INTO ava_challenges(id,challenger_corp,target_corp,cost,status,created_at,expires_at) VALUES($1,$2,$3,0,'locked',0,0)",
        [id, a.corpId, b.corpId],
      );
      await pool.query(
        `CREATE OR REPLACE FUNCTION corp_settlement_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${a.corpId}' AND NEW.influence>OLD.influence THEN RAISE EXCEPTION 'synthetic reward failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER corp_settlement_test_failure BEFORE UPDATE ON corps FOR EACH ROW EXECUTE FUNCTION corp_settlement_test_failure()',
      );
      try {
        await expect(services.ava.settleMatch(id, 'challenger')).rejects.toThrow();
        expect(
          (await pool.query('SELECT status FROM ava_challenges WHERE id=$1', [id])).rows[0].status,
        ).toBe('locked');
        expect(
          (await pool.query('SELECT * FROM ava_results WHERE matchup_id=$1', [id])).rows,
        ).toHaveLength(0);
        expect(
          Number(
            (await pool.query('SELECT influence FROM corps WHERE id=$1', [a.corpId])).rows[0]
              .influence,
          ),
        ).toBe(500);
      } finally {
        await pool.query('DROP TRIGGER corp_settlement_test_failure ON corps');
        await pool.query('DROP FUNCTION corp_settlement_test_failure()');
      }
      expect((await services.ava.settleMatch(id, 'challenger')).ok).toBe(true);
      expect(await services.ava.settleMatch(id, 'challenger')).toEqual({
        ok: false,
        code: 'E_MATCHUP_CLOSED',
      });
      expect(
        Number(
          (await pool.query('SELECT influence FROM corps WHERE id=$1', [a.corpId])).rows[0]
            .influence,
        ),
      ).toBe(650);
    } finally {
      await pool.end();
    }
  });
});
