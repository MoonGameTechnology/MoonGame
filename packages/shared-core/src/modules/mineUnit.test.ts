/**
 * МИНА — НЕПОДВИЖНЫЙ ОТРЯД СРЕДИ ДРУГИХ ПРАВИЛ (SM-3.6, решение владельца 2026-09-30).
 *
 * `minefield.test.ts` держит сам подрыв. Здесь — как мина живёт рядом с боем, захватом,
 * приказами флота и челноками:
 *
 * 1. встреча с миной — не бой: боя нет, флот летит дальше;
 * 2. мина захвату не мешает;
 * 3. «Атака» по мине — подрыв по атакующему; сама мина не атакует;
 * 4. челноки уничтожают мину ударом по корпусу и не теряют ни одной машины;
 * 5. мину нельзя слить, разделить и сдвинуть.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { movementModule } from './movement';
import { interceptModule } from './intercept';
import { combatModule } from './combat';
import { minefieldModule } from './minefield';
import { captureOnArrivalModule } from './captureOnArrival';
import { fleetOpsModule } from './fleetOps';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    ship: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 5, hp: 10 } },
    mine: {
      faction: 'neutral',
      domain: 'space',
      stats: { attack: 0, defense: 0, speed: 0, hp: 20 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine'],
    },
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 20, defense: 4, speed: 100, hp: 16, strikeRange: 180, fuel: 4, rearmRounds: 2 },
    },
  },
  modules: {
    mine_layer: { name: 'Mine Layer', slot: 'utility', tag: 'vertical', effects: { stats: { mineCharge: 3, mineHit: 0.2 } } },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
  },
  sectorKinds: { planet: { name: 'Planet', capturable: true } },
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

function planet(id: string, x: number, links: string[], owner: string | null = null): Planet {
  return { id, owner, position: { x, y: 0 }, links, resources: {}, buildings: [], garrison: [], traits: [] };
}
function ships(id: string, owner: string, location: string | null, count = 10): Fleet {
  return { id, owner, location, movement: null, units: [{ unit: 'ship', count }], landing: [], traits: [], battleId: null };
}
function mine(at: { location: string } | { edge: { from: string; to: string; t: number } }, count = 3): Fleet {
  return {
    id: 'MINE',
    owner: 'p1',
    location: 'location' in at ? at.location : null,
    ...('edge' in at ? { edge: at.edge } : {}),
    movement: null,
    units: [{ unit: 'mine', count, modules: ['mine_layer'] }],
    landing: [],
    traits: [],
    battleId: null,
  };
}
function world(fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'sm36', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { N: planet('N', 0, ['M']), M: planet('M', 100, ['N', 'K']), K: planet('K', 200, ['M']) },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    battles: {},
    heroes: {},
    diplomacy: { 'p1|p2': 'war' },
  };
}

const rules = createKernel([movementModule, interceptModule, combatModule, minefieldModule, captureOnArrivalModule, fleetOpsModule]);
let seq = 0;
const act = (type: string, playerId: string, payload: unknown): Action => ({ id: `a:${seq++}`, type, playerId, payload, issuedAt: 0 });
function apply(s: GameState, a: Action) {
  const r = rules.applyAction(s, a, ctx(s.time));
  if (!r.ok) throw new Error(r.code);
  return r;
}
function advance(s: GameState, now: number): { state: GameState; events: DomainEvent[] } {
  const r = rules.advanceTo(s, ctx(now));
  if (!r.ok) throw new Error(r.code);
  expect(r.failures).toEqual([]);
  return { state: r.state, events: r.events };
}

describe('встреча с миной — не бой: боя нет, флот летит дальше', () => {
  it('на дороге: подрыв в точке мины, флот доходит до цели', () => {
    const s0 = world([ships('E', 'p2', 'N'), mine({ edge: { from: 'N', to: 'M', t: 0.5 } })]);
    const moving = apply(s0, act('fleet.move', 'p2', { fleetId: 'E', to: 'M' })).state;
    const { state, events } = advance(moving, moving.fleets.E!.movement!.arrivesAt);
    expect(events.map((e) => e.type)).toContain('mines.triggered');
    expect(events.map((e) => e.type)).not.toContain('battle.started');
    expect(state.fleets.E).toMatchObject({ location: 'M', battleId: null });
    expect(state.fleets.E!.units[0]!.count).toBe(8);
  });

  it('транзитом через узел с миной: подрыв, а маршрут идёт дальше', () => {
    const s0 = world([ships('E', 'p2', 'N'), mine({ location: 'M' })]);
    const moving = apply(s0, act('fleet.move', 'p2', { fleetId: 'E', to: 'K' })).state;
    const { state, events } = advance(moving, moving.time + 200 * HOUR);
    expect(events.map((e) => e.type)).toContain('mines.triggered');
    expect(events.map((e) => e.type)).not.toContain('battle.started');
    expect(state.fleets.E!.location).toBe('K');
  });

  it('стоящая рядом с миной вражеская эскадра в бой с ней не вступает и при объявлении войны', () => {
    // Объявление войны сцепляет стоящих рядом (CMB-5) — с миной сцепки нет.
    const warNotice: GameModule = {
      id: 'war-notice',
      version: '1.0.0',
      setup(api) {
        api.onAction('test.war', (_a, h) => h.emit('diplomacy.changed', { a: 'p1', b: 'p2', stance: 'war' }));
      },
    };
    const k = createKernel([movementModule, interceptModule, combatModule, minefieldModule, warNotice]);
    const s0 = world([ships('E', 'p2', 'M'), mine({ location: 'M' })]);
    const r = k.applyAction(s0, act('test.war', 'p2', {}), ctx(0));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.battles).toEqual({});
    expect(r.events.map((e) => e.type)).not.toContain('mines.triggered');
  });
});

describe('мина захвату не мешает', () => {
  it('флот входит на ничейный мир с чужой миной — мир взят', () => {
    const s0 = world([ships('E', 'p2', 'N'), mine({ location: 'M' })]);
    const moving = apply(s0, act('fleet.move', 'p2', { fleetId: 'E', to: 'M' })).state;
    const { state } = advance(moving, moving.fleets.E!.movement!.arrivesAt);
    expect(state.planets.M!.owner).toBe('p2');
  });
});

describe('«Атака» по мине — подрыв по атакующему; мина не атакует', () => {
  it('атаковать мину на своём узле: подрыв, боя нет', () => {
    const s0 = world([ships('E', 'p2', 'M'), mine({ location: 'M' })]);
    const r = apply(s0, act('fleet.engage', 'p2', { fleetId: 'E', targetId: 'MINE' }));
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['mine.contact', 'mines.triggered']));
    expect(r.state.battles).toEqual({});
    expect(r.state.fleets.E!.units[0]!.count).toBe(8);
    expect(r.state.fleets.MINE!.units[0]!.count).toBe(2);
  });

  it('мина приказом не атакует', () => {
    const s0 = world([ships('E', 'p2', 'M'), mine({ location: 'M' })]);
    const r = rules.applyAction(s0, act('fleet.engage', 'p1', { fleetId: 'MINE', targetId: 'E' }), ctx(0));
    expect(r.ok ? 'ok' : r.code).toBe('E_MINE_PASSIVE');
  });
});

describe('мину нельзя слить, разделить и сдвинуть', () => {
  it('слияние, раскол и приказ на движение — отказы', () => {
    const s0 = world([ships('F', 'p1', 'M'), mine({ location: 'M' }, 3)]);
    const code = (a: Action): string => {
      const r = rules.applyAction(s0, a, ctx(0));
      return r.ok ? 'ok' : r.code;
    };
    expect(code(act('fleet.merge', 'p1', { from: 'F', into: 'MINE' }))).toBe('E_EMPLACEMENT');
    expect(code(act('fleet.split', 'p1', { fleetId: 'MINE', take: [{ unit: 'mine', count: 1 }] }))).toBe('E_EMPLACEMENT');
    expect(code(act('fleet.move', 'p1', { fleetId: 'MINE', to: 'N' }))).toBe('E_FLEET_IMMOBILE');
  });
});

describe('челноки уничтожают мину безопасно', () => {
  it('удар бомбардировщиков снимает мину по корпусу, ни одна машина не сбита', () => {
    const s0 = world([mine({ location: 'M' }, 3)]);
    s0.fleets.MINE!.owner = 'p2';
    s0.planets.N = { ...s0.planets.N!, owner: 'p1', buildings: [{ type: 'spaceport', level: 1, hp: 30 }],
      hangar: [{ id: 'sq:b', units: [{ unit: 'bomber', count: 3 }] }] };
    const strikeKernel: GameModule[] = [constructionModule, shuttleModule];
    const k = createKernel(strikeKernel);
    const applied = k.applyAction(s0, act('shuttle.strike', 'p1', { planetId: 'N', squadronId: 'sq:b', targetFleetId: 'MINE' }), ctx(0));
    if (!applied.ok) throw new Error(applied.code);
    const done = k.advanceTo(applied.state, ctx(3 * HOUR));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.fleets.MINE).toBeUndefined(); // 3 × 20 огня = 60 = 3 мины × 20 корпуса
    const back = (done.state.planets.N!.hangar ?? []).reduce((n, sq) => n + sq.units.reduce((m, u) => m + u.count, 0), 0);
    expect(back).toBe(3);
    expect(done.events.some((e) => e.type === 'shuttle.repelled')).toBe(false);
  });
});
