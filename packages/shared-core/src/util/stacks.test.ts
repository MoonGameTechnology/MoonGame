import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import type { GameState, UnitStack } from '../state/gameState';
import { sideDamageBreakdown } from './combat';
import {
  cappedUnitStat,
  COMBAT_UNIT_CAP,
  sumUnitStat,
  loadoutKey,
  takeFromStacks,
  mergeStacks,
  addUnits,
} from './stacks';

// gun out-shoots pea; howitzer is the only artillery piece; targeting is a +4
// attack module so a fitted stack sorts above a bare one of the same hull.
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    gun: { faction: 'x', stats: { attack: 10, defense: 6, speed: 5, hp: 5 }, line: 'front' },
    pea: { faction: 'x', stats: { attack: 4, defense: 2, speed: 5, hp: 5 }, line: 'front' },
    howitzer: {
      faction: 'x',
      stats: { attack: 18, defense: 1, speed: 3, hp: 8, range: 200 },
      traits: ['artillery'],
    },
  },
  factions: {},
  buildings: {},
  events: {},
  modules: {
    targeting: {
      name: 'Targeting',
      slot: 'weapon',
      tag: 'vertical',
      cost: {},
      effects: { stats: { attack: 4 } },
    },
  },
});

const stack = (unit: string, count: number, extra: Partial<UnitStack> = {}): UnitStack => ({
  unit,
  count,
  ...extra,
});

describe('cappedUnitStat — the Bytro combat line cap', () => {
  it('matches sumUnitStat while the side fits under the cap', () => {
    const units = [stack('gun', 6), stack('pea', 4)];
    expect(cappedUnitStat(units, data, 'attack')).toBe(sumUnitStat(units, data, 'attack')); // 76
  });

  it(`caps the firing line at ${COMBAT_UNIT_CAP} units — extras add nothing`, () => {
    expect(cappedUnitStat([stack('gun', 12)], data, 'attack')).toBe(10 * 10);
    expect(cappedUnitStat([stack('gun', 10)], data, 'attack')).toBe(10 * 10);
    expect(cappedUnitStat([stack('gun', 200)], data, 'attack')).toBe(10 * 10);
  });

  it('fills the line strongest-first across stacks, independent of stack order', () => {
    // 6 guns (10) + 8 peas (4): the guns all fire, only 4 peas squeeze in.
    const ab = cappedUnitStat([stack('gun', 6), stack('pea', 8)], data, 'attack');
    const ba = cappedUnitStat([stack('pea', 8), stack('gun', 6)], data, 'attack');
    expect(ab).toBe(6 * 10 + 4 * 4);
    expect(ba).toBe(ab);
  });

  it('reads EFFECTIVE stats — a fitted stack outranks a bare one of the same hull', () => {
    // 3 fitted guns (14) fire first, then 7 of the 9 bare guns (10).
    const units = [stack('gun', 9), stack('gun', 3, { modules: ['targeting'] })];
    expect(cappedUnitStat(units, data, 'attack')).toBe(3 * 14 + 7 * 10);
  });

  it('the eligible filter excludes units from firing AND from spending the budget', () => {
    const units = [stack('howitzer', 2), stack('gun', 12)];
    const artilleryOnly = (def: { traits: string[] }): boolean => def.traits.includes('artillery');
    expect(cappedUnitStat(units, data, 'attack', artilleryOnly)).toBe(2 * 18);
    // Unfiltered, the howitzers head the line and the guns fill the rest.
    expect(cappedUnitStat(units, data, 'attack')).toBe(2 * 18 + 8 * 10);
  });

  it('honours a custom cap and skips empty/unknown stacks', () => {
    expect(cappedUnitStat([stack('gun', 12)], data, 'attack', undefined, 2)).toBe(2 * 10);
    expect(cappedUnitStat([stack('gun', 0), stack('nosuch', 5)], data, 'attack')).toBe(0);
    expect(cappedUnitStat([], data, 'attack')).toBe(0);
  });
});

describe('loadoutKey — canonical, order-independent loadout signature', () => {
  it('is empty for no modules, and sorted+joined for several regardless of input order', () => {
    expect(loadoutKey()).toBe('');
    expect(loadoutKey([])).toBe('');
    expect(loadoutKey(['b', 'a'])).toBe('a,b');
    expect(loadoutKey(['a', 'b'])).toBe('a,b');
  });
});

describe('takeFromStacks — used by fleet.split to peel ships off a stack list', () => {
  it('moves the requested count off a single matching stack, at full health', () => {
    const src = [stack('gun', 5)];
    const taken = takeFromStacks(src, 'gun', 2);
    expect(taken).toEqual([{ unit: 'gun', count: 2 }]);
    expect(src).toEqual([{ unit: 'gun', count: 3 }]);
  });

  it('apportions hp/shieldHp pools pro-rata (never duplicates hull)', () => {
    const src = [stack('gun', 4, { hp: 20, shieldHp: 8 })]; // 5 hp/ship, 2 shield/ship
    const taken = takeFromStacks(src, 'gun', 1);
    expect(taken).toEqual([{ unit: 'gun', count: 1, hp: 5, shieldHp: 2 }]);
    expect(src).toEqual([{ unit: 'gun', count: 3, hp: 15, shieldHp: 6 }]);
    // Total pool conserved exactly.
    expect((taken[0]!.hp ?? 0) + (src[0]!.hp ?? 0)).toBe(20);
  });

  it('carries the loadout onto the taken stack (a split never strips paid modules)', () => {
    const src = [stack('gun', 3, { modules: ['targeting'] })];
    const taken = takeFromStacks(src, 'gun', 1);
    expect(taken[0]?.modules).toEqual(['targeting']);
    expect(src[0]?.modules).toEqual(['targeting']); // source keeps its own copy
  });

  it('spans multiple stacks of the same unit and stops once count is satisfied', () => {
    const src = [stack('gun', 2), stack('gun', 2, { modules: ['targeting'] })];
    const taken = takeFromStacks(src, 'gun', 3);
    const totalTaken = taken.reduce((a, s) => a + s.count, 0);
    expect(totalTaken).toBe(3);
    const totalLeft = src.reduce((a, s) => a + s.count, 0);
    expect(totalLeft).toBe(1);
  });

  it('ignores non-matching units and a non-positive remainder', () => {
    const src = [stack('gun', 2), stack('pea', 5)];
    expect(takeFromStacks(src, 'pea', 2)).toEqual([{ unit: 'pea', count: 2 }]);
    expect(src.find((s) => s.unit === 'gun')?.count).toBe(2); // untouched
  });
});

describe('mergeStacks — used by fleet.merge to fold one fleet into another', () => {
  it('coalesces same-unit, same-loadout, both-full-health stacks', () => {
    const out = mergeStacks([stack('gun', 2)], [stack('gun', 3)]);
    expect(out).toEqual([{ unit: 'gun', count: 5 }]);
  });

  it('keeps a damaged stack separate — merging on hp equality alone would fuse pools', () => {
    const out = mergeStacks([stack('gun', 2)], [stack('gun', 1, { hp: 3 })]);
    expect(out).toContainEqual({ unit: 'gun', count: 2 });
    expect(out).toContainEqual({ unit: 'gun', count: 1, hp: 3 });
  });

  it('keeps a differently-fitted stack separate — a fitted stack never absorbs a bare one', () => {
    const out = mergeStacks([stack('gun', 2)], [stack('gun', 1, { modules: ['targeting'] })]);
    expect(out).toContainEqual({ unit: 'gun', count: 2 });
    expect(out).toContainEqual({ unit: 'gun', count: 1, modules: ['targeting'] });
  });

  it('coalesces two same-loadout fitted stacks (module order does not matter)', () => {
    const out = mergeStacks(
      [stack('gun', 1, { modules: ['a', 'b'] })],
      [stack('gun', 1, { modules: ['b', 'a'] })],
    );
    expect(out).toEqual([{ unit: 'gun', count: 2, modules: ['a', 'b'] }]);
  });

  it('does not mutate its inputs (clones every stack)', () => {
    const base = [stack('gun', 2, { modules: ['targeting'] })];
    const add = [stack('gun', 1)];
    const out = mergeStacks(base, add);
    out[0]!.modules?.push('extra');
    expect(base[0]!.modules).toEqual(['targeting']); // untouched
  });

  it('appends a unit with no match in base', () => {
    const out = mergeStacks([stack('gun', 2)], [stack('pea', 1)]);
    expect(out).toContainEqual({ unit: 'pea', count: 1 });
  });
});

describe('sideDamageBreakdown rides the cap for every combatant kind', () => {
  it('caps a fleet, a landing force and a garrison alike', () => {
    const state = {
      fleets: { f1: { units: [stack('gun', 12)], landing: [stack('pea', 14)] } },
      planets: { P: { garrison: [stack('pea', 25)] } },
    } as unknown as GameState;
    expect(sideDamageBreakdown(state, { kind: 'fleet', fleetId: 'f1' }, data, 'attack').total).toBe(
      10 * 10,
    );
    expect(sideDamageBreakdown(state, { kind: 'landing', fleetId: 'f1' }, data, 'attack').total).toBe(
      10 * 4,
    );
    expect(
      sideDamageBreakdown(state, { kind: 'garrison', planetId: 'P' }, data, 'defense').total,
    ).toBe(10 * 2);
  });
});

describe('SZE-1.1 — звёздность модуля едет ВМЕСТЕ с кораблём', () => {
  // Носитель звезды — стек, а не игрок: `effectiveStats` видит только `(def, stack, data)`,
  // и звезда обязана доехать до КАЖДОГО потребителя статов, иначе HUD и бой разойдутся
  // в числах. Отсюда требование: всякий путь, который копирует стек, копирует и звёзды.
  const starred = (): UnitStack => ({
    unit: 'gun',
    count: 4,
    modules: ['targeting'],
    moduleStars: { targeting: 2 },
  });

  it('разделение флота уносит звёзды с отделённой частью', () => {
    // `takeFromStacks` перечисляет поля поимённо — забытое поле тут теряется МОЛЧА.
    const src = [starred()];
    const [taken] = takeFromStacks(src, 'gun', 2, ['targeting']);
    expect(taken?.moduleStars).toEqual({ targeting: 2 });
    expect(src[0]?.moduleStars).toEqual({ targeting: 2 });
  });

  it('слияние флотов не роняет звёзды и не делит их объект на двоих', () => {
    const base = [starred()];
    const out = mergeStacks(base, [starred()]);
    expect(out).toHaveLength(1);
    expect(out[0]?.count).toBe(8);
    expect(out[0]?.moduleStars).toEqual({ targeting: 2 });
    // Копия, а не общая ссылка: иначе правка одного флота меняла бы чужой.
    expect(out[0]?.moduleStars).not.toBe(base[0]?.moduleStars);
  });

  it('свежая постройка встаёт со своими звёздами', () => {
    const stacks: UnitStack[] = [];
    addUnits(stacks, 'gun', 3, ['targeting'], { targeting: 2 });
    expect(stacks[0]?.moduleStars).toEqual({ targeting: 2 });
    // Нулевые звёзды поля не заводят — состояние остаётся байт-в-байт прежним.
    const bare: UnitStack[] = [];
    addUnits(bare, 'gun', 3, ['targeting'], { targeting: 0 });
    expect(bare[0]).toEqual({ unit: 'gun', count: 3, modules: ['targeting'] });
  });

  it('звёзды доезжают до боевого веса', () => {
    // Лестницу надо подложить: в этих данных её нет, а пустая лестница ось выключает.
    const withLadder: GameData = parseGameData({
      version: '0.1.0',
      resources: ['metal'],
      units: { gun: { faction: 'x', stats: { attack: 10, defense: 6, speed: 5, hp: 5 } } },
      factions: {},
      buildings: {},
      events: {},
      modules: {
        targeting: { name: 'T', slot: 'weapon', tag: 'vertical', cost: {}, effects: { stats: { attack: 4 } } },
      },
      sectorZeroStars: { cap: 2, guaranteed: 1, steps: [{ warrants: 1, bonus: 0.5 }, { chance: 0.5, warrants: 2, bonus: 0.5 }] },
    });
    const plain = sumUnitStat([{ unit: 'gun', count: 1, modules: ['targeting'] }], withLadder, 'attack');
    const withStars = sumUnitStat([{ ...starred(), count: 1 }], withLadder, 'attack');
    expect(plain).toBe(14); // 10 + 4
    expect(withStars).toBe(18); // 10 + 4 × (1 + 0.5 + 0.5)
  });
});

describe('addUnits — заслуга при доливе и переезде (VET-2 / PERK-3.2)', () => {
  it('долив НЕотмеченных разбавляет отметку по весу', () => {
    // 2 отмеченных + 6 новых = четверть. Это та же цена удобства, что у медалей:
    // большой стек удобен, но честь подразделения он разводит по новичкам.
    const stacks: UnitStack[] = [{ unit: 'gun', count: 2, promoted: 1 }];
    addUnits(stacks, 'gun', 6);
    expect(stacks[0]?.count).toBe(8);
    expect(stacks[0]?.promoted).toBeCloseTo(0.25, 9);
  });

  it('ПЕРЕЕЗД юнитов приносит их заслугу с собой — сплит копирует', () => {
    // Авто-сбор построенного уносит корабли из гарнизона во флот и зовёт `addUnits`.
    // Без переноса отмеченный корабль терял бы отметку ровно в момент подъёма с верфи.
    const source: UnitStack = { unit: 'gun', count: 3, promoted: 1, battles: 2 };
    const dest: UnitStack[] = [];
    addUnits(dest, 'gun', 3, undefined, undefined, undefined, source);
    expect(dest[0]?.count).toBe(3); // размер партии, а не остаток источника
    expect(dest[0]?.promoted).toBe(1);
    expect(dest[0]?.battles).toBe(2);
  });

  it('переезд в НЕПУСТОЙ стек усредняет, а не затирает', () => {
    const dest: UnitStack[] = [{ unit: 'gun', count: 1 }];
    addUnits(dest, 'gun', 3, undefined, undefined, undefined, { promoted: 1 });
    expect(dest[0]?.count).toBe(4);
    expect(dest[0]?.promoted).toBeCloseTo(0.75, 9);
  });

  it('без заслуги поле не заводится вовсе', () => {
    const dest: UnitStack[] = [];
    addUnits(dest, 'gun', 2);
    expect(dest[0]).toEqual({ unit: 'gun', count: 2 });
  });
});
