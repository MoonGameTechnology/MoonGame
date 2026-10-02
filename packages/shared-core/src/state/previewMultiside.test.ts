/**
 * ПРОГНОЗ НА N СТОРОН (MSB-6) — приёмка половины кирпича, живущей в ядре.
 *
 * Прогноз был двусторонним по построению и повторял правила боя СВОИМИ СЛОВАМИ. Пока бой
 * был дуэлью, это лишь дублирование; с N сторонами это обещание игроку другого боя —
 * панель показывала бы расклад, которого не будет.
 *
 * Поэтому дуэль теперь ЧАСТНЫЙ СЛУЧАЙ многостороннего расчёта, а не отдельный алгоритм:
 * `previewBattle` зовёт `previewSides` на двух сторонах. Отсюда первое требование
 * приёмки — на двустороннем бою не изменился ни один исход (это держат 18 прежних тестов
 * `previewBattle.test.ts`), и второе — многосторонний расклад считается теми же
 * правилами, что живой раунд.
 */
import { describe, it, expect } from 'vitest';
import { previewSides, previewBattle } from './previewBattle';
import { parseGameData, type GameData } from '../data/schemas';
import type { UnitStack } from './gameState';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    fighter: { faction: 'x', stats: { attack: 10, defense: 5, speed: 10, hp: 100 } },
    // Гибнет за один раунд и успевает ответить: на нём видно, сколько ответ весит.
    striker: { faction: 'x', stats: { attack: 100, defense: 30, speed: 10, hp: 100 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const f = (count: number): UnitStack[] => [{ unit: 'fighter', count }];
const striker = (count: number): UnitStack[] => [{ unit: 'striker', count }];

describe('MSB-6 — прогноз считает N сторон теми же правилами, что бой', () => {
  it('ДУЭЛЬ не изменилась: тот же исход, что у двустороннего прогноза', () => {
    const duel = previewBattle(f(3), f(2), data);
    const viaSides = previewSides(
      [
        { units: f(3), role: 'attacker' },
        { units: f(2), role: 'defender' },
      ],
      data,
    );
    expect(viaSides.roundsEst).toBe(duel.roundsEst);
    expect(viaSides.sides[0]!.losses).toEqual(duel.attacker.losses);
    expect(viaSides.sides[1]!.losses).toEqual(duel.defender.losses);
  });

  it('ТРОЕ: залп делится на всех врагов — задета КАЖДАЯ сторона, а не двое', () => {
    const r = previewSides(
      [
        { units: f(2), role: 'attacker' },
        { units: f(2), role: 'attacker' },
        { units: f(2), role: 'defender' },
      ],
      data,
    );
    // Ни одна сторона не осталась нетронутой: до кирпича прогноз обсчитал бы двоих.
    for (const side of r.sides) expect(side.damageFraction).toBeGreaterThan(0);
  });

  it('СОЮЗНИКОВ не бьют: вражда спрашивается у вызывающего', () => {
    const allies = new Set(['a1', 'a2']);
    const hostile = (x?: string | null, y?: string | null): boolean =>
      !(allies.has(x ?? '') && allies.has(y ?? ''));
    const r = previewSides(
      [
        { units: f(2), role: 'attacker', owner: 'a1' },
        { units: f(2), role: 'attacker', owner: 'a2' },
        { units: f(9), role: 'defender', owner: 'd' },
      ],
      data,
      hostile,
    );
    // Союзники получают урон ТОЛЬКО от обороняющегося, поэтому их потери равны между
    // собой — если бы они били друг друга, симметрия сломалась бы вместе с ролями.
    expect(r.sides[0]!.damageFraction).toBeCloseTo(r.sides[1]!.damageFraction, 10);
  });

  it('НИКТО НИКОМУ НЕ ВРАГ — боя нет, а не 240 пустых раундов', () => {
    const r = previewSides(
      [
        { units: f(2), role: 'attacker', owner: 'a' },
        { units: f(2), role: 'defender', owner: 'b' },
      ],
      data,
      () => false,
    );
    expect(r.outcome).toBe('stalemate');
    expect(r.roundsEst).toBe(1); // предохранитель не крутится впустую
    expect(r.sides.every((s) => s.damageFraction === 0)).toBe(true);
  });

  it('ПОБЕДИТЕЛЬ есть, только когда выжил РОВНО ОДИН — как в бою (MSB-3)', () => {
    const rout = previewSides(
      [
        { units: f(20), role: 'attacker' },
        { units: f(1), role: 'defender' },
      ],
      data,
    );
    expect(rout.outcome).toBe('decided');
    const twoLeft = previewSides(
      [
        { units: f(2), role: 'attacker', owner: 'a1' },
        { units: f(2), role: 'attacker', owner: 'a2' },
        { units: f(1), role: 'defender', owner: 'd' },
      ],
      data,
      (x, y) => !(x !== 'd' && y !== 'd'),
    );
    // Двое союзников добили третьего и оба живы — единственного победителя нет.
    expect(twoLeft.outcome).toBe('stalemate');
  });
});

describe('UIX-6.3 — раунд прогноза = раунд живого боя 3.x, и цепочка досчитывается', () => {
  it('ОБОРОНЯЮЩИЙСЯ отвечает КАЖДОМУ атакующему полным залпом (§0.0 №1, 2026-09-28)', () => {
    // Двое союзников бьют одного. Он гибнет за раунд, но успевает ответить обоим — каждому
    // всей своей обороной (30), а не половиной: прежний прогноз делил ответ между ними.
    const r = previewSides(
      [
        { units: striker(1), role: 'attacker', owner: 'a1' },
        { units: striker(1), role: 'attacker', owner: 'a2' },
        { units: striker(1), role: 'defender', owner: 'd' },
      ],
      data,
      (x, y) => x !== y && (x === 'd' || y === 'd'),
    );
    expect(r.roundsEst).toBe(1);
    expect(r.sides[0]!.damageFraction).toBeCloseTo(0.3, 10);
    expect(r.sides[1]!.damageFraction).toBeCloseTo(0.3, 10);
  });

  it('ОБОРОНЯЮЩИЙСЯ стреляет, только когда его атакуют: двое обороняющихся друг друга не бьют', () => {
    // `d1` враждебен всем, `a` и `d2` в мире. `d2` никто не атакует — и он не стреляет;
    // `d1` с ним враждует, но тоже лишь обороняется. Прежний прогноз давал залп обоим.
    const r = previewSides(
      [
        { units: f(9), role: 'attacker', owner: 'a' },
        { units: f(2), role: 'defender', owner: 'd1' },
        { units: f(2), role: 'defender', owner: 'd2' },
      ],
      data,
      (x, y) => x !== y && (x === 'd1' || y === 'd1'),
    );
    expect(r.sides[1]!.survivors).toEqual([]);
    expect(r.sides[2]!.damageFraction).toBe(0);
  });

  it('ЦЕПОЧКА: после первой гибели выжившие сцепляются заново и дерутся до конца (§0.0 №5)', () => {
    // Все против всех. Слабый погибает первым, но бой на этом не кончается: двое
    // оставшихся сходятся новым боем, и победитель остаётся один.
    const r = previewSides(
      [
        { units: f(3), role: 'attacker' },
        { units: f(1), role: 'defender' },
        { units: f(3), role: 'attacker' },
      ],
      data,
    );
    expect(r.outcome).toBe('decided');
    expect(r.sides.filter((x) => x.survivors.length > 0)).toHaveLength(1);
  });

  it('ПЕРЕСЦЕПКА — по ключу, а не по месту в списке: порядок входа исход не меняет', () => {
    const a = { units: f(4), role: 'attacker' as const, key: 'f2' };
    const d = { units: f(1), role: 'defender' as const, key: 'f0' };
    const b = {
      units: [
        { unit: 'fighter', count: 2 },
        { unit: 'striker', count: 1 },
      ],
      role: 'attacker' as const,
      key: 'f1',
    };
    const one = previewSides([a, d, b], data);
    const two = previewSides([b, a, d], data);
    expect(two.roundsEst).toBe(one.roundsEst);
    expect(two.sides[0]!.survivors).toEqual(one.sides[2]!.survivors);
    expect(two.sides[1]!.survivors).toEqual(one.sides[0]!.survivors);
  });
});
