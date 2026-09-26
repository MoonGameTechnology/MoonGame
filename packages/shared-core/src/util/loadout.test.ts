import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGameData, type GameData } from '../data/schemas';
import { loadGameData } from '../data/loadGameData';
import {
  effectiveStats,
  slotUsage,
  canEquip,
  validateLoadout,
  loadoutCost,
  moduleAllowed,
  loadoutBays,
  moduleRarityBonus,
  withBonusSlots,
} from './loadout';
import { sumUnitStat, addUnits } from './stacks';
import type { UnitStack } from '../state/gameState';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      stats: { attack: 10, defense: 8, speed: 6, hp: 40, shield: 15, cargoCapacity: 2 },
      slots: { weapon: 1, defense: 1, utility: 1 },
    },
    tank: { faction: 'x', domain: 'ground', stats: { attack: 20, defense: 16, speed: 0, hp: 50 } },
    // Universal bays: `reinforced` takes any two modules; `hybrid` has a typed weapon
    // bay and one universal bay on top.
    reinforced: { faction: 'x', stats: { attack: 20, defense: 18, speed: 5, hp: 90 }, slots: { universal: 2 } },
    hybrid: { faction: 'x', stats: { attack: 10, defense: 8, speed: 6, hp: 40 }, slots: { weapon: 1, universal: 1 } },
  },
  factions: {},
  buildings: {},
  events: {},
  modules: {
    targeting: { name: 'T', slot: 'weapon', tag: 'vertical', effects: { stats: { attack: 4 } }, cost: { metal: 60 } },
    targeting2: { name: 'T2', slot: 'weapon', tag: 'vertical', effects: { stats: { attack: 6 } }, cost: { metal: 90 } },
    plating: { name: 'P', slot: 'defense', tag: 'vertical', effects: { stats: { hp: 12 } }, cost: { metal: 50 } },
    cargo: { name: 'C', slot: 'utility', tag: 'horizontal', effects: { stats: { cargoCapacity: 6 } }, cost: { metal: 45 }, allowed: { domain: 'space' } },
  },
});
const cruiser = data.units.cruiser!;
const tank = data.units.tank!;

describe('effectiveStats — base + flat module deltas', () => {
  it('no modules → exactly the base stats (a fresh copy)', () => {
    expect(effectiveStats(cruiser, {}, data)).toEqual({ ...cruiser.stats });
    expect(effectiveStats(cruiser, { modules: [] }, data)).toEqual({ ...cruiser.stats });
  });

  it('adds each installed module’s flat deltas', () => {
    const s = effectiveStats(cruiser, { modules: ['targeting', 'plating'] }, data);
    expect(s.attack).toBe(14); // 10 + 4
    expect(s.hp).toBe(52); // 40 + 12
    expect(s.shield).toBe(15); // untouched
  });

  it('skips unknown module ids (base-default, never crashes)', () => {
    expect(effectiveStats(cruiser, { modules: ['ghost'] }, data).attack).toBe(10);
  });

  it('is deterministic and does not mutate the base def', () => {
    const before = { ...cruiser.stats };
    effectiveStats(cruiser, { modules: ['targeting'] }, data);
    expect(cruiser.stats).toEqual(before);
  });
});

describe('slot usage, allow rules, and canEquip', () => {
  it('counts occupied slots per category', () => {
    expect(slotUsage(['targeting', 'cargo'], data)).toEqual({ weapon: 1, defense: 0, utility: 1 });
  });

  it('loadoutBays lists one empty bay per slot the hull offers', () => {
    expect(loadoutBays(cruiser.slots, [], data).map((b) => b.type)).toEqual(['weapon', 'defense', 'utility']);
    expect(loadoutBays(tank.slots, [], data)).toEqual([]); // no slots
  });

  it('moduleAllowed honours the domain predicate', () => {
    expect(moduleAllowed('cruiser', cruiser, data.modules.cargo!)).toBe(true);
    expect(moduleAllowed('tank', tank, data.modules.cargo!)).toBe(false); // space-only on ground
  });

  it('canEquip accepts a module into its free typed slot', () => {
    expect(canEquip('cruiser', cruiser, [], 'targeting', data)).toEqual({ ok: true });
  });

  it('rejects a full slot, a duplicate, a wrong-type/allow, and an unknown module', () => {
    // weapon capacity is 1 — a second weapon module has nowhere to go.
    expect(canEquip('cruiser', cruiser, ['targeting'], 'targeting2', data)).toEqual({
      ok: false,
      code: 'E_NO_SLOT',
    });
    expect(canEquip('cruiser', cruiser, ['targeting'], 'targeting', data)).toEqual({
      ok: false,
      code: 'E_DUP_MODULE',
    });
    expect(canEquip('tank', tank, [], 'cargo', data)).toEqual({ ok: false, code: 'E_NOT_ALLOWED' });
    expect(canEquip('cruiser', cruiser, [], 'ghost', data)).toEqual({
      ok: false,
      code: 'E_UNKNOWN_MODULE',
    });
  });

  it('sums the resource cost of a loadout', () => {
    expect(loadoutCost(['targeting', 'cargo'], data)).toEqual({ metal: 105 });
    expect(loadoutCost([], data)).toEqual({});
  });
});

describe('validateLoadout — the whole-loadout gate the build action uses', () => {
  it('accepts a legal loadout and reports the first illegal module', () => {
    expect(validateLoadout('cruiser', cruiser, ['targeting', 'plating', 'cargo'], data)).toEqual({
      ok: true,
    });
    expect(validateLoadout('cruiser', cruiser, ['targeting', 'targeting2'], data)).toEqual({
      ok: false,
      code: 'E_NO_SLOT', // second weapon module, only one weapon slot
    });
    expect(validateLoadout('cruiser', cruiser, ['ghost'], data)).toEqual({
      ok: false,
      code: 'E_UNKNOWN_MODULE',
    });
  });
});

// Универсальные отсеки (решение владельца 2026-09-26, усиленный крейсер: «4 слота под
// модули любые»): модуль любого типа, но только когда отсеки его типа заняты. Гейт
// верфи и раскладка экранов считают одинаково — иначе экран нарисовал бы одно, а ядро
// приняло бы другое.
describe('universal bays — any module type, typed bays first', () => {
  const reinforced = data.units.reinforced!;
  const hybrid = data.units.hybrid!;

  it('a universal bay takes a module of any type; the budget is bounded', () => {
    expect(validateLoadout('reinforced', reinforced, ['targeting', 'plating'], data)).toEqual({ ok: true });
    expect(validateLoadout('reinforced', reinforced, ['plating', 'cargo'], data)).toEqual({ ok: true });
    expect(validateLoadout('reinforced', reinforced, ['targeting', 'targeting2'], data)).toEqual({ ok: true });
    expect(canEquip('reinforced', reinforced, ['targeting', 'plating'], 'cargo', data)).toEqual({
      ok: false,
      code: 'E_NO_SLOT',
    });
  });

  it('a module fills its typed bay first, so the universal bay is left for an overflow', () => {
    // targeting → the weapon bay whichever order it comes in; plating → the universal one.
    expect(validateLoadout('hybrid', hybrid, ['targeting', 'plating'], data)).toEqual({ ok: true });
    expect(validateLoadout('hybrid', hybrid, ['plating', 'targeting'], data)).toEqual({ ok: true });
    expect(canEquip('hybrid', hybrid, ['plating', 'targeting'], 'targeting2', data)).toEqual({
      ok: false,
      code: 'E_NO_SLOT',
    });
    expect(validateLoadout('hybrid', hybrid, ['targeting', 'targeting2'], data)).toEqual({ ok: true });
  });

  it('the module’s own allow rule still decides in a universal bay', () => {
    const ground = { ...tank, slots: { weapon: 0, defense: 0, utility: 0, universal: 2 } };
    expect(canEquip('tank', ground, [], 'cargo', data)).toEqual({ ok: false, code: 'E_NOT_ALLOWED' });
  });

  it('loadoutBays: typed bays, then universal ones holding the overflow', () => {
    expect(loadoutBays(hybrid.slots, ['plating', 'targeting'], data)).toEqual([
      { type: 'weapon', module: 'targeting' },
      { type: 'universal', module: 'plating' },
    ]);
    expect(loadoutBays(reinforced.slots, ['plating'], data)).toEqual([
      { type: 'universal', module: 'plating' },
      { type: 'universal', module: null },
    ]);
  });

  it('loadoutBays does not depend on the install order', () => {
    const a = loadoutBays(reinforced.slots, ['plating', 'targeting'], data);
    const b = loadoutBays(reinforced.slots, ['targeting', 'plating'], data);
    expect(a).toEqual(b);
    expect(a.map((bay) => bay.module)).toEqual(['targeting', 'plating']); // weapon, then defense
  });

  it('loadoutBays keeps a module over capacity as an extra bay, never drops it', () => {
    expect(loadoutBays(hybrid.slots, ['targeting', 'targeting2', 'plating'], data)).toEqual([
      { type: 'weapon', module: 'targeting' },
      { type: 'universal', module: 'targeting2' },
      { type: 'defense', module: 'plating', extra: true },
    ]);
    expect(loadoutBays(cruiser.slots, ['ghost'], data).every((bay) => bay.module === null)).toBe(true);
  });

  it('a ship star adds a typed slot and keeps the universal ones (withBonusSlots)', () => {
    const starred = withBonusSlots(reinforced, { weapon: 1 });
    expect(starred.slots).toEqual({ weapon: 1, defense: 0, utility: 0, universal: 2 });
    // targeting → the star's weapon slot; targeting2 and plating → the two universal bays.
    expect(validateLoadout('reinforced', starred, ['targeting', 'targeting2', 'plating'], data)).toEqual({ ok: true });
  });

  it('a hull without the field has no universal bays — old hulls answer as before', () => {
    expect(cruiser.slots.universal).toBeUndefined();
    expect(canEquip('cruiser', cruiser, ['targeting'], 'targeting2', data)).toEqual({
      ok: false,
      code: 'E_NO_SLOT',
    });
  });
});

describe('sumUnitStat reflects installed modules (MOD-4 routing)', () => {
  it('adds module deltas ×count; bare stacks are unchanged', () => {
    expect(sumUnitStat([{ unit: 'cruiser', count: 2 }], data, 'cargoCapacity')).toBe(4); // 2 × base 2
    expect(sumUnitStat([{ unit: 'cruiser', count: 2, modules: ['cargo'] }], data, 'cargoCapacity')).toBe(16); // 2 × (2 + 6)
    expect(sumUnitStat([{ unit: 'cruiser', count: 1, modules: ['targeting'] }], data, 'attack')).toBe(14); // 10 + 4
  });
});

describe('loadout-aware stack identity (addUnits merge)', () => {
  it('merges same unit + same loadout, keeps different loadouts apart', () => {
    const stacks: UnitStack[] = [];
    addUnits(stacks, 'cruiser', 1, ['targeting']);
    addUnits(stacks, 'cruiser', 2, ['targeting']); // same loadout → merges to 3
    addUnits(stacks, 'cruiser', 1, ['cargo']); // different loadout → separate
    addUnits(stacks, 'cruiser', 1); // bare hull → separate
    expect(stacks).toHaveLength(3);
    expect(stacks.find((s) => s.modules?.includes('targeting'))?.count).toBe(3);
    expect(stacks.find((s) => s.modules?.includes('cargo'))?.count).toBe(1);
    expect(stacks.find((s) => s.modules === undefined)?.count).toBe(1);
  });

  it('treats loadout as a set — order does not split a stack', () => {
    const stacks: UnitStack[] = [];
    addUnits(stacks, 'cruiser', 1, ['targeting', 'cargo']);
    addUnits(stacks, 'cruiser', 1, ['cargo', 'targeting']); // same set, different order → merges
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.count).toBe(2);
  });
});

// HPR-1.5.1 — the hero's ship is a hull like any other. Until now the `hero` unit
// carried no `slots`, so every module bounced off it (`E_NO_SLOT`) and the hero's
// hardware lived in a SECOND system (`heroFittings` + the never-wired `statMods`).
// Giving the hull typed bays makes the live seam — `effectiveStats`, read by combat,
// artillery, construction and forced march — the only one. These assertions run
// against the REAL `data/*.json`, not a fixture: the point is that the shipped
// catalog works, not that the engine could.
describe('HPR-1.5.1 — the shipped hero hull takes ordinary ship modules', () => {
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
  const shipped: GameData = loadGameData(
    (name: string): unknown => JSON.parse(readFileSync(path.join(dataDir, name), 'utf8')),
  );
  const heroDef = shipped.units.hero!;

  it('offers one bay of each category', () => {
    expect(heroDef.slots).toEqual({ weapon: 1, defense: 1, utility: 1 });
    expect(loadoutBays(heroDef.slots, [], shipped).map((b) => b.type)).toEqual(['weapon', 'defense', 'utility']);
  });

  it('accepts a space module into each bay', () => {
    for (const id of ['targeting_array', 'ablative_plating', 'ion_engine'])
      expect(canEquip('hero', heroDef, [], id, shipped)).toEqual({ ok: true });
  });

  it('installed modules change the stats combat reads', () => {
    const base = effectiveStats(heroDef, {}, shipped);
    const fitted = effectiveStats(
      heroDef,
      { modules: ['targeting_array', 'ablative_plating', 'ion_engine'] },
      shipped,
    );
    expect(fitted.attack).toBe((base.attack ?? 0) + 4);
    expect(fitted.hp).toBe((base.hp ?? 0) + 12);
    expect(fitted.speed).toBe((base.speed ?? 0) + 2);
    // The combat/artillery path (`sumUnitStat`) sees the same numbers — a fitted
    // hero stack is genuinely stronger, not merely annotated.
    const stack: UnitStack = { unit: 'hero', count: 1, modules: ['targeting_array'] };
    expect(sumUnitStat([stack], shipped, 'attack')).toBe((base.attack ?? 0) + 4);
  });

  it('the bays are BOUNDED and still honour a module’s own allow rule', () => {
    // A second module of an occupied category has nowhere to go…
    expect(canEquip('hero', heroDef, ['ablative_plating'], 'shield_booster', shipped)).toEqual({
      ok: false,
      code: 'E_NO_SLOT',
    });
    // …and a hull-locked module stays locked: bays did not make the hero universal.
    expect(canEquip('hero', heroDef, [], 'radar_module', shipped)).toEqual({
      ok: false,
      code: 'E_NOT_ALLOWED',
    });
  });
});

describe('SZE-1.1 — звёздность модуля усиливает его вклад', () => {
  // Лестница живёт в `data.sectorZeroStars` (SZE-0.2); `bonus` — доля БАЗОВОГО вклада
  // модуля, которую добавляет ступень. Ноль звёзд обязан давать прежние числа
  // байт-в-байт, иначе звёздность молча пересчитала бы весь основной режим.
  const starred: GameData = parseGameData({
    version: '0.1.0',
    resources: ['metal'],
    units: {
      cruiser: {
        faction: 'x',
        stats: { attack: 10, defense: 0, speed: 1, hp: 10, cargoCapacity: 2 },
        slots: { weapon: 1, utility: 1 },
      },
    },
    factions: {},
    buildings: {},
    events: {},
    modules: {
      targeting: { name: 'T', slot: 'weapon', tag: 'vertical', effects: { stats: { attack: 4 } }, cost: {} },
      cargo: { name: 'C', slot: 'utility', tag: 'horizontal', effects: { stats: { cargoCapacity: 6 } }, cost: {} },
    },
    sectorZeroStars: {
      cap: 3,
      guaranteed: 1,
      steps: [
        { chance: 1, warrants: 10, bonus: 0.25 },
        { chance: 0.5, warrants: 20, bonus: 0.5 },
        { chance: 0.25, warrants: 40, bonus: 1 },
      ],
    },
  });
  const hull = starred.units.cruiser!;

  it('ноль звёзд = прежние числа, байт-в-байт', () => {
    expect(effectiveStats(hull, { modules: ['targeting'] }, starred).attack).toBe(14);
    expect(
      effectiveStats(hull, { modules: ['targeting'], moduleStars: { targeting: 0 } }, starred).attack,
    ).toBe(14);
  });

  it('звезда множит ВКЛАД МОДУЛЯ, а не характеристику корпуса', () => {
    // 10 базы корпуса не трогаем: 4 × (1 + 0.25) = 5 → 15. Иначе звезда модуля
    // усиливала бы и голый корпус, то есть корабль без модулей.
    expect(
      effectiveStats(hull, { modules: ['targeting'], moduleStars: { targeting: 1 } }, starred).attack,
    ).toBe(15);
    // ★3 = 1 + 0.25 + 0.5 + 1 → 4 × 2.75 = 11 → 21
    expect(
      effectiveStats(hull, { modules: ['targeting'], moduleStars: { targeting: 3 } }, starred).attack,
    ).toBe(21);
  });

  it('трюм — целые места на ЛЮБОЙ звезде: округляется итог корпуса (владелец 2026-09-24)', () => {
    // 2 + 6 × 1,25 = 9,5 → 10; ★2: 2 + 6 × 1,75 = 12,5 → 13; ★3: 2 + 6 × 2,75 = 18,5 → 19.
    const hold = (star: number): number | undefined =>
      effectiveStats(hull, { modules: ['cargo'], moduleStars: { cargo: star } }, starred).cargoCapacity;
    expect([0, 1, 2, 3].map(hold)).toEqual([8, 10, 13, 19]);
    for (const star of [0, 1, 2, 3]) expect(Number.isInteger(hold(star))).toBe(true);
    // Урон — не места: он остаётся дробным, как был.
    expect(
      effectiveStats(hull, { modules: ['targeting'], moduleStars: { targeting: 1 } }, starred).attack,
    ).toBe(15);
  });

  it('звёзды выше лестницы не растут дальше последней ступени', () => {
    const top = effectiveStats(hull, { modules: ['targeting'], moduleStars: { targeting: 3 } }, starred).attack;
    expect(
      effectiveStats(hull, { modules: ['targeting'], moduleStars: { targeting: 99 } }, starred).attack,
    ).toBe(top);
  });

  it('звезда НЕ НАДЕТОГО модуля ни на что не влияет', () => {
    expect(
      effectiveStats(hull, { modules: [], moduleStars: { targeting: 3 } }, starred).attack,
    ).toBe(10);
  });

  it('пустая лестница (основной режим) обнуляет ось целиком', () => {
    // `data.sectorZeroStars` по умолчанию пуст — значит звёздность выключается ДАННЫМИ,
    // без флага в коде, ровно как медали и мастерская.
    expect(
      effectiveStats(cruiser, { modules: ['targeting'], moduleStars: { targeting: 5 } }, data).attack,
    ).toBe(14);
  });
});

describe('SZE-5.1 — редкость модуля даёт новый параметр, звезда его усиливает', () => {
  // Решение владельца 2026-09-24: «редкость даёт дополнительный параметр, звёздность
  // усиливает параметры». Прибавки ступеней складываются и множатся той же звездой.
  const rare: GameData = parseGameData({
    version: '0.1.0',
    resources: ['metal'],
    units: { cruiser: { faction: 'x', stats: { attack: 10, defense: 0, speed: 5, hp: 10 }, slots: { utility: 1 } } },
    factions: {},
    buildings: {},
    events: {},
    modules: {
      radar: {
        name: 'R',
        slot: 'utility',
        tag: 'horizontal',
        rarity: 'simple',
        rarityBonus: { unique: { speed: 2 }, mythic: { defense: 4 }, legendary: { hp: 10 } },
        effects: { stats: { radarRange: 100 } },
        cost: {},
      },
    },
    sectorZeroStars: { cap: 1, guaranteed: 1, steps: [{ chance: 1, warrants: 10, bonus: 0.5 }] },
  });
  const hull = rare.units.cruiser!;
  const radar = rare.modules.radar!;

  it('без поднятой редкости — прежние числа байт-в-байт', () => {
    const s = effectiveStats(hull, { modules: ['radar'] }, rare);
    expect([s.speed, s.defense, s.radarRange]).toEqual([5, 0, 100]);
  });

  it('прибавки ступеней складываются: мифический несёт и уникальную', () => {
    expect(moduleRarityBonus(radar, 'unique')).toEqual({ speed: 2 });
    expect(moduleRarityBonus(radar, 'mythic')).toEqual({ speed: 2, defense: 4 });
    const s = effectiveStats(hull, { modules: ['radar'], moduleRarity: { radar: 'mythic' } }, rare);
    expect([s.speed, s.defense, s.hp]).toEqual([7, 4, 10]);
  });

  it('звезда множит и базовый параметр, и параметры редкости', () => {
    const s = effectiveStats(
      hull,
      { modules: ['radar'], moduleStars: { radar: 1 }, moduleRarity: { radar: 'unique' } },
      rare,
    );
    expect(s.radarRange).toBe(150); // 100 × 1.5
    expect(s.speed).toBe(8); // 5 + 2 × 1.5
  });

  it('ступень не выше базовой, чужая ступень и снятый модуль прибавки не дают', () => {
    expect(moduleRarityBonus(radar, 'simple')).toEqual({});
    expect(moduleRarityBonus(radar, 'cosmic')).toEqual({});
    expect(effectiveStats(hull, { modules: [], moduleRarity: { radar: 'legendary' } }, rare).hp).toBe(10);
  });

  it('поднятая редкость доезжает до стека вместе с лоадаутом и не заводится зря', () => {
    const stacks: UnitStack[] = [];
    addUnits(stacks, 'cruiser', 2, ['radar'], undefined, { radar: 'mythic', other: 'legendary' });
    expect(stacks[0]!.moduleRarity).toEqual({ radar: 'mythic' });
    const bare: UnitStack[] = [];
    addUnits(bare, 'cruiser', 1, [], undefined, { radar: 'mythic' });
    expect(bare[0]!.moduleRarity).toBeUndefined();
  });

  it('схема отклоняет прибавку на ступени не выше базовой и правку слотов', () => {
    const mod = (extra: Record<string, unknown>) =>
      parseGameData({
        version: '0.1.0',
        resources: ['metal'],
        units: {},
        factions: {},
        buildings: {},
        events: {},
        modules: { m: { name: 'M', slot: 'utility', tag: 'horizontal', cost: {}, ...extra } },
      });
    expect(() => mod({ rarity: 'unique', rarityBonus: { unique: { hp: 1 } } })).toThrow();
    expect(() => mod({ rarityBonus: { unique: { utilitySlots: 1 } } })).toThrow();
    expect(() => mod({ rarityBonus: { unique: { hp: 1 } } })).not.toThrow();
  });
});
