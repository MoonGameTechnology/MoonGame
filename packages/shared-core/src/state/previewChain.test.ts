/**
 * ПРОГНОЗ = БОЙ ТРЁХ СТОРОН И БОЛЬШЕ (UIX-6.3) — приёмка ядра.
 *
 * MSB-6 научил прогноз считать N сторон, но живой раунд потом ушёл вперёд (бой 3.x):
 * обороняющийся отвечает КАЖДОМУ атакующему полным залпом, а не делит ответ между ними
 * (§0.0 №1, уточнение 2026-09-28), и не стреляет, пока его не атаковали. Вдобавок прогноз
 * обрывался на первой гибели, хотя бой этим не кончается: выжившие сцепляются заново
 * (§0.0 №5, цепочка). Поэтому окно боя прогнозировало только дуэль.
 *
 * Оракул здесь — сам бой. Один и тот же расклад прогоняется через живое ядро без хуков
 * урона и через `previewSides`, и прогноз обязан совпасть до единицы: те же выжившие, тот
 * же остаток корпуса, то же число раундов по всей цепочке.
 */
import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { combatModule } from '../modules/combat';
import { diplomacyModule } from '../modules/diplomacy';
import { previewSides, type PreviewSideInput } from './previewBattle';
import {
  createInitialState,
  type Battle,
  type Fleet,
  type GameState,
  type Player,
  type UnitStack,
} from './gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { getStance, setStance } from './diplomacy';
import type { Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Роль решает исход: копейщик бьёт больно и держит слабо, бастион наоборот. Так
    // прогноз, перепутавший, кто нападает в новом звене, разойдётся с боем заметно.
    lancer: { faction: 'x', stats: { attack: 30, defense: 6, speed: 10, hp: 120 } },
    bulwark: { faction: 'x', stats: { attack: 6, defense: 24, speed: 10, hp: 200 } },
    marine: { faction: 'x', domain: 'ground', stats: { attack: 10, defense: 4, speed: 1, hp: 20 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const kernel = createKernel([combatModule, diplomacyModule]);
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const stacks = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));
const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

/** Вражда так, как её спрашивает живой залп (`sidesHostile`): война — враг, ничейный —
 *  враг всякому, кроме ничейного. */
const hostileIn =
  (s: GameState) =>
  (a: string | null | undefined, b: string | null | undefined): boolean =>
    a !== b && (a == null || b == null || getStance(s, a, b) === 'war');

/** Все названные игроки воюют друг с другом, кроме пар из `friends` (союз). */
function declare(s: GameState, owners: string[], friends: Array<[string, string]>): void {
  for (let i = 0; i < owners.length; i++) {
    for (let j = i + 1; j < owners.length; j++) setStance(s, owners[i]!, owners[j]!, 'war');
  }
  for (const [a, b] of friends) setStance(s, a, b, 'alliance');
}

interface Ship {
  id: string;
  owner: string;
  role: 'attacker' | 'defender';
  units: Array<[string, number]>;
}

/** Бой флотов на узле `P`. Стороны — в порядке вступления, как их держит `Battle.sides`. */
function orbit(ships: Ship[], friends: Array<[string, string]> = []): GameState {
  const s = createInitialState({ seed: 'uix63', version: { data: '0.1.0', manifest: '1' } });
  const fleets: Record<string, Fleet> = {};
  const players: Record<string, Player> = {};
  for (const x of ships) {
    players[x.owner] = player(x.owner);
    fleets[x.id] = {
      id: x.id,
      owner: x.owner,
      location: 'P',
      movement: null,
      units: stacks(x.units),
      traits: [],
      battleId: 'b1',
    };
  }
  const sides: Battle['sides'] = ships.map((x) => ({
    ref: { kind: 'fleet', fleetId: x.id },
    owner: x.owner,
    role: x.role,
  }));
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
    battles: { b1: { id: 'b1', location: 'P', phase: 'orbital', sides, round: 0 } },
    scheduled: [{ id: 'evt:0', at: 0, type: 'combat.tick', payload: { battleId: 'b1' }, seq: 0 }],
    scheduleSeq: 1,
  };
  declare(out, Object.keys(players), friends);
  return out;
}

/** Мир `P` хозяина `p0` под штурмом плацдармов; стороны — берега в порядке высадки,
 *  потом гарнизон (так их ставит `beachhead.landed`). */
function siege(
  garrison: Array<[string, number]>,
  landings: Array<[string, Array<[string, number]>]>,
  friends: Array<[string, string]> = [],
): GameState {
  const s = createInitialState({ seed: 'uix63', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = { p0: player('p0') };
  for (const [owner] of landings) players[owner] = player(owner);
  const sides: Battle['sides'] = landings.map(([owner]) => ({
    ref: { kind: 'beachhead' as const, planetId: 'P', owner },
    owner,
    role: 'attacker' as const,
  }));
  sides.push({ ref: { kind: 'garrison', planetId: 'P' }, owner: 'p0', role: 'defender' });
  const out: GameState = {
    ...s,
    players,
    planets: {
      P: {
        id: 'P',
        owner: 'p0',
        position: { x: 0, y: 0 },
        resources: {},
        buildings: [],
        garrison: stacks(garrison),
        traits: [],
        beachheads: landings.map(([owner, units]) => ({ owner, units: stacks(units) })),
      },
    },
    battles: { b1: { id: 'b1', location: 'P', phase: 'ground', sides, round: 0 } },
    scheduled: [{ id: 'evt:0', at: 0, type: 'combat.tick', payload: { battleId: 'b1' }, seq: 0 }],
    scheduleSeq: 1,
  };
  declare(out, Object.keys(players), friends);
  return out;
}

/** Вход прогноза — стороны боя `b1` как есть: состав, роль, владелец, id флота,
 *  гарнизон держит мир. */
function sidesOf(s: GameState): PreviewSideInput[] {
  const planet = s.planets.P!;
  return s.battles.b1!.sides.map((side) => {
    const ref = side.ref;
    if (ref.kind === 'fleet') {
      return {
        units: s.fleets[ref.fleetId]!.units,
        role: side.role,
        owner: side.owner,
        key: ref.fleetId,
      };
    }
    if (ref.kind === 'garrison') {
      return { units: planet.garrison, role: side.role, owner: side.owner, holds: true };
    }
    const units =
      ref.kind === 'beachhead'
        ? (planet.beachheads ?? []).find((b) => b.owner === ref.owner)!.units
        : [];
    return { units, role: side.role, owner: side.owner };
  });
}

/** Бой до конца всей цепочки: что осталось у каждой исходной стороны и сколько раундов
 *  отыграли все звенья вместе. */
function fight(s: GameState): { after: UnitStack[][]; rounds: number; owner: string | null } {
  const r = kernel.advanceTo(s, ctx(2000 * HOUR));
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  const end = r.state;
  const planet = end.planets.P!;
  const after = s.battles.b1!.sides.map((side) => {
    const ref = side.ref;
    if (ref.kind === 'fleet') return end.fleets[ref.fleetId]?.units ?? [];
    // На земле сторона — это владелец: взявший мир держит его своим гарнизоном.
    if (planet.owner === side.owner) return planet.garrison;
    return (planet.beachheads ?? []).find((b) => b.owner === side.owner)?.units ?? [];
  });
  const rounds = r.events
    .filter((e) => e.type === 'battle.resolved')
    .reduce((n, e) => n + ((e.payload as { rounds?: number }).rounds ?? 0), 0);
  expect(Object.keys(end.battles)).toHaveLength(0); // цепочка дошла до конца
  return { after, rounds, owner: planet.owner };
}

const heads = (u: readonly UnitStack[]): Array<[string, number]> =>
  u.filter((x) => x.count > 0).map((x) => [x.unit, x.count]);
const hulls = (u: readonly UnitStack[]): Array<number | null> =>
  u.filter((x) => x.count > 0).map((x) => x.hp ?? null);

describe('UIX-6.3 — прогноз многостороннего боя совпадает с боем', () => {
  it('ОРБИТА: обороняющийся отвечает каждому из двух союзников полным залпом', () => {
    const s = orbit(
      [
        { id: 'f1', owner: 'p1', role: 'attacker', units: [['lancer', 3]] },
        { id: 'f2', owner: 'p2', role: 'attacker', units: [['lancer', 2]] },
        { id: 'f0', owner: 'p0', role: 'defender', units: [['bulwark', 5]] },
      ],
      [['p1', 'p2']],
    );
    const pv = previewSides(sidesOf(s), data, hostileIn(s));
    const real = fight(s);
    expect(pv.roundsEst).toBe(real.rounds);
    pv.sides.forEach((side, i) => {
      expect(heads(side.survivors)).toEqual(heads(real.after[i]!));
      expect(hulls(side.survivors)).toEqual(hulls(real.after[i]!));
    });
  });

  it('ОРБИТА, цепочка: после первой гибели нападает младший id, а не первый в списке', () => {
    // В списке боя первым стоит f2, но заново сцепляет выживших живой бой по id флота:
    // нападёт бастион f1 (атака 6), копейщик f2 ответит обороной (6). Перепутай прогноз
    // роли — копейщик бил бы атакой 30, и исход разошёлся бы.
    const s = orbit([
      { id: 'f2', owner: 'p2', role: 'attacker', units: [['lancer', 2]] },
      { id: 'f0', owner: 'p0', role: 'defender', units: [['lancer', 1]] },
      { id: 'f1', owner: 'p1', role: 'attacker', units: [['bulwark', 3]] },
    ]);
    const pv = previewSides(sidesOf(s), data, hostileIn(s));
    const real = fight(s);
    expect(pv.outcome).toBe('decided');
    expect(pv.roundsEst).toBe(real.rounds);
    pv.sides.forEach((side, i) => {
      expect(heads(side.survivors)).toEqual(heads(real.after[i]!));
      expect(hulls(side.survivors)).toEqual(hulls(real.after[i]!));
    });
  });

  it('ОРБИТА, четверо: цепочка идёт, пока стоит хоть одна враждебная пара', () => {
    const s = orbit([
      { id: 'f3', owner: 'p3', role: 'attacker', units: [['lancer', 2]] },
      { id: 'f1', owner: 'p1', role: 'defender', units: [['bulwark', 2]] },
      {
        id: 'f0',
        owner: 'p0',
        role: 'attacker',
        units: [
          ['lancer', 1],
          ['bulwark', 1],
        ],
      },
      { id: 'f2', owner: 'p2', role: 'attacker', units: [['bulwark', 4]] },
    ]);
    const pv = previewSides(sidesOf(s), data, hostileIn(s));
    const real = fight(s);
    expect(pv.roundsEst).toBe(real.rounds);
    pv.sides.forEach((side, i) => {
      expect(heads(side.survivors)).toEqual(heads(real.after[i]!));
      expect(hulls(side.survivors)).toEqual(hulls(real.after[i]!));
    });
  });

  it('ЗЕМЛЯ: выбитый берег не кончает штурм — уцелевшие отдыхают и идут снова', () => {
    // Два враждующих берега штурмуют один мир. Первым гибнет слабый берег; живые стороны
    // возвращаются в покой — израненные стеки снова с полным корпусом, — и штурм идёт
    // новым боем. Без отдыха гарнизон пал бы на ход позже и унёс бы ещё одного морпеха.
    const s = siege(
      [['marine', 10]],
      [
        ['p1', [['marine', 8]]],
        ['p2', [['marine', 3]]],
      ],
    );
    const pv = previewSides(sidesOf(s), data, hostileIn(s));
    const real = fight(s);
    expect(real.owner).toBe('p1');
    expect(pv.roundsEst).toBe(real.rounds);
    pv.sides.forEach((side, i) => expect(heads(side.survivors)).toEqual(heads(real.after[i]!)));
  });

  it('ЗЕМЛЯ: мир взят — его держит первый берег, и враг продолжает штурм уже против него', () => {
    const s = siege(
      [['marine', 2]],
      [
        ['p1', [['marine', 6]]],
        ['p2', [['marine', 6]]],
      ],
    );
    const pv = previewSides(sidesOf(s), data, hostileIn(s));
    const real = fight(s);
    expect(real.owner).toBe('p2'); // p1 взял мир первым и потерял его
    expect(pv.roundsEst).toBe(real.rounds);
    pv.sides.forEach((side, i) => expect(heads(side.survivors)).toEqual(heads(real.after[i]!)));
  });

  it('ЗЕМЛЯ, союзники: мир взят первым берегом, второй с ним не дерётся', () => {
    const s = siege(
      [['marine', 3]],
      [
        ['p1', [['marine', 4]]],
        ['p2', [['marine', 4]]],
      ],
      [['p1', 'p2']],
    );
    const pv = previewSides(sidesOf(s), data, hostileIn(s));
    const real = fight(s);
    expect(real.owner).toBe('p1');
    expect(pv.roundsEst).toBe(real.rounds); // лишнего звена «союзник против союзника» нет
    expect(heads(pv.sides[2]!.survivors)).toEqual([]); // гарнизон пал
    // Оба берега стоят. Сколько у кого — бой дальше не сверяет: войска союзника после
    // захвата садятся на его флоты или вливаются в гарнизон, а это уже не бой.
    expect(pv.sides[0]!.survivors.length).toBeGreaterThan(0);
    expect(pv.sides[1]!.survivors.length).toBeGreaterThan(0);
  });
});
