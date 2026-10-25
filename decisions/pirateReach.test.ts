import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type Planet } from '../packages/shared-core/src/state/gameState';
import {
  PIRATE_FLEET_MAX,
  PIRATE_FLEET_PER_DAY,
  PIRATE_FLEET_START,
  isPirateClan,
  pirateRaidZone,
  pirateShipCap,
  pirateShipCount,
} from './pirateReach';

const DAY = 24 * 3_600_000;

const node = (id: string, owner: string | null, links: string[], kind = 'planet'): Planet => ({
  id, owner, kind, links, position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [],
});

/** Цепочка DEN — A — B — C — D: логово на одном конце. */
function world(): GameState {
  const s = createInitialState({ seed: 'pirates', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    startedAt: 0,
    time: 0,
    players: {
      pir: { id: 'pir', name: 'pir', faction: 'pirates', status: 'active', resources: {}, npc: 'pirate' },
      p1: { id: 'p1', name: 'p1', faction: 'azure', status: 'active', resources: {} },
    },
    planets: {
      DEN: node('DEN', 'pir', ['A'], 'pirate_base'),
      A: node('A', null, ['DEN', 'B']),
      B: node('B', null, ['A', 'C']),
      C: node('C', null, ['B', 'D']),
      D: node('D', 'p1', ['C']),
    },
    fleets: {},
  };
}

describe('pirateReach', () => {
  it('knows a pirate clan by its NPC role, not by its house', () => {
    const s = world();
    expect(isPirateClan(s, 'pir')).toBe(true);
    expect(isPirateClan(s, 'p1')).toBe(false);
  });

  it('raids two lane hops from the den and no further', () => {
    expect([...pirateRaidZone(world(), 'pir')].sort()).toEqual(['A', 'B', 'DEN']);
  });

  it('measures from any own world once the den is lost, and has no zone with none', () => {
    const s = world();
    s.planets.DEN!.owner = 'p1';
    s.planets.C!.owner = 'pir';
    expect([...pirateRaidZone(s, 'pir')].sort()).toEqual(['A', 'B', 'C', 'D']);
    s.planets.C!.owner = null;
    expect(pirateRaidZone(s, 'pir').size).toBe(0);
  });

  it('grows the fleet cap by the game day up to the limit', () => {
    const s = world();
    expect(pirateShipCap(s)).toBe(PIRATE_FLEET_START);
    s.time = 2 * DAY + 1;
    expect(pirateShipCap(s)).toBe(PIRATE_FLEET_START + 2 * PIRATE_FLEET_PER_DAY);
    s.time = 100 * DAY;
    expect(pirateShipCap(s)).toBe(PIRATE_FLEET_MAX);
  });

  it('counts ships in fleets, in port, on the slip and in the queue — not ground troops', () => {
    const s = world();
    const isShip = (u: string): boolean => u !== 'boarder';
    s.fleets.F = {
      id: 'F', owner: 'pir', location: 'DEN', movement: null, battleId: null, traits: [],
      units: [{ unit: 'cruiser', count: 3 }, { unit: 'boarder', count: 5 }],
    };
    s.planets.DEN!.garrison = [{ unit: 'skiff', count: 2 }, { unit: 'boarder', count: 4 }];
    s.planets.DEN!.buildQueue = [{ id: 9, kind: 'unit', playerId: 'pir', unit: 'cruiser', count: 1 }];
    s.scheduled = [
      { id: 'evt:1', at: 1, seq: 1, type: 'construction.complete', payload: { kind: 'unit', planetId: 'DEN', unit: 'skiff', count: 2 } },
      { id: 'evt:2', at: 1, seq: 2, type: 'construction.complete', payload: { kind: 'unit', planetId: 'D', unit: 'skiff', count: 7 } },
    ];
    expect(pirateShipCount(s, 'pir', isShip)).toBe(3 + 2 + 1 + 2);
  });
});
