import { expect, it } from 'vitest';
import { registerConstructionMaintenance } from './maintenance';
import type { EventHandler, HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { DomainEvent } from '../../action/types';
import { createInitialState } from '../../state/gameState';
import { parseGameData } from '../../data/schemas';

it('enumerates worlds a bounded number of times per maintenance step, independently of parked fleets', () => {
  const data = parseGameData({ version: 'services', resources: ['metal'], factions: {}, events: {},
    units: { scout: { faction: 'x', domain: 'space', stats: { hp: 100, attack: 1, defense: 1, speed: 1 } } }, buildings: {} });
  const state = createInitialState({ seed: 'services', version: { data: data.version, manifest: '1' } });
  state.players.p1 = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} };
  for (let i = 0; i < 800; i++) {
    const id = `p${i}`;
    state.planets[id] = { id, owner: 'p1', position: { x: i, y: 0 },
      buildings: [], garrison: [], resources: {}, traits: [] };
  }
  for (let i = 0; i < 372; i++) {
    const id = `f${i}`;
    state.fleets[id] = { id, owner: 'p1', location: `p${i}`, movement: null,
      units: [{ unit: 'scout', count: 1 }], traits: [] };
  }
  let scans = 0;
  state.planets = new Proxy(state.planets, {
    ownKeys(target) { scans++; return Reflect.ownKeys(target); },
  });
  let advance: EventHandler | undefined;
  registerConstructionMaintenance({ on(type, handler) {
    if (type === 'time.advanced') advance = handler;
  } } as ModuleSetupApi, () => { throw new Error('unexpected infected world'); });
  expect(advance).toBeDefined();
  advance!({ type: 'time.advanced', payload: { from: 0, to: 3_600_000 } } as DomainEvent,
    { state, ctx: { now: 3_600_000, data } } as HandlerContext);
  expect(scans).toBeLessThanOrEqual(5);
  expect(Object.values(state.fleets).every((fleet) => fleet.units[0]?.hp === undefined)).toBe(true);
});
