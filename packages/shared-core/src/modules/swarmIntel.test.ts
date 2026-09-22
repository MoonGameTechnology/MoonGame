import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { visibleState } from '../state/visibility';
import { visibilityModule } from './visibility';

const data = parseGameData({ version: '1', resources: ['metal'], units: { scout: { faction: 'human', stats: { attack: 0, defense: 0, hp: 10, speed: 1, radarRange: 2000 } } }, factions: {}, buildings: {}, events: {} });
function fixture(): GameState {
  const state = createInitialState({ seed: 'contact', version: { data: '1', manifest: '1' } });
  state.players = {
    p1: { id: 'p1', name: 'Human', faction: 'human', status: 'active', resources: {} },
    p2: { id: 'p2', name: 'Swarm', faction: 'swarm', status: 'active', resources: {} },
  };
  state.planets = Object.fromEntries(['A', 'B'].map(id => [id, {
    id, owner: id === 'A' ? 'p1' : null, position: { x: id === 'A' ? 0 : 1000, y: 0 },
    links: [], resources: {}, buildings: [], garrison: [], traits: [],
  }]));
  state.fleets = { swarm: { id: 'swarm', owner: 'p2', location: 'B', movement: null,
    traits: [], units: [{ unit: 'swarm_drone', count: 5 }] } };
  return state;
}
const kernel = createKernel([visibilityModule]);
function advance(state: GameState, now: number): GameState {
  const result = kernel.advanceTo(state, { now, data, config: { timeScale: 1 } });
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

describe('Swarm contact intelligence', () => {
  it('records only identified enemy Swarm fleets and copies their composition', () => {
    const state = fixture();
    expect(advance(state, 1).swarmIntel?.p1).toBeUndefined();
    state.fleets.swarm!.location = 'A';
    const seen = advance(state, 2);
    expect(seen.swarmIntel?.p1?.swarm).toEqual({ owner: 'p2', location: 'A', at: 2,
      units: [{ unit: 'swarm_drone', count: 5 }] });
    expect(state.swarmIntel).toBeUndefined();
    seen.fleets.swarm!.units[0]!.count = 99;
    expect(seen.swarmIntel?.p1?.swarm?.units[0]?.count).toBe(5);
    expect(seen.swarmIntel?.p2).toBeUndefined();
  });

  it('retains last contact under fog, replaces it on sight, and survives a save roundtrip', () => {
    let state = fixture();
    state.fleets.swarm!.location = 'A';
    state = advance(state, 1);
    state.fleets.swarm!.location = 'B';
    state.fleets.swarm!.units = [{ unit: 'swarm_guard', count: 9 }];
    state = advance(JSON.parse(JSON.stringify(state)) as GameState, 2);
    const view = visibleState(state, 'p1', data);
    expect(view.fleets.swarm).toBeUndefined();
    expect(view.swarmIntel?.p1?.swarm?.units).toEqual([{ unit: 'swarm_drone', count: 5 }]);
    state.fleets.swarm!.location = 'A';
    state = advance(state, 3);
    expect(state.swarmIntel?.p1?.swarm).toMatchObject({ at: 3, units: [{ unit: 'swarm_guard', count: 9 }] });
    expect(advance(fixture(), 4).swarmIntel).toBeUndefined();
  });

  it('radar-only detection remains a signature and teaches no composition', () => {
    const state = fixture();
    state.planets.B!.position.x = 1500;
    state.fleets.scout = { id: 'scout', owner: 'p1', location: 'A', movement: null,
      traits: [], units: [{ unit: 'scout', count: 1 }] };
    const seen = advance(state, 1);
    const view = visibleState(seen, 'p1', data);
    expect(view.signatures).toHaveLength(1);
    expect(view.fleets.swarm).toBeUndefined();
    expect(view.swarmIntel).toBeUndefined();
  });

  it('does not disclose other observers records or record non-Swarm factions', () => {
    const state = fixture();
    state.swarmIntel = { p2: { secret: { owner: 'p1', location: 'B', at: 0, units: [] } } };
    expect(visibleState(state, 'p1', data).swarmIntel).toBeUndefined();
    state.players.p2!.faction = 'pirates';
    state.fleets.swarm!.location = 'A';
    expect(advance(state, 1).swarmIntel?.p1).toBeUndefined();
  });
});
