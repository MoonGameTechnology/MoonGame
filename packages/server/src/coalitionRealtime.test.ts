import { describe, expect, it } from 'vitest';
import {
  coalitionOf, createInitialState, createKernel, deepClone, diplomacyModule,
  getStance, hashState, parseGameData, runReplay, setStance,
  type Action, type GameModule, type ReplayStep,
} from '@void/shared-core';
import { MatchRoom, type MatchRoomOptions } from './matchRoom';
import { snapshotOf } from './persistence';
import type { MatchSnapshot } from './store';

const HOUR = 3_600_000;
const START = 1_700_000_000_000;
const data = parseGameData({
  version: 'coalition-clock-test', resources: ['credits'], units: {}, factions: {},
  buildings: {}, events: {}, sectors: {}, planetTypes: {},
});
// A witness pins the historical ordering during offline catch-up: departure must
// occur at its actual game instant, before the host switches clock rate.
const witness: GameModule = {
  id: 'departure-witness', version: '1',
  setup(api) {
    api.on('coalition.left', (_, h) => { h.state.players.a!.resources.credits = h.ctx.now; });
  },
};
const modules = [diplomacyModule, witness];
function initial() {
  const state = createInitialState({ seed: 'coalition-clock', version: { data: data.version, manifest: 'test' } });
  for (const id of ['a', 'b', 'c']) {
    state.players[id] = { id, name: id, faction: 'x', status: 'active', resources: { credits: 0 } };
  }
  state.coalitions = { c1: { id: 'c1', founder: 'a', members: ['a', 'b'], emblem: 'star', description: '' } };
  state.coalitionSeq = 1;
  setStance(state, 'a', 'b', 'alliance');
  return state;
}
const order = (id: string, type: string, playerId = 'b', payload: unknown = {}): Action =>
  ({ id, type, playerId, payload, issuedAt: -123 });
function fixture(scale = 24) {
  let wall = START;
  const steps: ReplayStep[] = [];
  const make = (snapshot?: MatchSnapshot, nextScale = scale, extra: Partial<MatchRoomOptions> = {}) => new MatchRoom({
    id: 'coalition-clock', kernel: createKernel(modules), data,
    initialState: snapshot?.state ?? initial(), initialSeq: snapshot?.seq,
    initialClock: snapshot?.clock, initiallyStarted: true, timeScale: nextScale,
    now: () => wall, record: (step) => steps.push(step), ...extra,
  });
  return { make, steps, setWall: (next: number) => { wall = next; } };
}
function leave(room: MatchRoom, kind: 'leave' | 'kick' = 'leave') {
  const actor = kind === 'leave' ? 'b' : 'a';
  expect(room.submitAction(actor, order('departure', `coalition.${kind}`, actor,
    kind === 'leave' ? {} : { target: 'b' })).ok).toBe(true);
}

describe('coalition deadlines use ordinary hours', () => {
  it.each([
    { scale: 1, kind: 'leave' as const }, { scale: 24, kind: 'leave' as const },
    { scale: 1, kind: 'kick' as const }, { scale: 24, kind: 'kick' as const },
  ])('$kind at ×$scale waits 24 real hours and then locks entry for 48 real hours', ({ scale, kind }) => {
    const f = fixture(scale);
    const room = f.make();
    leave(room, kind);
    expect(coalitionOf(room.state, 'b')?.departures?.b).toMatchObject({
      wallAt: START + 24 * HOUR, at: 24 * HOUR * scale,
    });
    expect(room.msUntilNextEvent()).toBe(24 * HOUR);
    f.setWall(START + 24 * HOUR - 1);
    room.tick();
    expect(coalitionOf(room.state, 'b')).not.toBeNull();
    f.setWall(START + 24 * HOUR);
    room.tick();
    expect(coalitionOf(room.state, 'b')).toBeNull();
    expect(getStance(room.state, 'a', 'b')).toBe('peace');
    expect(room.state.coalitionJoinAfter?.b).toBe(START + 72 * HOUR);
    f.setWall(START + 72 * HOUR - 1);
    expect(room.submitAction('b', order('early', 'coalition.create'))).toMatchObject({ ok: false, code: 'E_COALITION_COOLDOWN' });
    f.setWall(START + 72 * HOUR);
    expect(room.submitAction('b', order('ready', 'coalition.create')).ok).toBe(true);
  });

  it.each([2, 48])('preserves UTC deadlines when restarting from ×24 to ×%s', (nextScale) => {
    const f = fixture();
    const live = f.make();
    leave(live);
    f.setWall(START + 6 * HOUR);
    live.tick();
    const saved = JSON.parse(JSON.stringify(snapshotOf(live))) as MatchSnapshot;
    f.setWall(START + 12 * HOUR);
    const restored = f.make(saved, nextScale);
    restored.tick();
    expect(coalitionOf(restored.state, 'b')?.departures?.b?.wallAt).toBe(START + 24 * HOUR);
    expect(restored.msUntilNextEvent()).toBe(12 * HOUR);
    f.setWall(START + 24 * HOUR - 1);
    restored.tick();
    expect(coalitionOf(restored.state, 'b')).not.toBeNull();
    f.setWall(START + 24 * HOUR);
    restored.tick();
    expect(coalitionOf(restored.state, 'b')).toBeNull();
    const cooldown = JSON.parse(JSON.stringify(snapshotOf(restored))) as MatchSnapshot;
    f.setWall(START + 72 * HOUR - 1);
    const again = f.make(cooldown, 1);
    expect(again.submitAction('b', order('early-restart', 'coalition.create'))).toMatchObject({ ok: false, code: 'E_COALITION_COOLDOWN' });
    f.setWall(START + 72 * HOUR);
    expect(again.submitAction('b', order('ready-restart', 'coalition.create')).ok).toBe(true);
  });

  it('settles an offline departure at its old-rate instant, without restarting the cooldown', () => {
    const f = fixture();
    const live = f.make();
    leave(live);
    f.setWall(START + 6 * HOUR);
    const saved = JSON.parse(JSON.stringify(snapshotOf(live))) as MatchSnapshot;
    f.setWall(START + 30 * HOUR);
    const restored = f.make(saved, 2);
    restored.tick();
    expect(coalitionOf(restored.state, 'b')).toBeNull();
    expect(restored.state.players.a!.resources.credits).toBe(24 * HOUR * 24);
    expect(restored.state.coalitionJoinAfter?.b).toBe(START + 72 * HOUR);
  });

  it('replays first clock setup and restart-rate changes bit-exactly', () => {
    const f = fixture();
    const live = f.make();
    const start = deepClone(live.state);
    leave(live);
    f.setWall(START + 6 * HOUR);
    live.tick();
    const saved = JSON.parse(JSON.stringify(snapshotOf(live))) as MatchSnapshot;
    f.setWall(START + 12 * HOUR);
    const restored = f.make(saved, 2);
    restored.tick();
    f.setWall(START + 24 * HOUR);
    restored.tick();
    const replayed = runReplay(createKernel(modules), data, JSON.parse(JSON.stringify({
      dataVersion: data.version, initial: start, steps: f.steps,
    })));
    expect(replayed.rejected).toEqual([]);
    expect(replayed.failures).toEqual([]);
    expect(replayed.hash).toBe(hashState(restored.state));
  });

  it('never commits or records a speculative clock setup when persistence fails', async () => {
    const f = fixture();
    let fail = true;
    const room = f.make(undefined, 24, { persist: async () => { if (fail) throw new Error('test write failure'); } });
    const start = deepClone(room.state);
    const action = order('durable-departure', 'coalition.leave');
    expect(await room.submitServerAction('b', action)).toMatchObject({ ok: false });
    expect(room.state).toEqual(start);
    expect(f.steps).toEqual([]);
    fail = false;
    f.setWall(START + HOUR);
    expect(await room.submitServerAction('b', action)).toEqual({ ok: true });
    expect(coalitionOf(room.state, 'b')?.departures?.b?.wallAt).toBe(START + 25 * HOUR);
    const replayed = runReplay(createKernel(modules), data, { dataVersion: data.version, initial: start, steps: f.steps });
    expect(replayed.rejected).toEqual([]);
    expect(replayed.hash).toBe(hashState(room.state));
  });

  it('refuses a client-forged clock mapping on the bare wire path', async () => {
    const f = fixture();
    const room = f.make();
    const received: Array<{ type: string; code?: string }> = [];
    const peer = { send: (raw: string) => { received.push(JSON.parse(raw)); } };
    room.addPeer('b', peer);
    await room.receive('b', peer, JSON.stringify({ type: 'action', action: order('forged', 'coalition.clock.rebase', 'b', {
      wallTime: START + 72 * HOUR, gameTime: 0, timeScale: 24,
    }) }));
    expect(received.some((message) => message.type === 'rejection' && message.code === 'E_BAD_PAYLOAD')).toBe(true);
    expect(room.state.coalitionClock).toBeUndefined();
  });
});
