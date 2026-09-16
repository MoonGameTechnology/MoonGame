/**
 * ГРЕЙДЫ МЕДАЛЕЙ (VET-3) — приёмка кирпича.
 *
 * Решения владельца 4-6: у медали есть СТЕПЕНЬ, степень зависит от нанесённого урона и от
 * числа пройденных сражений, и чем выше степень, тем выше награда за сохранение юнита.
 *
 * Пороги в этом тесте НЕ проверяются числами из данных — они там и живут, и менять их
 * можно без правки кода. Проверяется ПРАВИЛО: как два числа превращаются в две медали.
 */
import { describe, it, expect } from 'vitest';
import { medalsOf, MEDAL_LINES, type MedalAward } from './medals';
import { parseGameData, type GameData } from '../data/schemas';

/** Пороги нарочно круглые и НЕ равны шипнутым: тест про правило, а не про баланс. */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  medals: {
    valour: { grades: [10, 20, 30, 40] },
    service: { grades: [1, 2, 3, 4] },
  },
});

const names = (awards: MedalAward[]): string[] => awards.map((a) => `${a.line}.${a.grade}`);

describe('VET-3 — две линии медалей из двух чисел', () => {
  it('две линии, и они независимы: транспорт носит выслугу без доблести', () => {
    expect(names(medalsOf({ unit: 'x', count: 1, battles: 3 }, data))).toEqual(['service.3']);
  });

  it('стрелок без выслуги носит доблесть без выслуги', () => {
    expect(names(medalsOf({ unit: 'x', count: 1, damageDealt: 25 }, data))).toEqual(['valour.2']);
  });

  it('ветеран носит ОБЕ, каждую своей степени', () => {
    const awards = medalsOf({ unit: 'x', count: 1, damageDealt: 35, battles: 2 }, data);
    expect(names(awards)).toEqual(['valour.3', 'service.2']);
  });

  it('порог НЕ перешагнут — медали НЕТ, а не «нулевая степень»', () => {
    // Разница содержательная: «медали нет» и «низшая медаль» по-разному выглядят в
    // карточке и по-разному платят. Ноль степени сделал бы их неразличимыми.
    expect(medalsOf({ unit: 'x', count: 1, damageDealt: 9, battles: 0 }, data)).toEqual([]);
  });

  it('стек, не воевавший вовсе, медалей не носит', () => {
    expect(medalsOf({ unit: 'x', count: 1 }, data)).toEqual([]);
  });

  it('ровно НА пороге медаль уже есть — граница включающая', () => {
    expect(names(medalsOf({ unit: 'x', count: 1, damageDealt: 10 }, data))).toEqual(['valour.1']);
  });

  it('заслуга выше верхнего порога степень не задирает — потолок есть', () => {
    expect(names(medalsOf({ unit: 'x', count: 1, damageDealt: 100_000 }, data))).toEqual([
      'valour.4',
    ]);
  });

  it('порядок наград стабилен: сперва доблесть, потом выслуга', () => {
    // Порядок — это порядок строк в карточке юнита; он не имеет права зависеть от того,
    // какая медаль оказалась выше степенью.
    const a = medalsOf({ unit: 'x', count: 1, damageDealt: 10, battles: 4 }, data);
    const b = medalsOf({ unit: 'x', count: 1, damageDealt: 40, battles: 1 }, data);
    expect(a.map((x) => x.line)).toEqual(['valour', 'service']);
    expect(b.map((x) => x.line)).toEqual(['valour', 'service']);
  });

  it('ключ локализации собирается ЗДЕСЬ, а не шаблоном у каждого клиента', () => {
    // Два шаблона (`medal.${line}.${grade}` в прототипе и в packages/client) разъехались
    // бы на первой же правке — и разошлось бы это молча, показав игроку голый ключ.
    const awards = medalsOf({ unit: 'x', count: 1, damageDealt: 35, battles: 2 }, data);
    expect(awards.map((a) => a.key)).toEqual(['medal.valour.3', 'medal.service.2']);
  });

  it('КАЖДАЯ степень каждой линии даёт свой ключ — ни одна не остаётся без имени', () => {
    // Сторож против дыры «завели пятую степень в данных, а имени ей не дали»: VET-5
    // покажет игроку голый `medal.valour.5`, и заметит это только он.
    const seen: string[] = [];
    for (const line of MEDAL_LINES) {
      const scale = data.medals[line];
      expect(scale, line).toBeDefined();
      for (const [i, threshold] of scale!.grades.entries()) {
        const awards = medalsOf(
          line === 'valour'
            ? { unit: 'x', count: 1, damageDealt: threshold }
            : { unit: 'x', count: 1, battles: threshold },
          data,
        );
        const award = awards.find((a) => a.line === line);
        expect(award?.grade, `${line} порог ${threshold}`).toBe(i + 1);
        seen.push(award!.key);
      }
    }
    expect(new Set(seen).size).toBe(seen.length); // ключи не повторяются
  });
});
