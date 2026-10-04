import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  createInitialState,
  createKernel,
  hashState,
  parseGameData,
  visibleView,
  type Action,
  type GameData,
  type GameModule,
  type MatchConfig,
  type GameState,
  type Player,
} from '@void/shared-core';
import { MatchRoom, type RoomObservation, type RoomPeer } from './matchRoom';
import type { ServerMessage } from './protocol';

class MemoryPeer implements RoomPeer {
  readonly messages: ServerMessage[] = [];

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
}

const renameModule: GameModule = {
  id: 'rename-test',
  version: '1.0.0',
  setup(api) {
    api.onAction('player.rename', (action, h) => {
      const payload = action.payload;
      if (typeof payload !== 'object' || payload === null || !('name' in payload)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const name = (payload as { name: unknown }).name;
      if (typeof name !== 'string' || name.length === 0) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_FORBIDDEN');
      player.name = name;
      h.emit('player.renamed', { playerId: action.playerId, name });
    });
  },
};

function player(id: string, name: string): Player {
  return { id, name, faction: id, status: 'active', resources: {} };
}

function testData(): GameData {
  return parseGameData({
    version: 'test',
    resources: ['credits'],
    units: {},
    factions: {},
    buildings: {},
    events: {},
    sectors: {},
    planetTypes: {},
  });
}

function testState(): GameState {
  const base = createInitialState({
    seed: 'server-test',
    version: { data: 'test', manifest: 'test' },
  });
  return { ...base, players: { p1: player('p1', 'One'), p2: player('p2', 'Two') } };
}

function action(id: string, playerId: string, name: string): Action {
  return { id, type: 'player.rename', playerId, issuedAt: 1, payload: { name } };
}

function room(): MatchRoom {
  return new MatchRoom({
    id: 'test-room',
    initialState: testState(),
    kernel: createKernel([renameModule]),
    data: testData(),
    now: () => 10,
  });
}

describe('MatchRoom — player-action deny-list (AVA-8)', () => {
  function deniedRoom(): MatchRoom {
    return new MatchRoom({
      id: 'ava-room',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      // The AvA wire rule: the orchestrator owns this action type — players don't.
      denyPlayerActions: (type) => (type === 'player.rename' ? 'E_AVA_DIPLOMACY' : null),
    });
  }

  it('refuses a denied type on the wire with the stable code; nothing applies', async () => {
    const r = deniedRoom();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    await r.receive(
      'p1',
      p1,
      JSON.stringify({ type: 'action', matchId: 'ava-room', action: action('a1', 'p1', 'Sneaky') }),
    );
    expect(p1.messages.at(-1)).toMatchObject({
      type: 'rejection',
      actionId: 'a1',
      code: 'E_AVA_DIPLOMACY',
    });
    expect(r.state.players.p1?.name).toBe('One'); // the reducer never saw it
  });

  it('server-internal submits bypass the wire deny (the orchestrator owns the stances)', async () => {
    const r = deniedRoom();
    const result = await r.submitServerAction('p1', action('a2', 'p1', 'System'));
    expect(result.ok).toBe(true);
    expect(r.state.players.p1?.name).toBe('System');
  });
});

describe('MatchRoom', () => {
  it('sends one anonymous group contact and clears it in a delta after dispersion', () => {
    const data = parseGameData({ ...testData(),
      units: { scout: { faction: 'p2', signature: 1, stats: { attack: 1, defense: 1, speed: 1, hp: 10 } } },
      buildings: { radar: { name: 'Radar', radarRange: 300, radarLevel: 2 } },
    });
    const initialState = testState();
    for (const [id, x] of [['home', 0], ['near', 230], ['far', 290]] as const) {
      initialState.planets[id] = { id, owner: id === 'home' ? 'p1' : null,
        position: { x, y: 0 }, links: [], buildings: [], garrison: [], resources: {}, traits: [] };
    }
    initialState.planets.home!.buildings = [{ type: 'radar', level: 1, hp: 10 }];
    initialState.fleets.secretA = { id: 'secretA', owner: 'p2', location: 'near', movement: null,
      units: [{ unit: 'scout', count: 3 }], traits: [] };
    initialState.fleets.secretB = { id: 'secretB', owner: 'p2', location: null,
      movement: { from: 'near', to: 'far', departedAt: 0, arrivesAt: 60 },
      units: [{ unit: 'scout', count: 2 }], traits: [] };
    let now = 0;
    const r = new MatchRoom({ id: 'signals', initialState, kernel: createKernel([]), data, now: () => now });
    const peer = new MemoryPeer();
    r.addPeer('p1', peer);
    expect(peer.messages[0]).toMatchObject({ type: 'welcome', signatures: [{ location: 'near', size: 'M' }] });
    now = 60;
    r.tick();
    expect(peer.messages.at(-1)).toMatchObject({ type: 'delta', signatures: [] });
    expect(JSON.stringify(peer.messages)).not.toContain('secretA');
    expect(JSON.stringify(peer.messages)).not.toContain('secretB');
  });

  it('welcomes each player with the authoritative snapshot', () => {
    const r = room();
    const p1 = new MemoryPeer();

    expect(r.addPeer('p1', p1)).toBe(true);

    expect(p1.messages).toHaveLength(1);
    expect(p1.messages[0]).toMatchObject({ type: 'welcome', matchId: 'test-room', playerId: 'p1' });
  });

  it('serializes an action and broadcasts the new state to every peer', () => {
    const r = room();
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.addPeer('p2', p2);

    const result = r.submitAction('p1', action('a1', 'p1', 'Commander'), p1);

    expect(result.ok).toBe(true);
    expect(r.state.players.p1?.name).toBe('Commander');
    // each peer gets a delta carrying only the changed entity, not the full state
    expect(p1.messages.at(-1)).toMatchObject({
      type: 'delta',
      seq: 1,
      delta: { changed: { players: { p1: { name: 'Commander' } } } },
    });
    expect(p2.messages.at(-1)).toMatchObject({ type: 'delta', seq: 1 });
  });

  it('a peer reconstructs the exact server state from welcome + deltas', () => {
    const r = room();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    const welcome = p1.messages[0];
    if (welcome?.type !== 'welcome') throw new Error('expected a welcome snapshot');
    let clientState = welcome.state;
    r.submitAction('p1', action('a1', 'p1', 'Commander'), p1);
    r.submitAction('p1', action('a2', 'p1', 'Admiral'), p1);
    for (const m of p1.messages) {
      if (m.type === 'delta') clientState = applyDelta(clientState, m.delta);
    }
    // What the peer must reconstruct is its own PROJECTION, not the raw server state:
    // the fog boundary drops the authoritative-internal bits before anything goes on the
    // wire (`rng` — the world's dice — and `fog` itself). Compare against exactly what
    // the room sends, so this stays a test of the delta pipeline's losslessness rather
    // than an accidental assertion that the projection strips nothing.
    const { signatures: _sig, remembered: _rem, ...sent } = visibleView(r.state, 'p1', testData()).view;
    expect(clientState).toEqual(sent);
  });

  it('rejects cross-player spoofed actions without broadcasting state', () => {
    const r = room();
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.addPeer('p2', p2);

    const result = r.submitAction('p2', action('spoof', 'p1', 'Spoofed'), p2);

    expect(result).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(r.state.players.p1?.name).toBe('One');
    expect(p2.messages.at(-1)).toMatchObject({
      type: 'rejection',
      actionId: 'spoof',
      code: 'E_FORBIDDEN',
    });
    expect(p1.messages).toHaveLength(1);
  });

  it('deduplicates retried action ids', () => {
    const r = room();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);

    const first = r.submitAction('p1', action('a1', 'p1', 'First'), p1);
    const second = r.submitAction('p1', action('a1', 'p1', 'Second'), p1);

    expect(first).toMatchObject({ ok: true, seq: 1 });
    expect(second).toMatchObject({ ok: true, seq: 1 });
    expect(r.state.players.p1?.name).toBe('First');
    // first action → delta broadcast; the deduped retry → full state resync
    expect(p1.messages.filter((m) => m.type === 'delta' || m.type === 'state')).toHaveLength(2);
  });

  it('validates inbound client messages before applying them', () => {
    const r = room();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);

    r.receive('p1', p1, '{bad json');
    r.receive('p1', p1, JSON.stringify({ type: 'action', action: action('a2', 'p1', 'Valid') }));

    expect(p1.messages[1]).toMatchObject({ type: 'error', code: 'E_BAD_MESSAGE' });
    expect(r.state.players.p1?.name).toBe('Valid');
  });
});

// Ends the match on a `match.surrender` action so observeEndIfNeeded fires.
const surrenderModule: GameModule = {
  id: 'surrender-test',
  version: '1.0.0',
  setup(api) {
    api.onAction('match.surrender', (action, h) => {
      const other = action.playerId === 'p1' ? 'p2' : 'p1';
      h.state.match.status = 'ended';
      h.state.match.winner = other;
      h.state.match.reason = 'elimination';
      h.emit('match.ended', { winner: other });
    });
  },
};

function surrenderAction(id: string, playerId: string): Action {
  return { id, type: 'match.surrender', playerId, issuedAt: 1, payload: {} };
}

// Ends the match on a `time.advanced` SPAN once the world passes a deadline — the
// score/domination shape, where the boundary is crossed by a catch-up advance and NOT
// by the triggering action (which then rejects with E_MATCH_ENDED). Sets a reward table
// so the test can assert it survives to the `end` observation.
const deadlineModule: GameModule = {
  id: 'deadline-test',
  version: '1.0.0',
  setup(api) {
    api.on('time.advanced', (event, h) => {
      // `time.advanced` fires with h.state.time at the span START and the reached time
      // in the payload (`to`) — mirror how the real victory module ends mid-advance.
      const to = (event.payload as { to?: number }).to ?? 0;
      if (h.state.match.status !== 'ended' && to >= 100) {
        h.state.match.status = 'ended';
        h.state.match.winner = 'p1';
        h.state.match.reason = 'domination';
        h.state.match.rewards = { p1: { place: 1, xp: 200 }, p2: { place: 2, xp: 40 } };
      }
    });
  },
};

describe('MatchRoom — observation & state hash (M0)', () => {
  function observed(options?: { emitStateHash?: boolean }): {
    r: MatchRoom;
    events: RoomObservation[];
  } {
    const events: RoomObservation[] = [];
    const r = new MatchRoom({
      id: 'obs',
      initialState: testState(),
      kernel: createKernel([renameModule, surrenderModule]),
      data: testData(),
      now: () => 10,
      observe: (e) => events.push(e),
      ...(options?.emitStateHash ? { emitStateHash: true } : {}),
    });
    return { r, events };
  }

  it('reports join, action (ok + reject) and leave to the observer', () => {
    const { r, events } = observed();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.submitAction('p1', action('a1', 'p1', 'Commander'), p1); // ok
    r.submitAction('p1', action('a2', 'p1', ''), p1); // rejected (empty name)
    r.removePeer('p1', p1);

    // Lifecycle kinds only — the M1 metrics kinds (events/broadcast/timing) ride the
    // same stream and have their own describe below.
    const lifecycle = events.filter(
      (e) => e.kind === 'join' || e.kind === 'action' || e.kind === 'leave',
    );
    expect(lifecycle).toEqual([
      { kind: 'join', playerId: 'p1' },
      { kind: 'action', actionId: 'a1', playerId: 'p1', type: 'player.rename', ok: true, seq: 1 },
      {
        kind: 'action',
        actionId: 'a2',
        playerId: 'p1',
        type: 'player.rename',
        ok: false,
        seq: 2,
        code: 'E_BAD_PAYLOAD',
      },
      { kind: 'leave', playerId: 'p1' },
    ]);
  });

  it('a THROWING observer never disrupts the room (metrics is pure telemetry)', () => {
    const r = new MatchRoom({
      id: 'obs-throw',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      observe: () => {
        throw new Error('a metrics consumer blew up on EVERY observation');
      },
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1); // the 'join' observation throws internally — must not escape
    // The action commits and broadcasts despite the observer throwing on join/action/
    // events/broadcast/timing — if any escaped, submitAction would throw and fail here.
    const res = r.submitAction('p1', action('a1', 'p1', 'Commander'), p1);
    expect(res.ok).toBe(true);
    expect(p1.messages.some((m) => (m as { type: string }).type === 'welcome')).toBe(true);
    expect(r.state.players.p1?.name).toBe('Commander'); // the world actually advanced
  });

  it('reports a match end exactly once', () => {
    const { r, events } = observed();
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.addPeer('p2', p2);
    r.submitAction('p1', surrenderAction('s1', 'p1'), p1);
    // a deduped retry of the same ending action must not re-report the end
    r.submitAction('p1', surrenderAction('s1', 'p1'), p1);

    const ends = events.filter((e) => e.kind === 'end');
    expect(ends).toEqual([{ kind: 'end', winner: 'p2', reason: 'elimination' }]);
  });

  it('banks the end reward table when the match ends on an advance during a REJECTED action (EC-*)', () => {
    let clock = 10;
    const events: RoomObservation[] = [];
    const r = new MatchRoom({
      id: 'obs-deadline',
      initialState: testState(),
      kernel: createKernel([renameModule, deadlineModule]),
      data: testData(),
      now: () => clock,
      observe: (e) => events.push(e),
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    clock = 150; // the world must catch up past the deadline before this action applies
    // The pre-apply advance crosses time 100 → deadlineModule ends the match; the rename
    // then rejects with E_MATCH_ENDED. Before the fix, observeEndIfNeeded was skipped on
    // this reject-but-advanced path, so the reward table was never banked.
    r.submitAction('p1', action('a1', 'p1', 'Commander'), p1);

    expect(events.filter((e) => e.kind === 'end')).toEqual([
      {
        kind: 'end',
        winner: 'p1',
        reason: 'domination',
        rewards: { p1: { place: 1, xp: 200 }, p2: { place: 2, xp: 40 } },
      },
    ]);
    const acts = events.filter((e) => e.kind === 'action');
    expect(acts.at(-1)).toMatchObject({ ok: false, code: 'E_MATCH_ENDED' });
  });

  it('reports lobby running/paused flips when a gate is configured', () => {
    const events: RoomObservation[] = [];
    const r = new MatchRoom({
      id: 'obs-lobby',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      waitForPlayers: ['p1', 'p2'],
      observe: (e) => events.push(e),
    });
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    r.addPeer('p1', p1); // still waiting — no flip
    r.addPeer('p2', p2); // both in → running
    r.removePeer('p2', p2); // one dropped → paused

    expect(events.filter((e) => e.kind === 'lobby')).toEqual([
      { kind: 'lobby', waiting: false },
      { kind: 'lobby', waiting: true },
    ]);
  });

  it('omits the hash field unless emitStateHash is set', () => {
    const { r } = observed();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    expect(p1.messages[0]).not.toHaveProperty('hash');
  });

  it('attaches a hash the client can verify against its reconstructed state', () => {
    const { r } = observed({ emitStateHash: true });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    const welcome = p1.messages[0];
    if (welcome?.type !== 'welcome') throw new Error('expected a welcome snapshot');
    expect(typeof (welcome as { hash?: string }).hash).toBe('string');

    let clientState = welcome.state;
    r.submitAction('p1', action('a1', 'p1', 'Commander'), p1);
    const delta = p1.messages.at(-1);
    if (delta?.type !== 'delta') throw new Error('expected a delta');
    clientState = applyDelta(clientState, delta.delta);
    // the desync check the overlay runs: our rebuild hashes to the server's tag
    expect(hashState(clientState)).toBe((delta as { hash?: string }).hash);
  });

  /** A hashing room on a wall clock the test moves, with a seat per id. */
  function hashingRoom(ids: string[]): { r: MatchRoom; at: (wall: number) => void } {
    let wall = 10;
    const players = Object.fromEntries(ids.map((id) => [id, player(id, id)]));
    const r = new MatchRoom({
      id: 'hash-cadence',
      initialState: { ...testState(), players },
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => wall,
      emitStateHash: true,
    });
    return {
      r,
      at: (ms) => {
        wall = ms;
      },
    };
  }
  const tagOf = (m: ServerMessage | undefined): string | undefined =>
    m !== undefined && 'hash' in m ? m.hash : undefined;

  it('tags a delta once a period per player, and every full snapshot', async () => {
    const { r, at } = hashingRoom(['p1']);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    const welcome = p1.messages[0];
    if (welcome?.type !== 'welcome') throw new Error('expected a welcome snapshot');
    expect(welcome.hash).toBe(hashState(welcome.state));

    let clientState = welcome.state;
    /** Renames at `wall`; whether that delta carried the tag (checked against the rebuild). */
    const tagged = (wall: number, name: string): boolean => {
      at(wall);
      r.submitAction('p1', action(name, 'p1', name), p1);
      const delta = p1.messages.at(-1);
      if (delta?.type !== 'delta') throw new Error('expected a delta');
      clientState = applyDelta(clientState, delta.delta);
      if (delta.hash !== undefined) expect(hashState(clientState)).toBe(delta.hash);
      return delta.hash !== undefined;
    };
    expect(tagged(10, 'a1')).toBe(true); // the first seat booked is due at once
    expect(tagged(10, 'a2')).toBe(false);
    expect(tagged(3_009, 'a3')).toBe(false); // a millisecond before its next point
    expect(tagged(3_500, 'a4')).toBe(true); // a late broadcast…
    expect(tagged(6_010, 'a5')).toBe(true); // …does not move the point after it
    expect(tagged(6_011, 'a6')).toBe(false);
    expect(tagged(60_000, 'a7')).toBe(true); // an idle spell costs one tag,
    expect(tagged(60_000, 'a8')).toBe(false); // not one per point it skipped

    // A resync is a full snapshot: tagged whatever the schedule, and it matches the
    // rebuild that went through the untagged deltas too.
    await r.receive('p1', p1, JSON.stringify({ type: 'desync', seq: 8, hash: 'stale' }));
    const resync = p1.messages.at(-1);
    if (resync?.type !== 'state') throw new Error('expected a resync snapshot');
    expect(resync.hash).toBe(hashState(clientState));
  });

  /** A peer per seat, and a heartbeat at `wall` that says which seats its deltas tagged. */
  function seatedBeats(ids: string[]): (wall: number) => string[] {
    const { r, at } = hashingRoom(ids);
    const peers = ids.map((id) => {
      const peer = new MemoryPeer();
      r.addPeer(id, peer);
      return peer;
    });
    return (wall) => {
      at(wall);
      const seen = peers.map((peer) => peer.messages.length);
      r.tick();
      const fresh = peers.map((peer, i) => peer.messages.slice(seen[i]));
      expect(fresh.every((messages) => messages.some((m) => m.type === 'delta'))).toBe(true);
      return ids.filter((_, i) => fresh[i]!.some((m) => tagOf(m)));
    };
  }

  it('spreads seats that join together over the period', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
    const beat = seatedBeats(ids);
    // A heartbeat every 100 ms for one period: each seat is tagged once, and no heartbeat
    // tags two of them (a reconnect wave would otherwise be hashed all on one broadcast).
    const tagged: string[][] = [];
    for (let wall = 10; wall < 3_010; wall += 100) tagged.push(beat(wall));
    expect(Math.max(...tagged.map((seats) => seats.length))).toBe(1);
    expect(tagged.flat().sort()).toEqual([...ids].sort());
  });

  it('lets seats that shared a late broadcast part again', () => {
    const beat = seatedBeats(['p1', 'p2']);
    // p1's grid starts at 10 and p2's at 10 + 0.618 × 3000 ≈ 1864. The first heartbeat is
    // late enough to tag both; from then on each is tagged on its own grid again.
    expect(beat(2_000)).toEqual(['p1', 'p2']);
    const when: Record<string, number[]> = { p1: [], p2: [] };
    for (let wall = 2_100; wall <= 8_000; wall += 100) {
      for (const id of beat(wall)) when[id]!.push(wall);
    }
    expect(when).toEqual({ p1: [3_100, 6_100], p2: [4_900, 7_900] });
  });
});

describe('MatchRoom — M1 observations (events / broadcast / timing / desync)', () => {
  function observed(): { r: MatchRoom; events: RoomObservation[]; peers: [MemoryPeer, MemoryPeer] } {
    const events: RoomObservation[] = [];
    const r = new MatchRoom({
      id: 'obs-m1',
      initialState: testState(),
      kernel: createKernel([renameModule, surrenderModule]),
      data: testData(),
      now: () => 10,
      observe: (e) => events.push(e),
    });
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.addPeer('p2', p2);
    return { r, events, peers: [p1, p2] };
  }

  it('surfaces the domain events of a committed action, with clock spans excluded', () => {
    const { r, events } = observed();
    r.submitAction('p1', action('a1', 'p1', 'Commander'));

    const ev = events.filter((e) => e.kind === 'events');
    expect(ev).toHaveLength(1);
    if (ev[0]?.kind !== 'events') throw new Error('expected an events observation');
    expect(ev[0].seq).toBe(1);
    const types = ev[0].events.map((e) => e.type);
    expect(types).toContain('player.renamed');
    // the world advanced 0 → 10 under this submit, but the clock span is noise
    expect(types).not.toContain('time.advanced');
  });

  it('reports broadcast fan-out with a per-player delta size', () => {
    const { r, events } = observed();
    r.submitAction('p1', action('a1', 'p1', 'Commander'));

    const b = events.filter((e) => e.kind === 'broadcast');
    expect(b).toHaveLength(1);
    if (b[0]?.kind !== 'broadcast') throw new Error('expected a broadcast observation');
    expect(b[0].seq).toBe(1);
    expect(b[0].ms).toBeGreaterThanOrEqual(0);
    // both connected players got a measured delta payload
    expect(Object.keys(b[0].deltaBytes).sort()).toEqual(['p1', 'p2']);
    expect(b[0].deltaBytes.p1).toBeGreaterThan(0);
  });

  it('reports a submit timing for accepted and rejected actions alike', () => {
    const { r, events } = observed();
    r.submitAction('p1', action('a1', 'p1', 'Commander')); // ok
    r.submitAction('p1', action('a2', 'p1', '')); // rejected

    const timings = events.filter((e) => e.kind === 'timing');
    expect(timings).toHaveLength(2);
    expect(timings).toEqual([
      expect.objectContaining({ op: 'submit', seq: 1, actionType: 'player.rename' }),
      expect.objectContaining({ op: 'submit', seq: 2, actionType: 'player.rename' }),
    ]);
    for (const t of timings) if (t.kind === 'timing') expect(t.ms).toBeGreaterThanOrEqual(0);
  });

  it('logs a desync report and answers it with a full resync snapshot', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    const before = p1.messages.length;

    await r.receive('p1', p1, JSON.stringify({ type: 'desync', seq: 3, hash: 'client-hash' }));

    expect(events.filter((e) => e.kind === 'desync')).toEqual([
      { kind: 'desync', playerId: 'p1', atSeq: 3, clientHash: 'client-hash' },
    ]);
    const reply = p1.messages[before];
    expect(reply).toMatchObject({ type: 'state', matchId: 'obs-m1' });
  });

  it('cools down repeat resync replies but never stops observing the reports', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    const before = p1.messages.length;

    await r.receive('p1', p1, JSON.stringify({ type: 'desync', seq: 3, hash: 'h1' }));
    await r.receive('p1', p1, JSON.stringify({ type: 'desync', seq: 4, hash: 'h2' })); // within cool-down

    // both reports observed (a desync storm must be visible in the metrics) …
    expect(events.filter((e) => e.kind === 'desync')).toHaveLength(2);
    // … but only the first got the (costly) full-state reply
    const states = p1.messages.slice(before).filter((m) => m.type === 'state');
    expect(states).toHaveLength(1);
  });

  it('rejects a malformed desync report as E_BAD_MESSAGE', async () => {
    const { r, peers } = observed();
    const [p1] = peers;
    await r.receive('p1', p1, JSON.stringify({ type: 'desync', seq: 'nope' }));
    expect(p1.messages.at(-1)).toMatchObject({ type: 'error', code: 'E_BAD_MESSAGE' });
  });

  it('observes a client perf sample and never answers it (M2)', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    const before = p1.messages.length;

    await r.receive('p1', p1, JSON.stringify({ type: 'perf', fps: 58, rttMs: 42, memMb: 120 }));

    expect(events.filter((e) => e.kind === 'client_perf')).toEqual([
      { kind: 'client_perf', playerId: 'p1', fps: 58, rttMs: 42, memMb: 120 },
    ]);
    expect(p1.messages).toHaveLength(before); // telemetry is not a conversation
  });

  it('rate-limits perf samples per player — a flood is dropped silently', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    const before = p1.messages.length;

    await r.receive('p1', p1, JSON.stringify({ type: 'perf', fps: 60 }));
    await r.receive('p1', p1, JSON.stringify({ type: 'perf', fps: 59 })); // same instant → dropped

    expect(events.filter((e) => e.kind === 'client_perf')).toHaveLength(1);
    expect(p1.messages).toHaveLength(before); // no error either — silent drop
  });

  it('rejects an out-of-range perf sample as E_BAD_MESSAGE (fail-secure)', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    await r.receive('p1', p1, JSON.stringify({ type: 'perf', fps: -5 }));
    await r.receive('p1', p1, JSON.stringify({ type: 'perf', fps: Infinity }));
    expect(events.filter((e) => e.kind === 'client_perf')).toHaveLength(0);
    expect(p1.messages.at(-1)).toMatchObject({ type: 'error', code: 'E_BAD_MESSAGE' });
  });

  it('drops garbage optional fields but keeps the valid fps (parse clamps)', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    await r.receive(
      'p1',
      p1,
      JSON.stringify({ type: 'perf', fps: 30, rttMs: 'huge', memMb: -1 }),
    );
    expect(events.filter((e) => e.kind === 'client_perf')).toEqual([
      { kind: 'client_perf', playerId: 'p1', fps: 30 },
    ]);
  });

  it('carries the long frames and the worst main-thread block through', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    const sample = {
      fps: 21,
      longFrames: 204,
      worstFrameMs: 133,
      loafMs: 1024,
      loafScriptMs: 1017,
      loafLayoutMs: 4,
      loafBy: 'FrameRequestCallback',
    };
    await r.receive('p1', p1, JSON.stringify({ type: 'perf', ...sample }));
    expect(events.filter((e) => e.kind === 'client_perf')).toEqual([
      { kind: 'client_perf', playerId: 'p1', ...sample },
    ]);
  });

  it('drops a bad long-frame field alone, and never logs an unsafe invoker name', async () => {
    const { r, events, peers } = observed();
    const [p1] = peers;
    await r.receive(
      'p1',
      p1,
      JSON.stringify({
        type: 'perf',
        fps: 30,
        longFrames: 2.5,
        worstFrameMs: 120,
        loafMs: -1,
        loafScriptMs: 'x',
        loafLayoutMs: 1e9,
        loafBy: 'FrameRequestCallback\n{"kind":"forged"}',
      }),
    );
    expect(events.filter((e) => e.kind === 'client_perf')).toEqual([
      { kind: 'client_perf', playerId: 'p1', fps: 30, worstFrameMs: 120 },
    ]);

    const other = observed();
    const [q1] = other.peers;
    await other.r.receive(
      'p1',
      q1,
      JSON.stringify({ type: 'perf', fps: 30, loafBy: 'a'.repeat(81), junk: 'kept?' }),
    );
    expect(other.events.filter((e) => e.kind === 'client_perf')).toEqual([
      { kind: 'client_perf', playerId: 'p1', fps: 30 },
    ]);
  });
});

describe('MatchRoom — lobby gate (waitForPlayers)', () => {
  function lobby(): { r: MatchRoom; tick: (ms: number) => void } {
    let real = 1000;
    const r = new MatchRoom({
      id: 'lobby',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => real,
      waitForPlayers: ['p1', 'p2'],
    });
    return { r, tick: (ms) => (real += ms) };
  }
  const waitingOf = (m: ServerMessage | undefined): boolean | undefined =>
    (m as { waiting?: boolean } | undefined)?.waiting;

  it('freezes the world clock until both players connect, runs it, re-freezes on drop', () => {
    const { r, tick } = lobby();
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();

    // p1 alone → waiting, clock frozen at 0
    r.addPeer('p1', p1);
    expect(p1.messages[0]).toMatchObject({ type: 'welcome', waiting: true, serverTime: 0 });

    // an order WHILE waiting applies, but does NOT advance the clock
    tick(5000);
    r.submitAction('p1', action('a1', 'p1', 'Solo'), p1);
    expect(r.state.time).toBe(0);
    expect(p1.messages.at(-1)).toMatchObject({ type: 'delta', serverTime: 0, waiting: true });

    // p2 joins → the match starts; both learn the wait is over
    r.addPeer('p2', p2);
    expect(waitingOf(p2.messages[0])).toBeUndefined(); // p2 welcome: running
    expect(waitingOf(p1.messages.at(-1))).toBeUndefined(); // p1 got a flip broadcast

    // 3s pass with both connected → the clock accrues exactly that
    tick(3000);
    r.submitAction('p2', action('a2', 'p2', 'Duo'), p2);
    expect(r.state.time).toBe(3000);
    expect(p2.messages.at(-1)).toMatchObject({ type: 'delta', serverTime: 3000 });

    // p2 drops → clock re-freezes at 3000; p1 is told it's waiting again
    r.removePeer('p2', p2);
    expect(waitingOf(p1.messages.at(-1))).toBe(true);
    tick(10000);
    r.submitAction('p1', action('a3', 'p1', 'Alone'), p1);
    expect(r.state.time).toBe(3000); // still frozen — no advance past 3000
    expect(p1.messages.at(-1)).toMatchObject({ serverTime: 3000, waiting: true });
  });
});

/** Сколько живых соединений держит кресло p1 — инвариант «одна рука на империи». */
function sittingCount(r: MatchRoom): number {
  return r.peerCount;
}

describe('MatchRoom — singlePeerPerPlayer (1v1 slot guard)', () => {
  function guarded(): MatchRoom {
    return new MatchRoom({
      id: 'guard',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      singlePeerPerPlayer: true,
    });
  }

  // Одна рука на империи — но выигрывает НОВОЕ соединение, а не старое.
  //
  // Прежде отказывали пришедшему, и на живом плейтесте это ударило по своему же
  // владельцу: кресло держал ЕГО ЖЕ мёртвый сокет (пропал сигнал, TCP-FIN не дошёл), а
  // реап идёт heartbeat'ом до ~30 секунд. Игрок открывал игру заново и получал
  // обвинение, что играет с другого устройства. Личность пришедшего проверена
  // рукопожатием, значит это тот же человек — впускаем его, прощаемся со старым.
  /** Подключение с ДОКАЗАННОЙ личностью: токен или билет места. Позиционные аргументы —
   *  как у `addPeer(playerId, peer, sessionId, welcomeExtras, accountId, verified)`. */
  const join = (r: MatchRoom, id: string, peer: MemoryPeer, account?: string): boolean =>
    r.addPeer(id, peer, undefined, undefined, account, true);

  it('впускает НОВОЕ соединение на занятое кресло, выселяя старое', () => {
    const r = guarded();
    const a = new MemoryPeer();
    const b = new MemoryPeer();

    expect(join(r, 'p1', a, 'acc-1')).toBe(true);
    expect(a.messages[0]).toMatchObject({ type: 'welcome', playerId: 'p1' });

    // Пришедший садится, а прежнее соединение получает отказ и закрывается.
    expect(join(r, 'p1', b, 'acc-1')).toBe(true);
    expect(b.messages[0]).toMatchObject({ type: 'welcome', playerId: 'p1' });
    expect(a.messages.at(-1)).toEqual({ type: 'error', matchId: 'guard', code: 'E_SLOT_TAKEN' });

    // Чужое кресло при этом не трогается — 1v1 остаётся 1v1.
    expect(join(r, 'p2', new MemoryPeer(), 'acc-2')).toBe(true);

    // И обычный путь «сокет отвалился → вернулся» работает как прежде.
    r.removePeer('p1', b);
    expect(join(r, 'p1', new MemoryPeer(), 'acc-1')).toBe(true);
  });

  // Перехват — удобство, и оно не имеет права стоить места. Обе проверки ниже нашло
  // ревью на PR #939, и обе про то, что доказательство личности здесь не формальность.
  it('НЕ выселяет по недоказанной личности (дев-рукопожатие `?player=`)', () => {
    // `?player=` берётся прямо из адреса и ничем не подтверждается, а прототип — боевой
    // хост плейтестов — поднимает комнату с этим же guard'ом. Без проверки любой, кто
    // знает id матча и игрока, выселял бы сидящего и забирал его империю.
    const r = guarded();
    const sitting = new MemoryPeer();
    const stranger = new MemoryPeer();
    expect(join(r, 'p1', sitting, 'acc-1')).toBe(true);

    expect(r.addPeer('p1', stranger)).toBe(false); // verified не передан
    expect(stranger.messages).toEqual([{ type: 'error', matchId: 'guard', code: 'E_SLOT_TAKEN' }]);
    expect(sitting.messages.at(-1)).toMatchObject({ type: 'welcome' }); // сидящего не тронули
  });

  it('НЕ выселяет ЧУЖИМ аккаунтом, даже с доказанной личностью', () => {
    // Токен доказывает лишь, что он когда-то был выдан на это место. После админского
    // кика и передачи кресла прежний токен живёт ещё до четверти часа — и им нельзя
    // выселять нового владельца.
    const r = guarded();
    const owner = new MemoryPeer();
    const previous = new MemoryPeer();
    expect(join(r, 'p1', owner, 'acc-new')).toBe(true);

    expect(join(r, 'p1', previous, 'acc-old')).toBe(false);
    expect(previous.messages).toEqual([{ type: 'error', matchId: 'guard', code: 'E_SLOT_TAKEN' }]);
    expect(sittingCount(r)).toBe(1);
  });

  it('выселение не оставляет за креслом двух соединений', async () => {
    // Суть инварианта: перехват меняет ТОГО, кто сидит, а не их количество. Если бы
    // старое соединение снималось только асинхронным обработчиком закрытия, на кресле
    // на миг оказывалось бы двое — и оба получали бы дельты.
    const r = guarded();
    const first = new MemoryPeer();
    const second = new MemoryPeer();
    join(r, 'p1', first, 'acc-1');
    const beforeFirst = first.messages.length;
    join(r, 'p1', second, 'acc-1');

    // Рассылка после перехвата доходит только до нового.
    const beforeSecond = second.messages.length;
    await r.receive(
      'p1',
      second,
      JSON.stringify({ type: 'action', action: action('t1', 'p1', 'Взятое') }),
    );
    expect(second.messages.length).toBeGreaterThan(beforeSecond);
    expect(first.messages.length).toBe(beforeFirst + 1); // только сам отказ, ничего сверх
  });

  it('still allows multiple peers per side when the guard is off (default)', () => {
    const r = room(); // singlePeerPerPlayer unset
    expect(r.addPeer('p1', new MemoryPeer())).toBe(true);
    expect(r.addPeer('p1', new MemoryPeer())).toBe(true); // same side, e.g. a 2nd device
  });
});

describe('MatchRoom — manualStart lobby', () => {
  type Lobby = { host: string | null; connected: string[]; started: boolean };
  const lobbyOf = (m: ServerMessage | undefined): Lobby | undefined =>
    (m as { lobby?: Lobby } | undefined)?.lobby;

  function manual(): { r: MatchRoom; tick: (ms: number) => void } {
    let real = 1000;
    const r = new MatchRoom({
      id: 'ms',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => real,
      manualStart: true,
    });
    return { r, tick: (ms) => (real += ms) };
  }

  it('freezes the clock and shows a lobby until the host presses Start', () => {
    const { r, tick } = manual();
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();

    // first to join hosts; clock frozen at 0; lobby roster present
    r.addPeer('p1', p1);
    expect(p1.messages[0]).toMatchObject({ type: 'welcome', waiting: true, serverTime: 0 });
    expect(lobbyOf(p1.messages[0])).toEqual({ host: 'p1', connected: ['p1'], started: false });

    // p2 joins → p1's lobby roster updates; still not started
    r.addPeer('p2', p2);
    expect(lobbyOf(p1.messages.at(-1))).toEqual({
      host: 'p1',
      connected: ['p1', 'p2'],
      started: false,
    });

    // time passes but the clock stays frozen at 0 until Start
    tick(5000);
    r.submitAction('p1', action('a1', 'p1', 'Solo'), p1);
    expect(r.state.time).toBe(0);

    // a NON-host cannot start
    r.start('p2');
    expect(r.state.time).toBe(0);
    expect(lobbyOf(p2.messages.at(-1))?.started).toBe(false);

    // the host starts → clock runs from the press; lobby.started true; waiting clears
    r.start('p1');
    expect(lobbyOf(p1.messages.at(-1))?.started).toBe(true);
    expect((p1.messages.at(-1) as { waiting?: boolean }).waiting).toBeUndefined();

    tick(3000);
    r.submitAction('p1', action('a2', 'p1', 'Go'), p1);
    expect(r.state.time).toBe(3000); // accrues from the Start press, not from join
  });

  it('hands the host role to the remaining player if the host leaves before Start', () => {
    const { r } = manual();
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.addPeer('p2', p2);
    expect(lobbyOf(p2.messages.at(-1))?.host).toBe('p1');

    r.removePeer('p1', p1); // host drops pre-start
    expect(lobbyOf(p2.messages.at(-1))).toEqual({ host: 'p2', connected: ['p2'], started: false });

    r.start('p2'); // the new host can now start
    expect(lobbyOf(p2.messages.at(-1))?.started).toBe(true);
  });

  it('resumes an already-started match (initiallyStarted) — no fresh lobby, clock continues', () => {
    let real = 5000;
    const resumed: GameState = { ...testState(), time: 3000 }; // 3000ms already played
    const r = new MatchRoom({
      id: 'resume',
      initialState: resumed,
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => real,
      manualStart: true,
      initiallyStarted: true,
    });
    expect(r.isStarted).toBe(true);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    // straight into the running match: no waiting, lobby.started, clock at the saved time
    expect((p1.messages[0] as { waiting?: boolean }).waiting).toBeUndefined();
    expect(lobbyOf(p1.messages[0])?.started).toBe(true);
    expect((p1.messages[0] as { serverTime: number }).serverTime).toBe(3000);
    // the clock keeps accruing from the resume point
    real = 5500;
    r.submitAction('p1', action('a1', 'p1', 'Go'), p1);
    expect(r.state.time).toBe(3500); // 3000 + (5500 − 5000)
  });

  it('auto-start (initiallyStarted, NO manualStart): born running, anchored, scaled — no lobby on the wire', () => {
    // SES-2.1 (Iron Order model): a session's clock runs from creation. The anchor
    // matters — without it a fresh world (time 0) against a raw wall-clock `now`
    // would fast-forward decades on the first tick.
    let real = 100_000;
    const r = new MatchRoom({
      id: 'auto',
      initialState: testState(), // fresh world, time 0
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => real,
      initiallyStarted: true,
      timeScale: 10, // TIME_SCALE keeps working without a lobby gate
    });
    expect(r.isStarted).toBe(true);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    // No lobby machinery leaks into snapshots: no roster, no waiting flag.
    expect((p1.messages[0] as { waiting?: boolean }).waiting).toBeUndefined();
    expect(lobbyOf(p1.messages[0])).toBeUndefined();
    expect((p1.messages[0] as { serverTime: number }).serverTime).toBe(0); // anchored at creation
    // 2 real seconds later the world is 20 game-seconds in — anchored AND scaled.
    real += 2000;
    r.submitAction('p1', action('a1', 'p1', 'Go'), p1);
    expect(r.state.time).toBe(20_000);
  });
});

// SRV-1: a rejected action must still flush the world-advance the room already
// committed (otherwise scheduled arrivals/battles are lost until the next accept).
const armModule: GameModule = {
  id: 'arm-test',
  version: '1.0.0',
  setup(api) {
    api.onAction('arm', (_action, h) => {
      h.schedule(h.ctx.now + 1000, 'boom', {});
    });
    api.on('boom', (_event, h) => {
      const p = h.state.players.p1;
      if (p) p.name = 'BOOMED';
      h.emit('boomed', { owner: 'p1' }); // owner so it passes the fog event filter
    });
    api.onAction('reject.me', (_action, h) => h.reject('E_NOPE'));
  },
};

describe('MatchRoom — durable idempotency (initialReceipts)', () => {
  it('a receipt seeded from a prior run dedupes a retried action (no re-apply)', () => {
    // before the "crash": apply a1 and capture its receipt
    const r1 = room();
    const p1 = new MemoryPeer();
    r1.addPeer('p1', p1);
    const first = r1.submitAction('p1', action('a1', 'p1', 'Commander'), p1);
    expect(first.ok).toBe(true);

    // after the "restart": a fresh room seeded with that receipt. We deliberately
    // start from the PRE-action state (name 'One') so a re-apply would be visible.
    const r2 = new MatchRoom({
      id: 'test-room',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      initialReceipts: [{ actionId: 'a1', playerId: 'p1', seq: first.seq, ok: true }],
    });
    const p1b = new MemoryPeer();
    r2.addPeer('p1', p1b);
    const retry = r2.submitAction('p1', action('a1', 'p1', 'Commander'), p1b);
    expect(retry).toMatchObject({ ok: true, seq: first.seq }); // served from the receipt
    expect(r2.state.players.p1?.name).toBe('One'); // NOT re-applied
  });
});

describe('MatchRoom — SRV-1 (advance events on a rejected action)', () => {
  it('broadcasts the world-advance even when the triggering action is rejected', () => {
    let real = 1000;
    const r = new MatchRoom({
      id: 'srv1',
      initialState: testState(),
      kernel: createKernel([armModule]),
      data: testData(),
      now: () => real,
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);

    // arm a 'boom' for t=2000
    r.submitAction('p1', { id: 'arm1', type: 'arm', playerId: 'p1', issuedAt: 1, payload: {} }, p1);
    const mark = p1.messages.length;

    // jump past the boom, then send a KNOWINGLY-REJECTED action
    real = 3000;
    const res = r.submitAction(
      'p1',
      { id: 'rej1', type: 'reject.me', playerId: 'p1', issuedAt: 1, payload: {} },
      p1,
    );
    expect(res.ok).toBe(false);

    const after = p1.messages.slice(mark);
    // the advance fired 'boom' → a delta carrying 'boomed' was broadcast despite the reject
    const delta = after.find((m) => m.type === 'delta') as
      | { events: { type: string }[] }
      | undefined;
    expect(delta?.events.some((e) => e.type === 'boomed')).toBe(true);
    expect(r.state.players.p1?.name).toBe('BOOMED');
    // and the rejection itself was still delivered
    expect(after.some((m) => m.type === 'rejection' && (m as { code?: string }).code === 'E_NOPE')).toBe(
      true,
    );
  });
});

// PA-4.1: the world must run 24/7 — scheduled events (arrivals/battles/captures)
// fire even with no player connected. `msUntilNextEvent` tells a wakeup driver when
// to call `tick`, which advances the world and broadcasts with no action. Reuses
// `armModule`: an `arm` action schedules a `boom` 1000ms out that renames p1.
const armAction = (id: string): Action => ({
  id,
  type: 'arm',
  playerId: 'p1',
  issuedAt: 1,
  payload: {},
});

describe('MatchRoom — offline scheduler (tick / msUntilNextEvent)', () => {
  function armed(start = 1000): { r: MatchRoom; set: (ms: number) => void } {
    let real = start;
    const r = new MatchRoom({
      id: 'sched',
      initialState: testState(),
      kernel: createKernel([armModule]),
      data: testData(),
      now: () => real,
    });
    return { r, set: (ms) => (real = ms) };
  }

  it('reports no wakeup when nothing is scheduled', () => {
    expect(armed().r.msUntilNextEvent()).toBeNull();
  });

  it('reports the ms until the soonest scheduled event', () => {
    const { r } = armed(1000);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.submitAction('p1', armAction('arm1'), p1); // schedules boom at now(1000)+1000
    expect(r.msUntilNextEvent()).toBe(1000); // 2000 − 1000
  });

  it('tick() fires a due event with no action, broadcasts it, then has nothing left', () => {
    const { r, set } = armed(1000);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.submitAction('p1', armAction('arm1'), p1);
    expect(r.state.players.p1?.name).toBe('One'); // not yet boomed
    const mark = p1.messages.length;

    // wall-clock jumps past the boom; the driver wakes the room — no action sent
    set(2500);
    expect(r.msUntilNextEvent()).toBe(0); // overdue
    r.tick();

    expect(r.state.players.p1?.name).toBe('BOOMED'); // fired with no action
    const delta = p1.messages.slice(mark).find((m) => m.type === 'delta') as
      | { events: { type: string }[] }
      | undefined;
    expect(delta?.events.some((e) => e.type === 'boomed')).toBe(true);
    expect(r.msUntilNextEvent()).toBeNull(); // consumed → idle again
  });

  it('does not wake or advance while the lobby clock is frozen', () => {
    let real = 1000;
    const r = new MatchRoom({
      id: 'sched-lobby',
      initialState: testState(),
      kernel: createKernel([armModule]),
      data: testData(),
      now: () => real,
      manualStart: true,
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1); // host, but not started → clock frozen
    r.submitAction('p1', armAction('arm1'), p1);
    expect(r.msUntilNextEvent()).toBeNull(); // frozen → nothing to wake for
    real = 9000;
    r.tick();
    expect(r.state.players.p1?.name).toBe('One'); // tick is a no-op while frozen
  });
});

// F-03 / F-04 (audit): the in-memory receipts map must not grow without bound, and a
// flood of actions must be rate-limited — without breaking idempotency (a rate-limited
// action keeps no receipt, so a genuine retry after backoff still lands).
describe('MatchRoom — DoS bounds (receipts cap + action rate limit)', () => {
  it('evicts the oldest receipt past the cap — a retry of an evicted action re-applies', () => {
    const r = new MatchRoom({
      id: 'cap',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      maxReceipts: 2, // tiny cap to force eviction
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);

    const a1 = r.submitAction('p1', action('a1', 'p1', 'A1'), p1);
    r.submitAction('p1', action('a2', 'p1', 'A2'), p1);
    r.submitAction('p1', action('a3', 'p1', 'A3'), p1); // size 3 > 2 → evicts a1
    expect(a1.seq).toBe(1);

    // a3 is still within the cap → its retry is served from the receipt (no re-apply)
    const a3retry = r.submitAction('p1', action('a3', 'p1', 'ZZ'), p1);
    expect(a3retry.seq).toBe(3);
    expect(r.state.players.p1?.name).toBe('A3'); // deduped — 'ZZ' ignored

    // a1's receipt was evicted → its retry is NOT deduped: it re-applies, fresh seq
    const a1retry = r.submitAction('p1', action('a1', 'p1', 'A1again'), p1);
    expect(a1retry.seq).toBeGreaterThan(3);
    expect(r.state.players.p1?.name).toBe('A1again'); // re-applied
  });

  it('rate-limits a flood transiently — no receipt, so the same id lands after the window', () => {
    let real = 1000;
    const r = new MatchRoom({
      id: 'rate',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => real,
      actionRateMax: 2,
      actionRateWindowMs: 1000,
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);

    expect(r.submitAction('p1', action('a1', 'p1', 'One'), p1).ok).toBe(true);
    expect(r.submitAction('p1', action('a2', 'p1', 'Two'), p1).ok).toBe(true);

    // 3rd within the window → rate-limited (transient rejection, world untouched)
    const flooded = r.submitAction('p1', action('a3', 'p1', 'Three'), p1);
    expect(flooded).toMatchObject({ ok: false, code: 'E_RATE_LIMIT' });
    expect(p1.messages.at(-1)).toMatchObject({
      type: 'rejection',
      actionId: 'a3',
      code: 'E_RATE_LIMIT',
    });
    expect(r.state.players.p1?.name).toBe('Two'); // a3 not applied

    // no receipt was kept for a3 → after the window the SAME id is accepted
    real += 1001;
    const retried = r.submitAction('p1', action('a3', 'p1', 'Three'), p1);
    expect(retried.ok).toBe(true);
    expect(r.state.players.p1?.name).toBe('Three');
  });
});

// Playtest fast-forward: the running clock advances timeScale× faster than wall-time,
// so a real minute is many game-hours and fleets/builds/economy resolve on-screen.
describe('MatchRoom — timeScale (playtest fast-forward clock)', () => {
  it('runs the world clock timeScale× faster than wall-time after Start', () => {
    let real = 1000;
    const r = new MatchRoom({
      id: 'ts',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => real,
      manualStart: true,
      timeScale: 100,
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.start('p1'); // host starts the clock at wall=1000
    real = 1050; // 50 real-ms later → 50 × 100 = 5000 game-ms
    r.submitAction('p1', action('a1', 'p1', 'Go'), p1);
    expect(r.state.time).toBe(5000);
    expect((p1.messages.at(-1) as { serverTime: number }).serverTime).toBe(5000);
  });

  it('shrinks the offline-wakeup delay by timeScale (event fires sooner in wall-time)', () => {
    const real = 1000;
    const r = new MatchRoom({
      id: 'ts2',
      initialState: testState(),
      kernel: createKernel([armModule]),
      data: testData(),
      now: () => real,
      manualStart: true,
      timeScale: 100,
    });
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.start('p1');
    r.submitAction('p1', { id: 'arm1', type: 'arm', playerId: 'p1', issuedAt: 1, payload: {} }, p1);
    // boom is scheduled at game-time 1000; at ×100 that is 1000/100 = 10 wall-ms away
    expect(r.msUntilNextEvent()).toBe(10);
  });
});

describe('MatchRoom — backpressure (drop a peer that stops draining)', () => {
  it('closes a peer whose outbound buffer exceeds the cap instead of sending', () => {
    const r = room();
    let closed: number | undefined;
    let sent = 0;
    const slow: RoomPeer = {
      bufferedAmount: 2_000_000, // over the 1 MiB cap → not draining
      send: () => {
        sent += 1;
      },
      close: (code) => {
        closed = code;
      },
    };
    r.addPeer('p1', slow); // the welcome broadcast hits the backpressure guard
    expect(closed).toBe(1013); // dropped with "try again later"
    expect(sent).toBe(0); // nothing queued onto the stuck peer
  });

  it('leaves room for the full snapshot still on its way: a big welcome keeps the joiner', async () => {
    // The 1675-province map's welcome is just over 1 MiB, and right after the join it still
    // counts as unsent: with socket compression it waits in ws's queue uncompressed while
    // zlib runs. Model that with a peer from which nothing drains.
    const state = testState();
    state.players.p1!.name = 'x'.repeat(1_100_000);
    const r = new MatchRoom({
      id: 'test-room',
      initialState: state,
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
    });
    const talker = new MemoryPeer();
    r.addPeer('p2', talker);
    const say = (text: string) =>
      r.receive('p2', talker, JSON.stringify({ type: 'chat.send', channel: 'session', text }));
    await say('hi'); // the joiner gets the chat back-log right after the welcome
    let buffered = 0;
    let closed: number | undefined;
    const got: string[] = [];
    const joiner: RoomPeer = {
      get bufferedAmount() {
        return buffered;
      },
      send: (data) => {
        buffered += Buffer.byteLength(data);
        got.push((JSON.parse(data) as ServerMessage).type);
      },
      close: (code) => {
        closed = code;
      },
    };
    r.addPeer('p1', joiner);
    expect(buffered).toBeGreaterThan(1_048_576); // the welcome alone is over the cap
    expect(got).toEqual(['welcome', 'chat.msg']);
    await say('again');
    expect(got).toEqual(['welcome', 'chat.msg', 'chat.msg']);
    expect(closed).toBeUndefined();
    buffered += 1_048_576; // a megabyte of backlog beyond the snapshot: a stuck client
    await say('and again');
    expect(closed).toBe(1013);
  });

  it('counts a resync as the snapshot on its way, as a welcome', async () => {
    const r = room();
    let buffered = 0;
    let closed: number | undefined;
    const got: string[] = [];
    const p1: RoomPeer = {
      get bufferedAmount() {
        return buffered;
      },
      send: (data) => {
        buffered += Buffer.byteLength(data);
        got.push((JSON.parse(data) as ServerMessage).type);
      },
      close: (code) => {
        closed = code;
      },
    };
    r.addPeer('p1', p1); // a small welcome
    // The view grows past the cap after the join (the server path: no wire payload limit).
    expect(r.submitAction('p1', action('a1', 'p1', 'x'.repeat(1_100_000))).ok).toBe(true);
    buffered = 0; // everything so far went out
    const send = (message: object) => r.receive('p1', p1, JSON.stringify(message));
    await send({ type: 'desync', seq: 1, hash: 'mismatch' }); // answered with the full view
    expect(got.at(-1)).toBe('state');
    expect(buffered).toBeGreaterThan(1_048_576);
    await send({ type: 'ping', clientTime: 1 });
    expect(got.at(-1)).toBe('pong');
    expect(closed).toBeUndefined();
  });
});

describe('MatchRoom — socket compression', () => {
  it('sends the welcome that carries a seat ticket uncompressed, everything else as is', async () => {
    const r = room();
    const sent: Array<{ to: string; type: string; options?: { compress?: boolean } }> = [];
    const peer = (to: string): RoomPeer => ({
      send: (data, options) => {
        const { type } = JSON.parse(data) as ServerMessage;
        sent.push({ to, type, ...(options ? { options } : {}) });
      },
    });
    const p1 = peer('p1');
    r.addPeer('p1', p1, undefined, { seatTicket: 'ticket-of-p1' });
    r.addPeer('p2', peer('p2'));
    await r.receive(
      'p1',
      p1,
      JSON.stringify({ type: 'action', matchId: 'test-room', action: action('a1', 'p1', 'Uno') }),
    );
    expect(sent).toEqual([
      { to: 'p1', type: 'welcome', options: { compress: false } },
      { to: 'p2', type: 'welcome' },
      { to: 'p1', type: 'delta' },
      { to: 'p2', type: 'delta' },
    ]);
  });
});

// BF-15/BF-16: event fog. Personal and bilateral events (research, steward,
// diplomacy, market, elimination) must reach their named participants; hero
// events must stay owner-only even when an enemy identifies the node.
describe('MatchRoom — event fog (personal/bilateral audiences, hero privacy)', () => {
  const fogEventsModule: GameModule = {
    id: 'fog-events-test',
    version: '1.0.0',
    setup(api) {
      api.onAction('test.personal', (action, h) => {
        h.emit('technology.researched', { playerId: action.playerId, technology: 'lasers' });
      });
      api.onAction('test.bilateral', (action, h) => {
        const { to } = action.payload as { to: string };
        h.emit('diplomacy.offered', { from: action.playerId, to, stance: 'peace' });
      });
      api.onAction('test.hero', (action, h) => {
        const { at } = action.payload as { at: string };
        h.emit('hero.spawned', { owner: action.playerId, heroId: 'h1', fleetId: 'f1', at });
      });
      // Бой p1 против p3 в мире `far`, которого не опознаёт никто.
      api.onAction('test.battle', (_action, h) => {
        h.state.battles['battle:9'] = {
          id: 'battle:9',
          location: 'far',
          phase: 'orbital',
          round: 0,
          sides: [
            { ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker' },
            { ref: { kind: 'fleet', fleetId: 'f3' }, owner: 'p3', role: 'defender' },
          ],
        };
        h.emit('battle.started', { battleId: 'battle:9', location: 'far', phase: 'orbital', attacker: 'p1', defender: 'p3' });
      });
      // Бой, начатый и законченный одним пакетом (первый залп добил флот): в состоянии
      // его нет ни до, ни после.
      api.onAction('test.battle-flash', (_action, h) => {
        h.emit('battle.started', { battleId: 'battle:8', location: 'far', phase: 'orbital', attacker: 'p1', defender: 'p3' });
        h.emit('battle.resolved', { battleId: 'battle:8', location: 'far', winner: 'p3', winners: ['p3'] });
      });
      api.onAction('test.battle-end', (_action, h) => {
        delete h.state.battles['battle:9'];
        h.emit('battle.resolved', { battleId: 'battle:9', location: 'far', winner: 'p3', winners: ['p3'] });
      });
    },
  };

  function fogState(): GameState {
    const base = testState();
    return {
      ...base,
      players: {
        ...base.players,
        p3: player('p3', 'Three'),
      },
      // p2 owns node1 → p2 identifies it (fog coverage floods from own worlds).
      planets: {
        node1: {
          id: 'node1',
          owner: 'p2',
          position: { x: 0, y: 0 },
          resources: {},
          buildings: [],
          garrison: [],
          traits: [],
        },
        far: {
          id: 'far',
          owner: null,
          position: { x: 50_000, y: 0 },
          resources: {},
          buildings: [],
          garrison: [],
          traits: [],
        },
      },
    };
  }

  function fogRoom(): { r: MatchRoom; p1: MemoryPeer; p2: MemoryPeer; p3: MemoryPeer } {
    const r = new MatchRoom({
      id: 'fog-room',
      initialState: fogState(),
      kernel: createKernel([fogEventsModule]),
      data: testData(),
      now: () => 10,
    });
    const p1 = new MemoryPeer();
    const p2 = new MemoryPeer();
    const p3 = new MemoryPeer();
    r.addPeer('p1', p1);
    r.addPeer('p2', p2);
    r.addPeer('p3', p3);
    return { r, p1, p2, p3 };
  }

  function lastEvents(peer: MemoryPeer): string[] {
    const last = peer.messages.at(-1) as { type: string; events?: { type: string }[] };
    expect(last.type).toBe('delta');
    return (last.events ?? []).map((e) => e.type);
  }

  it('a personal event (payload.playerId) reaches its subject and nobody else', () => {
    const { r, p1, p2, p3 } = fogRoom();
    r.submitAction(
      'p1',
      { id: 'e1', type: 'test.personal', playerId: 'p1', issuedAt: 1, payload: {} },
      p1,
    );
    expect(lastEvents(p1)).toContain('technology.researched');
    expect(lastEvents(p2)).not.toContain('technology.researched');
    expect(lastEvents(p3)).not.toContain('technology.researched');
  });

  it('a bilateral event (from/to) reaches both participants but not a third party', () => {
    const { r, p1, p2, p3 } = fogRoom();
    r.submitAction(
      'p1',
      { id: 'e2', type: 'test.bilateral', playerId: 'p1', issuedAt: 1, payload: { to: 'p2' } },
      p1,
    );
    expect(lastEvents(p1)).toContain('diplomacy.offered');
    expect(lastEvents(p2)).toContain('diplomacy.offered');
    expect(lastEvents(p3)).not.toContain('diplomacy.offered');
  });

  it('a hero event is owner-only: an identified node must NOT reveal it to an enemy', () => {
    const { r, p1, p2, p3 } = fogRoom();
    // p1 spawns a hero at node1 — a node p2 identifies (p2 owns it).
    r.submitAction(
      'p1',
      { id: 'e3', type: 'test.hero', playerId: 'p1', issuedAt: 1, payload: { at: 'node1' } },
      p1,
    );
    expect(lastEvents(p1)).toContain('hero.spawned');
    expect(lastEvents(p2)).not.toContain('hero.spawned'); // the leak BF-16 plugged
    expect(lastEvents(p3)).not.toContain('hero.spawned');
  });

  it('a battle reports to its own sides even where nobody identifies the world — start and end', () => {
    const { r, p1, p2, p3 } = fogRoom();
    r.submitAction('p1', { id: 'e4', type: 'test.battle', playerId: 'p1', issuedAt: 1, payload: {} }, p1);
    expect(lastEvents(p1)).toContain('battle.started');
    expect(lastEvents(p3)).toContain('battle.started');
    expect(lastEvents(p2)).not.toContain('battle.started'); // not a side, world unseen
    // Итог приходит, когда боя в состоянии уже нет: его несёт кадр, в котором бой был.
    r.submitAction('p1', { id: 'e5', type: 'test.battle-end', playerId: 'p1', issuedAt: 2, payload: {} }, p1);
    expect(lastEvents(p1)).toContain('battle.resolved');
    expect(lastEvents(p3)).toContain('battle.resolved');
    expect(lastEvents(p2)).not.toContain('battle.resolved');
  });

  it('a battle started and ended in one batch still reports to its sides (Codex review on #1408)', () => {
    const { r, p1, p2, p3 } = fogRoom();
    r.submitAction('p1', { id: 'e6', type: 'test.battle-flash', playerId: 'p1', issuedAt: 1, payload: {} }, p1);
    for (const peer of [p1, p3]) {
      expect(lastEvents(peer)).toContain('battle.started');
      expect(lastEvents(peer)).toContain('battle.resolved');
    }
    expect(lastEvents(p2)).not.toContain('battle.started');
    expect(lastEvents(p2)).not.toContain('battle.resolved');
  });
});

describe('MatchRoom — host fog (hostFog)', () => {
  /** A host extension shaped like the prototype's bot favour ledger: one bot's opinion of
   *  every seat, in a top-level key the core projection does not know. */
  type OpinionState = GameState & { opinion: Record<string, Record<string, number>> };
  const opinionModule: GameModule = {
    id: 'opinion-test',
    version: '1.0.0',
    setup(api) {
      api.onAction('test.sour', (action, h) => {
        const { about } = action.payload as { about: string };
        (h.state as OpinionState).opinion.bot![about]! -= 10;
      });
    },
  };
  /** The narrowing a host would pass: each viewer sees only the bot's opinion of THEM. */
  const ownOpinion = (view: GameState, viewer: string): GameState => {
    const { opinion, ...rest } = view as OpinionState;
    return { ...rest, opinion: { bot: { [viewer]: opinion.bot![viewer]! } } } as GameState;
  };

  function hostRoom(
    hostFog?: (view: GameState, viewer: string) => GameState,
    now: () => number = () => 10,
  ): MatchRoom {
    const initialState = { ...testState(), opinion: { bot: { p1: 60, p2: 60 } } } as OpinionState;
    return new MatchRoom({
      id: 'host-fog',
      initialState,
      kernel: createKernel([opinionModule]),
      data: testData(),
      now,
      emitStateHash: true,
      ...(hostFog ? { hostFog } : {}),
    });
  }
  const welcomeOpinion = (peer: MemoryPeer): OpinionState['opinion'] => {
    const welcome = peer.messages[0];
    if (welcome?.type !== 'welcome') throw new Error('expected a welcome snapshot');
    return (welcome.state as OpinionState).opinion;
  };
  const sour = (id: string, about: string): Action => ({
    id,
    type: 'test.sour',
    playerId: 'p2',
    issuedAt: 1,
    payload: { about },
  });

  it('without it a host key rides every view whole', () => {
    const r = hostRoom();
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    expect(welcomeOpinion(p1)).toEqual({ bot: { p1: 60, p2: 60 } });
  });

  it('narrows the welcome, and a change outside the slice sends that viewer none of it', () => {
    const r = hostRoom(ownOpinion);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    expect(welcomeOpinion(p1)).toEqual({ bot: { p1: 60 } });

    r.submitAction('p2', sour('a1', 'p2'));
    const delta = p1.messages.at(-1);
    if (delta?.type !== 'delta') throw new Error('expected a delta');
    expect(delta.delta.meta?.opinion).toBeUndefined(); // the bot soured on p2: not p1's to see

    r.submitAction('p2', sour('a2', 'p1'));
    const own = p1.messages.at(-1);
    if (own?.type !== 'delta') throw new Error('expected a delta');
    expect(own.delta.meta?.opinion).toEqual({ bot: { p1: 50 } });
  });

  it("hashes the narrowed view: the client's rebuild matches every tag, resync included", async () => {
    let wall = 10;
    const r = hostRoom(ownOpinion, () => wall);
    const p1 = new MemoryPeer();
    r.addPeer('p1', p1);
    const welcome = p1.messages[0];
    if (welcome?.type !== 'welcome') throw new Error('expected a welcome snapshot');
    expect(welcome.hash).toBe(hashState(welcome.state));

    let clientState = welcome.state;
    for (const [id, about] of [
      ['a1', 'p2'],
      ['a2', 'p1'],
    ] as const) {
      r.submitAction('p2', sour(id, about));
      const delta = p1.messages.at(-1);
      if (delta?.type !== 'delta') throw new Error('expected a delta');
      clientState = applyDelta(clientState, delta.delta);
      expect(hashState(clientState)).toBe(delta.hash);
      wall += 3_000; // a delta carries the tag once a period per player
    }
    const {
      signatures: _sig,
      remembered: _rem,
      ...core
    } = visibleView(r.state, 'p1', testData()).view;
    expect(clientState).toEqual(ownOpinion(core as GameState, 'p1'));

    // The resync path goes through the same view: a full `state` is narrowed as well.
    await r.receive('p1', p1, JSON.stringify({ type: 'desync', seq: 2, hash: 'stale' }));
    const resync = p1.messages.at(-1);
    if (resync?.type !== 'state') throw new Error('expected a resync snapshot');
    expect(resync.state).toEqual(clientState);
    expect(resync.hash).toBe(hashState(clientState));
  });
});

/** Пишет в имя игрока то, что редьюсер РЕАЛЬНО видит в `ctx.config` — правила комнаты
 *  наружу не выставлены (`config` приватный), а смотреть надо именно на них: между
 *  конструктором и `context()` резолв режима мог бы и потеряться. */
const rulesProbeModule: GameModule = {
  id: 'rules-probe',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.rules', (act, h) => {
      const p = h.state.players[act.playerId];
      if (!p) return h.reject('E_FORBIDDEN');
      p.name = String(h.ctx.config?.victory?.scoreLimit ?? 'none');
    });
  },
};

describe('MatchRoom — режим матча консервируется при рождении (PVE-0.2)', () => {
  /** `testData()` не несёт режимов вовсе, поэтому режим приходится посадить — и это
   *  ровно то, что проверяется: комната читает `data.modes`, а не зашитый список. */
  function dataWithMode(): GameData {
    return {
      ...testData(),
      modes: {
        brisk: { name: 'Brisk', victory: { scoreLimit: 120 }, teamFormat: 'ffa', modules: [] },
      },
    };
  }

  function modeRoom(config: MatchConfig): MatchRoom {
    return new MatchRoom({
      id: 'mode-room',
      initialState: testState(),
      kernel: createKernel([rulesProbeModule]),
      data: dataWithMode(),
      now: () => 10,
      config,
    });
  }

  /** Правила глазами редьюсера: `scoreLimit` или 'none', если его не задал никто. */
  async function seenScoreLimit(config: MatchConfig): Promise<string | undefined> {
    const r = modeRoom(config);
    await r.submitServerAction('p1', {
      id: 'r1',
      type: 'test.rules',
      playerId: 'p1',
      issuedAt: 1,
      payload: {},
    });
    return r.state.players.p1?.name;
  }

  it('пресет режима доезжает до правил, по которым комната судит матч', async () => {
    expect(await seenScoreLimit({ timeScale: 1, modeId: 'brisk' })).toBe('120');
  });

  it('явное правило матча бьёт пресет', async () => {
    expect(await seenScoreLimit({ timeScale: 1, modeId: 'brisk', victory: { scoreLimit: 777 } })).toBe(
      '777',
    );
  });

  it('матч без режима поднимается как раньше (обратная совместимость)', async () => {
    expect(await seenScoreLimit({ timeScale: 1 })).toBe('none');
  });

  it('неизвестный режим — комната НЕ рождается (fail-secure, E_UNKNOWN_MODE)', () => {
    // Ставка кирпича: обойти резолв нечем. Комнату поднимают из трёх мест
    // (`createDevMatch`, прото-хост, тесты), и все три идут через конструктор —
    // поэтому отказ живёт там, а не в одной из фабрик, которую легко обойти.
    expect(() => modeRoom({ timeScale: 1, modeId: 'no_such_mode' })).toThrowError(
      expect.objectContaining({ code: 'E_UNKNOWN_MODE' }),
    );
  });
});

describe('MatchRoom — серверные приказы (PVE-5.2)', () => {
  /** Модуль, у которого есть действие, наблюдаемое снаружи: приказ переименовывает
   *  игрока, поэтому «дошёл ли серверный приказ до редьюсера» видно по состоянию. */
  function orderRoom(
    serverOrders?: (state: GameState, seq: number) => Action[],
  ): MatchRoom {
    return new MatchRoom({
      id: 'orders-room',
      initialState: testState(),
      kernel: createKernel([renameModule]),
      data: testData(),
      now: () => 10,
      initiallyStarted: true,
      ...(serverOrders ? { serverOrders } : {}),
    });
  }

  /** Приказы подаются fire-and-forget (tick синхронный), поэтому тесту нужно отдать
   *  цикл событий — иначе он проверит состояние до того, как приказ применится. */
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it('приказ, выданный источником, доезжает до редьюсера обычным путём действий', async () => {
    const calls: number[] = [];
    const r = orderRoom((_state, seq) => {
      calls.push(seq);
      // Один приказ на первый вызов: дальше источник молчит, как реальный
      // оркестратор молчит про уже летящий флот.
      return calls.length > 1 ? [] : [action('srv:p1:0', 'p1', 'Renamed')];
    });
    r.tick();
    await settle();
    expect(r.state.players.p1?.name).toBe('Renamed');
  });

  it('seq растёт на число выданных приказов — два тика не минтят один id', async () => {
    const seen: number[] = [];
    const r = orderRoom((_state, seq) => {
      seen.push(seq);
      return seen.length === 1
        ? [action(`srv:p1:${seq}`, 'p1', 'A'), action(`srv:p1:${seq + 1}`, 'p1', 'B')]
        : [];
    });
    r.tick();
    await settle();
    r.tick();
    await settle();
    // Повтори комната прежний seq — вторая волна приказов была бы съедена кэшем
    // квитанций как ретрай, и NPC замер бы навсегда.
    expect(seen).toEqual([0, 2]);
  });

  it('источник, который бросает, НЕ роняет комнату (тактика не несущая)', () => {
    const r = orderRoom(() => {
      throw new Error('bad tactic');
    });
    expect(() => r.tick()).not.toThrow();
  });

  it('без источника комната ведёт себя как раньше', () => {
    const r = orderRoom();
    expect(() => r.tick()).not.toThrow();
    expect(r.state.players.p1?.name).toBe('One');
  });
});
