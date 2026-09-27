import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { loadoutEffectsModule } from './loadoutEffects';
import { salvageModule, SALVAGE_SHARE } from './salvage';
import { combatModule } from './combat';
import { createInitialState, type Fleet, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';
import type { Action, ApplyResult, Context, DomainEvent } from '../action/types';

/**
 * Фаза 3 `ship-modules-roadmap.md`: модули кораблей со своей механикой, вливающие стат
 * носителя в чужой хук. Правила проверяются синтетическими событиями, как в
 * `salvage.test.ts`: вход модуля — это события шины, и подать их напрямую честнее, чем
 * выводить расклад стрельбой.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    hauler: {
      faction: 'x',
      stats: { attack: 0, defense: 0, speed: 5, hp: 10 },
      cost: { metal: 1000 },
    },
    ship: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 5, hp: 10 },
      slots: { weapon: 1, defense: 1, utility: 1 },
    },
  },
  modules: {
    tractor: {
      name: 'Tractor',
      slot: 'weapon',
      tag: 'vertical',
      effects: { stats: { retreatPull: 0.15 } },
    },
    tractor_huge: {
      name: 'Huge Tractor',
      slot: 'weapon',
      tag: 'vertical',
      effects: { stats: { retreatPull: 0.9 } },
    },
    salvage_rig: {
      name: 'Salvage Rig',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { salvageBonus: 0.05 } },
    },
    salvage_rig_big: {
      name: 'Big Salvage Rig',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { salvageBonus: 0.1 } },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const ctx = (now: number): Context => ({ now, data });

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal: 0 } };
}
function fleet(id: string, owner: string, location: string | null, modules?: string[]): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    traits: [],
    units: [{ unit: 'ship', count: 1, ...(modules ? { modules } : {}) }],
  };
}
function world(fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'le', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}

const emitter: GameModule = {
  id: 'test-emitter',
  version: '1.0.0',
  setup(api) {
    api.onAction('emit', (a, h) => {
      for (const e of (a.payload as { events: DomainEvent[] }).events) h.emit(e.type, e.payload);
    });
  },
};
const emitAll = (events: DomainEvent[]): Action => ({
  id: 's:p1:1',
  type: 'emit',
  playerId: 'p1',
  payload: { events },
  issuedAt: 0,
});
const ok = (r: ApplyResult): ApplyResult & { ok: true } => {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
};
// Погиб один hauler врага на узле N — котёл 1000 металла; победил p1.
const battle: DomainEvent[] = [
  {
    type: 'unit.died',
    payload: { unit: 'hauler', count: 1, at: 'N', owner: 'p2', battleId: 'b1' },
  },
  { type: 'battle.resolved', payload: { battleId: 'b1', location: 'N', winners: ['p1'] } },
];
function metalAfter(state: GameState, withModule = true): number {
  const mods = withModule
    ? [salvageModule, loadoutEffectsModule, emitter]
    : [salvageModule, emitter];
  const out = ok(createKernel(mods).applyAction(deepFreeze(state), emitAll(battle), ctx(0))).state;
  return out.players['p1']!.resources['metal'] ?? 0;
}

describe('SM-3.2 — сборщик обломков поднимает долю трофеев', () => {
  it('без носителя доля базовая, бит-в-бит как без модуля ядра', () => {
    const s = world([fleet('f1', 'p1', 'N')]);
    expect(metalAfter(s)).toBe(Math.floor(1000 * SALVAGE_SHARE));
    expect(metalAfter(s)).toBe(metalAfter(s, false));
  });

  it('носитель на поле боя прибавляет свой стат к доле', () => {
    expect(metalAfter(world([fleet('f1', 'p1', 'N', ['salvage_rig'])]))).toBe(
      Math.floor(1000 * (SALVAGE_SHARE + 0.05)),
    );
  });

  it('действует лучший носитель, а не сумма', () => {
    const s = world([
      fleet('f1', 'p1', 'N', ['salvage_rig']),
      fleet('f2', 'p1', 'N', ['salvage_rig_big']),
      fleet('f3', 'p1', 'N', ['salvage_rig']),
    ]);
    expect(metalAfter(s)).toBe(Math.floor(1000 * (SALVAGE_SHARE + 0.1)));
  });

  it('носитель на другом узле или в пути прибавки не даёт', () => {
    const s = world([
      fleet('f1', 'p1', 'M', ['salvage_rig']),
      fleet('f2', 'p1', null, ['salvage_rig']),
    ]);
    expect(metalAfter(s)).toBe(Math.floor(1000 * SALVAGE_SHARE));
  });

  it('сборщик ЧУЖОГО игрока на поле боя победителю не помогает', () => {
    expect(metalAfter(world([fleet('f1', 'p2', 'N', ['salvage_rig'])]))).toBe(
      Math.floor(1000 * SALVAGE_SHARE),
    );
  });

  it('проигравший со сборщиком не получает ничего', () => {
    const state = world([fleet('f1', 'p2', 'N', ['salvage_rig_big'])]);
    const out = ok(
      createKernel([salvageModule, loadoutEffectsModule, emitter]).applyAction(
        state,
        emitAll(battle),
        ctx(0),
      ),
    ).state;
    expect(out.players['p2']!.resources['metal']).toBe(0);
  });
});

describe('SM-3.1 — тяговый луч: отступать от носителя дороже', () => {
  // Бой на узле N: флот A (p1, 10 кораблей по 10 корпуса — пул 100) против флота D (p2).
  function engaged(dMods?: string[], aMods?: string[], extra: Fleet[] = []): GameState {
    const a: Fleet = {
      ...fleet('A', 'p1', 'N', aMods),
      units: [{ unit: 'ship', count: 10, ...(aMods ? { modules: aMods } : {}) }],
      battleId: 'b1',
    };
    const d: Fleet = { ...fleet('D', 'p2', 'N', dMods), battleId: 'b1' };
    const s = world([a, d, ...extra]);
    s.planets = {
      N: {
        id: 'N',
        owner: null,
        position: { x: 0, y: 0 },
        resources: {},
        buildings: [],
        garrison: [],
        traits: [],
      },
    };
    s.battles = {
      b1: {
        id: 'b1',
        location: 'N',
        phase: 'orbital',
        round: 0,
        sides: [
          { ref: { kind: 'fleet', fleetId: 'A' }, owner: 'p1', role: 'attacker' },
          { ref: { kind: 'fleet', fleetId: 'D' }, owner: 'p2', role: 'defender' },
          ...extra.map((f) => ({
            ref: { kind: 'fleet' as const, fleetId: f.id },
            owner: f.owner,
            role: 'defender' as const,
          })),
        ],
      },
    };
    for (const f of extra) s.fleets[f.id]!.battleId = 'b1';
    return s;
  }
  const retreatA: Action = {
    id: 'r:p1:1',
    type: 'fleet.retreat',
    playerId: 'p1',
    payload: { fleetId: 'A' },
    issuedAt: 0,
  };
  function hullAfter(state: GameState, withModule = true): number | undefined {
    const mods = withModule ? [combatModule, loadoutEffectsModule] : [combatModule];
    const out = ok(createKernel(mods).applyAction(deepFreeze(state), retreatA, ctx(0))).state;
    return out.fleets['A']!.units[0]!.hp;
  }

  it('без луча цена 40%, бит-в-бит как без модуля ядра', () => {
    expect(hullAfter(engaged())).toBeCloseTo(60);
    expect(hullAfter(engaged(), false)).toBeCloseTo(60);
  });

  it('луч у врага прибавляет свой стат к цене', () => {
    expect(hullAfter(engaged(['tractor']))).toBeCloseTo(45); // 1 − (0.4 + 0.15)
  });

  it('цена упирается в потолок 75%, и флот не гибнет от одного отступления', () => {
    expect(hullAfter(engaged(['tractor_huge']))).toBeCloseTo(25);
  });

  it('собственный луч отступающего его не держит', () => {
    expect(hullAfter(engaged(undefined, ['tractor']))).toBeCloseTo(60);
  });

  it('луч флота того же игрока в бою не цепляет', () => {
    expect(
      hullAfter(engaged(undefined, undefined, [fleet('A2', 'p1', 'N', ['tractor_huge'])])),
    ).toBeCloseTo(60);
  });

  it('без модуля ядра луч у врага ничего не меняет', () => {
    expect(hullAfter(engaged(['tractor']), false)).toBeCloseTo(60);
  });
});
