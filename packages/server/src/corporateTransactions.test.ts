import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from './store';
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
