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
  },
  factions: {},
  buildings: {},
  events: {},
});

const f = (count: number): UnitStack[] => [{ unit: 'fighter', count }];

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
