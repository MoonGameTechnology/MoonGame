import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type BattleSide, type GameState } from '../state/gameState';
import { previewSides } from '../state/previewBattle';
import { setStance } from '../state/diplomacy';
import { parseGameData } from '../data/schemas';
import { combatModule } from './combat';

/**
 * Линия флотов державы (MSB-13, резолюция владельца 2026-11-19): внутри флота предел линии
 * `min(1, L/N)` по его кораблям, как всегда; в бою пять флотов державы бьют в полную силу,
 * при M > 5 каждый — на 5/M. Союзник линию не делит, стороны без хозяина — каждая сама.
 */
const HOUR = 3_600_000;
const data = parseGameData({
  version: 'line',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 1000, speed: 1, attack: 12, defense: 8 } },
    // Мишень: огромный корпус, без оружия — урон по ней читается как есть.
    hulk: { faction: 'x', stats: { hp: 100_000, speed: 1, attack: 0, defense: 0 } },
  },
});
const kernel = createKernel([combatModule]);

/** Бой у P: атакующие флоты `shooters` (id → [владелец, кораблей]) против мишени `t`. */
function world(shooters: Record<string, [string | null, number]>): GameState {
  const state = createInitialState({
    seed: 'line',
    version: { data: data.version, manifest: '1' },
  });
  for (const owner of ['a', 'c', 't']) {
    state.players[owner] = {
      id: owner,
      name: owner,
      faction: 'x',
      status: 'active',
      resources: {},
    };
  }
  state.planets.P = {
    id: 'P',
    owner: null,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    traits: [],
    garrison: [],
  };
  const sides: BattleSide[] = [];
  for (const [id, [owner, count]] of Object.entries(shooters)) {
    state.fleets[id] = {
      id,
      owner: owner as string,
      location: 'P',
      movement: null,
      units: [{ unit: 'ship', count }],
      traits: [],
      battleId: 'battle:0',
    };
    sides.push({
      ref: { kind: 'fleet', fleetId: id },
      owner,
      role: 'attacker',
      attackStartedAt: 0,
      nextAttackAt: HOUR,
      attackCount: 0,
    });
  }
  state.fleets.t = {
    id: 't',
    owner: 't',
    location: 'P',
    movement: null,
    units: [{ unit: 'hulk', count: 1 }],
    traits: [],
    battleId: 'battle:0',
  };
  sides.push({ ref: { kind: 'fleet', fleetId: 't' }, owner: 't', role: 'defender' });
  state.battles['battle:0'] = {
    id: 'battle:0',
    location: 'P',
    phase: 'orbital',
    sides,
    round: 0,
    nextRoundAt: HOUR,
  };
  state.battleSeq = 1;
  state.scheduled = [
    { id: 'evt:0', seq: 0, type: 'combat.tick', at: HOUR, payload: { battleId: 'battle:0' } },
  ];
  state.scheduleSeq = 1;
  return state;
}
/** Сколько корпуса мишень потеряла за первый залп всех атакующих. */
function firstVolley(state: GameState): number {
  const result = kernel.advanceTo(state, { now: HOUR, data });
  if (!result.ok) throw Error(result.code);
  expect(result.failures).toEqual([]);
  return 100_000 - (result.state.fleets.t!.units[0]!.hp ?? 100_000);
}

/** `n` флотов владельца `owner` по `ships` кораблей: id — `${prefix}1…${prefix}n`. */
function fleets(prefix: string, owner: string | null, n: number, ships = 10) {
  return Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`${prefix}${i + 1}`, [owner, ships]]),
  ) as Record<string, [string | null, number]>;
}

describe('линия флотов державы (MSB-13)', () => {
  it('внутри флота предел прежний: 50 кораблей одним флотом бьют как 10', () => {
    // 50 кораблей × 12 × 10/50 — как десять кораблей в полную силу.
    expect(firstVolley(world({ big: ['a', 50] }))).toBeCloseTo(120, 9);
  });

  it('пять флотов по 10 — в пределе линии: бьют всеми пятьюдесятью кораблями', () => {
    expect(firstVolley(world(fleets('a', 'a', 5)))).toBeCloseTo(5 * 10 * 12, 9);
  });

  it('сверх пяти флотов каждый бьёт на 5/M — сумма не растёт', () => {
    const six = firstVolley(world(fleets('a', 'a', 6)));
    const ten = firstVolley(world(fleets('a', 'a', 10)));
    expect(six).toBeCloseTo(6 * 10 * 12 * (5 / 6), 9);
    expect(ten).toBeCloseTo(10 * 10 * 12 * 0.5, 9);
    expect(six).toBeCloseTo(ten, 9);
  });

  it('флот, которому нечем стрелять, линию тоже занимает', () => {
    const state = world({ ...fleets('a', 'a', 5), cargo: ['a', 1] });
    state.fleets.cargo!.units = [{ unit: 'hulk', count: 1 }];
    expect(firstVolley(state)).toBeCloseTo(5 * 10 * 12 * (5 / 6), 9);
  });

  it('у каждой державы своя линия: союзник её не делит', () => {
    const state = world({ ...fleets('a', 'a', 5), c1: ['c', 10] });
    setStance(state, 'a', 'c', 'alliance');
    expect(firstVolley(state)).toBeCloseTo(6 * 10 * 12, 9);
  });

  it('у пиратов и Роя хозяина нет — линия у каждой стороны своя', () => {
    expect(firstVolley(world(fleets('p', null, 6)))).toBeCloseTo(6 * 10 * 12, 9);
  });

  it('прогноз считает линию флотов так же, как бой', () => {
    // Семь флотов державы — линия флотов работает, а у третьего ещё и свой предел кораблей.
    const shooters: Record<string, [string | null, number]> = {
      ...fleets('a', 'a', 6, 4),
      big: ['a', 30],
    };
    const state = world(shooters);
    const ids = [...Object.keys(shooters), 't'];
    const forecast = previewSides(
      ids.map((id) => ({
        units: state.fleets[id]!.units,
        owner: state.fleets[id]!.owner,
        role: id === 't' ? 'defender' : 'attacker',
        key: id,
      })),
      data,
      (x, y) => x !== y,
    );
    const result = kernel.advanceTo(state, { now: 400 * HOUR, data });
    if (!result.ok) throw Error(result.code);
    for (const [i, id] of ids.entries()) {
      const live = result.state.fleets[id]?.units ?? [];
      expect(
        forecast.sides[i]!.survivors.map(({ unit, count, hp }) => ({ unit, count, hp })),
      ).toEqual(live.map(({ unit, count, hp }) => ({ unit, count, hp })));
    }
  });
});
