/**
 * Property tests for the stack and treasury arithmetic that every fleet order, split,
 * merge, purchase and volley runs through. Example tests pin single cases; these state
 * the conservation laws over the whole input domain and let fast-check hunt for the
 * counterexample:
 *
 * - split (`takeFromStacks`) and merge (`mergeStacks`) move ships and hull, never mint
 *   or destroy them;
 * - merit averaging on merge keeps the weighted total (`damageDealt × count`);
 * - paying and refunding the same bag is a roundtrip, and an affordable purchase never
 *   drives a line negative;
 * - a volley split between enemies sums to the volley;
 * - damage only ever removes hull and ships, every death is reported, and a volley
 *   larger than the whole side wipes it.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseGameData, type ResourceBag } from '../data/schemas';
import type { UnitStack } from '../state/unitStack';
import { damageEvenly, damageUnits, stackHull } from './combat';
import { mergeStacks, takeFromStacks } from './stacks';
import { canAfford, payCost, refundCost } from './treasury';
import { splitVolley } from './volley';

const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 20, defense: 12, speed: 5, hp: 40 }, line: 'front' },
    escort: {
      faction: 'x',
      stats: { attack: 8, defense: 6, speed: 6, hp: 25, shield: 10 },
      line: 'mid',
    },
    tender: { faction: 'x', stats: { attack: 2, defense: 4, speed: 4, hp: 60 }, line: 'rear' },
  },
  factions: {},
  buildings: {},
  events: {},
});
const UNITS = ['cruiser', 'escort', 'tender'] as const;
const PER_SHIP: Record<string, { hp: number; shield: number }> = {
  cruiser: { hp: 40, shield: 0 },
  escort: { hp: 25, shield: 10 },
  tender: { hp: 60, shield: 0 },
};

/** A stack as play can leave it: full health, or damaged (pools strictly inside
 *  `(0, count × perShip]`), with optional merit. Count ≥ 1: an emptied stack is
 *  filtered out of every fleet by the code that empties it. */
const arbStack: fc.Arbitrary<UnitStack> = fc
  .record({
    unit: fc.constantFrom(...UNITS),
    count: fc.integer({ min: 1, max: 40 }),
    hullFrac: fc.option(fc.double({ min: 0.01, max: 1, noNaN: true }), { nil: undefined }),
    shieldFrac: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    damageDealt: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), { nil: undefined }),
  })
  .map(({ unit, count, hullFrac, shieldFrac, damageDealt }) => {
    const s: UnitStack = { unit, count };
    const per = PER_SHIP[unit]!;
    if (hullFrac !== undefined)
      s.hp = Math.max(hullFrac * count * per.hp, (count - 1) * per.hp + 0.5);
    if (shieldFrac !== undefined && per.shield > 0) s.shieldHp = shieldFrac * count * per.shield;
    if (damageDealt !== undefined) s.damageDealt = damageDealt;
    return s;
  });
const arbStacks = fc.array(arbStack, { minLength: 0, maxLength: 6 });

const countOf = (stacks: readonly UnitStack[], unit: string): number =>
  stacks.filter((s) => s.unit === unit).reduce((n, s) => n + s.count, 0);
const hullOf = (stacks: readonly UnitStack[]): number =>
  stacks.reduce((n, s) => n + stackHull(s, PER_SHIP[s.unit]!.hp).pool, 0);
const shieldOf = (stacks: readonly UnitStack[]): number =>
  stacks.reduce((n, s) => n + (s.shieldHp ?? s.count * PER_SHIP[s.unit]!.shield), 0);
const meritOf = (stacks: readonly UnitStack[]): number =>
  stacks.reduce((n, s) => n + (s.damageDealt ?? 0) * s.count, 0);
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

describe('split and merge conserve ships, hull and shields', () => {
  it('takeFromStacks moves exactly min(asked, available) ships and splits the pools without loss', () => {
    fc.assert(
      fc.property(
        arbStacks,
        fc.constantFrom(...UNITS),
        fc.integer({ min: 0, max: 120 }),
        (stacks, unit, asked) => {
          const src = structuredClone(stacks);
          const before = { count: countOf(src, unit), hull: hullOf(src), shield: shieldOf(src) };
          const taken = takeFromStacks(src, unit, asked);
          const after = [...src, ...taken];
          expect(countOf(taken, unit)).toBe(Math.min(asked, before.count));
          expect(countOf(after, unit)).toBe(before.count);
          expect(close(hullOf(after), before.hull)).toBe(true);
          expect(close(shieldOf(after), before.shield)).toBe(true);
          for (const s of after) {
            expect(s.count).toBeGreaterThanOrEqual(0);
            if (s.hp !== undefined) expect(Number.isFinite(s.hp) && s.hp >= 0).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('several takes from one source in a row (as fleet.split does) never hand out an empty or NaN stack', () => {
    fc.assert(
      fc.property(
        arbStacks,
        fc.array(
          fc.record({ unit: fc.constantFrom(...UNITS), n: fc.integer({ min: 1, max: 40 }) }),
          { maxLength: 4 },
        ),
        (stacks, takes) => {
          const src = structuredClone(stacks);
          const before = { hull: hullOf(src), counts: UNITS.map((u) => countOf(src, u)) };
          const taken = takes.flatMap(({ unit, n }) => takeFromStacks(src, unit, n));
          for (const s of taken) {
            expect(s.count).toBeGreaterThan(0);
            if (s.hp !== undefined) expect(Number.isFinite(s.hp)).toBe(true);
          }
          UNITS.forEach((u, i) => expect(countOf([...src, ...taken], u)).toBe(before.counts[i]));
          expect(close(hullOf([...src, ...taken]), before.hull)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('mergeStacks keeps every unit count, hull pool, shield pool and merit total, and leaves its inputs alone', () => {
    fc.assert(
      fc.property(arbStacks, arbStacks, (base, add) => {
        const frozen = JSON.stringify([base, add]);
        const merged = mergeStacks(base, add);
        expect(JSON.stringify([base, add])).toBe(frozen);
        for (const u of UNITS) expect(countOf(merged, u)).toBe(countOf(base, u) + countOf(add, u));
        expect(close(hullOf(merged), hullOf(base) + hullOf(add))).toBe(true);
        expect(close(shieldOf(merged), shieldOf(base) + shieldOf(add))).toBe(true);
        expect(close(meritOf(merged), meritOf(base) + meritOf(add))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('splitting a fleet and merging it back restores the same ships and pools', () => {
    fc.assert(
      fc.property(
        arbStacks,
        fc.constantFrom(...UNITS),
        fc.integer({ min: 0, max: 60 }),
        (stacks, unit, asked) => {
          const src = structuredClone(stacks);
          const taken = takeFromStacks(src, unit, asked);
          const back = mergeStacks(
            src.filter((s) => s.count > 0),
            taken,
          );
          for (const u of UNITS) expect(countOf(back, u)).toBe(countOf(stacks, u));
          expect(close(hullOf(back), hullOf(stacks))).toBe(true);
          expect(close(shieldOf(back), shieldOf(stacks))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('treasury', () => {
  const arbBag: fc.Arbitrary<ResourceBag> = fc.dictionary(
    fc.constantFrom('credits', 'metal', 'microelectronics', 'fuel'),
    fc.integer({ min: 0, max: 5000 }),
  );

  it('an affordable purchase never drives a line negative, and refunding it restores the purse', () => {
    fc.assert(
      fc.property(arbBag, arbBag, (purse, cost) => {
        const wallet = { ...purse };
        if (!canAfford(wallet, cost)) {
          expect(Object.keys(cost).some((r) => (wallet[r] ?? 0) < (cost[r] ?? 0))).toBe(true);
          return;
        }
        payCost(wallet, cost);
        for (const v of Object.values(wallet)) expect(v).toBeGreaterThanOrEqual(0);
        refundCost(wallet, cost);
        for (const r of new Set([...Object.keys(purse), ...Object.keys(cost)])) {
          expect(wallet[r] ?? 0).toBe(purse[r] ?? 0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('a NaN line on either side is never affordable', () => {
    fc.assert(
      fc.property(arbBag, fc.constantFrom('credits', 'metal'), fc.boolean(), (bag, res, onCost) => {
        const purse = onCost ? { ...bag } : { ...bag, [res]: Number.NaN };
        const cost = onCost ? { ...bag, [res]: Number.NaN } : { [res]: 1 };
        expect(canAfford(purse, cost)).toBe(false);
      }),
    );
  });
});

describe('volley and damage', () => {
  it('a volley split between enemies sums to the volley; with no enemies nothing is dealt', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.integer({ min: 0, max: 8 }),
        (volley, n) => {
          const enemies = Array.from({ length: n }, (_, i) => ({
            ref: { kind: 'fleet', id: `F${i}` } as never,
            owner: null,
          }));
          const shares = splitVolley(volley, enemies);
          expect(shares).toHaveLength(n);
          const sum = shares.reduce((a, s) => a + s.damage, 0);
          expect(close(sum, n === 0 ? 0 : volley)).toBe(true);
        },
      ),
    );
  });

  for (const [name, damage] of [
    ['damageUnits (echelons)', damageUnits],
    ['damageEvenly (bombardment)', damageEvenly],
  ] as const) {
    it(`${name}: hull and ships only go down, every loss is reported, absorbed damage never exceeds the volley`, () => {
      fc.assert(
        fc.property(
          arbStacks,
          fc.double({ min: 0, max: 20_000, noNaN: true }),
          (stacks, volley) => {
            const units = structuredClone(stacks);
            const before = {
              hull: hullOf(units),
              shield: shieldOf(units),
              counts: UNITS.map((u) => countOf(units, u)),
            };
            const { survivors, deaths } = damage(units, volley, data);
            const absorbed =
              before.hull - hullOf(survivors) + (before.shield - shieldOf(survivors));
            expect(absorbed).toBeGreaterThanOrEqual(-1e-6);
            expect(absorbed).toBeLessThanOrEqual(volley + 1e-6 * Math.max(1, volley));
            UNITS.forEach((u, i) => {
              const lost = deaths.filter((d) => d.unit === u).reduce((n, d) => n + d.count, 0);
              expect(countOf(survivors, u) + lost).toBe(before.counts[i]);
            });
            for (const s of survivors) {
              expect(Number.isInteger(s.count) && s.count > 0).toBe(true);
              expect(s.hp === undefined || (Number.isFinite(s.hp) && s.hp > 0)).toBe(true);
            }
            if (volley > before.hull + before.shield + 1e-6) expect(survivors).toHaveLength(0);
          },
        ),
        { numRuns: 400 },
      );
    });

    it(`${name}: a zero volley changes nothing`, () => {
      fc.assert(
        fc.property(arbStacks, (stacks) => {
          const units = structuredClone(stacks);
          const { survivors, deaths } = damage(units, 0, data);
          expect(deaths).toHaveLength(0);
          expect(survivors).toEqual(stacks);
        }),
      );
    });
  }
});
