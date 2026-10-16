import { describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  createKernel,
  parseGameData,
  type GameModule,
  type GameState,
  type HandlerContext,
} from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import { snapshotOf } from './persistence';
import type { MatchSnapshot } from './store';

/** Models the authoritative event contract of a round that wipes its defender.
 * Combat arithmetic has its own tests; these exercise the room's commit boundary. */
function wipe(h: HandlerContext): void {
  h.state.planets.home!.garrison = [];
  h.emit('combat.round', {
    battleId: 'battle:1',
    round: 1,
    defender: 'defender',
    attacker: 'attacker',
    dmgToDefender: 100,
    dmgToAttacker: 5,
  });
  h.emit('battle.resolved', { battleId: 'battle:1', winner: 'attacker', rounds: 1 });
}
const module: GameModule = {
  id: 'combat-proof-test',
  version: '1',
  setup(api) {
    api.onAction('test.wipe', (_action, h) => wipe(h));
    api.on('test.wipe', (_event, h) => wipe(h));
  },
};
const data = parseGameData({
  version: 'test',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectors: {},
  planetTypes: {},
});
function state(): GameState {
  const value = createInitialState({
    seed: 'combat-proof',
    version: { data: 'test', manifest: 'test' },
  });
  value.players.defender = {
    id: 'defender',
    name: 'Defender',
    faction: 'f',
    status: 'active',
    resources: {},
    seated: true,
    claimedAt: 0,
  };
  value.players.attacker = {
    id: 'attacker',
    name: 'Attacker',
    faction: 'f',
    status: 'active',
    resources: {},
  };
  value.planets.home = {
    id: 'home',
    owner: 'defender',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [{ unit: 'test', count: 1 }],
    traits: [],
  };
  return value;
}
const action = { id: 'round', type: 'test.wipe', playerId: 'attacker', issuedAt: 0, payload: {} };
const expected = { '["defender",0,"defense"]': ['battle:1'] };

describe('durable combat participation outside the deterministic world', () => {
  it('persists a wiped defender proof with the prospective snapshot before exposing the commit', async () => {
    const writes: MatchSnapshot[] = [];
    const room = new MatchRoom({
      id: 'match',
      initialState: state(),
      data,
      kernel: createKernel([module]),
      now: () => 0,
      persist: async (snapshot) => {
        expect(room.state.planets.home!.garrison).toHaveLength(1);
        expect(room.economyActivitySnapshot).toEqual({});
        expect(snapshot.state.planets.home!.garrison).toEqual([]);
        expect(snapshot.economyActivity).toEqual(expected);
        writes.push(snapshot);
      },
    });
    expect(await room.submitServerAction('attacker', action)).toEqual({ ok: true });
    expect(room.state.planets.home!.garrison).toEqual([]);
    expect(room.economyActivitySnapshot).toEqual(expected);
    expect(snapshotOf(room).economyActivity).toEqual(expected);
    expect(room.state).not.toHaveProperty('economyActivity');
    expect(writes).toHaveLength(1);
  });

  it('does not retain evidence from a failed prospective persist and retries exactly once', async () => {
    const persist = vi.fn(async () => undefined).mockRejectedValueOnce(Error('offline'));
    const room = new MatchRoom({
      id: 'match',
      initialState: state(),
      data,
      kernel: createKernel([module]),
      now: () => 0,
      persist,
    });
    expect((await room.submitServerAction('attacker', action)).ok).toBe(false);
    expect(room.state.planets.home!.garrison).toHaveLength(1);
    expect(room.economyActivitySnapshot).toEqual({});
    expect(await room.submitServerAction('attacker', action)).toEqual({ ok: true });
    expect(room.economyActivitySnapshot).toEqual(expected);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('includes timer-only combat in the next host snapshot without depending on an observer', () => {
    let wall = 0;
    const initial = state();
    initial.scheduled = [{ id: 'wipe:1', at: 1, seq: 0, type: 'test.wipe', payload: {} }];
    const room = new MatchRoom({
      id: 'match',
      initialState: initial,
      data,
      kernel: createKernel([module]),
      now: () => wall,
      initiallyStarted: true,
    });
    wall = 2;
    expect(room.tick()).toBe(true);
    expect(room.state.planets.home!.garrison).toEqual([]);
    expect(snapshotOf(room).economyActivity).toEqual(expected);
    const captured = room.economyActivitySnapshot;
    captured['["defender",0,"defense"]']!.push('forged');
    expect(room.economyActivitySnapshot).toEqual(expected);
  });
});

describe('own orders as presence evidence', () => {
  const DAY = 86_400_000;
  const order = (id: string) => ({ ...action, id, type: 'test.noop', playerId: 'defender' });
  const noop: GameModule = {
    id: 'noop-test',
    version: '1',
    setup(api) {
      api.onAction('test.noop', () => undefined);
    },
  };
  const peer = { send: () => undefined };

  it('records the day of an order sent from the player’s client, never a server driver', () => {
    const room = new MatchRoom({
      id: 'match',
      initialState: state(),
      data,
      kernel: createKernel([module, noop]),
      now: () => 20_741 * DAY + 5,
    });
    expect(room.submitAction('defender', order('driver')).ok).toBe(true);
    expect(room.economyActivitySnapshot).toEqual({});
    expect(room.submitAction('defender', order('client'), peer).ok).toBe(true);
    const facts = room.economyActivitySnapshot;
    expect(facts['["defender",0,"ordersUtc"]']).toEqual(['20741']);
    expect(facts['["defender",0,"orders"]']).toEqual([String(Math.floor(room.state.time / DAY))]);
  });

  it('persists the order day with the prospective snapshot of a durable room', async () => {
    const writes: MatchSnapshot[] = [];
    const room = new MatchRoom({
      id: 'match',
      initialState: state(),
      data,
      kernel: createKernel([module, noop]),
      now: () => 20_741 * DAY + 5,
      clientActionTypes: ['test.noop'],
      persist: async (snapshot) => {
        writes.push(snapshot);
      },
    });
    room.addPeer('defender', peer);
    const raw = JSON.stringify({ type: 'action', action: order('client') });
    await room.receive('defender', peer, raw);
    expect(writes.at(-1)!.economyActivity?.['["defender",0,"ordersUtc"]']).toEqual(['20741']);
    expect(room.economyActivitySnapshot).toEqual(writes.at(-1)!.economyActivity);
  });
});
