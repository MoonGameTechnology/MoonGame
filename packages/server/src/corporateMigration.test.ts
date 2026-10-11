import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrate, PostgresCorpStore } from './store';
import { migrateCorporations } from './corporateMigration';

const url = process.env.DATABASE_URL;
describe.skipIf(!url)('corporate database cutover', () => {
  it('copies corporate identities and audit atomically, keeps game data out, and refuses overwrite', async () => {
    const admin = new Pool({ connectionString: url });
    const suffix = randomUUID().replaceAll('-', '');
    const names = [`corp_source_${suffix}`, `corp_target_${suffix}`];
    let source: Pool | undefined, target: Pool | undefined;
    try {
      for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
      const sourceUrl = new URL(url!);
      sourceUrl.pathname = `/${names[0]}`;
      const targetUrl = new URL(url!);
      targetUrl.pathname = `/${names[1]}`;
      source = new Pool({ connectionString: sourceUrl.toString() });
      target = new Pool({ connectionString: targetUrl.toString() });
      await migrate(source);
      const corps = new PostgresCorpStore(source);
      const created = await corps.createCorp('Migration Corp', 'head', 'Pilot');
      if (!created.ok) throw Error('fixture');
      await corps.appendAudit({ corpId: created.corpId, at: 10, actor: 'head', action: 'create' });
      await source.query(
        "INSERT INTO matches(id,data_version,seq,status,state) VALUES('game-only','test',1,'ongoing','{}')",
      );
      const dry = await migrateCorporations(source, target);
      expect(dry.corps).toBe(1);
      expect(
        (await target.query("SELECT to_regclass('public.corps') AS name")).rows[0].name,
      ).toBeNull();
      expect((await migrateCorporations(source, target, true)).corps).toBe(1);
      expect((await new PostgresCorpStore(target).membershipOf('head'))?.corpId).toBe(
        created.corpId,
      );
      expect(await new PostgresCorpStore(target).auditOf(created.corpId)).toHaveLength(1);
      expect((await target.query('SELECT count(*) AS n FROM matches')).rows[0].n).toBe('0');
      await expect(migrateCorporations(source, target, true)).rejects.toThrow(
        'E_CORPORATIONS_TARGET_NOT_EMPTY',
      );
      expect((await new PostgresCorpStore(source).membershipOf('head'))?.corpId).toBe(
        created.corpId,
      );
    } finally {
      await Promise.all([source?.end(), target?.end()]);
      for (const name of names) await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });
});
