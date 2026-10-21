import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './store/postgres';
import {
  BOT_ROSTER_SIZE,
  SYSTEM_BOT_ROSTER,
  MemoryBotRosterStore,
  PostgresBotRosterStore,
  type BotAssignment,
  type BotMatchResult,
  type BotRosterStore,
} from './botRoster';

const result = (seat: BotAssignment, extra: Partial<BotMatchResult> = {}): BotMatchResult => ({
  botId: seat.botId,
  playerId: seat.playerId,
  mapId: 'test-map',
  endedAt: 1_800_000_000_000,
  outcome: 'win',
  xp: 120,
  place: 1,
  ...extra,
});

function rosterContract(label: string, create: () => BotRosterStore): void {
  describe(label, () => {
    let store: BotRosterStore;
    beforeEach(async () => {
      store = create();
      await store.ensureRoster();
    });

    it('seeds 100 stable identities with no invented XP and resolves login case-insensitively', async () => {
      expect(SYSTEM_BOT_ROSTER).toHaveLength(100);
      expect(new Set(SYSTEM_BOT_ROSTER.map((b) => b.id)).size).toBe(100);
      expect(new Set(SYSTEM_BOT_ROSTER.map((b) => b.login.toLowerCase())).size).toBe(100);
      expect(new Set(SYSTEM_BOT_ROSTER.map((b) => b.seed)).size).toBe(100);
      for (const bot of SYSTEM_BOT_ROSTER) {
        expect(bot.id).toMatch(/^system-bot:\d{3}$/);
        expect(bot.login).toMatch(/^~[A-Za-z]+$/);
        expect(bot.portrait).toBeGreaterThanOrEqual(1);
        expect(bot.portrait).toBeLessThanOrEqual(40);
        expect(await store.findByLogin(bot.login.toUpperCase())).toEqual(bot);
        expect(await store.recentMatches(bot.id)).toEqual([]);
      }
      expect(await store.findByLogin('Orion')).toBeNull();
      expect(await store.findByLogin("~Orion' OR true --")).toBeNull();
    });

    it('deduplicates seats, preserves existing assignments and keeps all seats pinned when the limit shrinks', async () => {
      const first = await store.assign('same-match', ['p1', 'p2', 'p1'], 10, 10);
      expect(first).toHaveLength(2);
      expect(await store.assign('same-match', ['p2'], 0, 20)).toEqual(first);
      const expanded = await store.assign('same-match', ['p1', 'p2', 'p3'], 10, 20);
      expect(expanded).toHaveLength(3);
      expect(expanded.slice(0, 2)).toEqual(first);
      expect(await store.activeMatchIds()).toEqual(['same-match']);
    });

    it('cancels a lost reservation without freeing another participant or erasing a result', async () => {
      const [a, b] = await store.assign('race', ['p1', 'p2'], 2, 1);
      await store.cancelUnclaimedAssignment('race', a!.botId);
      await store.cancelUnclaimedAssignment('race', a!.botId);
      expect(await store.assignments('race')).toEqual([b]);
      expect(await store.assign('next', ['p1'], 2, 2)).toHaveLength(1);
      await store.finishMatch('race', [result(b!)], 3);
      await store.cancelUnclaimedAssignment('race', b!.botId);
      expect(await store.assignments('race')).toEqual([b]);
      expect(await store.recentMatches(b!.botId)).toHaveLength(1);
    });

    it('removes an empty active marker after the last lost reservation and permits a fresh attempt', async () => {
      const [seat] = await store.assign('lost-race', ['p1'], 1, 1);
      await store.cancelUnclaimedAssignment('lost-race', seat!.botId);
      await store.cancelUnclaimedAssignment('lost-race', seat!.botId);
      expect(await store.assignments('lost-race')).toEqual([]);
      expect(await store.activeMatchIds()).toEqual([]);
      const retry = await store.assign('lost-race', ['p2'], 1, 2);
      expect(retry).toHaveLength(1);
      expect(retry[0]?.playerId).toBe('p2');
      expect(await store.activeMatchIds()).toEqual(['lost-race']);
    });

    it('atomically enforces the global active limit across competing rooms and calls', async () => {
      const requests = Array.from({ length: 6 }, (_, i) =>
        store.assign(`room-${i}`, ['p1', 'p2', 'p3'], 7, 1),
      );
      const all = (await Promise.all(requests)).flat();
      expect(all).toHaveLength(7);
      expect(new Set(all.map((a) => a.botId)).size).toBe(7);
      expect(await store.assign('full-room', ['p1'], 7, 2)).toEqual([]);
      const same = await Promise.all([
        store.assign('room-0', ['p1', 'p2', 'p3'], 7, 3),
        store.assign('room-0', ['p1', 'p2', 'p3'], 7, 3),
      ]);
      expect(same[0]).toEqual(same[1]);
    });

    it('caps allocation at 100 identities and never releases a live assignment merely because time passed', async () => {
      const seats = Array.from({ length: 105 }, (_, i) => `p${i + 1}`);
      const all = await store.assign('long-match', seats, 1000, 0);
      expect(all).toHaveLength(BOT_ROSTER_SIZE);
      expect(await store.assign('later-match', ['p1'], 100, 8_000_000_000_000)).toEqual([]);
      expect(await store.assign('long-match', seats, 0, 8_000_000_000_000)).toEqual(all);
    });

    it('rotates least recently assigned profiles and records each actual finish exactly once', async () => {
      const [first] = await store.assign('finished-match', ['p1'], 1, 1);
      const final = result(first!);
      await store.finishMatch('finished-match', [final], 2);
      expect((await store.findByLogin(first!.login))?.xp).toBe(120);
      expect(await store.recentMatches(first!.botId)).toEqual([
        { ...final, matchId: 'finished-match' },
      ]);
      expect(await store.activeMatchIds()).toEqual([]);
      expect(await store.assignments('finished-match')).toEqual([first]);
      const [next] = await store.assign('new-match', ['p1'], 1, 3);
      expect(next!.botId).not.toBe(first!.botId);
      await store.finishMatch('finished-match', [result(first!, { xp: 9999 })], 4);
      await store.ensureRoster();
      expect((await store.findByLogin(first!.login))?.xp).toBe(120);
      expect(await store.assign('finished-match', ['p1', 'p2'], 100, 5)).toEqual([first]);
      expect(await store.activeMatchIds()).toEqual(['new-match']);
    });

    it('rejects incomplete, duplicate and mismatched results before crediting or freeing any profile', async () => {
      const seats = await store.assign('result-match', ['p1', 'p2'], 2, 1);
      const good = seats.map((seat) => result(seat));
      for (const bad of [
        good.slice(0, 1),
        [good[0]!, good[0]!],
        [good[0]!, { ...good[1]!, playerId: 'foreign-seat' }],
        [good[0]!, { ...good[1]!, botId: 'foreign-bot' }],
      ]) {
        await expect(store.finishMatch('result-match', bad, 2)).rejects.toThrow(
          'E_BOT_RESULT_MISMATCH',
        );
      }
      expect(await store.activeMatchIds()).toEqual(['result-match']);
      expect(await store.assign('cannot-steal', ['p1'], 2, 3)).toEqual([]);
      for (const seat of seats) {
        expect((await store.findByLogin(seat.login))?.xp).toBe(0);
        expect(await store.recentMatches(seat.botId)).toEqual([]);
      }
      await store.finishMatch('result-match', good, 4);
      expect(await store.activeMatchIds()).toEqual([]);
    });

    it('atomically releases explicitly unplayed identities without XP or history and rejects conflicting declarations', async () => {
      const [played, unplayed] = await store.assign('partial-admission', ['p1', 'p2'], 2, 1);
      for (const ids of [
        [],
        [played!.botId],
        ['foreign-bot'],
        [unplayed!.botId, unplayed!.botId],
      ]) {
        await expect(
          store.finishMatch('partial-admission', [result(played!)], 2, ids),
        ).rejects.toThrow('E_BOT_RESULT_MISMATCH');
      }
      expect(await store.activeMatchIds()).toEqual(['partial-admission']);
      expect((await store.findByLogin(played!.login))?.xp).toBe(0);
      await store.finishMatch('partial-admission', [result(played!)], 3, [unplayed!.botId]);
      await store.finishMatch('partial-admission', [result(played!)], 4, [unplayed!.botId]);
      expect(await store.activeMatchIds()).toEqual([]);
      expect((await store.findByLogin(played!.login))?.xp).toBe(120);
      expect(await store.recentMatches(played!.botId)).toHaveLength(1);
      expect((await store.findByLogin(unplayed!.login))?.xp).toBe(0);
      expect(await store.recentMatches(unplayed!.botId)).toEqual([]);
      expect(await store.assign('later-match', ['p1', 'p2'], 2, 5)).toHaveLength(2);
    });

    it('a delayed finish or abandon of an old match cannot release a profile reused by a new match', async () => {
      const seats = Array.from({ length: 100 }, (_, i) => `p${i + 1}`);
      const old = await store.assign('old-match', seats, 100, 1);
      const results = old.map((seat) => result(seat, { outcome: 'draw', xp: 0, place: null }));
      await store.finishMatch('old-match', results, 2);
      const current = await store.assign('current-match', seats, 100, 3);
      expect(new Set(current.map((s) => s.botId))).toEqual(new Set(old.map((s) => s.botId)));
      await store.finishMatch('old-match', results, 4);
      await store.abandonMatch('old-match');
      expect(await store.activeMatchIds()).toEqual(['current-match']);
      expect(await store.assign('extra-match', ['p1'], 100, 5)).toEqual([]);
    });

    it('abandons only the named match, leaves its assignment history and invents no match result', async () => {
      const [lost] = await store.assign('lost-snapshot', ['p1'], 2, 1);
      const [live] = await store.assign('live-snapshot', ['p1'], 2, 2);
      await store.abandonMatch('lost-snapshot');
      await store.abandonMatch('lost-snapshot');
      expect(await store.activeMatchIds()).toEqual(['live-snapshot']);
      expect(await store.assignments('lost-snapshot')).toEqual([lost]);
      expect(await store.recentMatches(lost!.botId)).toEqual([]);
      expect((await store.findByLogin(lost!.login))?.xp).toBe(0);
      await store.finishMatch('lost-snapshot', [result(lost!)], 3);
      expect(await store.recentMatches(lost!.botId)).toEqual([]);
      expect(await store.assignments('live-snapshot')).toEqual([live]);
    });

    it('returns bounded history newest first without inventing losses from a draw', async () => {
      const all = await store.assign(
        'holders',
        Array.from({ length: 100 }, (_, i) => `p${i}`),
        100,
        1,
      );
      await store.finishMatch(
        'holders',
        all.map((seat) => result(seat, { endedAt: 10, xp: 0 })),
        2,
      );
      // Every profile participates so the same bot has more than the public history limit.
      for (let i = 0; i < 11; i++) {
        const match = `history-${i}`;
        const seats = await store.assign(
          match,
          Array.from({ length: 100 }, (_, n) => `p${n}`),
          100,
          3 + i,
        );
        await store.finishMatch(
          match,
          seats.map((seat) =>
            result(seat, {
              endedAt: 100 + i,
              outcome: i % 2 ? 'draw' : 'loss',
              xp: 0,
              place: null,
            }),
          ),
          30 + i,
        );
      }
      const history = await store.recentMatches(all[0]!.botId);
      expect(history).toHaveLength(10);
      expect(history.map((r) => r.endedAt)).toEqual([
        110, 109, 108, 107, 106, 105, 104, 103, 102, 101,
      ]);
      expect(history[1]?.outcome).toBe('draw');
      expect(await store.recentMatches(all[0]!.botId, 2)).toHaveLength(2);
      expect(await store.recentMatches(all[0]!.botId, 0)).toEqual([]);
      expect(await store.recentMatches('missing-bot', 1000)).toEqual([]);
    });

    it('rejects invalid clocks, XP and outcomes without altering a live assignment', async () => {
      await expect(store.assign('invalid', ['p1'], Number.NaN, 1)).rejects.toThrow(
        'E_BOT_ROSTER_INPUT',
      );
      await expect(store.assign('invalid', ['p1'], 1, -1)).rejects.toThrow('E_BOT_ROSTER_INPUT');
      const [seat] = await store.assign('validation', ['p1'], 1, 1);
      for (const extra of [
        { xp: -1 },
        { xp: 0.5 },
        { endedAt: 8.64e15 + 1 },
        { endedAt: -1 },
        { place: 0 },
        { outcome: 'unknown' as BotMatchResult['outcome'] },
      ]) {
        await expect(store.finishMatch('validation', [result(seat!, extra)], 2)).rejects.toThrow(
          'E_BOT_ROSTER_INPUT',
        );
      }
      expect(await store.activeMatchIds()).toEqual(['validation']);
      expect((await store.findByLogin(seat!.login))?.xp).toBe(0);
    });

    it('returns copies so callers cannot mutate saved identities, assignments or history', async () => {
      const identity = await store.findByLogin(SYSTEM_BOT_ROSTER[0]!.login);
      identity!.xp = 12345;
      expect((await store.findByLogin(SYSTEM_BOT_ROSTER[0]!.login))?.xp).toBe(0);
      const assigned = await store.assign('copies', ['p1'], 1, 1);
      const original = { ...assigned[0]! };
      assigned[0]!.playerId = 'changed';
      expect(await store.assignments('copies')).toEqual([original]);
      await store.finishMatch('copies', [result(original)], 2);
      const history = await store.recentMatches(original.botId);
      history[0]!.xp = 999;
      expect((await store.recentMatches(original.botId))[0]?.xp).toBe(120);
    });
  });
}

rosterContract('MemoryBotRosterStore', () => new MemoryBotRosterStore());

// The PostgreSQL adapter runs the same contract, including actual concurrent transactions.
// An isolated random schema keeps the fixed 100 identities out of other tests' tables.
const DB = process.env.DATABASE_URL;
describe.skipIf(!DB)('PostgresBotRosterStore', () => {
  const schema = `bot_roster_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: DB });
  const pool = new Pool({ connectionString: DB, options: `-c search_path=${schema}` });
  let created = false;
  beforeAll(async () => {
    // schema contains only a fixed prefix and UUID hex, never user input.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE bot_roster_results, bot_roster_assignments, bot_roster_matches, bot_roster_identities',
    );
  });
  afterAll(async () => {
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
  rosterContract('durable contract', () => new PostgresBotRosterStore(pool));

  it('survives a store restart without replacing profiles, reassigning live seats or duplicating results', async () => {
    const before = new PostgresBotRosterStore(pool);
    await before.ensureRoster();
    const [finished] = await before.assign('persisted-end', ['p1'], 2, 1);
    await before.finishMatch('persisted-end', [result(finished!)], 2);
    const live = await before.assign('persisted-live', ['p1'], 1, 3);
    const after = new PostgresBotRosterStore(pool);
    await after.ensureRoster();
    expect(await after.assign('persisted-live', ['p1'], 1, 4)).toEqual(live);
    expect(await after.assign('other-room', ['p1'], 1, 5)).toEqual([]);
    expect((await after.findByLogin(finished!.login))?.xp).toBe(120);
    await after.finishMatch('persisted-end', [result(finished!)], 6);
    expect((await after.findByLogin(finished!.login))?.xp).toBe(120);
    expect(await after.recentMatches(finished!.botId)).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::integer AS n FROM users')).rows[0]?.n).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::integer AS n FROM bot_roster_identities')).rows[0]?.n,
    ).toBe(100);
  });
});
