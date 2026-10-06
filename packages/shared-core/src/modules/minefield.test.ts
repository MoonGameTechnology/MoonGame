/**
 * МИННЫЙ ЗАГРАДИТЕЛЬ (SM-3.4) И МИНА — НЕПОДВИЖНЫЙ ОТРЯД (SM-3.6).
 *
 * Поставить мину может свой стоящий флот с заградителем; через 15 минут она встаёт
 * отрядом (`fleets`) с юнитом `mine`, в стеке — заряды. Враждебный флот, сошедшийся с ней
 * вплотную (узел, дорога, приказ «Атака»), теряет долю текущего корпуса каждого
 * космического стека и летит дальше; мина тратит заряд. Чужую мину видно только вблизи.
 * Без мин всё идёт бит-в-бит как прежде.
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
import { isVisibleTo, visibleState } from '../state/visibility';
import type { Action, ApplyResult, Context, DomainEvent } from '../action/types';
import { movementModule } from './movement';
import { interceptModule } from './intercept';
import { isMineFleet, MINE_SIGNATURE } from '../state/minefields';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    ship: { faction: 'x', stats: { attack: 5, defense: 5, speed: 5, hp: 10, shield: 4 } },
    trooper: { faction: 'x', domain: 'ground', stats: { attack: 2, defense: 2, speed: 0, hp: 5 } },
    mine: {
      faction: 'neutral',
      stats: { attack: 0, defense: 0, speed: 0, hp: 20 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine'],
    },
    // Ракетная мина (SM-3.7a) — тоже мина-отряд, но заряды контактной в неё не вливаются.
    rocket_mine: {
      faction: 'neutral',
      stats: { attack: 0, defense: 0, speed: 0, hp: 20 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine', 'rocketMine'],
    },
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
    armor: { name: 'Armor', slot: 'defense', tag: 'vertical', effects: { stats: { hp: 5 } } },
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
  const node = (id: string, x: number) => ({
    id,
    owner: null,
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { N: node('N', 0), M: node('M', 100) },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    battles: {},
    diplomacy: { 'p1|p2': 'war' },
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
const kernel = createKernel([movementModule, interceptModule, minefieldModule, emitter]);
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
const mineOf = (s: GameState, owner = 'p1'): Fleet | undefined =>
  Object.values(s.fleets).find((f) => f.owner === owner && isMineFleet(f, data));
const charges = (f: Fleet | undefined): number => (f?.units ?? []).reduce((n, st) => n + st.count, 0);
function advance(s: GameState, now: number) {
  const r = kernel.advanceTo(s, ctx(now));
  if (!r.ok) throw new Error(r.code);
  expect(r.failures).toEqual([]);
  return r.state;
}

describe('SM-3.6 — мина на дороге: отряд, встреча вплотную, флот летит дальше', () => {
  function road() {
    const layer = fleet('L', 'p1', null, 1, ['mine_layer']);
    layer.edge = { from: 'N', to: 'M', t: 0.5 };
    const s = world([layer, fleet('E', 'p2', 'N')]);
    s.planets.N!.links = ['M']; s.planets.M!.links = ['N'];
    return s;
  }
  function move(s: GameState, fleetId: string, to: string) {
    return ok(kernel.applyAction(s, { id: 'move', playerId: s.fleets[fleetId]!.owner,
      type: 'fleet.move', payload: { fleetId, to }, issuedAt: s.time }, ctx(s.time))).state;
  }
  it('встаёт через 15 минут отрядом в точке дороги и подрывает встречного один раз', () => {
    const laying = ok(kernel.applyAction(deepFreeze(road()), lay('L'), ctx(0))).state;
    expect(mineOf(advance(laying, HOUR / 4 - 1))).toBeUndefined();
    const armed = advance(laying, HOUR / 4);
    const mine = mineOf(armed)!;
    expect(mine).toMatchObject({ location: null, edge: { from: 'N', to: 'M', t: 0.5 }, movement: null });
    expect(mine.units).toEqual([{ unit: 'mine', count: 3, modules: ['mine_layer'] }]);
    const moving = move(armed, 'E', 'M');
    const meet = moving.scheduled.find((e) => e.type === 'fleet.intercept')!;
    expect(meet).toBeDefined();
    expect(advance(moving, meet.at - 1).fleets.E!.units[0]!.hp).toBeUndefined();
    const hit = advance(moving, meet.at);
    expect(hit.fleets.E!.units[0]!.hp).toBe(80);
    expect(charges(mineOf(hit))).toBe(2);
    expect(hit.fleets.E!.movement).not.toBeNull(); // летит дальше: ловушка, а не стена
    const arrived = advance(hit, moving.fleets.E!.movement!.arrivesAt);
    expect(arrived.fleets.E!.location).toBe('M');
    expect(arrived.fleets.E!.units[0]!.hp).toBe(80);
    expect(advance(JSON.parse(JSON.stringify(moving)), meet.at)).toEqual(hit);
  });
  it('заряды не вливаются в свою ракетную мину той же точки: она остаётся собой (Codex на #1499)', () => {
    const s = road();
    const rocket = { unit: 'rocket_mine', count: 1 };
    s.fleets.R = { ...fleet('R', 'p1', null), edge: { from: 'N', to: 'M', t: 0.5 }, units: [rocket] };
    const armed = advance(ok(kernel.applyAction(deepFreeze(s), lay('L'), ctx(0))).state, HOUR / 4);
    expect(armed.fleets.R!.units).toEqual([rocket]);
    const contact = Object.values(armed.fleets).filter((f) => f.id !== 'R' && isMineFleet(f, data));
    expect(contact).toHaveLength(1);
    expect(contact[0]).toMatchObject({
      owner: 'p1',
      edge: { from: 'N', to: 'M', t: 0.5 },
      units: [{ unit: 'mine', count: 3, modules: ['mine_layer'] }],
    });
  });
  it('флот, вставший на мину, подрывается один раз и не повторно при отъезде', () => {
    const armed = advance(ok(kernel.applyAction(road(), lay('L'), ctx(0))).state, HOUR / 4);
    const parking = ok(kernel.applyAction(armed, { id: 'park', playerId: 'p2', type: 'fleet.move',
      payload: { fleetId: 'E', toEdge: { from: 'N', to: 'M', t: 0.5 } }, issuedAt: armed.time }, ctx(armed.time))).state;
    const parked = advance(parking, parking.fleets.E!.movement!.arrivesAt);
    expect(parked.fleets.E!.movement).toBeNull();
    expect(parked.fleets.E!.units[0]!.hp).toBe(80);
    expect(charges(mineOf(parked))).toBe(2);
    const leaving = move(parked, 'E', 'M');
    const gone = advance(leaving, leaving.fleets.E!.movement!.arrivesAt);
    expect(gone.fleets.E!.units[0]!.hp).toBe(80);
    expect(charges(mineOf(gone))).toBe(2);
  });
  it('движение носителя отменяет установку; сменивший курс флот мину не цепляет', () => {
    const laying = ok(kernel.applyAction(road(), lay('L'), ctx(0))).state;
    expect(mineOf(advance(move(laying, 'L', 'M'), HOUR / 4))).toBeUndefined();
    const armed = advance(laying, HOUR / 4);
    const moving = move(armed, 'E', 'M');
    const at = moving.scheduled.find((e) => e.type === 'fleet.intercept')!.at;
    const stopped = ok(kernel.applyAction(moving, { id: 'stop', type: 'fleet.stop', playerId: 'p2',
      payload: { fleetId: 'E' }, issuedAt: moving.time }, ctx(moving.time))).state;
    expect(advance(stopped, at).fleets.E!.units[0]!.hp).toBeUndefined();
  });
  it('заградитель нужен до конца установки; перезарядку не обойти другим носителем', () => {
    const laying = ok(kernel.applyAction(road(), lay('L'), ctx(0))).state;
    laying.fleets.other = { ...structuredClone(laying.fleets.L!), id: 'other' };
    expect(kernel.applyAction(laying, lay('other'), ctx(0))).toMatchObject({ code: 'E_MINES_COOLDOWN' });
    laying.fleets.L!.units[0]!.modules = [];
    expect(mineOf(advance(laying, HOUR / 4))).toBeUndefined();
  });
  it('чужой не видит ни установки, ни мины издалека; вблизи видит мину отрядом', () => {
    const laying = ok(kernel.applyAction(road(), lay('L'), ctx(0))).state;
    expect(visibleState(laying, 'p2', data).minefields).toBeUndefined();
    const armed = advance(laying, HOUR / 4);
    const mineId = mineOf(armed)!.id;
    expect(visibleState(armed, 'p2', data).fleets[mineId]).toBeUndefined();
    expect(isVisibleTo(armed, 'p2', { fleetId: mineId }, data)).toBe(false);
    expect(visibleState(armed, 'p1', data).fleets[mineId]).toBeDefined();
    armed.fleets.E!.location = null;
    armed.fleets.E!.edge = { from: 'N', to: 'M', t: 0.4 }; // 10 от мины
    expect(visibleState(armed, 'p2', data).fleets[mineId]?.units).toEqual(mineOf(armed)!.units);
    expect(isVisibleTo(armed, 'p2', { fleetId: mineId }, data)).toBe(true);
    expect(MINE_SIGNATURE).toBeLessThan(data.units.ship!.signature);
  });
});

const enter = (fleetId: string, at: string, type = 'fleet.arrived'): Action => ({
  id: `e:${fleetId}:${at}`,
  type: 'emit',
  playerId: 'p1',
  payload: { events: [{ type, payload: { fleetId, at } }] },
  issuedAt: 0,
});

/** Мир, где флот L игрока p1 уже поставил мину на N. */
function mined(extra: Fleet[] = [], modules = ['mine_layer']): GameState {
  const laid = ok(kernel.applyAction(world([fleet('L', 'p1', 'N', 1, modules), ...extra]), lay('L'), ctx(0))).state;
  return advance(laid, HOUR / 4);
}

describe('SM-3.4 / SM-3.6 — мина на узле', () => {
  it('поставить: отряд владельца на узле, заряды и боевая часть из модуля', () => {
    const r = ok(kernel.applyAction(deepFreeze(world([fleet('L', 'p1', 'N', 1, ['mine_layer'])])), lay('L'), ctx(0)));
    expect(r.state.minefields?.installations?.L).toMatchObject({
      location: 'N',
      stack: { unit: 'mine', count: 3, modules: ['mine_layer'] },
    });
    expect(mineOf(mined())).toMatchObject({ location: 'N', units: [{ unit: 'mine', count: 3 }] });
    expect(r.state.minefields?.readyAt['L']).toBe(MINE_COOLDOWN_HOURS * HOUR);
    expect(r.events.map((e) => e.type)).toContain('mines.installing');
  });

  it('мине передаётся только боевая часть: прочие модули носителя остаются на нём', () => {
    const s = mined([], ['mine_layer', 'armor']);
    expect(mineOf(s)!.units[0]!.modules).toEqual(['mine_layer']);
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

  it('перезарядка: раньше срока — отказ, после срока заряды копятся в той же мине до потолка', () => {
    const s = mined([], ['mine_layer_heavy']);
    const early = kernel.applyAction(s, lay('L'), ctx(HOUR));
    expect(early.ok ? 'ok' : early.code).toBe('E_MINES_COOLDOWN');
    const later = ok(kernel.applyAction(s, lay('L'), ctx(MINE_COOLDOWN_HOURS * HOUR))).state;
    const ready = advance(later, (MINE_COOLDOWN_HOURS + 0.25) * HOUR);
    const mines = Object.values(ready.fleets).filter((f) => isMineFleet(f, data));
    expect(mines).toHaveLength(1);
    expect(charges(mines[0])).toBe(MINEFIELD_MAX_CHARGE);
  });

  it('враг на входе теряет долю корпуса кораблей, мина тратит заряд; десант в трюме цел', () => {
    const e = fleet('E', 'p2', 'M');
    e.landing = [{ unit: 'trooper', count: 4 }];
    const s = mined([e]);
    const r = ok(kernel.applyAction(s, enter('E', 'N'), ctx(HOUR / 4)));
    const stack = r.state.fleets['E']!.units[0]!;
    expect(stack.hp).toBeCloseTo(80); // 0.8 × пул 100
    expect(stack.count).toBe(8);
    expect(r.state.fleets['E']!.landing).toEqual([{ unit: 'trooper', count: 4 }]);
    expect(charges(mineOf(r.state))).toBe(2);
    expect(r.events.find((e) => e.type === 'unit.died')?.payload).toMatchObject({
      unit: 'ship', count: 2, owner: 'p2', killedBy: 'p1', at: 'N',
    });
    expect(r.events.find((e) => e.type === 'mines.triggered')?.payload).toMatchObject({
      owner: 'p2', by: ['p1'], lost: 2,
    });
  });

  it('транзит через узел мину не проскакивает', () => {
    const r = ok(kernel.applyAction(mined([fleet('E', 'p2', 'M')]), enter('E', 'N', 'fleet.transit'), ctx(HOUR / 4)));
    expect(r.state.fleets['E']!.units[0]!.hp).toBeCloseTo(80);
  });

  it('щит мины не держит, но щитовой пул не превышает выживших', () => {
    const e = fleet('E', 'p2', 'M');
    e.units[0]!.shieldHp = 40;
    const r = ok(kernel.applyAction(mined([e]), enter('E', 'N'), ctx(HOUR / 4)));
    expect(r.state.fleets['E']!.units[0]!.shieldHp).toBe(32); // 8 кораблей × 4
  });

  it('свой флот мина не трогает', () => {
    const r = ok(kernel.applyAction(mined([fleet('F', 'p1', 'M')]), enter('F', 'N'), ctx(HOUR / 4)));
    expect(r.state.fleets['F']!.units[0]!.hp).toBeUndefined();
    expect(charges(mineOf(r.state))).toBe(3);
  });

  it('заряды кончились — отряд мины снимается, следующий вход бесплатен', () => {
    let s = mined([fleet('E', 'p2', 'M')]);
    const id = mineOf(s)!.id;
    const removed: DomainEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const r = ok(kernel.applyAction(s, { ...enter('E', 'N'), id: `e${i}` }, ctx(HOUR / 4)));
      removed.push(...r.events.filter((e) => e.type === 'fleet.destroyed'));
      s = r.state;
    }
    expect(mineOf(s)).toBeUndefined();
    // Израсходованная мина — не потеря: пометка `spent` не даёт журналу объявить её гибель.
    expect(removed.map((e) => e.payload)).toEqual([{ fleetId: id, owner: 'p1', spent: true }]);
    const before = s.fleets['E']!.units[0]!.hp;
    s = ok(kernel.applyAction(s, { ...enter('E', 'N'), id: 'e-last' }, ctx(HOUR / 4))).state;
    expect(s.fleets['E']!.units[0]!.hp).toBe(before);
  });

  it('одно срабатывание не добивает флот: доля ниже единицы', () => {
    const s = mined([fleet('E', 'p2', 'M', 1)], ['mine_layer_heavy']);
    const r = ok(kernel.applyAction(s, enter('E', 'N'), ctx(HOUR / 4)));
    expect(r.state.fleets['E']!.units[0]!.count).toBe(1);
    expect(MINE_HIT_MAX).toBeLessThan(1);
  });

  it('мина видна владельцу и приблизившемуся флоту, издалека — нет', () => {
    const s = mined([fleet('E', 'p2', 'N')]);
    const id = mineOf(s)!.id;
    expect(visibleState(s, 'p1', data).fleets[id]).toBeDefined();
    expect(visibleState(s, 'p2', data).fleets[id]).toBeDefined();
    s.fleets.E!.location = 'M';
    expect(visibleState(s, 'p2', data).fleets[id]).toBeUndefined();
  });

  it('без мин вход на узел ничего не меняет', () => {
    const s = world([fleet('E', 'p2', 'M')]);
    const r = ok(kernel.applyAction(s, enter('E', 'N'), ctx(HOUR / 4)));
    expect(r.state.fleets['E']).toEqual(s.fleets['E']);
    expect(r.state.minefields).toBeUndefined();
  });
});
