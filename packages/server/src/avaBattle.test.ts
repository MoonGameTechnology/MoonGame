import { describe, expect, it } from 'vitest';
import { getStance, type Action } from '@void/shared-core';
import { AvaOrchestrator } from './avaOrchestrator';
import { AvaService } from './avaService';
import { CorpService, type CorpActor } from './corpService';
import { createStores } from './persistence';
import type { LoadedMatch } from './roomRegistry';
import { loadAvaMaps, loadShippedData, MODULE_MANIFEST_VERSION } from './scenario';
import { createAvaRoom, createMatchLoader, declareAvaWar } from './serverWiring';

// CORP-4 — one corporation battle from the lock to the settlement, on the host's own
// composition: the roster sweep locks the matchup, the orchestrator raises the session
// (`createAvaRoom`), the match loader brings it up like any match (and again after a
// restart), the war sweep opens the war, the session cap ends it, and the ended snapshot
// settles the matchup. Before CORP-4 the chain broke at the load: the state was pinned to
// a module graph the loader refuses, the room read the wall clock as world time and ended
// on its first tick, and the victory counted every seat for itself.

const data = loadShippedData();
const DAY = 24 * 60 * 60 * 1000;
const A_HEAD: CorpActor = { accountId: 'a-head', login: 'ahead' };
const A_MEMBER: CorpActor = { accountId: 'a-mem', login: 'amember' };
const B_HEAD: CorpActor = { accountId: 'b-head', login: 'bhead' };

function move(playerId: string, fleetId: string, to: string): Action {
  return {
    id: `move:${fleetId}:${to}`,
    type: 'fleet.move',
    playerId,
    payload: { fleetId, to },
    issuedAt: 0,
  };
}

describe('AvA battle end to end (CORP-4)', () => {
  it('raises, loads, opens the war and settles a battle by its sides', async () => {
    let wall = Date.UTC(2026, 9, 22);
    const now = (): number => wall;
    const stores = await createStores({});
    const corp = new CorpService({ store: stores.corpStore, now });
    const ava = new AvaService({
      corpStore: stores.corpStore,
      challengeStore: stores.challengeStore,
      rosterStore: stores.rosterStore,
      resultStore: stores.resultStore,
      feedStore: stores.feedStore,
      now,
    });

    // Corp A (head + member) challenges corp B (head alone): two seats a side, so B's
    // spare seat goes to a bot.
    const a = await corp.create(A_HEAD, 'Alliance A');
    const b = await corp.create(B_HEAD, 'Alliance B');
    if (!a.ok || !b.ok) throw new Error('fixture: create failed');
    await corp.apply(A_MEMBER, a.corpId);
    await corp.accept(A_HEAD, a.corpId, A_MEMBER.accountId);
    await stores.corpStore.addInfluence(a.corpId, 500);
    await ava.setCorpReady(A_HEAD);
    await ava.setCorpReady(B_HEAD);
    const ch = await ava.challenge(A_HEAD, b.corpId);
    if (!ch.ok) throw new Error('fixture: challenge failed');
    expect((await ava.accept(B_HEAD, ch.id)).ok).toBe(true);
    for (const who of [A_HEAD, A_MEMBER, B_HEAD]) {
      expect((await ava.join(who, ch.id)).ok).toBe(true);
    }
    wall += DAY; // the roster window closes
    expect(await ava.sweepRosters()).toEqual({ locked: 1, cancelled: 0 });

    const load = createMatchLoader({ stores, data, now });
    let live: LoadedMatch | null = null;
    const orch = new AvaOrchestrator({
      challengeStore: stores.challengeStore,
      rosterStore: stores.rosterStore,
      sessionStore: stores.sessionStore,
      data,
      maps: loadAvaMaps(),
      manifest: MODULE_MANIFEST_VERSION,
      createRoom: createAvaRoom({ stores, data, now }),
      cancel: (matchupId) => ava.cancelLocked(matchupId),
      now,
      peaceMs: DAY,
      isMatchEnded: async (matchId) => (await stores.store.load(matchId))?.status === 'ended',
      escalateWar: (matchId) =>
        live ? declareAvaWar(live.room, matchId) : Promise.resolve(false),
      settle: (matchupId, side) => ava.settleMatch(matchupId, side),
    });
    expect(await orch.sweep()).toEqual({ raised: 1, cancelled: 0 });
    const session = await stores.sessionStore.byMatchup(ch.id);
    expect(session?.mapId).toBe('ava-2v2-1');
    expect(session?.seats).toEqual({ 'a-head': 'slot_a1', 'a-mem': 'slot_a2', 'b-head': 'slot_b1' });
    const matchId = session!.matchId;

    // The loader raises the battle under fixed sides, on its own world clock: the world
    // starts at 0, so the first tick is nowhere near the session cap.
    live = await load(matchId);
    expect(live).not.toBeNull();
    let room = live!.room;
    expect(room.modeId).toBe('team_2v2');
    room.tick();
    expect(room.state.time).toBe(0);
    expect(room.state.match.status).toBe('ongoing');
    const teams = Object.fromEntries(
      Object.entries(room.state.players).map(([id, p]) => [id, p.team]),
    );
    expect(teams).toEqual({ slot_a1: 'A', slot_a2: 'A', slot_b1: 'B', 'bot:slot_b2': 'B' });

    // Orders during the peace: each human takes a free province.
    for (const [playerId, fleetId, to] of [
      ['slot_a1', 'fleet_a1', 'west'],
      ['slot_a2', 'fleet_a2', 'nexus'],
      ['slot_b1', 'fleet_b1', 'east'],
    ] as const) {
      expect(await room.submitServerAction(playerId, move(playerId, fleetId, to))).toEqual({
        ok: true,
      });
    }
    wall += DAY / 2;
    room.tick();
    expect(room.state.planets.west?.owner).toBe('slot_a1');
    expect(room.state.planets.nexus?.owner).toBe('slot_a2');
    expect(room.state.planets.east?.owner).toBe('slot_b1');

    // A restart: the room comes back from its snapshot with its mode and its own clock,
    // which ran on while the room was down.
    await live!.dispose();
    live = null;
    wall += DAY / 2;
    live = await load(matchId);
    room = live!.room;
    room.tick();
    expect(room.modeId).toBe('team_2v2');
    expect(room.state.time).toBe(DAY);

    // The peace lapses: the war sweep opens the war between the two sides only.
    expect(await orch.sweepWar()).toEqual({ declared: 1 });
    expect(getStance(room.state, 'slot_a1', 'slot_b1')).toBe('war');
    expect(getStance(room.state, 'slot_a2', 'bot:slot_b2')).toBe('war');
    expect(getStance(room.state, 'slot_a1', 'slot_a2')).toBe('alliance');
    expect(getStance(room.state, 'slot_b1', 'bot:slot_b2')).toBe('alliance');

    // The session cap (100 world days) ends the battle by score. The best seat of each
    // side ties, so per-seat rules would call a draw; the side sum decides.
    wall += 98 * DAY;
    room.tick();
    expect(room.state.match.status).toBe('ongoing');
    wall += DAY;
    room.tick();
    const { match } = room.state;
    expect(match.status).toBe('ended');
    expect(match.reason).toBe('timeout');
    expect(match.endedAt).toBe(100 * DAY);
    const total = (id: string): number => match.scores[id]?.total ?? 0;
    expect(total('slot_a1')).toBe(total('slot_b1'));
    expect(total('slot_a1') + total('slot_a2')).toBeGreaterThan(
      total('slot_b1') + total('bot:slot_b2'),
    );
    expect(match.winners).toEqual(['slot_a1', 'slot_a2']);

    // The ended snapshot is the settlement outbox the host drains (`deliverAvaResults`):
    // corp A wins the matchup and its influence.
    await live!.dispose();
    const pending = await stores.sessionStore.pendingResults!();
    expect(pending).toEqual([{ matchId, matchupId: ch.id, winner: 'slot_a1' }]);
    for (const result of pending) await orch.onMatchEnded(result.matchId, result.winner);
    expect((await stores.resultStore.get(ch.id))?.winnerCorp).toBe(a.corpId);
    // 500 − 100 for the challenge + 150 for the win
    expect((await stores.corpStore.getCorp(a.corpId))?.influence).toBe(550);
  });
});
