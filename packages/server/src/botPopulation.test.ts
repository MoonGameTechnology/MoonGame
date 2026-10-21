import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameData, GameState } from '@void/shared-core';
import { MemoryBotRosterStore } from './botRoster';
import {
  botFillSeats,
  botMatchLimit,
  startBotArrivals,
  botPopulationConfig,
  prepareBotPopulation,
  recoverBotPopulation,
  settleBotMatch,
} from './botPopulation';
import { MemoryProfileStore } from './profileStore';
import { seatClaimAction, seatConfirmAction } from './joinSeat';
import { createDevMatch, loadShippedData } from './scenario';
import { MemoryAccountStore, MemoryMatchStore, MemoryUserStore, type MatchSnapshot } from './store';

let data: GameData;
beforeAll(() => {
  data = loadShippedData();
});
const NOW = 1_800_000_000_000;
const CONFIG = { fillPercent: 35, activeLimit: 20, joinMinMs: 300_000, joinMaxMs: 900_000 };

async function fixture(id = 'bots') {
  const bots = new MemoryBotRosterStore();
  await bots.ensureRoster();
  const accounts = new MemoryAccountStore();
  const profiles = new MemoryProfileStore();
  const matches = new MemoryMatchStore();
  const room = createDevMatch(data, {
    id,
    now: () => 0,
    players: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    mapId: 'test-map',
    persist: (snapshot) => matches.save(snapshot),
  });
  const prepare = (restored = false) =>
    prepareBotPopulation({
      matchId: id,
      room,
      bots,
      accounts,
      data,
      config: CONFIG,
      restored,
      now: NOW,
    });
  return {
    id,
    room,
    bots,
    accounts,
    profiles,
    matches,
    prepare,
    populate: async () => {
      await prepare();
      return prepare();
    },
  };
}

function ended(matchId: string, state: GameState): MatchSnapshot {
  const terminal = structuredClone(state);
  terminal.time = 10_000;
  terminal.match = {
    ...terminal.match,
    status: 'ended',
    endedAt: 10_000,
    winner: 'p6',
    rewards: { p5: { xp: 80, place: 2 }, p6: { xp: 120, place: 1 } },
  };
  return {
    matchId,
    dataVersion: data.version,
    seq: 100,
    state: terminal,
    status: 'ended',
    clock: { gameTime: 20_000, wallTime: NOW, timeScale: 10, running: false },
  };
}

describe('persistent bot population admission', () => {
  it('defaults to opt-in and validates the ratio, global cap and real-time interval', () => {
    expect(botPopulationConfig({})).toEqual({ ...CONFIG, fillPercent: 0 });
    expect(botPopulationConfig({ BOT_FILL_PERCENT: '35', BOT_ACTIVE_LIMIT: '100' })).toEqual({
      ...CONFIG,
      activeLimit: 100,
    });
    for (const raw of ['36', '-1', '1.5', 'NaN', '', ' 2', '1e2'])
      expect(() => botPopulationConfig({ BOT_FILL_PERCENT: raw })).toThrow('E_BOT_CONFIG');
    expect(() => botPopulationConfig({ BOT_JOIN_MIN_MS: '0' })).toThrow('E_BOT_CONFIG');
    expect(() => botPopulationConfig({ BOT_JOIN_MIN_MS: '900001' })).toThrow('E_BOT_CONFIG');
  });

  it('caps the ratio at 35%, rounds down, and excludes NPC, occupied, team and PvE seats', async () => {
    const { room } = await fixture();
    const s = structuredClone(room.state);
    expect(botFillSeats(s, data, new Set(), 35)).toEqual(['p6', 'p5']);
    s.players.p6!.claimedAt = 0;
    expect(botFillSeats(s, data, new Set(['p5']), 35, 1)).toEqual(['p4']);
    s.players.p4!.npc = 'pirate';
    expect(botFillSeats(s, data, new Set(['p5']), 35, 1)).toEqual([]);
    s.players.p1!.team = 'side-a';
    expect(botFillSeats(s, data, new Set(), 35)).toEqual([]);
    delete s.players.p1!.team;
    s.modeId = Object.entries(data.modes).find(([, mode]) => mode.pve)?.[0];
    expect(s.modeId).toBeDefined();
    expect(botFillSeats(s, data, new Set(), 35)).toEqual([]);
    delete s.modeId;
    s.match.status = 'ended';
    expect(botFillSeats(s, data, new Set(), 35)).toEqual([]);
    for (const [size, expected] of [
      [2, 0],
      [4, 1],
      [10, 3],
      [20, 7],
      [50, 17],
    ]) {
      const state = createDevMatch(data, {
        now: () => 0,
        players: Array.from({ length: size! }, (_, i) => `p${i}`),
      }).state;
      expect(botMatchLimit(state, 35)).toBe(expected);
      expect(botMatchLimit(state, 100)).toBe(expected);
    }
  });

  it('admits at most one bot per attempt and never exceeds seven on a 20-seat map', async () => {
    const w = await fixture();
    const room = createDevMatch(data, {
      id: w.id,
      now: () => 0,
      players: Array.from({ length: 20 }, (_, i) => `p${i}`),
    });
    const args = { ...w, matchId: w.id, room, data, config: CONFIG, restored: false, now: NOW };
    for (let n = 1; n <= 9; n++)
      expect(await prepareBotPopulation(args)).toHaveLength(Math.min(n, 7));
    expect(room.peerCount).toBe(0);
    const seats = await w.bots.assignments(w.id);
    room.state.players[seats[0]!.playerId]!.status = 'defeated';
    expect(await prepareBotPopulation(args)).toHaveLength(7);
  });

  it('durably claims and confirms named seats, without user registrations or fake peers', async () => {
    const w = await fixture();
    const assignments = await w.populate();
    expect(assignments).toHaveLength(2);
    expect(await w.prepare(true)).toEqual(assignments);
    expect(w.room.sequence).toBe(4); // claim + confirm once per seat
    expect(w.room.peerCount).toBe(0);
    const stored = await w.matches.load(w.id);
    for (const a of assignments) {
      expect(stored?.state.players[a.playerId]?.seated).toBe(true);
      expect(await w.accounts.seatOf(w.id, a.login)).toBe(a.playerId);
      expect(await new MemoryUserStore().findUser(a.login)).toBeNull();
    }
    const human = await w.accounts.resolveSeat(
      w.id,
      'alice',
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      'p6',
    );
    expect(['p1', 'p2', 'p3', 'p4']).toContain(human?.playerId);
    expect((await w.accounts.seatedNicks(w.id)).filter((a) => a.nick.startsWith('~'))).toHaveLength(
      2,
    );
  });

  it('does not add new participants during startup repair', async () => {
    const w = await fixture();
    expect(await w.prepare(true)).toEqual([]);
    expect(await w.accounts.occupiedSeats(w.id)).toBe(0);
  });

  it('repairs a crash between durable claim and confirmation even when new filling is disabled', async () => {
    const w = await fixture();
    let failConfirm = true;
    const room = createDevMatch(data, {
      id: w.id,
      now: () => 0,
      initialState: w.room.state,
      persist: async (snapshot, receipt) => {
        if (failConfirm && receipt.actionId.startsWith('seat-confirm:'))
          throw new Error('store offline');
        await w.matches.save(snapshot);
      },
    });
    const args = {
      matchId: w.id,
      room,
      bots: w.bots,
      accounts: w.accounts,
      data,
      config: CONFIG,
      restored: false,
      now: NOW,
    };
    await expect(prepareBotPopulation(args)).rejects.toThrow('E_BOT_CONFIRMATION');
    const stored = (await w.matches.load(w.id))!;
    expect(stored).not.toBeNull();
    expect(await w.bots.activeMatchIds()).toEqual([w.id]);
    failConfirm = false;
    const restored = createDevMatch(data, {
      id: w.id,
      now: () => 0,
      initialState: stored.state,
      initialSeq: stored.seq,
      persist: (snapshot) => w.matches.save(snapshot),
    });
    const assignments = await prepareBotPopulation({
      ...args,
      room: restored,
      restored: true,
      config: { ...CONFIG, fillPercent: 0, activeLimit: 0 },
    });
    expect(assignments).toHaveLength(1);
    for (const a of assignments) expect(restored.state.players[a.playerId]?.seated).toBe(true);
  });

  it('cancels only the unclaimed bot reservation when a human won the seat', async () => {
    const w = await fixture();
    await w.bots.assign(w.id, ['p4'], 20, NOW);
    await w.accounts.resolveSeat(w.id, 'alice', ['p4']);
    expect(await w.prepare(true)).toEqual([]);
    expect(await w.bots.assignments(w.id)).toEqual([]);
    expect(await w.accounts.seatOf(w.id, 'alice')).toBe('p4');
    expect(await w.accounts.occupiedSeats(w.id)).toBe(1);
  });

  it('loses a concurrent reservation to a human, then tries a different free seat later', async () => {
    const w = await fixture();
    const assign = w.bots.assign.bind(w.bots);
    vi.spyOn(w.bots, 'assign').mockImplementationOnce(async (...args) => {
      await w.accounts.resolveSeat(w.id, 'alice', args[1]);
      return assign(...args);
    });
    expect(await w.prepare()).toEqual([]);
    expect(await w.accounts.seatOf(w.id, 'alice')).toBe('p6');
    const seats = await w.prepare();
    expect(seats).toHaveLength(1);
    expect(seats[0]!.playerId).toBe('p5');
    expect(await w.accounts.seatOf(w.id, 'alice')).toBe('p6');
  });

  it('refuses an old ongoing snapshot whose assignment has already been retired', async () => {
    const w = await fixture();
    await w.bots.assign(w.id, ['p4'], 20, NOW);
    await w.bots.abandonMatch(w.id);
    await expect(w.prepare(true)).rejects.toThrow('E_BOT_ASSIGNMENT_INACTIVE');
    expect(await w.accounts.occupiedSeats(w.id)).toBe(0);
  });
});

describe('bot results and restart recovery', () => {
  it('credits real outcomes once, retries a failure between stores, and translates game time to UTC', async () => {
    const w = await fixture();
    const seats = await w.populate();
    const snapshot = ended(w.id, w.room.state);
    await w.matches.save(snapshot);
    const original = w.bots.finishMatch.bind(w.bots);
    vi.spyOn(w.bots, 'finishMatch')
      .mockRejectedValueOnce(new Error('store offline'))
      .mockImplementation(original);
    const args = { snapshot, bots: w.bots, profiles: w.profiles, accounts: w.accounts, now: NOW };
    await expect(settleBotMatch(args)).rejects.toThrow('store offline');
    expect(await w.bots.activeMatchIds()).toEqual([w.id]);
    expect(await w.profiles.progress(seats[0]!.botId)).toMatchObject({ matches: 1 });
    await settleBotMatch(args);
    await settleBotMatch(args);
    expect(await w.bots.activeMatchIds()).toEqual([]);
    for (const seat of seats) {
      const won = seat.playerId === 'p6';
      expect(await w.profiles.progress(seat.botId)).toMatchObject({ matches: 1 });
      expect((await w.profiles.progress(seat.botId)).wins ?? 0).toBe(won ? 1 : 0);
      expect((await w.bots.findByLogin(seat.login))?.xp).toBe(won ? 120 : 80);
      expect(await w.bots.recentMatches(seat.botId)).toEqual([
        expect.objectContaining({
          matchId: w.id,
          mapId: 'test-map',
          endedAt: NOW - 1000,
          outcome: won ? 'win' : 'loss',
        }),
      ]);
    }
  });

  it('records a draw with no fabricated victory, place or XP when rewards are absent', async () => {
    const w = await fixture();
    const seats = await w.populate();
    const snapshot = ended(w.id, w.room.state);
    snapshot.state.match.winner = null;
    delete snapshot.state.match.rewards;
    await settleBotMatch({
      snapshot,
      bots: w.bots,
      profiles: w.profiles,
      accounts: w.accounts,
      now: NOW,
    });
    expect((await w.bots.recentMatches(seats[0]!.botId))[0]).toMatchObject({
      outcome: 'draw',
      xp: 0,
      place: null,
    });
    expect((await w.profiles.progress(seats[0]!.botId)).wins ?? 0).toBe(0);
  });

  it('keeps incomplete participants pinned while their durable match is still live', async () => {
    const w = await fixture();
    const seats = await w.bots.assign(w.id, ['p4'], 20, NOW);
    const snapshot: MatchSnapshot = {
      matchId: w.id,
      dataVersion: data.version,
      seq: 0,
      status: 'ongoing',
      state: w.room.state,
    };
    await w.matches.save(snapshot);
    await recoverBotPopulation({ ...w, now: () => NOW });
    expect(await w.bots.activeMatchIds()).toEqual([w.id]);
    expect(await w.profiles.progress(seats[0]!.botId)).toEqual({});
  });

  it('recovers a real terminal deadline crossed between durable claim and confirmation without invented participation', async () => {
    const w = await fixture();
    let wall = 0;
    const room = createDevMatch(data, {
      id: w.id,
      now: () => wall,
      initialState: w.room.state,
      config: { timeScale: 1, victory: { endsAt: 1000 } },
      persist: async (snapshot, receipt) => {
        await w.matches.save(snapshot);
        // A slow claim roundtrip crosses the deadline. The real confirmation's
        // clock catch-up ends the world before the kernel can confirm the seat.
        if (receipt.actionId.startsWith('seat-claim:')) wall = 1000;
      },
    });
    await expect(
      prepareBotPopulation({
        matchId: w.id,
        room,
        bots: w.bots,
        accounts: w.accounts,
        data,
        config: CONFIG,
        restored: false,
        now: NOW,
      }),
    ).rejects.toThrow('E_BOT_CONFIRMATION');
    const [seat] = await w.bots.assignments(w.id);
    expect(room.state.match).toMatchObject({ status: 'ended', reason: 'timeout' });
    expect(room.state.players[seat!.playerId]).toMatchObject({ claimedAt: 0 });
    expect(room.state.players[seat!.playerId]!.seated).not.toBe(true);
    expect((await w.matches.load(w.id))!.status).toBe('ended');
    await recoverBotPopulation({ ...w, now: () => NOW });
    await recoverBotPopulation({ ...w, now: () => NOW });
    expect(await w.bots.activeMatchIds()).toEqual([]);
    expect(await w.profiles.progress(seat!.botId)).toEqual({});
    expect((await w.bots.findByLogin(seat!.login))?.xp).toBe(0);
    expect(await w.bots.recentMatches(seat!.botId)).toEqual([]);
    expect(await w.bots.assign('next-match', ['p1'], 1, NOW + 1)).toHaveLength(1);
  });

  it('settles confirmed participants while releasing only unplayed identities without a result', async () => {
    const w = await fixture();
    const played = await w.populate();
    const all = await w.bots.assign(w.id, ['p4'], 20, NOW);
    const unplayed = all.find((seat) => !played.some((a) => a.botId === seat.botId))!;
    const snapshot = ended(w.id, w.room.state);
    await settleBotMatch({
      snapshot,
      bots: w.bots,
      profiles: w.profiles,
      accounts: w.accounts,
      now: NOW,
    });
    expect(await w.bots.activeMatchIds()).toEqual([]);
    for (const seat of played) {
      expect(await w.profiles.progress(seat.botId)).toMatchObject({ matches: 1 });
      expect(await w.bots.recentMatches(seat.botId)).toHaveLength(1);
      expect((await w.bots.findByLogin(seat.login))?.xp).toBeGreaterThan(0);
    }
    expect(await w.profiles.progress(unplayed.botId)).toEqual({});
    expect(await w.bots.recentMatches(unplayed.botId)).toEqual([]);
    expect((await w.bots.findByLogin(unplayed.login))?.xp).toBe(0);
  });

  it('rejects a terminal snapshot with a missing assigned player instead of treating it as unplayed', async () => {
    const w = await fixture();
    const [seat] = await w.bots.assign(w.id, ['missing-seat'], 20, NOW);
    await expect(
      settleBotMatch({
        snapshot: ended(w.id, w.room.state),
        bots: w.bots,
        profiles: w.profiles,
        accounts: w.accounts,
        now: NOW,
      }),
    ).rejects.toThrow('E_BOT_RESULT_INCOMPLETE');
    expect(await w.bots.activeMatchIds()).toEqual([w.id]);
    expect(await w.profiles.progress(seat!.botId)).toEqual({});
  });

  it('does not credit a human result when the human won an assigned bot seat before the match ended', async () => {
    const w = await fixture();
    let wall = 0;
    const room = createDevMatch(data, {
      id: w.id,
      now: () => wall,
      initialState: w.room.state,
      config: { timeScale: 1, victory: { endsAt: 1000 } },
      persist: (snapshot) => w.matches.save(snapshot),
    });
    const [bot] = await w.bots.assign(w.id, ['p6'], 1, NOW);
    // Allocation has committed, but the human wins the authoritative reservation
    // and actually enters the map before the bot's resolveSeat can cancel it.
    await w.accounts.resolveSeat(w.id, 'alice', ['p6']);
    expect(
      (await room.submitServerAction('p6', seatClaimAction(w.id, 'p6', room.state.time, {}))).ok,
    ).toBe(true);
    expect(
      (
        await room.submitServerAction(
          'p6',
          seatConfirmAction(w.id, 'p6', room.state.time, room.state.players.p6!.claimedAt),
        )
      ).ok,
    ).toBe(true);
    wall = 1000;
    await room.submitServerAction('p1', seatClaimAction(w.id, 'p1', room.state.time, {}));
    const snapshot = (await w.matches.load(w.id))!;
    expect(snapshot.state.match).toMatchObject({ status: 'ended', reason: 'timeout' });
    expect(snapshot.state.players.p6!.seated).toBe(true);
    expect(await w.accounts.seatOf(w.id, bot!.login)).toBeNull();
    await settleBotMatch({
      snapshot,
      bots: w.bots,
      profiles: w.profiles,
      accounts: w.accounts,
      now: NOW,
    });
    // A delayed admission cancellation cannot manufacture or erase a result.
    await w.bots.cancelUnclaimedAssignment(w.id, bot!.botId);
    await recoverBotPopulation({ ...w, now: () => NOW });
    expect(await w.bots.activeMatchIds()).toEqual([]);
    expect((await w.bots.findByLogin(bot!.login))?.xp).toBe(0);
    expect(await w.profiles.progress(bot!.botId)).toEqual({});
    expect(await w.bots.recentMatches(bot!.botId)).toEqual([]);
    expect(await w.accounts.seatOf(w.id, 'alice')).toBe('p6');
  });

  it('rejects conflicting bot ownership or an account-store outage before any profile credit', async () => {
    const w = await fixture();
    const seats = await w.populate();
    const snapshot = ended(w.id, w.room.state);
    const args = { snapshot, bots: w.bots, profiles: w.profiles, accounts: w.accounts, now: NOW };
    const credit = vi.spyOn(w.profiles, 'credit');
    const seatOf = vi.spyOn(w.accounts, 'seatOf').mockRejectedValueOnce(new Error('offline'));
    await expect(settleBotMatch(args)).rejects.toThrow('offline');
    seatOf.mockRestore();
    await w.accounts.releaseSeat(w.id, seats[0]!.login);
    await w.accounts.resolveSeat(w.id, seats[0]!.login, ['p1']);
    await expect(settleBotMatch(args)).rejects.toThrow('E_BOT_SEAT_CONFLICT');
    expect(credit).not.toHaveBeenCalled();
    expect(await w.bots.activeMatchIds()).toEqual([w.id]);
    for (const seat of seats) {
      expect(await w.profiles.progress(seat.botId)).toEqual({});
      expect(await w.bots.recentMatches(seat.botId)).toEqual([]);
    }
  });

  it('recovers terminal results and true orphans while leaving live matches pinned', async () => {
    const w = await fixture('completed');
    await w.populate();
    await w.matches.save(ended(w.id, w.room.state));
    const orphan = (await w.bots.assign('orphan', ['p1'], 20, NOW))[0]!;
    await w.accounts.resolveSeat('orphan', orphan.login, ['p1']);
    await w.bots.assign('live', ['p3'], 20, NOW);
    await w.matches.save({
      matchId: 'live',
      state: w.room.state,
      seq: 0,
      status: 'ongoing',
      dataVersion: data.version,
    });
    await recoverBotPopulation({
      bots: w.bots,
      profiles: w.profiles,
      accounts: w.accounts,
      matches: w.matches,
      now: () => NOW,
    });
    expect(await w.bots.activeMatchIds()).toEqual(['live']);
    expect(await w.accounts.occupiedSeats('orphan')).toBe(0);
    expect(await w.bots.recentMatches(orphan.botId)).toEqual([]);
  });

  it('does not confuse a storage outage with an absent match', async () => {
    const w = await fixture();
    await w.populate();
    vi.spyOn(w.matches, 'load').mockRejectedValue(new Error('unavailable'));
    await expect(
      recoverBotPopulation({
        bots: w.bots,
        profiles: w.profiles,
        accounts: w.accounts,
        matches: w.matches,
        now: () => NOW,
      }),
    ).rejects.toThrow('unavailable');
    expect(await w.bots.activeMatchIds()).toEqual([w.id]);
    expect(await w.accounts.occupiedSeats(w.id)).toBe(2);
  });
});

describe('gradual bot arrival timing', () => {
  afterEach(() => vi.useRealTimers());

  it('waits before the first arrival, serializes slow admissions, and stops cleanly', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const join = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const loop = startBotArrivals({
      config: CONFIG,
      random: () => 0,
      canJoin: () => true,
      join,
      onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(CONFIG.joinMinMs - 1);
    expect(join).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(join).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CONFIG.joinMaxMs * 10);
    expect(join).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(CONFIG.joinMinMs);
    expect(join).toHaveBeenCalledTimes(2);
    loop.stop();
    finish();
    await vi.advanceTimersByTimeAsync(CONFIG.joinMaxMs * 10);
    expect(join).toHaveBeenCalledTimes(2);
  });

  it('retries errors slowly, starts a fresh wait on restart and stops on a closed entry window', async () => {
    vi.useFakeTimers();
    const join = vi.fn().mockRejectedValue(new Error('offline'));
    const onError = vi.fn();
    let open = true;
    const args = { config: CONFIG, random: () => 0.5, canJoin: () => open, join, onError };
    const first = startBotArrivals(args);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(join).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    first.stop();
    await vi.advanceTimersByTimeAsync(86_400_000);
    const restarted = startBotArrivals(args);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(join).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(join).toHaveBeenCalledTimes(2);
    open = false;
    await vi.advanceTimersByTimeAsync(6_000_000);
    expect(join).toHaveBeenCalledTimes(2);
    restarted.stop();
  });
});
