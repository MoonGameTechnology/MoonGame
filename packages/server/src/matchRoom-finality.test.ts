import { describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  createKernel,
  parseGameData,
  hashState,
  runReplay,
  type GameModule,
  type ReplayStep,
} from '@void/shared-core';
import { MatchRoom, type RoomObservation } from './matchRoom';
import { startClockDriver } from './clockDriver';
import type { MatchSnapshot } from './store';
import type { ServerMessage } from './protocol';

const data = parseGameData({
  version: 'test',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const module: GameModule = {
  id: 'terminal-test',
  version: '1',
  setup(api) {
    api.on('finish', (_e, h) => {
      h.state.match.status = 'ended';
      h.state.match.endedAt = h.ctx.now;
      h.emit('match.ended', {});
    });
    api.on('pulse', (_e, h) => {
      h.state.scheduleSeq += 100;
    });
    api.onAction('noop', () => {});
    api.onAction('finishAction', (_a, h) => {
      h.state.match.status = 'ended';
      h.state.match.endedAt = h.ctx.now;
      h.emit('match.ended', {});
    });
  },
};
function initial() {
  const state = createInitialState({
    seed: 'finality',
    version: { data: 'test', manifest: 'test' },
  });
  state.players.p1 = { id: 'p1', name: 'One', faction: 'azure', status: 'active', resources: {} };
  state.scheduled = [
    { id: 'finish', at: 10, seq: 1, type: 'finish', payload: null },
    { id: 'pulse', at: 20, seq: 2, type: 'pulse', payload: null },
  ];
  return state;
}

describe('ended room lifecycle', () => {
  it('records a terminal event at the current instant so replay can execute it', () => {
    let wall = 0;
    const starting = initial();
    starting.scheduled[0]!.at = 0;
    const steps: ReplayStep[] = [];
    const room = new MatchRoom({
      id: 'same-instant-finality',
      initialState: starting,
      kernel: createKernel([module]),
      data,
      now: () => wall,
      initiallyStarted: true,
      record: (step) => steps.push(step),
    });
    wall = 1;
    room.tick();
    expect(room.state.match.status).toBe('ended');
    expect(room.state.time).toBe(0);
    // Replay chains only positive advances. Retain the request horizon when
    // an event at the starting instant ends the world without moving its clock.
    expect(steps).toEqual([{ at: 1 }]);
    const replay = runReplay(createKernel([module]), data, {
      dataVersion: data.version,
      initial: starting,
      steps,
    });
    expect(replay.hash).toBe(hashState(room.state));
  });

  it('stops an in-flight automation batch when its first order ends the match', async () => {
    let wall = 0;
    const observations: RoomObservation[] = [];
    const room = new MatchRoom({
      id: 'batch-finality',
      initialState: initial(),
      kernel: createKernel([module]),
      data,
      now: () => wall,
      initiallyStarted: true,
      observe: (e) => observations.push(e),
      serverOrders: () =>
        ['finishAction', 'noop'].map((type) => ({
          id: type,
          type,
          playerId: 'p1',
          issuedAt: 0,
          payload: {},
        })),
    });
    wall = 1;
    room.tick();
    await room.drain();
    expect(room.state.match.status).toBe('ended');
    expect(observations.filter((e) => e.kind === 'action')).toHaveLength(1);
  });
  it('freezes published time, background work and the driver while a viewer remains', async () => {
    let wall = 0;
    const observations: RoomObservation[] = [];
    const orders = vi.fn(() => []);
    const steps: ReplayStep[] = [];
    const starting = initial();
    const room = new MatchRoom({
      id: 'finality',
      initialState: starting,
      kernel: createKernel([module]),
      data,
      now: () => wall,
      initiallyStarted: true,
      timeScale: 2,
      observe: (e) => observations.push(e),
      serverOrders: orders,
      record: (step) => steps.push(step),
    });
    wall = 6; // wall target maps to game time 12; finish happens at 10
    expect(room.tick()).toBe(true);
    const final = structuredClone(room.state);
    expect(final.time).toBe(10);
    expect(orders).not.toHaveBeenCalled();
    wall = 1000;
    expect(room.tick()).toBe(false);
    expect(room.state).toEqual(final);
    expect(room.isClockRunning).toBe(false);
    expect(room.msUntilNextEvent()).toBeNull();
    expect(room.clockSnapshot).toMatchObject({ gameTime: 10, running: false, timeScale: 2 });
    const messages: ServerMessage[] = [];
    room.addPeer('p1', { send: (raw) => messages.push(JSON.parse(raw) as ServerMessage) });
    expect(messages[0]).toMatchObject({ type: 'welcome', serverTime: 10 });
    const schedule = vi.fn();
    const driver = startClockDriver(room, { heartbeatMs: 1000, schedule });
    driver.reschedule();
    expect(schedule).not.toHaveBeenCalled();
    driver.stop();
    const receipt = await room.submitServerAction('p1', {
      id: 'late',
      type: 'noop',
      playerId: 'p1',
      issuedAt: 1000,
      payload: {},
    });
    expect(receipt).toMatchObject({ ok: false, code: 'E_MATCH_ENDED' });
    expect(room.state).toEqual(final);
    expect(observations.filter((e) => e.kind === 'end')).toHaveLength(1);
    const replay = runReplay(createKernel([module]), data, {
      dataVersion: data.version,
      initial: starting,
      steps,
    });
    expect(replay.rejected).toEqual([]);
    expect(replay.hash).toBe(hashState(final));
  });

  it('persists the finishing instant before a durable commit and keeps it after restore', async () => {
    let wall = 0;
    let saved: MatchSnapshot | undefined;
    const room = new MatchRoom({
      id: 'durable-finality',
      initialState: initial(),
      kernel: createKernel([module]),
      data,
      now: () => wall,
      initiallyStarted: true,
      timeScale: 2,
      persist: async (snapshot) => {
        saved = structuredClone(snapshot);
      },
    });
    wall = 6;
    await room.submitServerAction('p1', {
      id: 'finishing',
      type: 'noop',
      playerId: 'p1',
      issuedAt: 0,
      payload: {},
    });
    expect(saved?.state.time).toBe(10);
    expect(saved?.clock).toMatchObject({ gameTime: 10, running: false });
    expect(saved?.createdAt).toBe(0);
    expect(saved?.endedAt).toBe(6);
    expect(room.endedAt).toBe(6);
    if (!saved) throw new Error('missing snapshot');
    wall = 1000;
    const restored = new MatchRoom({
      id: saved.matchId,
      initialState: saved.state,
      kernel: createKernel([module]),
      data,
      now: () => wall,
      initiallyStarted: true,
      timeScale: 2,
      initialClock: saved.clock,
      initialCreatedAt: saved.createdAt,
      initialEndedAt: saved.endedAt,
    });
    expect(restored.tick()).toBe(false);
    expect(restored.state).toEqual(saved.state);
    expect(restored.clockSnapshot).toMatchObject({ gameTime: 10, running: false });
    expect(restored.endedAt).toBe(6);
    expect(restored.createdAt).toBe(0);
  });

  it('does not start archive retention when the finishing durable write fails', async () => {
    let wall = 0;
    const persist = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const room = new MatchRoom({
      id: 'failed-finish', initialState: initial(), kernel: createKernel([module]), data,
      now: () => wall, initiallyStarted: true, persist,
    });
    const action = { id: 'finish', type: 'finishAction', playerId: 'p1', issuedAt: 0, payload: {} };
    wall = 1;
    expect((await room.submitServerAction('p1', action)).ok).toBe(false);
    expect(room.state.match.status).toBe('ongoing');
    expect(room.endedAt).toBeUndefined();
    wall = 2;
    expect((await room.submitServerAction('p1', action)).ok).toBe(true);
    expect(room.endedAt).toBe(2);
    expect(persist.mock.calls[1]![0].endedAt).toBe(2);
  });
});
