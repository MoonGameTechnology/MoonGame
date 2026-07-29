import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { instantRepairModule } from './instantRepair';
import { createInitialState, type Fleet, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// instantRepair — "золотой ремонт": мгновенный топ-ап корпуса за кредиты, из
// любого места. Порт прототипного instantRepairModule (prototype/src/instantRepair.ts,
// REFP-17). Ни один тест не завязан на ИИ/бота — только явные фикстуры.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 40 } },
  },
  factions: {},
  buildings: {},
  events: {},
});
const ctx: Context = { now: 0, data };

function player(id: string, credits = 0): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { credits } };
}
function fleet(id: string, owner: string, units: Array<[string, number, number?]> = []): Fleet {
  return {
    id,
    owner,
    location: 'A',
    movement: null,
    units: units.map(([unit, count, hp]) => ({ unit, count, ...(hp !== undefined ? { hp } : {}) })),
    traits: [],
  };
}
function stateWith(opts: { players?: Player[]; fleets?: Fleet[] }): GameState {
  const s = createInitialState({ seed: 'ir', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  return { ...s, players, fleets };
}
function act(fleetId: string, playerId = 'p1'): Action {
  return { id: `a:${playerId}:1`, type: 'fleet.instantRepair', playerId, payload: { fleetId }, issuedAt: 0 };
}
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}

describe('instantRepair — fleet.instantRepair', () => {
  it('tops up the hull for credits and clears the hp pool (full again)', () => {
    const kernel = createKernel([instantRepairModule]);
    const s = stateWith({
      players: [player('p1', 100)],
      fleets: [fleet('f1', 'p1', [['cruiser', 2, 40]])], // 2×40hp = 80 full, 40 missing
    });
    const r = okApply(kernel.applyAction(s, act('f1'), ctx));
    expect(r.state.fleets.f1?.units[0]?.hp).toBeUndefined();
    expect(r.state.players.p1?.resources.credits).toBe(60); // paid 40 credits
    expect(r.events.map((e) => e.type)).toContain('fleet.instantRepaired');
  });

  it('rejects nothing-to-repair, insufficient funds, a foreign fleet, and mid-battle', () => {
    const kernel = createKernel([instantRepairModule]);
    const full = stateWith({ players: [player('p1', 100)], fleets: [fleet('f1', 'p1', [['cruiser', 2]])] });
    expect(errCode(kernel.applyAction(full, act('f1'), ctx))).toBe('E_NOTHING_TO_REPAIR');

    const poor = stateWith({
      players: [player('p1', 5)],
      fleets: [fleet('f1', 'p1', [['cruiser', 2, 40]])],
    });
    expect(errCode(kernel.applyAction(poor, act('f1'), ctx))).toBe('E_NO_FUNDS');

    const foreign = stateWith({
      players: [player('p1', 100), player('p2', 100)],
      fleets: [fleet('f2', 'p2', [['cruiser', 2, 40]])],
    });
    expect(errCode(kernel.applyAction(foreign, act('f2', 'p1'), ctx))).toBe('E_NO_FLEET');

    const busy = stateWith({
      players: [player('p1', 100)],
      fleets: [{ ...fleet('f1', 'p1', [['cruiser', 2, 40]]), battleId: 'b1' }],
    });
    expect(errCode(kernel.applyAction(busy, act('f1'), ctx))).toBe('E_IN_BATTLE');
  });

  it('rejects a bad payload and a poisoned __proto__ fleet id', () => {
    const kernel = createKernel([instantRepairModule]);
    const s = stateWith({ players: [player('p1', 100)] });
    expect(errCode(kernel.applyAction(s, { ...act('f1'), payload: {} }, ctx))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(s, act('__proto__'), ctx))).toBe('E_NO_FLEET');
  });
});
