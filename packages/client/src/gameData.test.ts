import { describe, it, expect } from 'vitest';

import { shippedGameData } from '../../../data/bundle';
import { pveState, skirmishState } from './gameData';

/**
 * The client's doors into a playable state. Both were uncovered, and the PvE one was
 * shut: `pve-1.json` shipped four criss-crossing lanes, so `buildStateFromMap` threw
 * `E_INVALID_MAP` and the prototype's "🤖 PvE" button died without a word (PVR-0.1).
 * A door nobody opens in tests is a door that closes silently.
 */
const data = shippedGameData();

describe('pveState — the PvE door', () => {
  it('builds a state from the shipped PvE map', () => {
    const state = pveState(data);
    expect(Object.keys(state.planets).sort()).toEqual([
      'drift',
      'hive',
      'home_a',
      'home_b',
      'nexus',
      'ridge',
      'veil',
    ]);
    expect(state.planets.home_a!.owner).toBe('p1'); // the human seat
    expect(state.planets.hive!.owner).toBe('p3');
    expect(state.players.p3!.faction).toBe('swarm');
    expect(state.fleets.p1_1!.location).toBe('home_a');
  });

  it('lays the sectors out as a funnel: two lanes off the hub, one gate to the hive', () => {
    const state = pveState(data);
    // nexus is where both homes meet and where the two flanks come back together
    expect(state.planets.nexus!.links).toEqual(['drift', 'home_a', 'home_b', 'veil']);
    // drift and veil are the two ways between the hub and the gate — a choice, not a corridor
    expect(state.planets.drift!.links).toEqual(['nexus', 'ridge']);
    expect(state.planets.veil!.links).toEqual(['nexus', 'ridge']);
    // the Swarm has exactly one way out, and it is the storm the players can hold
    expect(state.planets.hive!.links).toEqual(['ridge']);
    expect(state.planets.ridge!.links).toEqual(['drift', 'hive', 'veil']);
  });
});

describe('skirmishState — the single-player door', () => {
  it('builds a state from the shipped skirmish map', () => {
    expect(Object.keys(skirmishState(data).planets)).toHaveLength(5);
  });
});
