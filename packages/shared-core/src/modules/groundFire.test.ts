/**
 * ОГОНЬ С ОРБИТЫ И С ВОЗДУХА ПО НАЗЕМНЫМ ВОЙСКАМ (ROS-1.6, `util/groundFire.ts`).
 *
 * Заказ владельца 2026-10-12: корабли бьют наземные юниты слабо, космическая авиация —
 * чуть сильнее. Здесь закреплены оба канала (обстрел с орбиты и удар шаттлов по миру),
 * порог «последнего бойца сверху не добить» и то, что урон идёт через хук своего канала.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { orbitalModule } from './orbital';
import { combatModule } from './combat';
import { interceptModule } from './intercept';
import { constructionModule } from './construction';
import { shuttleModule } from './shuttle';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 10, defense: 5, speed: 10, hp: 60 }, line: 'front' },
    militia: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      stats: { attack: 4, defense: 8, speed: 0, hp: 14 },
    },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      stats: { attack: 22, defense: 14, speed: 0, hp: 46 },
    },
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 20,
        defense: 4,
        speed: 100,
        hp: 16,
        strikeRange: 180,
        fuel: 2,
        rearmRounds: 3,
        siegeDamage: 8,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
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

function planet(
  id: string,
  owner: string | null,
  x: number,
  garrison: Array<[string, number]>,
): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: garrison.map(([unit, count]) => ({ unit, count })),
    traits: [],
  };
}

function cruisers(count: number, bombarding: boolean): Fleet {
  return {
    id: 'F',
    owner: 'p1',
    location: 'P',
    movement: null,
    units: [{ unit: 'cruiser', count }],
    traits: [],
    orbit: 'near',
    bombarding,
  };
}

function siege(fleet: Fleet, garrison: Array<[string, number]>): GameState {
  const s = createInitialState({ seed: 'gf', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { P: planet('P', 'p2', 0, garrison) },
    fleets: { F: fleet },
  };
}

function okAdvance(r: AdvanceResult): Extract<AdvanceResult, { ok: true }> {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}

/** Остаток корпуса гарнизона: `hp` побитого стека или полный пул целого. */
function garrisonHp(s: GameState, id = 'P'): number {
  return (s.planets[id]?.garrison ?? []).reduce(
    (n, st) => n + (st.hp ?? st.count * (data.units[st.unit]?.stats.hp ?? 0)),
    0,
  );
}

const orbitKernel = (extra: GameModule[] = []) =>
  createKernel([orbitalModule, combatModule, interceptModule, ...extra]);

describe('обстрел с орбиты бьёт войска мира (ROS-1.6)', () => {
  it('за час ложится десятая доля атаки каждого корабля', () => {
    // 10 крейсеров × атака 10 × 0,1 = 10 в час; ополчение 3 × 14 = 42.
    const r = okAdvance(
      orbitKernel().advanceTo(siege(cruisers(10, true), [['militia', 3]]), ctx(HOUR)),
    );
    expect(garrisonHp(r.state)).toBeCloseTo(32);
    expect(r.state.planets.P?.garrison[0]?.count).toBe(3);
  });

  it('флот на орбите без приказа «Обстрел» войска не трогает', () => {
    const r = okAdvance(
      orbitKernel().advanceTo(siege(cruisers(10, false), [['militia', 3]]), ctx(HOUR)),
    );
    expect(garrisonHp(r.state)).toBe(42);
  });

  it('павших пишет на обстреливающего, вне боя', () => {
    const r = okAdvance(
      orbitKernel().advanceTo(siege(cruisers(10, true), [['militia', 3]]), ctx(2 * HOUR)),
    );
    const died = r.events.filter((e) => e.type === 'unit.died');
    expect(died).toHaveLength(1);
    expect(died[0]?.payload).toMatchObject({
      unit: 'militia',
      count: 1,
      killedBy: 'p1',
      planetId: 'P',
    });
    expect((died[0]?.payload as { battleId?: string }).battleId).toBeUndefined();
  });

  it('последнего бойца с орбиты не добить: остаётся 1 прочности, мир не меняет хозяина', () => {
    const r = okAdvance(
      orbitKernel().advanceTo(
        siege(cruisers(10, true), [
          ['militia', 3],
          ['tank', 1],
        ]),
        ctx(100 * HOUR),
      ),
    );
    const left = r.state.planets.P?.garrison.filter((st) => st.count > 0) ?? [];
    expect(left).toHaveLength(1);
    expect(left[0]?.count).toBe(1);
    expect(garrisonHp(r.state)).toBeCloseTo(1);
    expect(r.state.planets.P?.owner).toBe('p2');
  });

  it('урон идёт через хук своего канала (фаза bombard)', () => {
    const double: GameModule = {
      id: 'probe',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('combat.damage', (v, args) =>
          (args as { phase?: string }).phase === 'bombard' ? v * 2 : v,
        );
      },
    };
    const r = okAdvance(
      orbitKernel([double]).advanceTo(siege(cruisers(10, true), [['militia', 3]]), ctx(HOUR)),
    );
    expect(garrisonHp(r.state)).toBeCloseTo(22);
  });
});

// --- удар шаттлов ----------------------------------------------------------------

const shuttleKernel = createKernel([constructionModule, shuttleModule]);

/** Свой порт A(0) с эскадрой бомбардировщиков, чужой мир B(100) с гарнизоном. */
function raid(garrison: Array<[string, number]>, bombers = 2): GameState {
  const s = createInitialState({ seed: 'gf-sh', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, []);
  home.buildings = [{ type: 'spaceport', level: 1, hp: 30 }];
  home.hangar = [{ id: 'sq:bomber', units: [{ unit: 'bomber', count: bombers }] }];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: home, B: planet('B', 'p2', 100, garrison) },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

const strikeB: Action = {
  id: 'a:1',
  type: 'shuttle.strike',
  playerId: 'p1',
  payload: { planetId: 'A', squadronId: 'sq:bomber', targetPlanetId: 'B' },
  issuedAt: 0,
};

/** Вылет и ровно один удар: до B 100 при скорости 100 — час пути. */
function struck(s: GameState): GameState {
  const a: ApplyResult = shuttleKernel.applyAction(s, strikeB, ctx(s.time));
  if (!a.ok) throw new Error(a.code);
  return okAdvance(shuttleKernel.advanceTo(a.state, ctx(s.time + HOUR))).state;
}

describe('удар шаттлов по миру бьёт его войска (ROS-1.6)', () => {
  it('за удар ложится четверть атаки каждой машины — больше, чем корабль за час', () => {
    // 2 бомбардировщика × атака 20 × 0,25 = 10 за удар.
    expect(garrisonHp(struck(raid([['militia', 3]])), 'B')).toBeCloseTo(32);
  });

  it('по войскам не враждебного мира огонь не идёт', () => {
    const s = raid([['militia', 3]]);
    expect(garrisonHp(struck({ ...s, diplomacy: { 'p1|p2': 'peace' } }), 'B')).toBe(42);
  });

  it('последнего бойца с воздуха не добить', () => {
    // 6 машин × 5 = 30 за удар против одного ополченца на 14.
    const after = struck(raid([['militia', 1]], 6));
    expect(after.planets.B?.garrison[0]?.count).toBe(1);
    expect(garrisonHp(after, 'B')).toBeCloseTo(1);
  });
});
