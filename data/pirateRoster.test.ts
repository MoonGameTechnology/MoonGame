import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap, canEquip, constructionModule, createInitialState, createKernel,
  factionModule, parseMatchMap, type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';
import firstChapter from './maps/pve-1.json';
import duel from './maps/duel-testbed.json';

const data = shippedGameData();
const kernel = createKernel([constructionModule, factionModule]);
const roster = ['pirate_skiff', 'pirate_frigate', 'pirate_cruiser', 'pirate_boarder', 'pirate_marauder', 'pirate_tank'];

function world(faction: string): GameState {
  const s = createInitialState({ seed: 'pirate-roster', version: { data: data.version, manifest: '1' } });
  s.players.p = { id: 'p', name: 'p', faction, status: 'active', resources: Object.fromEntries(data.resources.map((r) => [r, 10000])) };
  s.planets.A = {
    id: 'A', owner: 'p', kind: 'planet', position: { x: 0, y: 0 }, links: [], resources: {},
    buildings: ['shipyard', 'barracks', 'factory'].map((type) => ({ type, level: 3, hp: 100 })),
    garrison: [], traits: [],
  };
  return s;
}

describe('dedicated pirate units', () => {
  it('the core builds the pirate roster for its faction and rejects other factions', () => {
    for (const unit of roster) {
      const action = { id: 'build', type: 'unit.build', playerId: 'p', issuedAt: 0, payload: { planetId: 'A', unit, count: 1 } };
      expect(kernel.applyAction(world('pirates'), action, { now: 0, data }).ok, unit).toBe(true);
      for (const faction of ['vanguard', 'azure', 'swarm']) {
        const r = kernel.applyAction(world(faction), action, { now: 0, data });
        expect(r.ok ? 'accepted' : r.code, `${faction}: ${unit}`).toBe('E_FORBIDDEN');
      }
    }
  });

  it('ships and infantry/vehicles keep their real domains and transport sizes', () => {
    for (const id of roster.slice(0, 3)) expect(data.units[id]?.domain, id).toBe('space');
    for (const id of roster.slice(3)) expect(data.units[id]?.domain, id).toBe('ground');
    expect(data.units.pirate_tank?.kind).toBe('vehicle');
    expect(data.units.pirate_tank?.stats.cargoSize).toBe(2);
    expect(data.units.pirate_boarder?.stats.cargoSize).toBe(1);
  });

  it('the raider accepts the siege and repair modules its AI orders', () => {
    for (const module of ['siege_platform', 'repair_bay'])
      expect(canEquip('pirate_cruiser', data.units.pirate_cruiser!, [], module, data), module).toEqual({ ok: true });
  });

  it('authored maps actually field the dedicated pirates', () => {
    for (const source of [firstChapter, duel]) {
      const map = parseMatchMap(source);
      const slots = Object.fromEntries(Object.keys(map.slots).map((id) => [id, { playerId: id }]));
      const s = buildStateFromMap(map, data, { slots });
      expect(s.players.pirates?.faction).toBe('pirates');
      expect(s.fleets.pirate_patrol?.units).toEqual([{ unit: 'pirate_frigate', count: 2 }]);
      for (const p of Object.values(s.planets).filter((p) => p.owner === 'pirates'))
        for (const stack of p.garrison) expect(data.units[stack.unit]?.faction).toBe('pirates');
    }
  });
});
