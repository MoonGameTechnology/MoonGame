/**
 * МИННЫЙ ЗАГРАДИТЕЛЬ (SM-3.4, `ship-modules-roadmap.md` фаза 3).
 *
 * Поставить поле может свой стоящий флот с заградителем. Враждебный флот на входе
 * (конечная точка или транзит) теряет долю текущего корпуса каждого стека, поле тратит
 * заряд. Поле видит только владелец. Без мин всё идёт бит-в-бит как прежде.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import {
  minefieldModule,
  MINE_COOLDOWN_HOURS,
  MINEFIELD_MAX_CHARGE,
  MINE_HIT_MAX,
} from './minefield';
import { createInitialState, type Fleet, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';
import { visibleState } from '../state/visibility';
import type { Action, ApplyResult, Context, DomainEvent } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    ship: { faction: 'x', stats: { attack: 5, defense: 5, speed: 5, hp: 10, shield: 4 } },
  },
  modules: {
    mine_layer: {
      name: 'Mine Layer',
      slot: 'weapon',
      tag: 'vertical',
      effects: { stats: { mineCharge: 3, mineHit: 0.2 } },
    },
    mine_layer_heavy: {
      name: 'Heavy Mine Layer',
      slot: 'weapon',
      tag: 'vertical',
      effects: { stats: { mineCharge: 5, mineHit: 0.4 } },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function fleet(
  id: string,
  owner: string,
  location: string | null,
  count = 10,
  modules?: string[],
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    traits: [],
    units: [{ unit: 'ship', count, ...(modules ? { modules } : {}) }],
    battleId: null,
  };
}
function world(fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'sm34', version: { data: '0.1.0', manifest: '1' } });
  const node = (id: string) => ({
    id,
    owner: null,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { N: node('N'), M: node('M') },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    battles: {},
  };
}

/** Фикстура: выложить события в один шаг, как их выдал бы `movement`. */
const emitter: GameModule = {
  id: 'test-emitter',
  version: '1.0.0',
  setup(api) {
    api.onAction('emit', (a, h) => {
      for (const e of (a.payload as { events: DomainEvent[] }).events) h.emit(e.type, e.payload);
    });
  },
};
const kernel = createKernel([minefieldModule, emitter]);
const ok = (r: ApplyResult): ApplyResult & { ok: true } => {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
};
const lay = (fleetId: string, playerId = 'p1'): Action => ({
  id: `lay:${playerId}:${fleetId}`,
  type: 'fleet.layMines',
  playerId,
  payload: { fleetId },
  issuedAt: 0,
});
const enter = (fleetId: string, at: string, type = 'fleet.arrived'): Action => ({
  id: `e:${fleetId}:${at}`,
  type: 'emit',
  playerId: 'p1',
  payload: { events: [{ type, payload: { fleetId, at } }] },
  issuedAt: 0,
});

/** Мир, где флот L игрока p1 уже поставил поле на N. */
function mined(extra: Fleet[] = [], modules = ['mine_layer']): GameState {
  return ok(
    kernel.applyAction(world([fleet('L', 'p1', 'N', 1, modules), ...extra]), lay('L'), ctx(0)),
  ).state;
}

describe('SM-3.4 — минный заградитель', () => {
  it('поставить: поле владельца на узле флота, заряд и доля из модуля', () => {
    const r = ok(
      kernel.applyAction(
        deepFreeze(world([fleet('L', 'p1', 'N', 1, ['mine_layer'])])),
        lay('L'),
        ctx(0),
      ),
    );
    expect(r.state.minefields?.fields['N']?.['p1']).toEqual({ charge: 3, hit: 0.2 });
    expect(r.state.minefields?.readyAt['L']).toBe(MINE_COOLDOWN_HOURS * HOUR);
    expect(r.events.map((e) => e.type)).toContain('mines.laid');
  });

  it('без заградителя — отказ', () => {
    const r = kernel.applyAction(world([fleet('L', 'p1', 'N')]), lay('L'), ctx(0));
    expect(r.ok ? 'ok' : r.code).toBe('E_NO_MINELAYER');
  });

  it('чужой и несуществующий флот — один и тот же отказ', () => {
    const s = world([fleet('L', 'p2', 'N', 1, ['mine_layer'])]);
    const a = kernel.applyAction(s, lay('L'), ctx(0));
    const b = kernel.applyAction(s, lay('X'), ctx(0));
    expect(a.ok ? 'ok' : a.code).toBe('E_NO_FLEET');
    expect(b.ok ? 'ok' : b.code).toBe('E_NO_FLEET');
  });

  it('в пути и в бою мины не ставятся', () => {
    const moving = fleet('L', 'p1', null, 1, ['mine_layer']);
    const fighting = { ...fleet('L', 'p1', 'N', 1, ['mine_layer']), battleId: 'b1' };
    for (const f of [moving, fighting]) {
      const r = kernel.applyAction(world([f]), lay('L'), ctx(0));
      expect(r.ok ? 'ok' : r.code).toBe('E_FLEET_BUSY');
    }
  });

  it('перезарядка: вторая постановка раньше срока — отказ, после срока — заряд копится до потолка', () => {
    const s = mined([], ['mine_layer_heavy']);
    const early = kernel.applyAction(s, lay('L'), ctx(HOUR));
    expect(early.ok ? 'ok' : early.code).toBe('E_MINES_COOLDOWN');
    const later = ok(kernel.applyAction(s, lay('L'), ctx(MINE_COOLDOWN_HOURS * HOUR))).state;
    expect(later.minefields?.fields['N']?.['p1']?.charge).toBe(MINEFIELD_MAX_CHARGE);
  });

  it('враг на входе теряет долю корпуса, поле тратит заряд', () => {
    const s = mined([fleet('E', 'p2', 'M')]);
    const r = ok(kernel.applyAction(s, enter('E', 'N'), ctx(0)));
    const stack = r.state.fleets['E']!.units[0]!;
    expect(stack.hp).toBeCloseTo(80); // 0.8 × пул 100
    expect(stack.count).toBe(8);
    expect(r.state.minefields?.fields['N']?.['p1']?.charge).toBe(2);
    const died = r.events.find((e) => e.type === 'unit.died');
    expect(died?.payload).toMatchObject({
      unit: 'ship',
      count: 2,
      owner: 'p2',
      killedBy: 'p1',
      at: 'N',
    });
    expect(r.events.find((e) => e.type === 'mines.triggered')?.payload).toMatchObject({
      owner: 'p2',
      by: ['p1'],
      lost: 2,
    });
  });

  it('транзит через узел поле не проскакивает', () => {
    const r = ok(
      kernel.applyAction(mined([fleet('E', 'p2', 'M')]), enter('E', 'N', 'fleet.transit'), ctx(0)),
    );
    expect(r.state.fleets['E']!.units[0]!.hp).toBeCloseTo(80);
  });

  it('щит мины не держит, но щитовой пул не превышает выживших', () => {
    const e = fleet('E', 'p2', 'M');
    e.units[0]!.shieldHp = 40;
    const r = ok(kernel.applyAction(mined([e]), enter('E', 'N'), ctx(0)));
    expect(r.state.fleets['E']!.units[0]!.shieldHp).toBe(32); // 8 кораблей × 4
  });

  it('свой флот поле не трогает', () => {
    const r = ok(kernel.applyAction(mined([fleet('F', 'p1', 'M')]), enter('F', 'N'), ctx(0)));
    expect(r.state.fleets['F']!.units[0]!.hp).toBeUndefined();
    expect(r.state.minefields?.fields['N']?.['p1']?.charge).toBe(3);
  });

  it('заряд кончается — поле снимается, следующий вход бесплатен', () => {
    let s = mined([fleet('E', 'p2', 'M')]);
    for (let i = 0; i < 3; i++)
      s = ok(kernel.applyAction(s, { ...enter('E', 'N'), id: `e${i}` }, ctx(0))).state;
    expect(s.minefields?.fields['N']).toBeUndefined();
    const before = s.fleets['E']!.units[0]!.hp;
    s = ok(kernel.applyAction(s, { ...enter('E', 'N'), id: 'e-last' }, ctx(0))).state;
    expect(s.fleets['E']!.units[0]!.hp).toBe(before);
  });

  it('одно срабатывание не добивает флот: доля ниже единицы', () => {
    const s = mined([fleet('E', 'p2', 'M', 1)], ['mine_layer_heavy']);
    const r = ok(kernel.applyAction(s, enter('E', 'N'), ctx(0)));
    expect(r.state.fleets['E']!.units[0]!.count).toBe(1);
    expect(MINE_HIT_MAX).toBeLessThan(1);
  });

  it('поле видит только владелец', () => {
    const s = mined([fleet('E', 'p2', 'N')]);
    expect(visibleState(s, 'p1', data).minefields?.fields['N']?.['p1']).toBeDefined();
    expect(visibleState(s, 'p2', data).minefields).toBeUndefined();
  });

  it('без мин вход на узел ничего не меняет', () => {
    const s = world([fleet('E', 'p2', 'M')]);
    const r = ok(kernel.applyAction(s, enter('E', 'N'), ctx(0)));
    expect(r.state.fleets['E']).toEqual(s.fleets['E']);
    expect(r.state.minefields).toBeUndefined();
  });
});
