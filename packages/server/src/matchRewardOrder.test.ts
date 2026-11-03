import { describe, expect, it } from 'vitest';
import {
  combatModule,
  createInitialState,
  createKernel,
  parseGameData,
  type Action,
} from '@void/shared-core';
import { isMeaningfulRewardOrder } from './matchRewardOrder';

describe('meaningful own orders for final rewards', () => {
  it('counts an actual group retreat, but not unrelated or enemy fleet changes', () => {
    const data = parseGameData({
      version: 'orders',
      resources: ['metal'],
      factions: {},
      buildings: {},
      events: {},
      units: {
        ship: {
          faction: 'x',
          stats: { hp: 1000, speed: 1, attack: 12, defense: 8 },
          line: 'front',
        },
      },
    });
    const before = createInitialState({
      seed: 'retreat',
      version: { data: 'orders', manifest: 'test' },
    });
    for (const id of ['p1', 'p2'])
      before.players[id] = { id, name: id, faction: 'x', resources: {}, status: 'active' };
    for (const id of ['one', 'two', 'enemy', 'elsewhere'])
      before.fleets[id] = {
        id,
        owner: id === 'enemy' ? 'p2' : 'p1',
        location: 'front',
        units: [{ unit: 'ship', count: 1 }],
        movement: null,
        traits: [],
        battleId: id === 'elsewhere' ? null : 'battle',
      };
    before.battles.battle = {
      id: 'battle',
      phase: 'orbital',
      location: 'front',
      round: 0,
      nextRoundAt: 3600000,
      sides: ['one', 'two', 'enemy'].map((fleetId) => ({
        ref: { kind: 'fleet', fleetId },
        owner: before.fleets[fleetId]!.owner,
        role: fleetId === 'enemy' ? 'defender' : 'attacker',
      })),
    };
    const action: Action = {
      id: 'retreat',
      type: 'battle.retreat',
      playerId: 'p1',
      issuedAt: 0,
      payload: { battleId: 'battle', to: 'safe' },
    };
    const result = createKernel([combatModule]).applyAction(before, action, { now: 0, data });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    expect(result.events.filter((event) => event.type === 'fleet.retreated')).toHaveLength(2);
    expect(isMeaningfulRewardOrder(action, before, result.state)).toBe(true);
    expect(isMeaningfulRewardOrder(action, before, structuredClone(before))).toBe(false);
    for (const fleet of ['enemy', 'elsewhere']) {
      const changed = structuredClone(before);
      changed.fleets[fleet]!.battleId = null;
      changed.fleets[fleet]!.retreatHasteUntil = 1000;
      expect(isMeaningfulRewardOrder(action, before, changed)).toBe(false);
    }
  });

  it('rejects a repeated bombardment toggle and accepts an actual change', () => {
    const before = createInitialState({
      seed: 'orders',
      version: { data: 'test', manifest: 'test' },
    });
    before.players.p1 = {
      id: 'p1',
      name: 'A',
      faction: 'vanguard',
      resources: {},
      status: 'active',
    };
    before.fleets.f = {
      id: 'f',
      owner: 'p1',
      location: 'home',
      movement: null,
      traits: [],
      units: [],
    };
    const action: Action = {
      id: 'toggle',
      type: 'fleet.bombard',
      playerId: 'p1',
      payload: { fleetId: 'f', on: true },
      issuedAt: 0,
    };
    expect(isMeaningfulRewardOrder(action, before, structuredClone(before))).toBe(false);
    const changed = structuredClone(before);
    changed.fleets.f!.bombarding = true;
    expect(isMeaningfulRewardOrder(action, before, changed)).toBe(true);
    expect(isMeaningfulRewardOrder(action, changed, structuredClone(changed))).toBe(false);
  });

  it('does not count bookkeeping or changes produced by prior catch-up as the player contribution', () => {
    const state = createInitialState({
      seed: 'orders',
      version: { data: 'test', manifest: 'test' },
    });
    state.players.p1 = {
      id: 'p1',
      name: 'A',
      faction: 'vanguard',
      resources: { credits: 100 },
      status: 'active',
    };
    const after = structuredClone(state);
    after.players.p1!.resources.credits = 50;
    const action: Action = {
      id: 'order',
      type: 'unit.build',
      playerId: 'p1',
      payload: {},
      issuedAt: 0,
    };
    expect(isMeaningfulRewardOrder(action, state, after)).toBe(true);
    expect(isMeaningfulRewardOrder({ ...action, type: 'arsenal.sync' }, state, after)).toBe(false);
    expect(isMeaningfulRewardOrder(action, after, structuredClone(after))).toBe(false);
  });
});
