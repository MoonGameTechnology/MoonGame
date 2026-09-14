/**
 * БОЙ НА N СТОРОН (MSB-2) — приёмка кирпича «правило деления урона».
 *
 * MSB-1 дал бою ФОРМУ списка сторон, но правила остались парными: раунд брал
 * `attackerOf`/`defenderOf` и считал ровно один обмен ударами. Пять сторон укладывались в
 * `battle.sides` и обсчитывались как двое — остальные стояли в бою невредимыми.
 *
 * Решение владельца §0.0 №1: **урон дробится на всех врагов стороны.** Выбора цели у
 * игрока нет, спрятаться за спину союзника нельзя.
 *
 * Требование §0.0 №0, которое старше остальных: **механика универсальна по числу сторон.**
 * Поэтому приёмка кирпича — не «работает на трёх», а прямой вопрос владельца (§0.0.2):
 * сто сторон, и задеты ВСЕ сто, а не двое.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from './combat';
import { diplomacyModule } from './diplomacy';
import {
  createInitialState,
  type Battle,
  type BattleSide,
  type Fleet,
  type GameState,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Один корпус на всех: разница в исходе тогда объясняется ПРАВИЛОМ, а не составом.
    // Запас хода большой, чтобы сотня раундов никого не добила и счёт остался виден.
    fighter: { faction: 'x', stats: { attack: 12, defense: 8, speed: 10, hp: 4000 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const kernel = createKernel([combatModule, diplomacyModule]);
const ctx = (now: number): Context => ({ now, data });

function fleetOf(id: string, owner: string, count = 1): Fleet {
  return {
    id,
    owner,
    location: 'P',
    movement: null,
    units: [{ unit: 'fighter', count }],
    traits: [],
    battleId: 'b1',
  };
}

/**
 * Мир, где в ОДНОМ бою стоит `n` взаимно враждебных флотов. Бой собирается прямо в
 * состоянии: гонять сто штурмов через обычный путь значило бы проверять сцепление
 * (MSB-3), а этот кирпич про делёж урона.
 *
 * `defenders` — сколько ПЕРВЫХ сторон отвечают своим `defense`; остальные бьют `attack`.
 * Обороняющийся в бою есть всегда: бои заводятся штурмом и сцеплением, и сторона без
 * единого обороняющегося в игре недостижима (такой бой ядро закрывает как повреждённое
 * состояние — это сторож MSB-1, а не правило этого кирпича).
 */
function melee(n: number, defenders = 1): GameState {
  const s = createInitialState({ seed: 'msb2', version: { data: '0.1.0', manifest: '1' } });
  const fleets: Record<string, Fleet> = {};
  const players: Record<string, Player> = {};
  const sides: BattleSide[] = [];
  for (let i = 0; i < n; i++) {
    const owner = `p${String(i).padStart(3, '0')}`;
    const id = `f${String(i).padStart(3, '0')}`;
    players[owner] = { id: owner, name: owner, faction: 'x', status: 'active', resources: {} };
    fleets[id] = fleetOf(id, owner);
    sides.push({
      ref: { kind: 'fleet', fleetId: id },
      owner,
      role: i < defenders ? 'defender' : 'attacker',
    });
  }
  const battle: Battle = { id: 'b1', location: 'P', phase: 'orbital', sides, round: 0 };
  const out: GameState = {
    ...s,
    players,
    fleets,
    planets: {
      P: {
        id: 'P',
        owner: null,
        position: { x: 0, y: 0 },
        resources: {},
        buildings: [],
        garrison: [],
        traits: [],
      },
    },
    battles: { b1: battle },
    // Раунд назначается сразу: так один `advanceTo` даёт ровно один обмен ударами.
    scheduled: [{ id: 'evt:0', at: 0, type: 'combat.tick', payload: { battleId: 'b1' }, seq: 0 }],
    scheduleSeq: 1,
  };
  // Все против всех: без объявленной войны раунд закроется перемирием (CMB-7).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      setStance(out, `p${String(i).padStart(3, '0')}`, `p${String(j).padStart(3, '0')}`, 'war');
    }
  }
  return out;
}

/** Прогнать ровно один раунд. */
function oneRound(s: GameState): GameState {
  const r = kernel.advanceTo(s, ctx(0));
  if (!r.ok) throw new Error('advance failed');
  return r.state;
}

const hull = (s: GameState, id: string): number | undefined => s.fleets[id]?.units[0]?.hp;
const totalHp = (u: readonly UnitStack[] | undefined, full: number): number =>
  (u ?? []).reduce((n, st) => n + (st.hp ?? st.count * full), 0);

describe('MSB-2 — урон дробится на всех врагов', () => {
  it('ПРИЁМКА ВЛАДЕЛЬЦА: сто сторон — задеты ВСЕ сто, а не двое', () => {
    const after = oneRound(melee(100));
    const touched = Object.values(after.fleets).filter((f) => (f.units[0]?.hp ?? 4000) < 4000);
    expect(touched).toHaveLength(100);
  });

  it('ТРОЕ: залп каждого делится ПОПОЛАМ между двумя врагами', () => {
    // Обороняющийся p000 (defense 8 → по 4 каждому), двое атакующих (attack 12 → по 6).
    const after = oneRound(melee(3));
    expect(hull(after, 'f000')).toBeCloseTo(4000 - 12, 6); // 6 + 6
    expect(hull(after, 'f001')).toBeCloseTo(4000 - 10, 6); // 4 от обороны + 6 от соседа
    expect(hull(after, 'f002')).toBeCloseTo(4000 - 10, 6);
  });

  it('ЧЕТВЕРО: сумма прилетевшего равна сумме выпущенного — делёж ничего не теряет', () => {
    const after = oneRound(melee(4));
    const dealt = 8 + 3 * 12; // ответ обороны плюс три удара
    const taken =
      4 * 4000 - Object.values(after.fleets).reduce((n, f) => n + totalHp(f.units, 4000), 0);
    expect(taken).toBeCloseTo(dealt, 6);
  });

  it('РОЛЬ ПРИНАДЛЕЖИТ СТОРОНЕ: обороняющийся отвечает `defense`, а не `attack`', () => {
    // Двое обороняются (по 8, пополам), один атакует (12, пополам).
    const after = oneRound(melee(3, 2));
    expect(hull(after, 'f000')).toBeCloseTo(4000 - 10, 6); // 4 от второго обороняющегося + 6
    expect(hull(after, 'f001')).toBeCloseTo(4000 - 10, 6);
    expect(hull(after, 'f002')).toBeCloseTo(4000 - 8, 6); // 4 + 4 от двух оборон
  });

  it('НА ДВУХ СТОРОНАХ ИСХОД ПРЕЖНИЙ: весь залп уходит единственному врагу', () => {
    const after = oneRound(melee(2));
    expect(hull(after, 'f000')).toBeCloseTo(4000 - 12, 6); // удар attack
    expect(hull(after, 'f001')).toBeCloseTo(4000 - 8, 6); // ответ defense
  });

  it('СОЮЗНИКОВ НЕ БЬЮТ: залп делится только между ВРАЖДЕБНЫМИ сторонами', () => {
    // Двое атакующих в союзе между собой: у каждого ОДИН враг, и залп не дробится.
    const s = melee(3);
    setStance(s, 'p001', 'p002', 'alliance');
    const after = oneRound(s);
    expect(hull(after, 'f000')).toBeCloseTo(4000 - 24, 6); // по 12 от каждого
    expect(hull(after, 'f001')).toBeCloseTo(4000 - 4, 6); // половина ответа обороны
    expect(hull(after, 'f002')).toBeCloseTo(4000 - 4, 6);
  });
});
