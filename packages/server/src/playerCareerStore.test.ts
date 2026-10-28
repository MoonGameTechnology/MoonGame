import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createInitialState } from '@void/shared-core';
import { MemoryProfileStore, PostgresProfileStore, type ProfileStore } from './profileStore';
import { migrate, PostgresMatchStore } from './store/postgres';
import { emptyCareer, careerOwners } from './playerCareer';
import type { MatchSnapshot } from './store';
function snapshot(id: string): MatchSnapshot {
  const state = createInitialState({ seed: 'credit', version: { data: '1', manifest: '1' } });
  state.mapId = 'duel-1';
  state.match.status = 'ended';
  state.match.winner = 'a';
  state.match.rewards = {a:{place:1,xp:100}};
  state.players.a = {
    id: 'a',
    name: 'a',
    faction: 'a',
    status: 'active',
    resources: {},
    seated: true,
    claimedAt: 1,
  };
  const career = emptyCareer(100);
  career.owners = careerOwners(state, { a: id });
  career.players[id] = {
    destroyed: 2,
    lost: 1,
    destroyedCost: { metal: 40 },
    lostCost: { metal: 20 },
  };
  return { matchId: id, dataVersion: '1', seq: 1, status: 'ended', state, career };
}
function contract(label: string, factory: () => ProfileStore) {
  it(
    label +
      ' settles concurrent retries exactly once, accumulates matches and never invents old data',
    async () => {
      const store = factory(),
        id = 'career-' + label + '-' + Date.now(),
        first = snapshot(id);
      expect(await store.career!(id)).toBeNull();
      await Promise.all(Array.from({ length: 4 }, () => store.creditCareer!(first)));
      expect(await store.career!(id)).toMatchObject({
        matches: 1,
        wins: 1,
        pvp: { destroyed: 2, lost: 1 },
      });
      const second = { ...first, matchId: id + '-second' };
      await store.creditCareer!(second);
      expect(await store.career!(id)).toMatchObject({
        matches: 2,
        wins: 2,
        pvp: { destroyed: 4, lost: 2 },
      });
      const legacy = { ...first, matchId: id + '-legacy', career: undefined };
      await store.creditCareer!(legacy);
      expect((await store.career!(id))!.matches).toBe(2);
      if (label === 'postgres')
        expect(await factory().career!(id)).toEqual(await store.career!(id));
    },
  );
}
describe('career accounting store', () => contract('memory', () => new MemoryProfileStore()));
describe.skipIf(!process.env.DATABASE_URL)('durable career accounting', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => migrate(pool));
  afterAll(() => pool.end());
  contract('postgres', () => new PostgresProfileStore(pool));
  it('round-trips a private ledger alongside the authoritative world', async () => {
    const store = new PostgresMatchStore(pool),
      row = snapshot('career-roundtrip-' + Date.now());
    await store.save(row);
    expect((await store.load(row.matchId))!.career).toEqual(row.career);
    await store.save({ ...row, seq: 0, career: emptyCareer(200) });
    expect((await store.load(row.matchId))!.career).toEqual(row.career);
  });
});
