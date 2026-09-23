import { describe, expect, it } from 'vitest';
import { pveState, shippedGameData } from '../packages/client/src/gameData';
import { pirateEncounter } from './pirateEncounter';

function run() {
  const state = pveState(shippedGameData());
  state.pve = { waveNumber: 1, totalWaves: 10, npcPlayerId: 'p3' };
  return state;
}

describe('pirate encounter readout', () => {
  it('does not credit a third-party clear; old saves and finished runs show no hint', () => {
    const state = run();
    state.planets.pirate_den!.owner = 'p3';
    expect(pirateEncounter(state, 'p1')?.stage).toBe('cleared');
    state.match.status = 'ended';
    expect(pirateEncounter(state, 'p1')).toBeNull();
    state.match.status = 'ongoing';
    delete state.planets.pirate_den;
    expect(pirateEncounter(state, 'p1')).toBeNull();
  });

  it('losing the fleet suggests rebuilding, and restoring a captured base keeps progress', () => {
    const state = run();
    // Флотов у игрока на старте два: учебный и стража дома (PVR-2.4). «Флот потерян» —
    // это когда кораблей не осталось вовсе: со стражей дома к пиратам ещё есть с чем идти.
    for (const [id, f] of Object.entries(state.fleets)) if (f.owner === 'p1') delete state.fleets[id];
    expect(pirateEncounter(state, 'p1')?.stage).toBe('recover');
    state.planets.pirate_den!.owner = 'p1';
    expect(pirateEncounter(JSON.parse(JSON.stringify(state)), 'p1')?.stage).toBe('won');
  });

  it('a multi-hop course targets the final destination; cancelling it returns to approach', () => {
    const state = run();
    state.fleets.p1_1!.movement = {
      from: 'drift', to: 'home_a', destination: 'pirate_den', path: ['pirate_den'],
      departedAt: 0, arrivesAt: 100,
    };
    expect(pirateEncounter(state, 'p1')?.stage).toBe('travel');
    state.fleets.p1_1!.movement = null;
    expect(pirateEncounter(state, 'p1')?.stage).toBe('approach');
  });
});
