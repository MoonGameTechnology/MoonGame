import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { avaShape, buildStateFromMap, getStance, pairKey, parseMatchMap, type MatchMap } from '@void/shared-core';
import {
  AvaOrchestrator,
  avaBotOrders,
  avaDeniedAction,
  seatAvaRoster,
  warDeclarationsFor,
  winnerSideOf,
  type AvaSessionSpec,
} from './avaOrchestrator';
import { loadAvaMaps, loadShippedData, MODULE_MANIFEST_VERSION } from './scenario';
import {
  MemoryAvaChallengeStore,
  MemoryAvaRosterStore,
  MemoryAvaSessionStore,
  type AvaBattleReport,
  type AvaChallenge,
  type AvaSide,
} from './store';

// AVA-7 — the orchestrator: a LOCKED matchup becomes a live AvA session. Seating is a pure
// function (allies grouped onto one side's slots, empties → AI); the session build seeds a
// PEACEFUL cross-team start (S5) and persists the fixed accountId → slot map resolveAvaSeat
// reads. The map/data are the real shipped content.

const data = loadShippedData();
const { pool, retired } = loadAvaMaps(data);
// The mechanics run on the two small AvA maps the catalog no longer plays (a duel and a
// 2 на 2): every slot is named for its side. The shipped pool has its own tests (CORP-8).
const maps = retired;

interface Harness {
  orch: AvaOrchestrator;
  challenges: MemoryAvaChallengeStore;
  roster: MemoryAvaRosterStore;
  sessions: MemoryAvaSessionStore;
  built: AvaSessionSpec[];
}

function harness(): Harness {
  const challenges = new MemoryAvaChallengeStore();
  const roster = new MemoryAvaRosterStore();
  const sessions = new MemoryAvaSessionStore();
  const built: AvaSessionSpec[] = [];
  const orch = new AvaOrchestrator({
    challengeStore: challenges,
    rosterStore: roster,
    sessionStore: sessions,
    data,
    maps,
    manifest: MODULE_MANIFEST_VERSION,
    createRoom: (spec) => {
      built.push(spec);
      return Promise.resolve();
    },
    now: () => 42,
  });
  return { orch, challenges, roster, sessions, built };
}

/** Seed a LOCKED matchup with the given roster on each side (bypassing AvaService). The
 *  format defaults to the larger side — the size the roster alone used to pick (CORP-7). */
async function lockedMatchup(
  h: Harness,
  id: string,
  challenger: string[],
  target: string[],
  format = Math.max(challenger.length, target.length),
): Promise<void> {
  const row: AvaChallenge = {
    id,
    challengerCorp: 'cA',
    targetCorp: 'cB',
    format,
    cost: 100,
    status: 'pending',
    createdAt: 1,
    expiresAt: 10,
  };
  await h.challenges.createChallenge(row);
  await h.challenges.closeChallenge(id, 'accepted');
  await h.challenges.closeMatchup(id, 'locked');
  const add = (side: AvaSide, accts: string[]): Promise<unknown> =>
    Promise.all(
      accts.map((accountId) =>
        h.roster.addEntry({ matchupId: id, accountId, side, source: 'self', at: 1 }, 4),
      ),
    );
  await add('challenger', challenger);
  await add('target', target);
}

describe('seatAvaRoster (AVA-7) — pure roster → slot seating', () => {
  const duel = maps.find((m) => m.id === 'ava-duel-1')!;
  const map2v2 = maps.find((m) => m.id === 'ava-2v2-1')!;

  it('seats each side onto its own team slots; playerId = slotId', () => {
    const { slots, seats } = seatAvaRoster(duel, { challenger: ['acc-a'], target: ['acc-b'] });
    expect(seats).toEqual({ 'acc-a': 'slot_a', 'acc-b': 'slot_b' });
    expect(slots.slot_a).toEqual({ playerId: 'slot_a' });
    expect(slots.slot_b).toEqual({ playerId: 'slot_b' });
  });

  it('groups allies on one side and fills an empty slot with an AI bot', () => {
    const { slots, seats } = seatAvaRoster(map2v2, {
      challenger: ['acc-a1', 'acc-a2'],
      target: ['acc-b1'],
    });
    // both challenger accounts land on team A's slots — a single front
    expect(seats['acc-a1']).toBe('slot_a1');
    expect(seats['acc-a2']).toBe('slot_a2');
    expect(seats['acc-b1']).toBe('slot_b1');
    // the empty target slot is a server AI, not a seat any account holds
    expect(slots.slot_b2).toEqual({ playerId: 'bot:slot_b2', ai: true });
    expect(Object.values(seats)).not.toContain('slot_b2');
  });

  it('is deterministic — sorted accounts map to sorted slots regardless of input order', () => {
    const a = seatAvaRoster(map2v2, { challenger: ['acc-a2', 'acc-a1'], target: [] });
    const b = seatAvaRoster(map2v2, { challenger: ['acc-a1', 'acc-a2'], target: [] });
    expect(a.seats).toEqual(b.seats);
    expect(a.seats).toEqual({ 'acc-a1': 'slot_a1', 'acc-a2': 'slot_a2' });
  });
});

describe('AvaOrchestrator.orchestrate (AVA-7) — raise a session from a locked roster', () => {
  it('builds a peaceful session with players in their slots and records the link', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu1', ['acc-a'], ['acc-b']);
    const res = await h.orch.orchestrate('mu1');
    expect(res).toEqual({
      ok: true,
      matchId: 'ava-mu1',
      mapId: 'ava-duel-1',
      seats: { 'acc-a': 'slot_a', 'acc-b': 'slot_b' },
    });
    // the room was raised once, with both slots seated as real players…
    expect(h.built).toHaveLength(1);
    const state = h.built[0]!.state;
    expect(Object.keys(state.players).sort()).toEqual(['slot_a', 'slot_b']);
    // …their homeworlds owned by them…
    expect(state.planets.home_a?.owner).toBe('slot_a');
    expect(state.planets.home_b?.owner).toBe('slot_b');
    // …and the cross-team stance seeded at PEACE (S5 combat-lock is free from the seed).
    expect(state.diplomacy?.[pairKey('slot_a', 'slot_b')]).toBe('peace');
    // the session link is persisted for resolveAvaSeat / settlement
    expect(await h.sessions.byMatch('ava-mu1')).toMatchObject({ matchupId: 'mu1', mapId: 'ava-duel-1' });
  });

  it('fills a short side with an AI bot and seats only the humans', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu2', ['acc-a1', 'acc-a2'], ['acc-b1']);
    const res = await h.orch.orchestrate('mu2');
    if (!res.ok) throw new Error(res.code);
    expect(res.mapId).toBe('ava-2v2-1');
    const state = h.built[0]!.state;
    expect(Object.keys(state.players)).toHaveLength(4); // 3 humans + 1 bot
    const bots = Object.values(state.players).filter((p) => p.ai);
    expect(bots).toHaveLength(1);
    expect(res.seats).toEqual({ 'acc-a1': 'slot_a1', 'acc-a2': 'slot_a2', 'acc-b1': 'slot_b1' });
  });

  it('pins the host’s module manifest, each seat’s side, the team mode (CORP-4) and the map (CORP-5)', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu-duel', ['acc-a'], ['acc-b']);
    await lockedMatchup(h, 'mu-team', ['acc-a1', 'acc-a2'], ['acc-b1']);
    await h.orch.orchestrate('mu-duel');
    await h.orch.orchestrate('mu-team');
    const [duel, team] = h.built.map((spec) => spec.state);
    // The loader resumes only a match pinned to the module graph it runs.
    expect(duel!.version.manifest).toBe(MODULE_MANIFEST_VERSION);
    expect(team!.version.manifest).toBe(MODULE_MANIFEST_VERSION);
    // A 1-on-1 needs no sides; a 2-on-2 is a fixed-side team match.
    expect(duel!.modeId).toBeUndefined();
    expect(team!.modeId).toBe('team_2v2');
    // The map the battle is played on is part of the match (CORP-5): the match browser
    // names the battle by it.
    expect(duel!.mapId).toBe('ava-duel-1');
    expect(team!.mapId).toBe('ava-2v2-1');
    // Every seat, bots included, carries its side from the map's slots.
    expect(Object.fromEntries(Object.values(team!.players).map((p) => [p.id, p.team]))).toEqual({
      slot_a1: 'A',
      slot_a2: 'A',
      slot_b1: 'B',
      'bot:slot_b2': 'B',
    });
  });

  it('the format sets the side size: bots take the seats the roster leaves (CORP-7)', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu-f2', ['acc-a'], ['acc-b'], 2);
    const res = await h.orch.orchestrate('mu-f2');
    if (!res.ok) throw new Error(res.code);
    expect(res.mapId).toBe('ava-2v2-1');
    expect(res.seats).toEqual({ 'acc-a': 'slot_a1', 'acc-b': 'slot_b1' });
    const state = h.built[0]!.state;
    expect(state.modeId).toBe('team_2v2');
    expect(
      Object.values(state.players)
        .filter((p) => p.ai)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['bot:slot_a2', 'bot:slot_b2']);
    // A format with a fixed-side mode but no map in the pool is refused.
    await lockedMatchup(h, 'mu-f3', ['a1', 'a2'], ['b1', 'b2'], 3);
    expect(await h.orch.orchestrate('mu-f3')).toEqual({ ok: false, code: 'E_NO_MAP' });
  });

  it('is idempotent — a second orchestrate returns the same session without rebuilding', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu3', ['acc-a'], ['acc-b']);
    const first = await h.orch.orchestrate('mu3');
    const second = await h.orch.orchestrate('mu3');
    expect(second).toEqual(first);
    expect(h.built).toHaveLength(1); // the room was built exactly once
  });

  it('rejects a missing, unlocked, or unsized matchup with a stable code', async () => {
    const h = harness();
    expect(await h.orch.orchestrate('nope')).toEqual({ ok: false, code: 'E_NO_MATCHUP' });
    // accepted-but-not-locked
    await h.challenges.createChallenge({
      id: 'mu-open',
      challengerCorp: 'cA',
      targetCorp: 'cB',
      format: 2,
      cost: 100,
      status: 'pending',
      createdAt: 1,
      expiresAt: 10,
    });
    await h.challenges.closeChallenge('mu-open', 'accepted');
    expect(await h.orch.orchestrate('mu-open')).toEqual({ ok: false, code: 'E_NOT_LOCKED' });
    // no map in this pool is a 2×3 — the pick fails, fail-secure
    await lockedMatchup(h, 'mu-big', ['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']);
    expect(await h.orch.orchestrate('mu-big')).toEqual({ ok: false, code: 'E_NO_MAP' });
    expect(h.built).toHaveLength(0);
  });
});

describe('AvaOrchestrator.resolveAvaSeat (AVA-7) — fixed AvA seating', () => {
  it('returns the rostered account its fixed slot; refuses outsiders; null for a non-AvA match', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu4', ['acc-a'], ['acc-b']);
    await h.orch.orchestrate('mu4');
    expect(await h.orch.resolveAvaSeat('ava-mu4', 'acc-a')).toEqual({ ok: true, playerId: 'slot_a' });
    expect(await h.orch.resolveAvaSeat('ava-mu4', 'acc-b')).toEqual({ ok: true, playerId: 'slot_b' });
    expect(await h.orch.resolveAvaSeat('ava-mu4', 'acc-x')).toEqual({
      ok: false,
      code: 'E_NOT_ROSTERED',
    });
    expect(await h.orch.resolveAvaSeat('some-other-match', 'acc-a')).toBeNull();
  });
});

describe('AvaOrchestrator × arsenal snapshot (ARS-3)', () => {
  it('attaches each rostered account’s arsenal at launch; bots stay unrestricted', async () => {
    const challenges = new MemoryAvaChallengeStore();
    const roster = new MemoryAvaRosterStore();
    const sessions = new MemoryAvaSessionStore();
    const built: AvaSessionSpec[] = [];
    const arsenals: Record<string, { hulls: string[]; modules: string[] }> = {
      'acc-a1': { hulls: ['cruiser'], modules: ['cargo_bay'] },
      'acc-a2': { hulls: ['scout_drone'], modules: [] },
      'acc-b': { hulls: ['shuttle_carrier'], modules: [] },
    };
    const orch = new AvaOrchestrator({
      challengeStore: challenges,
      rosterStore: roster,
      sessionStore: sessions,
      data,
      maps,
      manifest: MODULE_MANIFEST_VERSION,
      createRoom: (spec) => {
        built.push(spec);
        return Promise.resolve();
      },
      now: () => 42,
      arsenalOf: (accountId) => Promise.resolve(arsenals[accountId]!),
    });
    const h = { orch, challenges, roster, sessions, built } as unknown as Harness;
    await lockedMatchup(h, 'mu-ars', ['acc-a1', 'acc-a2'], ['acc-b']); // 2v1 → the 2v2 map
    await orch.orchestrate('mu-ars');

    const state = built[0]!.state;
    const seats = built[0]!.seats;
    // each HUMAN seat carries ITS account's snapshot in the built state…
    expect(state.players[seats['acc-a1']!]?.arsenal).toEqual(arsenals['acc-a1']);
    expect(state.players[seats['acc-a2']!]?.arsenal).toEqual(arsenals['acc-a2']);
    expect(state.players[seats['acc-b']!]?.arsenal).toEqual(arsenals['acc-b']);
    // …while the AI-filled empty slot builds unrestricted (no snapshot)
    const bot = Object.keys(state.players).find((id) => id.startsWith('bot:'))!;
    expect(state.players[bot]?.arsenal).toBeUndefined();
  });
});

describe('AvaOrchestrator × corp rentals (ARS-6)', () => {
  it('merges a corp-rented item into the seat’s snapshot alongside the personal one', async () => {
    const challenges = new MemoryAvaChallengeStore();
    const roster = new MemoryAvaRosterStore();
    const sessions = new MemoryAvaSessionStore();
    const built: AvaSessionSpec[] = [];
    const orch = new AvaOrchestrator({
      challengeStore: challenges,
      rosterStore: roster,
      sessionStore: sessions,
      data,
      maps,
      manifest: MODULE_MANIFEST_VERSION,
      createRoom: (spec) => {
        built.push(spec);
        return Promise.resolve();
      },
      now: () => 42,
      arsenalOf: (accountId) =>
        Promise.resolve(accountId === 'acc-a1' ? { hulls: ['cruiser'], modules: [] } : { hulls: [], modules: [] }),
      // ARS-6: acc-a1 also has a corp-rented module for THIS matchup only.
      corpRentalOf: (accountId, matchupId) =>
        Promise.resolve(
          accountId === 'acc-a1' && matchupId === 'mu-rent'
            ? { hulls: [], modules: ['cargo_bay'] }
            : { hulls: [], modules: [] },
        ),
    });
    const h = { orch, challenges, roster, sessions, built } as unknown as Harness;
    await lockedMatchup(h, 'mu-rent', ['acc-a1'], ['acc-b']);
    await orch.orchestrate('mu-rent');

    const state = built[0]!.state;
    const seats = built[0]!.seats;
    expect(state.players[seats['acc-a1']!]?.arsenal).toEqual({
      hulls: ['cruiser'], // personal
      modules: ['cargo_bay'], // rented in
    });
  });
});

describe('avaDeniedAction (CORP-5) — what a battle refuses its players', () => {
  it('keeps the war with the orchestrator and the Steward off every seat; orders pass', () => {
    expect(avaDeniedAction('diplomacy.declare')).toBe('E_AVA_DIPLOMACY');
    expect(avaDeniedAction('steward.delegate')).toBe('E_AVA_STEWARD');
    // Recalling a Steward that never ran harms nothing; the player's own orders are the game.
    for (const type of ['steward.recall', 'fleet.move', 'fleet.assault', 'diplomacy.mapshare'])
      expect(avaDeniedAction(type)).toBeNull();
  });

  it('a side’s bot loses the same intents from its plan: the war stays on the orchestrator’s clock', () => {
    const plan = [
      { type: 'fleet.move', id: 'm' },
      { type: 'diplomacy.declare', id: 'war-on-the-leader' },
      { type: 'unit.build', id: 'b' },
    ];
    expect(avaBotOrders(plan).map((order) => order.id)).toEqual(['m', 'b']);
  });
});

describe('AvaOrchestrator.sweep (AVA-7) — no client needed', () => {
  it('raises a session for every locked matchup that has none, idempotently', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu5', ['acc-a'], ['acc-b']);
    await lockedMatchup(h, 'mu6', ['acc-c'], ['acc-d']);
    expect(await h.orch.sweep()).toEqual({ raised: 2, cancelled: 0 });
    expect(h.built).toHaveLength(2);
    expect(await h.orch.sweep()).toEqual({ raised: 0, cancelled: 0 }); // both already have sessions
    expect(h.built).toHaveLength(2);
  });

  it('cancels a locked matchup no map fits instead of leaving it locked (CORP-4)', async () => {
    const challenges = new MemoryAvaChallengeStore();
    const roster = new MemoryAvaRosterStore();
    const sessions = new MemoryAvaSessionStore();
    const cancelled: string[] = [];
    const orch = new AvaOrchestrator({
      challengeStore: challenges,
      rosterStore: roster,
      sessionStore: sessions,
      data,
      maps,
      manifest: MODULE_MANIFEST_VERSION,
      createRoom: () => Promise.resolve(),
      // The service's locked→cancelled gate; here the store transition stands in for it.
      cancel: (matchupId) => {
        cancelled.push(matchupId);
        return challenges.endMatchup(matchupId, 'cancelled');
      },
    });
    const h = { orch, challenges, roster, sessions, built: [] } as unknown as Harness;
    // No map in this pool is a 3-on-3, and the game has no fixed-side 11-on-11 mode.
    await lockedMatchup(h, 'mu-3v3', ['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']);
    await lockedMatchup(h, 'mu-11v11', ['c1'], ['d1'], 11);
    await lockedMatchup(h, 'mu-duel', ['e1'], ['f1']);
    expect(await orch.sweep()).toEqual({ raised: 1, cancelled: 2 });
    expect(cancelled.sort()).toEqual(['mu-11v11', 'mu-3v3']);
    expect(await orch.sweep()).toEqual({ raised: 0, cancelled: 0 }); // no longer locked
  });
});

// ---- AVA-8 · S6 war timer + S7 settlement hook -------------------------------

interface WarHarness extends Harness {
  escalated: string[];
  settled: Array<{ matchupId: string; side: AvaSide | null }>;
  /** Flip to false to simulate a transient escalation failure. */
  escalateOk: { value: boolean };
}

function warHarness(
  peaceMs = 1_000,
  pools: { maps: readonly MatchMap[]; retiredMaps?: readonly MatchMap[] } = { maps },
): WarHarness {
  const challenges = new MemoryAvaChallengeStore();
  const roster = new MemoryAvaRosterStore();
  const sessions = new MemoryAvaSessionStore();
  const built: AvaSessionSpec[] = [];
  const escalated: string[] = [];
  const settled: Array<{ matchupId: string; side: AvaSide | null }> = [];
  const escalateOk = { value: true };
  const orch = new AvaOrchestrator({
    challengeStore: challenges,
    rosterStore: roster,
    sessionStore: sessions,
    data,
    ...pools,
    manifest: MODULE_MANIFEST_VERSION,
    createRoom: (spec) => {
      built.push(spec);
      return Promise.resolve();
    },
    now: () => 42,
    peaceMs,
    escalateWar: (matchId) => {
      if (escalateOk.value) escalated.push(matchId);
      return Promise.resolve(escalateOk.value);
    },
    settle: (matchupId, side) => {
      settled.push({ matchupId, side });
      return Promise.resolve();
    },
  });
  return { orch, challenges, roster, sessions, built, escalated, settled, escalateOk };
}

describe('AvaOrchestrator.sweepWar (AVA-8, S6) — the peace period ends on a timer', () => {
  it('stamps warAt at session creation and escalates exactly once when due', async () => {
    const h = warHarness(1_000);
    await lockedMatchup(h, 'mu7', ['acc-a'], ['acc-b']);
    await h.orch.orchestrate('mu7');
    expect((await h.sessions.byMatchup('mu7'))?.warAt).toBe(42 + 1_000); // now + peaceMs

    expect(await h.orch.sweepWar(42)).toEqual({ declared: 0 }); // peace still running
    expect(h.escalated).toHaveLength(0);
    expect(await h.orch.sweepWar(42 + 1_000)).toEqual({ declared: 1 }); // due → war opens
    expect(h.escalated).toEqual(['ava-mu7']);
    expect(await h.orch.sweepWar(42 + 2_000)).toEqual({ declared: 0 }); // exactly once
    expect(h.escalated).toHaveLength(1);
  });

  it('a failed escalation stays queued and retries on the next pass', async () => {
    const h = warHarness(100);
    await lockedMatchup(h, 'mu8', ['acc-a'], ['acc-b']);
    await h.orch.orchestrate('mu8');
    h.escalateOk.value = false;
    expect(await h.orch.sweepWar(9_999)).toEqual({ declared: 0 }); // transient failure
    h.escalateOk.value = true;
    expect(await h.orch.sweepWar(9_999)).toEqual({ declared: 1 }); // retried and landed
  });

  it('a matchup settled before its war is purged from the queue without escalating', async () => {
    const h = warHarness(100);
    await lockedMatchup(h, 'mu9', ['acc-a'], ['acc-b']);
    await h.orch.orchestrate('mu9');
    await h.challenges.endMatchup('mu9'); // e.g. a timeout ended the match in peace
    expect(await h.orch.sweepWar(9_999)).toEqual({ declared: 0 });
    expect(h.escalated).toHaveLength(0); // no stance flips on a finished match
    expect(await h.orch.sweepWar(9_999)).toEqual({ declared: 0 }); // and it stays purged
  });
});

describe('warDeclarationsFor (AVA-8, S6) — the system declarations that open the war', () => {
  it('declares exactly the cross-team (still-at-peace) pairs, with deterministic ids', async () => {
    const h = warHarness();
    await lockedMatchup(h, 'mu10', ['acc-a1', 'acc-a2'], ['acc-b1']);
    await h.orch.orchestrate('mu10');
    const state = h.built[0]!.state;
    const declares = warDeclarationsFor(state, 'ava-mu10');
    // 2v2 map: side A slots (2 humans) × side B (1 human + 1 bot) = 4 cross pairs;
    // the same-side ALLIANCE pairs are not declared.
    expect(declares).toHaveLength(4);
    for (const { playerId, action } of declares) {
      expect(action.type).toBe('diplomacy.declare');
      expect(action.playerId).toBe(playerId);
      expect((action.payload as { stance: string }).stance).toBe('war');
      expect(action.id.startsWith('ava-war:ava-mu10:')).toBe(true);
    }
    // Applying them all makes every cross pair hostile — nothing left to declare.
    const ids = Object.keys(state.players).sort();
    for (const { action } of declares) {
      const { target } = action.payload as { target: string };
      state.diplomacy![pairKey(action.playerId, target)] = 'war';
    }
    expect(warDeclarationsFor(state, 'ava-mu10')).toHaveLength(0);
    expect(ids).toHaveLength(4);
  });

  it('declares on the other side only — a map’s inhabitants keep their stance (CORP-4)', () => {
    // The authored team map seats inhabitants: neutral settlements at peace with every
    // seat, pirates and broods at war with all.
    const map = parseMatchMap(
      JSON.parse(readFileSync(new URL('../../../data/maps/team-2v2.json', import.meta.url), 'utf8')),
    );
    const { slots } = seatAvaRoster(map, { challenger: ['acc-a1', 'acc-a2'], target: ['acc-b1'] });
    const state = buildStateFromMap(map, data, { slots, crossTeamStart: 'peace' });
    const neutral = Object.keys(state.players).filter((id) => state.players[id]!.npc === 'neutral');
    expect(neutral.length).toBeGreaterThan(0);
    const declares = warDeclarationsFor(state, 'ava-team');
    const pairs = declares.map(({ action }) =>
      [action.playerId, (action.payload as { target: string }).target].join('>'),
    );
    expect(pairs).toEqual([
      'bot:slot_4>slot_1',
      'bot:slot_4>slot_2',
      'slot_1>slot_3',
      'slot_2>slot_3',
    ]);
    // Opening the war leaves every neutral settlement at peace with every seat.
    for (const { action } of declares) {
      const { target } = action.payload as { target: string };
      state.diplomacy![pairKey(action.playerId, target)] = 'war';
    }
    for (const id of neutral) expect(getStance(state, id, 'slot_1')).toBe('peace');
  });
});

describe('AvaOrchestrator.onMatchEnded (AVA-8, S7) — the settlement hook', () => {
  it('maps the winning player (slot or bot) to its side and settles once', async () => {
    const h = warHarness();
    await lockedMatchup(h, 'mu11', ['acc-a'], ['acc-b']);
    await h.orch.orchestrate('mu11');
    await h.orch.onMatchEnded('ava-mu11', 'slot_a'); // team A slot → challenger side
    expect(h.settled).toEqual([{ matchupId: 'mu11', side: 'challenger' }]);
    await h.orch.onMatchEnded('ava-mu11', 'bot:slot_b'); // a bot win still credits its side
    expect(h.settled[1]).toEqual({ matchupId: 'mu11', side: 'target' });
  });

  it('a draw settles with null; a non-AvA match is ignored', async () => {
    const h = warHarness();
    await lockedMatchup(h, 'mu12', ['acc-a'], ['acc-b']);
    await h.orch.orchestrate('mu12');
    await h.orch.onMatchEnded('ava-mu12', null); // timeout tie — no winner
    expect(h.settled).toEqual([{ matchupId: 'mu12', side: null }]);
    await h.orch.onMatchEnded('dev', 'green'); // a regular match — not ours
    expect(h.settled).toHaveLength(1);
  });

  it('sends the ended battle’s breakdown along (CORP-9)', async () => {
    const h = harness();
    await lockedMatchup(h, 'mu-r', ['acc-a1', 'acc-a2'], ['acc-b1']);
    await h.orch.orchestrate('mu-r');
    await h.sessions.markWarDeclared('ava-mu-r', 77);
    const ended = structuredClone(h.built[0]!.state);
    ended.match.status = 'ended';
    ended.match.reason = 'domination';
    const reports: Array<AvaBattleReport | null> = [];
    const settles = (endedState: (matchId: string) => Promise<typeof ended | null>) =>
      new AvaOrchestrator({
        challengeStore: h.challenges,
        rosterStore: h.roster,
        sessionStore: h.sessions,
        data,
        maps,
        manifest: MODULE_MANIFEST_VERSION,
        createRoom: () => Promise.resolve(),
        settle: (_matchupId, _side, report) => {
          reports.push(report);
          return Promise.resolve();
        },
        endedState,
        loginsOf: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]))),
      });
    await settles((matchId) => Promise.resolve(matchId === 'ava-mu-r' ? ended : null)).onMatchEnded(
      'ava-mu-r',
      'slot_a1',
    );
    expect(reports[0]).toMatchObject({ reason: 'domination', warAt: 77, provinces: 9 });
    expect(reports[0]?.seats.map((seat) => [seat.side, seat.accountId, seat.login])).toEqual([
      ['target', null, null], // the bot on the target's empty seat
      ['challenger', 'acc-a1', 'ACC-A1'],
      ['challenger', 'acc-a2', 'ACC-A2'],
      ['target', 'acc-b1', 'ACC-B1'],
    ]);
    // A host that keeps no ended snapshot settles without one.
    await settles(() => Promise.resolve(null)).onMatchEnded('ava-mu-r', 'slot_a1');
    expect(reports[1]).toBeNull();
  });

  it('winnerSideOf: unknown slots yield null (no influence on a broken mapping)', () => {
    const duel = maps.find((m) => m.id === 'ava-duel-1')!;
    expect(winnerSideOf(duel, 'slot_a')).toBe('challenger');
    expect(winnerSideOf(duel, 'bot:slot_b')).toBe('target');
    expect(winnerSideOf(duel, 'ghost')).toBeNull();
  });
});

it('keeps the game war clock and fixed seating independent of corporate availability', async () => {
  const h = harness();
  await lockedMatchup(h, 'independent', ['acc-a'], ['acc-b']);
  await h.orch.orchestrate('independent');
  h.challenges.getChallenge = async () => { throw Error('corporations offline'); };
  let opened = 0;
  const game = new AvaOrchestrator({ challengeStore: h.challenges, rosterStore: h.roster, sessionStore: h.sessions,
    data, maps, manifest: MODULE_MANIFEST_VERSION, createRoom: async () => undefined, isMatchEnded: async () => false,
    escalateWar: async () => { opened++; return true; } });
  expect(await game.resolveAvaSeat('ava-independent', 'acc-a')).toEqual({ ok: true, playerId: 'slot_a' });
  expect(await game.resolveAvaSeat('ava-independent', 'outsider')).toEqual({ ok: false, code: 'E_NOT_ROSTERED' });
  expect(await game.sweepWar(Number.MAX_SAFE_INTEGER)).toEqual({ declared: 1 });
  expect(opened).toBe(1);
});

describe('AvaOrchestrator × the shipped pool (CORP-8) — a map for every format', () => {
  const shipped = { maps: pool, retiredMaps: retired };

  it('raises every format on its map, with the sides its mode fixes', async () => {
    const h = warHarness(1_000, shipped);
    for (let n = 2; n <= 10; n++) {
      await lockedMatchup(h, `mu-n${n}`, ['acc-a'], ['acc-b'], n);
      const res = await h.orch.orchestrate(`mu-n${n}`);
      if (!res.ok) throw new Error(res.code);
      expect(res.mapId).toBe(n === 2 ? 'team-2v2' : n === 3 ? 'team-3v3' : 'ffa-20');
      const state = h.built.at(-1)!.state;
      expect(state.modeId).toBe(`team_${n}v${n}`);
      const seats = Object.values(state.players).filter((p) => !p.npc);
      expect(seats.filter((p) => p.team === 'A')).toHaveLength(n);
      expect(seats.filter((p) => p.team === 'B')).toHaveLength(n);
    }
  });

  it('a 4 на 4 on the 20-start map: starts out of play are neutral, inhabitants stay out of the war', async () => {
    const h = warHarness(1_000, shipped);
    await lockedMatchup(h, 'mu-cut', ['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], 4);
    const res = await h.orch.orchestrate('mu-cut');
    if (!res.ok) throw new Error(res.code);
    const state = h.built[0]!.state;
    const cut = pool.find((m) => m.id === 'ffa-20' && avaShape(m)?.slotsPerSide === 4)!;
    for (let i = 1; i <= 20; i++) {
      const home = state.planets[`home_${i}`]!;
      if (Object.hasOwn(cut.slots, `slot_${i}`)) {
        expect(home.owner).not.toBeNull();
        continue;
      }
      expect([home.owner, home.buildings, home.garrison]).toEqual([
        null,
        [],
        [{ unit: 'militia', count: 2 }],
      ]);
    }
    // One scout a seat, bots included; the starts out of play bring none.
    expect(Object.values(state.fleets).filter((f) => !state.players[f.owner]?.npc)).toHaveLength(8);
    const inhabitants = Object.values(state.players).filter((p) => p.npc);
    expect(inhabitants).toHaveLength(9);
    for (const p of inhabitants) expect(p.team).toBeUndefined();
    // The war is declared between the two sides only: 4 × 4 seats.
    expect(warDeclarationsFor(state, 'ava-mu-cut')).toHaveLength(16);
  });

  it('settles a battle by its start on a cut map, and one raised on a retired map', async () => {
    const h = warHarness(1_000, shipped);
    await lockedMatchup(h, 'mu-cut', ['acc-a'], ['acc-b'], 6);
    await h.orch.orchestrate('mu-cut');
    await h.orch.onMatchEnded('ava-mu-cut', 'slot_15'); // a top start → the challenger
    await h.orch.onMatchEnded('ava-mu-cut', 'bot:slot_19'); // its bottom pair → the target
    // A battle raised before the catalog stopped playing its map still settles by it.
    await h.sessions.create({
      matchId: 'ava-mu-old',
      matchupId: 'mu-old',
      mapId: 'ava-2v2-1',
      seats: {},
      at: 1,
      warAt: 2,
    });
    await h.orch.onMatchEnded('ava-mu-old', 'slot_b2');
    expect(h.settled).toEqual([
      { matchupId: 'mu-cut', side: 'challenger' },
      { matchupId: 'mu-cut', side: 'target' },
      { matchupId: 'mu-old', side: 'target' },
    ]);
  });
});
