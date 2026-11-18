import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type BattleSide, type GameState } from '../state/gameState';
import { previewSides } from '../state/previewBattle';
import { setStance } from '../state/diplomacy';
import { parseGameData } from '../data/schemas';
import { combatModule } from './combat';

/**
 * Одна линия на державу (MSB-11, резолюция владельца 2026-11-18): предел линии
 * `min(1, L/N)` считается по всем живым кораблям державы в этом бою, а не по одному флоту.
 * Дробить армию на флоты по десять больше не выгодно. Внутри флота правило прежнее.
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

describe('одна линия на державу (MSB-11)', () => {
  it('пять флотов по 10 бьют как один флот из 50 — дробить невыгодно', () => {
    const one = firstVolley(world({ big: ['a', 50] }));
    const five = firstVolley(
      world({ a1: ['a', 10], a2: ['a', 10], a3: ['a', 10], a4: ['a', 10], a5: ['a', 10] }),
    );
    // 50 кораблей × 12 × 10/50 — как десять кораблей в полную силу.
    expect(one).toBeCloseTo(120, 9);
    expect(five).toBeCloseTo(one, 9);
  });

  it('пока кораблей державы не больше линии — штрафа нет, сколько бы ни было флотов', () => {
    const two = firstVolley(world({ a1: ['a', 5], a2: ['a', 5] }));
    expect(two).toBeCloseTo(10 * 12, 9);
  });

  it('у каждой державы своя линия: союзник её не делит', () => {
    const state = world({ a1: ['a', 10], c1: ['c', 10] });
    setStance(state, 'a', 'c', 'alliance');
    expect(firstVolley(state)).toBeCloseTo(2 * 10 * 12, 9);
  });

  it('у пиратов и Роя хозяина нет — линия, как и прежде, у каждой стороны', () => {
    expect(firstVolley(world({ p1: [null, 10], p2: [null, 10] }))).toBeCloseTo(2 * 10 * 12, 9);
  });

  it('прогноз считает линию державы так же, как бой', () => {
    const shooters: Record<string, [string, number]> = {
      a1: ['a', 10],
      a2: ['a', 10],
      a3: ['a', 30],
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
