import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  createKernel,
  parseGameData,
  type GameModule,
} from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import { snapshotOf } from './persistence';
import type { MatchSnapshot } from './store';

const data = parseGameData({
  version: 't',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectors: {},
  planetTypes: {},
});
const module: GameModule = {
  id: 'clock-proof',
  version: '1',
  setup(api) {
    api.onAction('arm', (_, h) => {
      h.schedule(h.ctx.now + 3_600_000, 'paid', {});
    });
    api.on('paid', (_, h) => {
      h.state.players.p!.resources.credits! += 1;
    });
  },
};
const initial = () => ({
  ...createInitialState({ seed: 'clock', version: { data: 't', manifest: 't' } }),
  players: {
    p: { id: 'p', name: 'P', faction: 'p', status: 'active' as const, resources: { credits: 0 } },
  },
});

describe('durable room clock', () => {
  it('keeps idle elapsed time and downtime at the saved scale, then uses the new scale', () => {
    let wall = 100_000;
    const make = (snap?: MatchSnapshot, scale = 24) =>
      new MatchRoom({
        id: 'clock',
        initialState: snap?.state ?? initial(),
        kernel: createKernel([module]),
        data,
        now: () => wall,
        initiallyStarted: true,
        timeScale: scale,
        initialClock: snap?.clock,
      });
    const first = make();
    wall += 60_000;
    const snap = snapshotOf(first); // no actions/ticks: state.time still zero
    expect(snap.state.time).toBe(0);
    wall += 20_000;
    const restarted = make(snap, 2);
    expect(snapshotOf(restarted).clock?.gameTime).toBe(80_000 * 24);
    wall += 1000;
    expect(snapshotOf(restarted).clock?.gameTime).toBe(80_000 * 24 + 2000);
    wall -= 5000; // NTP correction must not rewind an already observed clock
    expect(snapshotOf(restarted).clock?.gameTime).toBe(80_000 * 24 + 2000);
  });

  it('eight hours across a crash processes the scheduled effect once, matching continuous time', () => {
    let wall = 100_000;
    const make = (snap?: MatchSnapshot) =>
      new MatchRoom({
        id: 'clock',
        initialState: snap?.state ?? initial(),
        kernel: createKernel([module]),
        data,
        now: () => wall,
        initiallyStarted: true,
        initialClock: snap?.clock,
        initialSeq: snap?.seq,
      });
    const continuous = make();
    continuous.submitAction('p', {
      id: 'arm:1',
      type: 'arm',
      playerId: 'p',
      issuedAt: 0,
      payload: {},
    });
    const snap = snapshotOf(continuous);
    for (let h = 1; h <= 8; h++) {
      wall = 100_000 + h * 3_600_000;
      continuous.tick();
    }
    const restarted = make(snap);
    restarted.tick();
    expect(restarted.state).toEqual(continuous.state);
    expect(restarted.state.players.p!.resources.credits).toBe(1);
    const again = make(snapshotOf(restarted));
    again.tick();
    expect(again.state.players.p!.resources.credits).toBe(1);
  });

  it('does not charge downtime to a lobby that has not started', () => {
    let wall = 100_000;
    const opts = {
      id: 'lobby',
      initialState: initial(),
      kernel: createKernel([]),
      data,
      now: () => wall,
      manualStart: true,
    };
    const snap = snapshotOf(new MatchRoom(opts));
    wall += 8 * 3_600_000;
    const restored = new MatchRoom({ ...opts, initialState: snap.state, initialClock: snap.clock });
    expect(restored.isClockRunning).toBe(false);
    expect(snapshotOf(restored).clock?.gameTime).toBe(0);
  });
});
