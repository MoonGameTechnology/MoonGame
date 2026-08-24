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
    militia: { faction: 'x', domain: 'ground', stats: { attack: 2, defense: 2, speed: 2, hp: 10 } },
  },
  factions: {},
  buildings: {},
  events: {},
  modules: {
    plating: {
      name: 'P',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { hp: 12 } },
      cost: { metal: 50 },
    },
  },
});
const ctx: Context = { now: 0, data };

function player(id: string, credits = 0): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { credits } };
}
function fleet(
  id: string,
  owner: string,
  units: Array<[string, number, number?]> = [],
  over: Partial<Fleet> = {},
): Fleet {
  return {
    id,
    owner,
    location: 'A',
    movement: null,
    units: units.map(([unit, count, hp]) => ({ unit, count, ...(hp !== undefined ? { hp } : {}) })),
    traits: [],
    ...over,
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

  // Десант едет в трюме и чинится тем же действием: иначе игрок платил бы дважды
  // за один флот и не понимал, почему пехота осталась битой.
  it('repairs the carried landing force too, in one payment', () => {
    const kernel = createKernel([instantRepairModule]);
    const s = stateWith({
      players: [player('p1', 100)],
      // 2×40 корпуса при 70 → не хватает 10; 2×10 десанта при 5 → не хватает 15.
      fleets: [
        fleet('f1', 'p1', [['cruiser', 2, 70]], { landing: [{ unit: 'militia', count: 2, hp: 5 }] }),
      ],
    });
    const r = okApply(kernel.applyAction(s, act('f1'), ctx));
    expect(r.state.fleets.f1?.units[0]?.hp).toBeUndefined();
    expect(r.state.fleets.f1?.landing?.[0]?.hp).toBeUndefined();
    expect(r.state.players.p1?.resources.credits).toBe(75); // 10 + 15 кредитов
  });

  // Щит регенерирует сам и бесплатно — платный ремонт его не касается, иначе
  // игрок покупал бы то, что и так вернётся через минуту.
  it('leaves the shield pool alone — hull only', () => {
    const kernel = createKernel([instantRepairModule]);
    const s = stateWith({
      players: [player('p1', 100)],
      fleets: [{ ...fleet('f1', 'p1'), units: [{ unit: 'cruiser', count: 1, hp: 30, shieldHp: 3 }] }],
    });
    const r = okApply(kernel.applyAction(s, act('f1'), ctx));
    expect(r.state.fleets.f1?.units[0]?.hp).toBeUndefined();
    expect(r.state.fleets.f1?.units[0]?.shieldHp).toBe(3);
  });

  // Цена считается по ЭФФЕКТИВНОМУ корпусу: +hp фитинг поднимает и полный пул, и
  // счёт. По базовым `def.stats` ремонт бронированного флота стоил бы дешевле, чем
  // он на самом деле восстанавливает.
  it('prices the repair by fitted hull, not base stats', () => {
    const kernel = createKernel([instantRepairModule]);
    const per = 40 + 12; // cruiser 40hp + plating +12
    const s = stateWith({
      players: [player('p1', 500)],
      fleets: [
        {
          ...fleet('f1', 'p1'),
          units: [{ unit: 'cruiser', count: 2, hp: 100, modules: ['plating'] }],
        },
      ],
    });
    const r = okApply(kernel.applyAction(s, act('f1'), ctx));
    expect(r.state.players.p1?.resources.credits).toBe(500 - (per * 2 - 100));
  });

  it('rejects a bad payload and a poisoned __proto__ fleet id', () => {
    const kernel = createKernel([instantRepairModule]);
    const s = stateWith({ players: [player('p1', 100)] });
    expect(errCode(kernel.applyAction(s, { ...act('f1'), payload: {} }, ctx))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(s, act('__proto__'), ctx))).toBe('E_NO_FLEET');
  });
});
