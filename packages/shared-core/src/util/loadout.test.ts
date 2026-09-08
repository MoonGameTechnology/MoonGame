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
  hullSlotTypes,
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

  it('hullSlotTypes lists only categories the hull offers', () => {
    expect(hullSlotTypes(cruiser)).toEqual(['weapon', 'defense', 'utility']);
    expect(hullSlotTypes(tank)).toEqual([]); // no slots
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
    expect(hullSlotTypes(heroDef)).toEqual(['weapon', 'defense', 'utility']);
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
