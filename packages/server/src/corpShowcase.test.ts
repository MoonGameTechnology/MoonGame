import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { MemoryCorpStore, MemoryAvaResultStore, PostgresCorpStore, PostgresAvaResultStore, migrate, type CorpStore, type AvaResultStore } from './store';
import { buildFixtureFacility } from './corpFacilityFixture';

function contract(make: () => { corps: CorpStore; results: AvaResultStore }) {
  it('persists one head-selected showcase, with earned medals and hall checked under the store lock', async () => {
    const { corps, results } = make();
    const head = randomUUID(), officer = randomUUID();
    const made = await corps.createCorp(randomUUID(), head, 'Head');
    if (!made.ok) throw Error('fixture');
    const id = made.corpId;
    await corps.addMember(id, officer, 'Officer', 'officer');
    expect(await corps.setShowcase(id, head, [], 0)).toEqual({ ok: false, code: 'E_CORP_HALL_REQUIRED' });
    const now = await buildFixtureFacility(corps, id, head, 'hall_of_fame');
    expect(await corps.setShowcase(id, officer, [], now)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect(await corps.setShowcase(id, head, ['ava_first_victory'], now)).toEqual({ ok: false, code: 'E_CORP_MEDAL_NOT_EARNED' });
    await results.record({ matchupId: randomUUID(), challengerCorp: id, targetCorp: randomUUID(), winnerCorp: id, at: now });
    expect(await corps.setShowcase(id, head, ['ava_first_victory', 'ava_first_victory'], now)).toEqual({ ok: false, code: 'E_BAD_SHOWCASE' });
    expect(await corps.setShowcase(id, head, ['ava_first_victory'], now)).toEqual({ ok: true });
    expect(await corps.getCorp(id)).toMatchObject({ showcaseSlots: 5, showcase: ['ava_first_victory'] });
    expect((await corps.listCorps()).find((c) => c.corpId === id)?.showcase).toEqual(['ava_first_victory']);
    await corps.setShowcase(id, head, ['ava_first_victory'], now);
    expect((await corps.auditOf(id)).filter((a) => a.action === 'showcase')).toHaveLength(1);
    expect(await corps.setShowcase(id, head, [], now)).toEqual({ ok: true });
    expect((await corps.getCorp(id))?.showcase).toEqual([]);
  });
}

describe('corporation showcase memory', () => contract(() => {
  const results = new MemoryAvaResultStore();
  return { results, corps: new MemoryCorpStore(undefined, results) };
}));

describe.skipIf(!process.env.DATABASE_URL)('corporation showcase postgres', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => migrate(pool));
  afterAll(() => pool.end());
  contract(() => ({ results: new PostgresAvaResultStore(pool), corps: new PostgresCorpStore(pool) }));
});
