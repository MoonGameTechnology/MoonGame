/**
 * ПОДБИТЫЙ ШАТТЛ (SHU-5.7, резолюция владельца 2026-09-26).
 *
 * «С уменьшением хп уменьшается скорость шаттлов и урон атаки. Побитый челнок
 * конвертируется в побитый наземный юнит 1 к 1 в %.» Доля живого корпуса соединения —
 * `hullShare = 1 − damage / Σ корпусов`:
 *
 * 1. **Скорость** вылета умножается на долю — полкорпуса летит вдвое дольше.
 * 2. **Урон** удара умножается на долю — полкорпуса бьёт вполсилы.
 * 3. **Боец** побитого десантного челнока высаживается с той же долей здоровья, и
 *    раненый стек встаёт отдельно от целых.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import {
  createInitialState,
  type GameState,
  type Planet,
  type Player,
  type Squadron,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    striker: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
        siegeDamage: 8,
      },
    },
    landing_shuttle: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle', 'lander'],
      stats: {
        attack: 0,
        defense: 2,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
      },
    },
    militia: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 4, defense: 4, speed: 4, hp: 20, cargoSize: 1 },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
    mine: { name: 'Mine', cost: {}, buildTimeHours: 0, hp: 200 },
  },
  events: {},
});

const HOUR = 3_600_000;
const kernel = createKernel([constructionModule, shuttleModule]);
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function planet(id: string, owner: string | null, x: number, buildings: string[] = []): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
    garrison: [],
    traits: [],
  };
}

/** Свой порт A(0) с одной эскадрой, чужой мир B(100) с шахтой. */
function world(squad: Squadron, target: Partial<Planet> = {}): GameState {
  const s = createInitialState({ seed: 'shu57', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, ['spaceport']);
  home.hangar = [squad];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: home, B: { ...planet('B', 'p2', 100, ['mine']), ...target } },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const strike = (): Action => ({
  id: `a:${seq++}`,
  type: 'shuttle.strike',
  playerId: 'p1',
  payload: { planetId: 'A', squadronId: 'sq:1', targetPlanetId: 'B' },
  issuedAt: 0,
});
function launch(s: GameState): GameState {
  const r = kernel.applyAction(s, strike(), at(s));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(s: GameState, hours: number): GameState {
  const r = kernel.advanceTo(s, { now: s.time + hours * HOUR, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const striker = (damage?: number): Squadron => ({
  id: 'sq:1',
  units: [{ unit: 'striker', count: 1 }],
  ...(damage ? { damage } : {}),
});
const lander = (damage?: number): Squadron => ({
  id: 'sq:1',
  units: [{ unit: 'landing_shuttle', count: 1 }],
  cargo: [{ unit: 'militia', count: 1 }],
  ...(damage ? { damage } : {}),
});
const flightHours = (s: GameState): number => {
  const st = s.strikes![0]!;
  return (st.arrivesAt - st.departedAt) / HOUR;
};

describe('SHU-5.7 — подбитый шаттл', () => {
  it('полкорпуса — вдвое медленнее', () => {
    expect(flightHours(launch(world(striker())))).toBeCloseTo(1);
    expect(flightHours(launch(world(striker(5))))).toBeCloseTo(2);
  });

  it('полкорпуса — вполсилы по постройкам', () => {
    const mine = (s: GameState): number | undefined => s.planets.B?.buildings[0]?.hp;
    expect(mine(advance(launch(world(striker())), 1))).toBe(200 - 8);
    expect(mine(advance(launch(world(striker(5))), 2))).toBe(200 - 4);
  });

  it('побитый челнок высаживает бойца с тем же процентом здоровья', () => {
    // Пустой чужой мир: челнок с 30% корпуса берёт его ополченцем с 30% здоровья.
    const s = advance(launch(world(lander(7), { owner: 'p2', buildings: [] })), 5);
    expect(s.planets.B?.owner).toBe('p1');
    expect(s.planets.B?.garrison).toEqual([{ unit: 'militia', count: 1, hp: expect.closeTo(6) }]);
  });

  it('на своём мире раненое подкрепление встаёт отдельно от целого гарнизона', () => {
    const s0 = world(lander(5), {
      owner: 'p1',
      buildings: [],
      garrison: [{ unit: 'militia', count: 2 }],
    });
    const s = advance(launch(s0), 5);
    expect(s.planets.B?.garrison).toEqual([
      { unit: 'militia', count: 2 },
      { unit: 'militia', count: 1, hp: 10 },
    ]);
  });

  it('целый челнок высаживает целого бойца — как прежде', () => {
    const s = advance(launch(world(lander(), { owner: 'p2', buildings: [] })), 2);
    expect(s.planets.B?.garrison).toEqual([{ unit: 'militia', count: 1 }]);
  });
});
