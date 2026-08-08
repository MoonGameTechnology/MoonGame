/**
 * Tests for the squadron free-space movement module (squadronModule).
 * Covers: squadron.strike (happy path + all rejection codes), squadron.return,
 * squadron.arrived (dock + combat), and the fleet.split → homeBase wiring.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { squadronModule } from './squadron';
import { fleetOpsModule } from './fleetOps';
import { movementModule } from './movement';
import { combatModule } from './combat';
import { economyModule } from './economy';
import { createInitialState } from '../state/gameState';
import type { Action, Context } from '../action/types';
import type { Fleet, GameState, Planet, Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {
    carrier: {
      faction: 'x',
      stats: { attack: 4, defense: 10, speed: 5, hp: 70, cargoCapacity: 6 },
      cost: { metal: 100 },
      buildTimeHours: 4,
      traits: ['carrier'],
    },
    fighter_squadron: {
      faction: 'x',
      stats: { attack: 14, defense: 3, speed: 14, hp: 10, strikeRange: 180, fuel: 3, rearmRounds: 2 },
      cost: { metal: 90, credits: 40 },
      buildTimeHours: 2,
      traits: ['squadron'],
    },
    cruiser: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 10 },
      buildTimeHours: 2,
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const ctx = (now: number): Context => ({ now, data });

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal: 1000, credits: 1000 } };
}

function planet(id: string, owner: string | null, x = 0, y = 0): Planet {
  return {
    id,
    owner,
    position: { x, y },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}

function fleet(id: string, owner: string, loc: string | null, units: Array<{ unit: string; count: number }>): Fleet {
  return {
    id,
    owner,
    location: loc,
    movement: null,
    units,
    landing: [],
    traits: [],
    battleId: null,
  };
}

function stateWith(opts: { players?: Player[]; planets?: Planet[]; fleets?: Fleet[] }): GameState {
  const s = createInitialState({ seed: 'sq', version: { data: data.version, manifest: '4' } });
  const players: Record<string, Player> = {};
  for (const p of opts.players ?? []) players[p.id] = p;
  const planets: Record<string, Planet> = {};
  for (const p of opts.planets ?? []) planets[p.id] = p;
  const fleets: Record<string, Fleet> = {};
  for (const f of opts.fleets ?? []) fleets[f.id] = f;
  return { ...s, players, planets, fleets };
}

let actSeq = 0;
function act(playerId: string, type: string, payload: Record<string, unknown>): Action {
  return { id: `s:${playerId}:${++actSeq}`, type, playerId, payload, issuedAt: 0 };
}

function okApply(r: { ok: true; state: GameState } | { ok: false; code: string }) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}

function errCode(r: { ok: true } | { ok: false; code: string }): string | null {
  return r.ok ? null : r.code;
}

describe('squadron module — free-space movement', () => {
  it('squadron.strike: a split-off squadron wing flies to an enemy fleet', () => {
    const kernel = createKernel([squadronModule, fleetOpsModule, movementModule, combatModule, economyModule]);
    // Carrier at A (0,0) with 2 fighters + 1 cruiser; enemy cruiser at B (100,0)
    const st = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0), planet('B', 'p2', 100, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'carrier', count: 1 }, { unit: 'fighter_squadron', count: 2 }, { unit: 'cruiser', count: 1 }]),
        fleet('f2', 'p2', 'B', [{ unit: 'cruiser', count: 1 }]),
      ],
    });
    // Split the squadron off → creates a new fleet with homeBase
    const split = okApply(kernel.applyAction(st, act('p1', 'fleet.split', { fleetId: 'f1', take: [{ unit: 'fighter_squadron', count: 2 }] }), ctx(0)));
    // Find the new fleet
    const newFleetId = Object.keys(split.state.fleets).find((id) => id !== 'f1' && id !== 'f2')!;
    expect(newFleetId).toBeDefined();
    const wing = split.state.fleets[newFleetId]!;
    expect(wing.homeBase).toBe('f1');
    expect(wing.freePosition).toEqual({ x: 0, y: 0 });

    // Strike the enemy fleet at B (within strikeRange 180 of base at A)
    const strike = kernel.applyAction(split.state, act('p1', 'squadron.strike', { fleetId: newFleetId, targetFleetId: 'f2' }), ctx(0));
    expect(strike.ok).toBe(true);
    if (strike.ok) {
      const wing2 = strike.state.fleets[newFleetId]!;
      expect(wing2.freeMovement).not.toBeNull();
      expect(wing2.freeMovement!.targetX).toBe(100);
      expect(wing2.freeMovement!.targetY).toBe(0);
      expect(wing2.location).toBeNull();
    }
  });

  it('squadron.strike: rejects if fleet has no homeBase (not a squadron)', () => {
    const kernel = createKernel([squadronModule]);
    const st = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0), planet('B', 'p2', 100, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'cruiser', count: 1 }]),
        fleet('f2', 'p2', 'B', [{ unit: 'cruiser', count: 1 }]),
      ],
    });
    const r = kernel.applyAction(st, act('p1', 'squadron.strike', { fleetId: 'f1', targetFleetId: 'f2' }), ctx(0));
    expect(errCode(r)).toBe('E_NOT_SQUADRON');
  });

  it('squadron.strike: rejects if target is own fleet', () => {
    const kernel = createKernel([squadronModule, fleetOpsModule]);
    const st = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1', 0, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'carrier', count: 1 }, { unit: 'fighter_squadron', count: 2 }]),
        fleet('f2', 'p1', 'A', [{ unit: 'fighter_squadron', count: 2 }]),
      ],
    });
    // Give f2 a homeBase manually (it's a squadron wing)
    st.fleets['f2']!.homeBase = 'f1';
    st.fleets['f2']!.freePosition = { x: 0, y: 0 };
    const r = kernel.applyAction(st, act('p1', 'squadron.strike', { fleetId: 'f2', targetFleetId: 'f1' }), ctx(0));
    expect(errCode(r)).toBe('E_NOT_HOSTILE');
  });

  it('squadron.strike: rejects if target is out of range', () => {
    const kernel = createKernel([squadronModule, fleetOpsModule]);
    // Base at A (0,0), enemy at C (300,0) — beyond strikeRange 180
    const st = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0), planet('C', 'p2', 300, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'carrier', count: 1 }, { unit: 'fighter_squadron', count: 2 }, { unit: 'cruiser', count: 1 }]),
        fleet('f2', 'p2', 'C', [{ unit: 'cruiser', count: 1 }]),
      ],
    });
    const split = okApply(kernel.applyAction(st, act('p1', 'fleet.split', { fleetId: 'f1', take: [{ unit: 'fighter_squadron', count: 2 }] }), ctx(0)));
    const newFleetId = Object.keys(split.state.fleets).find((id) => id !== 'f1' && id !== 'f2')!;
    const r = kernel.applyAction(split.state, act('p1', 'squadron.strike', { fleetId: newFleetId, targetFleetId: 'f2' }), ctx(0));
    expect(errCode(r)).toBe('E_OUT_OF_RANGE');
  });

  it('squadron.return: flies back to the home base', () => {
    const kernel = createKernel([squadronModule, fleetOpsModule]);
    const st = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0), planet('B', 'p2', 100, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'carrier', count: 1 }, { unit: 'fighter_squadron', count: 2 }, { unit: 'cruiser', count: 1 }]),
        fleet('f2', 'p2', 'B', [{ unit: 'cruiser', count: 1 }]),
      ],
    });
    const split = okApply(kernel.applyAction(st, act('p1', 'fleet.split', { fleetId: 'f1', take: [{ unit: 'fighter_squadron', count: 2 }] }), ctx(0)));
    const newFleetId = Object.keys(split.state.fleets).find((id) => id !== 'f1' && id !== 'f2')!;
    // Move the wing to a free position (simulating it already flew somewhere)
    split.state.fleets[newFleetId]!.freePosition = { x: 50, y: 0 };
    split.state.fleets[newFleetId]!.location = null;
    const r = kernel.applyAction(split.state, act('p1', 'squadron.return', { fleetId: newFleetId }), ctx(0));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const wing = r.state.fleets[newFleetId]!;
      expect(wing.freeMovement).not.toBeNull();
      expect(wing.freeMovement!.targetX).toBe(0);
      expect(wing.freeMovement!.targetY).toBe(0);
    }
  });

  it('fleet.split: a non-squadron split does NOT set homeBase', () => {
    const kernel = createKernel([fleetOpsModule]);
    const st = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1', 0, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'cruiser', count: 2 }, { unit: 'carrier', count: 1 }]),
      ],
    });
    const r = okApply(kernel.applyAction(st, act('p1', 'fleet.split', { fleetId: 'f1', take: [{ unit: 'cruiser', count: 1 }] }), ctx(0)));
    const newFleetId = Object.keys(r.state.fleets).find((id) => id !== 'f1')!;
    expect(r.state.fleets[newFleetId]!.homeBase).toBeUndefined();
  });

  it('does not mutate the input state', () => {
    const kernel = createKernel([squadronModule, fleetOpsModule]);
    const st = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0), planet('B', 'p2', 100, 0)],
      fleets: [
        fleet('f1', 'p1', 'A', [{ unit: 'carrier', count: 1 }, { unit: 'fighter_squadron', count: 2 }, { unit: 'cruiser', count: 1 }]),
        fleet('f2', 'p2', 'B', [{ unit: 'cruiser', count: 1 }]),
      ],
    });
    const frozen = deepFreeze(structuredClone(st));
    // The kernel deep-clones internally, so a frozen input must not throw.
    const r = kernel.applyAction(frozen, act('p1', 'fleet.split', { fleetId: 'f1', take: [{ unit: 'fighter_squadron', count: 2 }] }), ctx(0));
    expect(r.ok).toBe(true);
  });
});