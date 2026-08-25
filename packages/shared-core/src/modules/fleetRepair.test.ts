import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { fleetRepairModule } from './fleetRepair';
import {
  createInitialState,
  type BuildingInstance,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// fleetRepair — "экспресс-ремонт за металл": мгновенный топ-ап корпуса, только у
// СВОЕГО дока (здание с shipRepair > 0). Был портом прототипного econScrewsModule
// (REFP-18); с CONV-2 копии прототипа нет, и это единственные тесты механики —
// сюда же перенесён случай «разбитая верфь доком не считается». Ни один тест не
// завязан на ИИ/бота.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 40 } },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', hp: 25, shipRepair: 1 },
    warehouse: { name: 'Warehouse', hp: 25 }, // no shipRepair — not a dock
  },
  events: {},
});
const ctx: Context = { now: 0, data };

function player(id: string, metal = 0): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal } };
}
function planet(id: string, owner: string | null, buildings: BuildingInstance[] = []): Planet {
  return { id, owner, position: { x: 0, y: 0 }, resources: {}, buildings, garrison: [], traits: [] };
}
function fleet(
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number, number?]> = [],
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count, hp]) => ({ unit, count, ...(hp !== undefined ? { hp } : {}) })),
    traits: [],
  };
}
function stateWith(opts: { players?: Player[]; planets?: Planet[]; fleets?: Fleet[] }): GameState {
  const s = createInitialState({ seed: 'fr', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  return { ...s, players, planets, fleets };
}
function act(fleetId: string, playerId = 'p1'): Action {
  return { id: `a:${playerId}:1`, type: 'fleet.repair', playerId, payload: { fleetId }, issuedAt: 0 };
}
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}

describe('fleetRepair — fleet.repair', () => {
  it('tops up the hull for metal at an owned dock', () => {
    const kernel = createKernel([fleetRepairModule]);
    const s = stateWith({
      players: [player('p1', 100)],
      planets: [planet('A', 'p1', [{ type: 'spaceport', level: 1, hp: 25 }])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 40]])], // 40 missing hp
    });
    const r = okApply(kernel.applyAction(s, act('f1'), ctx));
    expect(r.state.fleets.f1?.units[0]?.hp).toBeUndefined();
    expect(r.state.players.p1?.resources.metal).toBe(80); // paid 20 metal (40hp / 2)
    expect(r.events.map((e) => e.type)).toContain('fleet.repaired');
  });

  it('rejects a fleet not at an owned dock (foreign world, in transit, no repair building)', () => {
    const kernel = createKernel([fleetRepairModule]);
    const foreignWorld = stateWith({
      players: [player('p1', 100)],
      planets: [planet('A', 'p2', [{ type: 'spaceport', level: 1, hp: 25 }])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 40]])],
    });
    expect(errCode(kernel.applyAction(foreignWorld, act('f1'), ctx))).toBe('E_NO_DOCK');

    const noBuilding = stateWith({
      players: [player('p1', 100)],
      planets: [planet('A', 'p1', [{ type: 'warehouse', level: 1, hp: 25 }])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 40]])],
    });
    expect(errCode(kernel.applyAction(noBuilding, act('f1'), ctx))).toBe('E_NO_DOCK');

    const inTransit = stateWith({
      players: [player('p1', 100)],
      planets: [planet('A', 'p1', [{ type: 'spaceport', level: 1, hp: 25 }])],
      fleets: [
        {
          ...fleet('f1', 'p1', null, [['cruiser', 2, 40]]),
          movement: { to: 'B', from: 'A', departedAt: 0, arrivesAt: 100 },
        },
      ],
    });
    expect(errCode(kernel.applyAction(inTransit, act('f1'), ctx))).toBe('E_NO_DOCK');

    // Разбитая верфь доком не считается: здание стоит в списке, но `hp <= 0` —
    // чинить у руин нельзя, иначе бомбардировка дока ничего бы не давала (CONV-2).
    const ruinedDock = stateWith({
      players: [player('p1', 100)],
      planets: [planet('A', 'p1', [{ type: 'spaceport', level: 1, hp: 0 }])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 40]])],
    });
    expect(errCode(kernel.applyAction(ruinedDock, act('f1'), ctx))).toBe('E_NO_DOCK');
  });

  it('rejects nothing-to-repair and insufficient funds', () => {
    const kernel = createKernel([fleetRepairModule]);
    const dock = [planet('A', 'p1', [{ type: 'spaceport', level: 1, hp: 25 }])];
    const full = stateWith({
      players: [player('p1', 100)],
      planets: dock,
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2]])],
    });
    expect(errCode(kernel.applyAction(full, act('f1'), ctx))).toBe('E_NOTHING_TO_REPAIR');

    const poor = stateWith({
      players: [player('p1', 1)],
      planets: dock,
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 40]])],
    });
    expect(errCode(kernel.applyAction(poor, act('f1'), ctx))).toBe('E_NO_FUNDS');
  });

  it('rejects a bad payload and a poisoned __proto__ fleet id', () => {
    const kernel = createKernel([fleetRepairModule]);
    const s = stateWith({ players: [player('p1', 100)] });
    expect(errCode(kernel.applyAction(s, { ...act('f1'), payload: {} }, ctx))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(s, act('__proto__'), ctx))).toBe('E_NO_FLEET');
  });
});
