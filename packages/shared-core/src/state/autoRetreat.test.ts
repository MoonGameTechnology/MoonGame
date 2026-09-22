import { describe, it, expect } from 'vitest';
import { autoRetreatDue } from './autoRetreat';
import { hullFraction, maxHull } from '../util/repair';
import { createInitialState, type Fleet, type GameState, type Planet } from './gameState';
import { parseGameData, type GameData } from '../data/schemas';

/**
 * RETR-2 — «пора отходить» считает ЯДРО.
 *
 * Правило владельца (2026-09-22): уходить, когда ОСТАТОК корпуса падает до порога от
 * МАКСИМАЛЬНОГО корпуса флота. Здесь пинится именно арифметика порога и три условия,
 * при которых приказ молчит, — потому что драйверы (серверный и прототипный) обязаны
 * звать эту функцию, а не считать своё.
 */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // 100 hp на корпус — доли читаются как проценты без округлений.
    hull: { faction: 'x', stats: { attack: 1, defense: 1, speed: 5, hp: 100 }, line: 'front' },
  },
  factions: {},
  buildings: {},
  events: {},
});

function fleet(id: string, owner: string, count: number, hp?: number): Fleet {
  return {
    id,
    owner,
    location: 'P',
    movement: null,
    units: [{ unit: 'hull', count, ...(hp !== undefined ? { hp } : {}) }],
    traits: [],
  };
}
function planet(id: string): Planet {
  return {
    id,
    owner: null,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
/** Флот в бою с приказом отходить на `H` при пороге `at`. */
function staged(hp: number | undefined, at: number, inBattle = true): GameState {
  const s = createInitialState({ seed: 'rtr', version: { data: '0.1.0', manifest: '1' } });
  const f = fleet('A', 'p1', 2, hp); // максимум 200
  if (inBattle) f.battleId = 'b1';
  return {
    ...s,
    planets: { P: planet('P'), H: planet('H') },
    fleets: { A: f },
    battles: inBattle
      ? { b1: { id: 'b1', location: 'P', phase: 'orbital', sides: [], round: 1 } }
      : {},
    autoRetreat: { A: { at, to: 'H' } },
  };
}

describe('hullFraction — знаменатель это МАКСИМУМ флота', () => {
  it('целый флот читается как 1, побитый — как доля от максимума', () => {
    expect(maxHull(fleet('A', 'p1', 2), data)).toBe(200);
    expect(hullFraction(fleet('A', 'p1', 2), data)).toBe(1); // hp не указан = целый
    expect(hullFraction(fleet('A', 'p1', 2, 50), data)).toBe(0.25); // 50 из 200
  });

  it('флот без корпуса читается как ЦЕЛЫЙ, а не как ноль', () => {
    // Fail-secure в ту сторону, которая ничего не делает: «0%» у пустого флота
    // означало бы вечный приказ на отход для того, кого никто не бил.
    const empty: Fleet = { ...fleet('A', 'p1', 0), units: [] };
    expect(hullFraction(empty, data)).toBe(1);
  });
});

describe('autoRetreatDue — когда приказ срабатывает (RETR-2)', () => {
  it('срабатывает, когда остаток упал ДО порога', () => {
    // 60 из 200 = 30%, порог 30% → уходим (строгое «больше» не проходит).
    expect(autoRetreatDue(staged(60, 0.3), data)).toEqual([{ fleetId: 'A', owner: 'p1', to: 'H' }]);
  });

  it('молчит, пока остаток ВЫШЕ порога', () => {
    expect(autoRetreatDue(staged(61, 0.3), data)).toEqual([]); // 30.5% > 30%
  });

  it('каждая ступень меряет своё', () => {
    const hp = 80; // 40% от 200
    expect(autoRetreatDue(staged(hp, 0.2), data)).toEqual([]); // 40% > 20% — рано
    expect(autoRetreatDue(staged(hp, 0.3), data)).toEqual([]); // 40% > 30% — рано
    expect(autoRetreatDue(staged(hp, 0.4), data)).toHaveLength(1); // ровно порог
    expect(autoRetreatDue(staged(hp, 0.5), data)).toHaveLength(1); // уже ниже
  });

  it('побитый флот ВНЕ боя никуда не бежит', () => {
    // «Мало корпуса» само по себе не повод лететь: флот в доке остаётся в доке.
    expect(autoRetreatDue(staged(10, 0.5, false), data)).toEqual([]);
  });

  it('без приказа не срабатывает вовсе', () => {
    const s = staged(10, 0.5);
    delete s.autoRetreat;
    expect(autoRetreatDue(s, data)).toEqual([]);
  });

  it('приказ на исчезнувший флот не роняет разбор', () => {
    const s = staged(10, 0.5);
    s.autoRetreat = { ...s.autoRetreat, ghost: { at: 0.5, to: 'H' } };
    expect(autoRetreatDue(s, data).map((x) => x.fleetId)).toEqual(['A']);
  });

  it('порядок выдачи не зависит от порядка ключей в объекте', () => {
    // JSONB не хранит порядок ключей: несортированный обход дал бы порядок приказов,
    // зависящий от хоста и гибернации (инвариант №6).
    const s = staged(10, 0.5);
    s.fleets = { ...s.fleets, B: { ...fleet('B', 'p1', 2, 10), battleId: 'b1' } };
    s.autoRetreat = { B: { at: 0.5, to: 'H' }, A: { at: 0.5, to: 'H' } };
    expect(autoRetreatDue(s, data).map((x) => x.fleetId)).toEqual(['A', 'B']);
  });
});
