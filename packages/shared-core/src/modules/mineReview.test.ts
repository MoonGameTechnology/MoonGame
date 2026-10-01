/**
 * МИНА — ДОВОДКА ПО РЕВЬЮ #1411 (SM-3.6).
 *
 * Шесть находок Codex на PR мины-отряда, каждая здесь закреплена тестом, красным без правки:
 *
 * 1. мина не принимает общих приказов флота: орбита, обстрел, постановка мин, ремонт,
 *    постоянные приказы, марш, груз хранилища (находка по безопасности: безоружная мина
 *    морозила производство вражеского мира и перезаряжала себя сама);
 * 2. мина не обстреливает и не делит залп ПВО — даже если она оказалась на орбите;
 * 3. пополнение мины не назначает вторую встречу на дороге;
 * 4. мины разных владельцев в одной точке дороги срабатывают одним подрывом с общим
 *    потолком — как на узле;
 * 5. невидимую мину не находят ни дежурный вылет, ни приказ удара челноков.
 *
 * Шестая находка (знак дорожной установки в прототипе) — клиентская, её держит
 * `decisions/minefields.test.ts` (`ownInstallations`).
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { interceptModule } from './intercept';
import { combatModule } from './combat';
import { minefieldModule } from './minefield';
import { fleetOpsModule } from './fleetOps';
import { orbitalModule } from './orbital';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import { standingOrdersModule } from './standingOrders';
import { fleetRepairModule } from './fleetRepair';
import { instantRepairModule } from './instantRepair';
import { forcedMarchModule } from './forcedMarch';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { bombardedPlanets } from '../state/orbit';
import { patrolScrambles } from '../state/patrol';
import { forkTAtStart } from '../state/roads';
import { visibleMinefields } from '../state/minefields';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {
    ship: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 5, hp: 10 } },
    layer: { faction: 'x', domain: 'space', stats: { attack: 1, defense: 1, speed: 5, hp: 10 } },
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
    heavy_layer: { name: 'Heavy Layer', slot: 'utility', tag: 'vertical', effects: { stats: { mineCharge: 3, mineHit: 0.4 } } },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
  },
  sectorKinds: { planet: { name: 'Planet', capturable: true, orbit: true } },
  events: {},
});

const ctx = (now: number): Context => ({ now, data });
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: { metal: 1000, credits: 1000 },
});

function planet(id: string, x: number, links: string[], owner: string | null = null): Planet {
  return { id, owner, position: { x, y: 0 }, links, resources: {}, buildings: [], garrison: [], traits: [] };
}
function ships(id: string, owner: string, location: string | null, count = 10): Fleet {
  return { id, owner, location, movement: null, units: [{ unit: 'ship', count }], landing: [], traits: [], battleId: null };
}
function mine(
  id: string,
  owner: string,
  at: { location: string } | { edge: { from: string; to: string; t: number } },
  count = 3,
  module = 'mine_layer',
): Fleet {
  return {
    id,
    owner,
    location: 'location' in at ? at.location : null,
    ...('edge' in at ? { edge: at.edge } : {}),
    movement: null,
    units: [{ unit: 'mine', count, modules: [module] }],
    landing: [],
    traits: [],
    battleId: null,
  };
}
function world(fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'mine-review', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: { N: planet('N', 0, ['M']), M: planet('M', 100, ['N', 'K'], 'p2'), K: planet('K', 200, ['M']) },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    battles: {},
    heroes: {},
    diplomacy: { 'p1|p2': 'war', 'p2|p3': 'war' },
  };
}

const rules = createKernel([
  movementModule,
  interceptModule,
  combatModule,
  minefieldModule,
  fleetOpsModule,
  orbitalModule,
  standingOrdersModule,
  fleetRepairModule,
  instantRepairModule,
  forcedMarchModule,
]);
let seq = 0;
const act = (type: string, playerId: string, payload: unknown): Action => ({
  id: `a:${seq++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const code = (s: GameState, a: Action): string => {
  const r = rules.applyAction(s, a, ctx(s.time));
  return r.ok ? 'ok' : r.code;
};
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

describe('мина не принимает общих приказов флота', () => {
  const s0 = world([mine('MINE', 'p1', { location: 'M' })]);

  it('орбита и обстрел вражеского мира — отказ: безоружная мина не морозит производство', () => {
    expect(code(s0, act('fleet.orbit', 'p1', { fleetId: 'MINE', orbit: 'near' }))).toBe('E_MINE_PASSIVE');
    expect(code(s0, act('fleet.bombard', 'p1', { fleetId: 'MINE', on: true }))).toBe('E_MINE_PASSIVE');
  });

  it('постановка мин самой миной — отказ, установка не заводится: заряды не пополнить без заградителя', () => {
    const r = rules.applyAction(s0, act('fleet.layMines', 'p1', { fleetId: 'MINE' }), ctx(0));
    expect(r.ok ? 'ok' : r.code).toBe('E_MINE_PASSIVE');
    expect(s0.minefields).toBeUndefined();
  });

  it('ремонт, постоянные приказы и марш — отказ тем же кодом', () => {
    const damaged = world([{ ...mine('MINE', 'p1', { location: 'M' }), units: [{ unit: 'mine', count: 3, hp: 10, modules: ['mine_layer'] }] }]);
    expect(code(damaged, act('fleet.instantRepair', 'p1', { fleetId: 'MINE' }))).toBe('E_MINE_PASSIVE');
    expect(code(damaged, act('fleet.repair', 'p1', { fleetId: 'MINE' }))).toBe('E_MINE_PASSIVE');
    expect(code(s0, act('order.auto', 'p1', { fleetId: 'MINE', on: true }))).toBe('E_MINE_PASSIVE');
    expect(code(s0, act('fleet.forcemarch', 'p1', { fleetId: 'MINE', on: true }))).toBe('E_MINE_PASSIVE');
  });

  it('обычный флот те же приказы по-прежнему получает', () => {
    const s = world([ships('F', 'p1', 'M')]);
    expect(code(s, act('fleet.orbit', 'p1', { fleetId: 'F', orbit: 'near' }))).toBe('ok');
    expect(code(s, act('fleet.forcemarch', 'p1', { fleetId: 'F', on: true }))).toBe('ok');
  });
});

describe('мина не обстреливает и не делит залп ПВО — даже оказавшись на орбите', () => {
  it('мина с включённым обстрелом над вражеским миром его не морозит', () => {
    const s = world([{ ...mine('MINE', 'p1', { location: 'M' }), orbit: 'near', bombarding: true }]);
    expect(bombardedPlanets(s, data).has('M')).toBe(false);
  });
});

describe('пополнение мины не назначает вторую встречу', () => {
  const layer = (edge: { from: string; to: string; t: number }): Fleet => ({
    id: 'L',
    owner: 'p1',
    location: null,
    edge,
    movement: null,
    units: [{ unit: 'layer', count: 1, modules: ['mine_layer'] }],
    landing: [],
    traits: [],
    battleId: null,
  });
  const at = { from: 'N', to: 'M', t: 0.5 };

  it('первая мина в точке встаёт стоящей точкой для перехвата', () => {
    const s0 = world([layer(at)]);
    const laid = apply(s0, act('fleet.layMines', 'p1', { fleetId: 'L' })).state;
    const { events } = advance(laid, laid.minefields!.installations!.L!.readyAt);
    expect(events.filter((e) => e.type === 'fleet.parked')).toHaveLength(1);
  });

  it('пополнение той же мины — без нового `fleet.parked`', () => {
    const s0 = world([layer(at), mine('MINE', 'p1', { edge: at }, 1)]);
    const laid = apply(s0, act('fleet.layMines', 'p1', { fleetId: 'L' })).state;
    const { state, events } = advance(laid, laid.minefields!.installations!.L!.readyAt);
    expect(events.map((e) => e.type)).toContain('mines.laid');
    expect(events.filter((e) => e.type === 'fleet.parked')).toEqual([]);
    expect(state.fleets.MINE!.units.reduce((n, st) => n + st.count, 0)).toBe(4);
  });
});

describe('мины одной точки дороги — один подрыв с общим потолком', () => {
  it('две мины разных владельцев: один подрыв, доля урезана до 0,5 — как на узле', () => {
    const at = { from: 'N', to: 'M', t: 0.5 };
    const s0 = world([
      ships('E', 'p2', 'N'),
      mine('A', 'p1', { edge: at }, 3, 'heavy_layer'),
      mine('B', 'p3', { edge: at }, 3, 'heavy_layer'),
    ]);
    const moving = apply(s0, act('fleet.move', 'p2', { fleetId: 'E', to: 'M' })).state;
    const { state, events } = advance(moving, moving.fleets.E!.movement!.arrivesAt);
    const hits = events.filter((e) => e.type === 'mines.triggered');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.payload).toMatchObject({ fleetId: 'E', hit: 0.5, mines: ['A', 'B'] });
    // 100 корпуса × (1 − 0,5) = 50 → 5 кораблей. По очереди было бы 100 → 60 → 36 → 4.
    expect(state.fleets.E!.units[0]!.count).toBe(5);
    expect(state.fleets.A!.units[0]!.count).toBe(2);
    expect(state.fleets.B!.units[0]!.count).toBe(2);
  });
});

describe('мины ромба развилки на разных лейнах — одна точка, один подрыв (замечание Codex на #1414)', () => {
  // Тропа B ветвится в F(60,0) к A и C: мина на лейне B→A и мина на лейне B→C стоят в одной
  // физической точке общего ствола.
  function forkWorld(fleets: Fleet[]): GameState {
    const base = world(fleets);
    const xab = { x: 100, y: -75 };
    const xcb = { x: 100, y: 75 };
    const at = (id: string, x: number, y: number, links: string[], owner: string | null = null): Planet => ({
      ...planet(id, 0, links, owner),
      position: { x, y },
    });
    base.planets = {
      A: { ...at('A', 200, -150, ['B']), roads: { crossings: { B: xab }, trails: [{ exits: ['B'], fork: null }] } },
      B: {
        ...at('B', 0, 0, ['A', 'C'], 'p2'),
        roads: { crossings: { A: xab, C: xcb }, trails: [{ exits: ['A', 'C'], fork: { x: 60, y: 0 } }] },
      },
      C: { ...at('C', 200, 150, ['B']), roads: { crossings: { B: xcb }, trails: [{ exits: ['B'], fork: null }] } },
    };
    return base;
  }

  it('флот по стволу подрывается обеими минами разом, а не одной', () => {
    const probe = forkWorld([]);
    const s0 = forkWorld([
      ships('E', 'p2', 'A'),
      mine('X', 'p1', { edge: { from: 'B', to: 'A', t: forkTAtStart(probe, 'B', 'A') } }, 3, 'heavy_layer'),
      mine('Y', 'p3', { edge: { from: 'B', to: 'C', t: forkTAtStart(probe, 'B', 'C') } }, 3, 'heavy_layer'),
    ]);
    const moving = apply(s0, act('fleet.move', 'p2', { fleetId: 'E', to: 'B' })).state;
    const { state, events } = advance(moving, moving.fleets.E!.movement!.arrivesAt);
    const hits = events.filter((e) => e.type === 'mines.triggered');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.payload).toMatchObject({ fleetId: 'E', mines: ['X', 'Y'] });
    expect(state.fleets.X!.units[0]!.count).toBe(2);
    expect(state.fleets.Y!.units[0]!.count).toBe(2);
  });
});

describe('метка подрыва не уходит в проекцию (замечание Codex на #1414)', () => {
  it('срез мин зрителя без `struck`, даже когда у него есть своя перезарядка', () => {
    const s = world([ships('L', 'p1', 'N')]);
    s.minefields = { readyAt: { L: 999 }, struck: { hidden: 5 } };
    expect(visibleMinefields(s, 'p1')).toEqual({ readyAt: { L: 999 } });
  });
});

describe('невидимую мину не находят челноки', () => {
  const base = (s: GameState): GameState => ({
    ...s,
    planets: {
      ...s.planets,
      N: {
        ...s.planets.N!,
        owner: 'p1',
        buildings: [{ type: 'spaceport', level: 1, hp: 30 }],
        hangar: [{ id: 'sq:b', units: [{ unit: 'bomber', count: 3 }] }],
      },
    },
  });

  it('дежурный вылет с опознанного узла не бьёт мину без своего флота рядом', () => {
    const hidden = { ...base(world([mine('MINE', 'p2', { location: 'N' })])), patrols: { N: { kind: 'planet' as const } } };
    expect(patrolScrambles(hidden, data)).toEqual([]);
    const seen = { ...hidden, fleets: { ...hidden.fleets, F: ships('F', 'p1', 'N') } };
    expect(patrolScrambles(seen, data).map((sc) => sc.targetFleetId)).toEqual(['MINE']);
  });

  it('приказ удара по невидимой мине — `E_NO_TARGET`, как по несуществующему флоту', () => {
    const k = createKernel([constructionModule, shuttleModule]);
    const strike = act('shuttle.strike', 'p1', { planetId: 'N', squadronId: 'sq:b', targetFleetId: 'MINE' });
    const hidden = base(world([mine('MINE', 'p2', { location: 'M' })]));
    const r = k.applyAction(hidden, strike, ctx(0));
    expect(r.ok ? 'ok' : r.code).toBe('E_NO_TARGET');
    const seen = base(world([mine('MINE', 'p2', { location: 'M' }), ships('F', 'p1', 'M')]));
    const ok = k.applyAction(seen, strike, ctx(0));
    expect(ok.ok ? 'ok' : ok.code).toBe('ok');
  });
});
