import { describe, expect, it } from 'vitest';
import { createInitialState, type Action } from '@void/shared-core';
import { isMeaningfulRewardOrder } from './matchRewardOrder';

describe('meaningful own orders for final rewards', () => {
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
