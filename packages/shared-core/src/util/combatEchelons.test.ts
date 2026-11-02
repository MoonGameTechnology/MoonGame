import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import type { UnitStack } from '../state/gameState';
import { damageByClass, damageUnits } from './combat';
import { targetedVolley } from './groundTargets';
import { cappedUnitBreakdown, cappedUnitStat } from './stacks';

const data = parseGameData({
  version: 'test',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    front: { faction: 'x', line: 'front', stats: { speed: 1, hp: 100, attack: 10, defense: 10 } },
    mid: { faction: 'x', line: 'mid', stats: { defense: 0, speed: 1, hp: 100, attack: 10 } },
    rear: { faction: 'x', line: 'rear', stats: { defense: 0, speed: 1, hp: 100, attack: 10 } },
    infantry: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      line: 'front',
      stats: { defense: 0, speed: 1, hp: 100, attack: 10 },
    },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      line: 'front',
      stats: {
        defense: 0,
        speed: 1,
        hp: 100,
        attack: 20,
        attackVsInfantry: 100,
        attackVsVehicle: 20,
      },
    },
    support: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      line: 'rear',
      stats: { defense: 0, speed: 1, hp: 100, attack: 5 },
    },
  },
});

describe('echelons, hull health and soft efficiency limits', () => {
  it('240 is 120/72/48 and each of three front-line units receives 40', () => {
    const units: UnitStack[] = [
      { unit: 'front', count: 2 },
      { unit: 'front', count: 1, battles: 4 },
      { unit: 'mid', count: 1 },
      { unit: 'rear', count: 1 },
    ];
    damageUnits(units, 240, data);
    expect(units.map((s) => s.hp)).toEqual([120, 60, 28, 52]);
  });

  it('class potency follows equal shares INSIDE the complete formation', () => {
    // Front 65%: two infantry and one tank; rear 35%: one vehicle.
    const targets: UnitStack[] = [
      { unit: 'infantry', count: 2 },
      { unit: 'tank', count: 1 },
      { unit: 'support', count: 1 },
    ];
    const shot = targetedVolley([{ unit: 'tank', count: 1 }], targets, data, 'attack');
    damageByClass(targets, shot.pools, data);
    expect(targets[0]!.hp).toBeCloseTo(200 - (100 * 0.65 * 2) / 3, 10);
    expect(targets[1]!.hp).toBeCloseTo(100 - (20 * 0.65) / 3, 10);
    expect(targets[2]!.hp).toBeCloseTo(100 - 20 * 0.35, 10);
  });

  it('does not preserve floating-point ghost survivors after exact lethal damage', () => {
    const units: UnitStack[] = [
      { unit: 'front', count: 1, hp: 60 },
      { unit: 'mid', count: 1, hp: 12 },
      { unit: 'rear', count: 4, hp: 96 },
    ];
    expect(damageUnits(units, 168, data).survivors).toEqual([]);
  });

  it('all 25 ground units fire at 80%; 60% hull means 48% strength per unit', () => {
    const units: UnitStack[] = [{ unit: 'infantry', count: 25, hp: 1500 }];
    const rows = cappedUnitBreakdown(units, data, 'attack');
    expect(rows[0]!.firing).toBe(25);
    expect(rows[0]!.powerScale).toBeCloseTo(0.48, 12);
    expect(rows[0]!.damage).toBeCloseTo(120, 12);
  });

  it('20 ships at 60% hull use 50% efficiency; shields do not change firepower', () => {
    const units = [{ unit: 'front', count: 20, hp: 1200, shieldHp: 10000 }];
    expect(cappedUnitStat(units, data, 'attack')).toBe(60);
    expect(cappedUnitStat([{ ...units[0]!, shieldHp: 0 }], data, 'defense')).toBe(60);
  });

  it('a weak hull still fires in a mixed over-limit force', () => {
    const rows = cappedUnitBreakdown(
      [
        { unit: 'tank', count: 20 },
        { unit: 'support', count: 5 },
      ],
      data,
      'attack',
    );
    expect(rows.map((r) => r.firing)).toEqual([20, 5]);
    expect(rows.reduce((n, r) => n + r.damage, 0)).toBe((20 * 20 + 5 * 5) * 0.8);
  });
});
