import { describe, expect, it } from 'vitest';
import {
  createInitialState, createKernel, parseGameData, sensorCoverage, viewCoverage,
  victoryModule, visibilityModule, visibleState, type GameState, type Planet,
} from '@void/shared-core';
import { economyObservation } from './metaEconomyObservation';
import { operationProgress } from './metaEconomyDelivery';
import { matchProfileProgress } from './profileCredit';

const data = parseGameData({ version: 'test', resources: ['metal'], units: {}, factions: {}, buildings: {}, events: {} });
function world(): GameState {
  const state = createInitialState({ seed: 'final-exploration', version: { data: 'test', manifest: 'test' } });
  state.players = {
    p1: { id: 'p1', name: 'One', faction: 'x', status: 'active', resources: {} },
    p2: { id: 'p2', name: 'Two', faction: 'x', status: 'active', resources: {} },
  };
  state.planets = Object.fromEntries(Array.from({ length: 10 }, (_,i) => {
    const planet: Planet = { id: `world-${i}`, owner: i === 0 ? 'p1' : 'p2',
      position: { x: i * 2000, y: 0 }, resources: {}, garrison: [], buildings: [], traits: [], links: [] };
    return [planet.id, planet];
  }));
  return state;
}

describe('post-match map reveal and exploration facts', () => {
  it('reveals a timeout finish without awarding exploration, recon operations or career progress', () => {
    // Match the real module order: victory handles time.advanced before visibility.
    const kernel = createKernel([victoryModule, visibilityModule]);
    const config = { timeScale: 1, victory: { dominationPercent: 1, scoreLimit: 1e12, endsAt: 10 } };
    const first = kernel.advanceTo(world(), { now: 1, data, config });
    if (!first.ok) throw new Error(first.code);
    expect(first.state.match.status).toBe('ongoing');
    const baseline = economyObservation(first.state, 'p1');
    expect(baseline.known).toEqual(['world-0']);
    const finished = kernel.advanceTo(first.state, { now: 10, data, config });
    if (!finished.ok) throw new Error(finished.code);
    expect(finished.state.match.status).toBe('ended');
    expect(Object.keys(finished.state.fog!.p1!)).toEqual(['world-0']);
    expect(economyObservation(finished.state, 'p1').known).toEqual(baseline.known);
    expect(operationProgress(finished.state, 'p1', baseline).recon).toBe(0);
    expect(matchProfileProgress(finished.state, 'p1').explored).toBe(1);
    expect(sensorCoverage(finished.state, 'p1', data).identify.size).toBe(1);
    expect(viewCoverage(finished.state, 'p1', data).identify.size).toBe(10);
    const frozen = structuredClone(finished.state);
    for (const player of ['p1','p2']) {
      const view = visibleState(finished.state, player, data);
      for (const [id, planet] of Object.entries(finished.state.planets)) expect(view.planets[id]!.owner).toBe(planet.owner);
    }
    expect(finished.state).toEqual(frozen);
    expect(operationProgress(finished.state, 'p1', baseline).recon).toBe(0);
    expect(matchProfileProgress(finished.state, 'p1').explored).toBe(1);
  });
});
