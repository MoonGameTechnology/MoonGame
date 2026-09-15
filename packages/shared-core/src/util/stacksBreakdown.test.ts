/**
 * РАЗБИВКА ЗАЛПА ПО СТЕКАМ (VET-1) — приёмка кирпича.
 *
 * Решение владельца 3 (§0.0 роадмапа медалей): «надо, чтоб подсчитывался урон каждого
 * юнита в бою (по идее он и так считается)». Проверено — считается: `cappedUnitStat`
 * строит строки `{per, unit, count}`, сортирует их по силе, идёт по бюджету линии огня
 * и в ПОСЛЕДНЕЙ строке складывает всё в одно число. Вклад каждого стека существует ровно
 * до этого сложения и там же выбрасывается.
 *
 * Поэтому кирпич — не «завести учёт», а «не выбрасывать посчитанное», и главное
 * требование у него ровно одно: **исход боя не меняется ни на единицу урона**. Гарантия
 * тут не обещанием, а устройством — сумма перестаёт быть отдельным кодом и становится
 * сложением разбивки, так что двух путей, способных разойтись, не остаётся физически.
 *
 * ⚠️ **Про «побитово» — честная оговорка, потому что первая версия этого файла обещала
 * больше, чем проверяла.** Я написал тест на точное равенство и объявил, что он ловит
 * расхождение ПОРЯДКА сложения. Проверка порчей это опровергла: перевернул порядок
 * слагаемых — тест остался зелёным. Замер объяснил почему: на игровых числах double
 * ассоциативен, и порядок начинает быть виден только при разнице порядков около 1e16
 * (проверено: `[[7.3,8],[2.7,2]]` и `[[3.3,6],[1.1,3],[0.7,1]]` дают побитово одно и то
 * же в обе стороны, различие появляется лишь на `[[1e16,1],[1,5],[0.1,4]]`).
 *
 * Поэтому здесь проверяется то, что РЕАЛЬНО может разойтись: не порядок сложения, а само
 * ПРАВИЛО — кап, сортировка линии огня, фильтр. Первый тест прогоняет их пачкой раскладов
 * сразу, а не одним удачным: одна форма флота зелёная и у неверного правила.
 */
import { describe, it, expect } from 'vitest';
import { cappedUnitStat, cappedUnitBreakdown, COMBAT_UNIT_CAP } from './stacks';
import { parseGameData, type GameData } from '../data/schemas';
import type { UnitStack } from '../state/gameState';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Дробные `attack` — намеренно: на круглых числах побитовое равенство сошлось бы
    // само собой, и тест перестал бы ловить расхождение порядка сложения.
    lance: { faction: 'x', stats: { attack: 7.3, defense: 1, speed: 5, hp: 10 } },
    cutter: { faction: 'x', stats: { attack: 2.7, defense: 1, speed: 9, hp: 6 } },
    barge: { faction: 'x', stats: { attack: 0, defense: 1, speed: 3, hp: 40 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const stacks = (list: Array<[string, number]>): UnitStack[] =>
  list.map(([unit, count]) => ({ unit, count }));

describe('VET-1 — разбивка вклада по стекам', () => {
  it('сумма разбивки ТОЧНО равна прежнему числу — на всех формах флота, а не на одной', () => {
    // Раскладов много намеренно: кап режет по-разному в зависимости от того, чей стек
    // сильнее, сколько стеков и упирается ли сумма в COMBAT_UNIT_CAP вообще. Неверное
    // правило совпадает с верным на КАКОЙ-ТО одной форме почти всегда — и почти никогда
    // на всех сразу.
    const shapes: Array<Array<[string, number]>> = [
      [['lance', 8], ['cutter', 6]], // кап режет слабый стек частью
      [['lance', 10], ['cutter', 4]], // кап выбран сильным целиком
      [['cutter', 6], ['lance', 8]], // тот же флот, стеки в обратном порядке
      [['lance', 3]], // кап не задет вовсе
      [['lance', 3], ['cutter', 3], ['barge', 3]], // три стека, один без пушек
      [['barge', 12]], // одни транспорты: кап упёрт, урона нет
      [['lance', 5], ['lance', 5], ['lance', 5]], // три стека ОДНОГО корпуса
      [], // пустой флот
    ];
    for (const shape of shapes) {
      const fleet = stacks(shape);
      const sum = cappedUnitBreakdown(fleet, data, 'attack').reduce((a, c) => a + c.damage, 0);
      // Именно toBe, а не toBeCloseTo: «примерно равно» — это и есть та неточность,
      // ради отсутствия которой кирпич существует.
      expect(sum, JSON.stringify(shape)).toBe(cappedUnitStat(fleet, data, 'attack'));
    }
  });

  it('стек за пределами капа в разбивку не попадает ВОВСЕ, а не строкой с нулём', () => {
    // 10 копий уже выбирают весь кап — катера не стреляют ни одним стволом.
    const fleet = stacks([
      ['lance', 10],
      ['cutter', 4],
    ]);
    const breakdown = cappedUnitBreakdown(fleet, data, 'attack');
    expect(breakdown.map((c) => c.unit)).toEqual(['lance']);
  });

  it('ключ разбивки — ИНДЕКС стека, а не имя юнита', () => {
    // Два стека одного корпуса — обычное дело: побитый и целый не сливаются
    // (`findHealthyStack`). Разбивка «по имени» слила бы их и приписала весь урон
    // одному носителю — а носитель медали именно стек.
    const fleet: UnitStack[] = [
      { unit: 'lance', count: 3, hp: 12 },
      { unit: 'lance', count: 2 },
    ];
    const breakdown = cappedUnitBreakdown(fleet, data, 'attack');
    expect(breakdown.map((c) => c.index).sort()).toEqual([0, 1]);
    expect(breakdown.find((c) => c.index === 0)?.firing).toBe(3);
    expect(breakdown.find((c) => c.index === 1)?.firing).toBe(2);
  });

  it('частично попавший в линию огня стек отдаёт РОВНО свою часть', () => {
    const fleet = stacks([
      ['lance', 8],
      ['cutter', 6],
    ]);
    const breakdown = cappedUnitBreakdown(fleet, data, 'attack');
    const cutter = breakdown.find((c) => c.unit === 'cutter');
    expect(cutter?.firing).toBe(COMBAT_UNIT_CAP - 8); // 2 из шести
    expect(cutter?.damage).toBe(2 * 2.7);
  });

  it('транспорт без пушек стоит в линии, но его вклад — ноль', () => {
    // Он ЗАНИМАЕТ бюджет (так считает и `cappedUnitStat`), поэтому строка есть,
    // а урона в ней нет: «не стрелял» и «не стоял» — разные вещи для медали.
    const fleet = stacks([['barge', 3]]);
    const breakdown = cappedUnitBreakdown(fleet, data, 'attack');
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.damage).toBe(0);
    expect(breakdown[0]?.firing).toBe(3);
  });

  it('фильтр `eligible` и кап прокидываются так же, как в сумме', () => {
    const fleet = stacks([
      ['lance', 8],
      ['cutter', 6],
    ]);
    const only = (def: { stats: Record<string, number> }): boolean => def.stats.speed! > 8;
    const breakdown = cappedUnitBreakdown(fleet, data, 'attack', only, 4);
    expect(breakdown.map((c) => c.unit)).toEqual(['cutter']);
    expect(breakdown.reduce((a, c) => a + c.damage, 0)).toBe(
      cappedUnitStat(fleet, data, 'attack', only, 4),
    );
  });

  it('формульный `stat` работает и в разбивке — им считается обстрел', () => {
    const fleet = stacks([['lance', 2]]);
    const formula = (st: Record<string, number>): number => (st.attack ?? 0) * 0.5;
    expect(cappedUnitBreakdown(fleet, data, formula).reduce((a, c) => a + c.damage, 0)).toBe(
      cappedUnitStat(fleet, data, formula),
    );
  });
});
