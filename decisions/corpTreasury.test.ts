import { describe, expect, it } from 'vitest';
import { updateCorpInfrastructure } from '../packages/server/src/corpConstruction';
import { corpIncomeParts, corpLedger } from './corpTreasury';

const income = (at: number, n: number) => ({ at, action: 'building_income', detail: String(n) });

describe('казна корпорации (CORP-3)', () => {
  it('в движении влияния — доход, оплата стройки и влияние битв; прочее журнала — нет', () => {
    expect(
      corpLedger([
        { at: 9, action: 'influence', detail: '+150: победа m1' },
        { at: 8, action: 'building_complete', target: 'supply_center', detail: '1' },
        { at: 7, action: 'accept', target: 'acc-2' },
        { at: 6, action: 'building_start', target: 'supply_center', detail: '{"level":1,"cost":60}' },
        { at: 5, action: 'rent', target: 'acc-3', detail: 'item-1' },
        { at: 4, action: 'influence', detail: '-100: вызов c2' },
      ]),
    ).toEqual([
      { kind: 'battle', at: 9, delta: 150 },
      { kind: 'build', at: 6, delta: -60, buildingId: 'supply_center', level: 1 },
      { kind: 'battle', at: 4, delta: -100 },
    ]);
  });

  it('доход зданий подряд — одной строкой со временем самой свежей доли', () => {
    expect(
      corpLedger([
        income(30, 2),
        { at: 25, action: 'role', target: 'acc-2', detail: 'officer' },
        income(20, 1),
        { at: 15, action: 'building_start', target: 'headquarters', detail: '{"level":2,"cost":120}' },
        income(10, 3),
        income(5, 4),
      ]),
    ).toEqual([
      { kind: 'income', at: 30, delta: 3 },
      { kind: 'build', at: 15, delta: -120, buildingId: 'headquarters', level: 2 },
      { kind: 'income', at: 10, delta: 7 },
    ]);
  });

  it('запись без понятной суммы и бесплатная стройка выпадают', () => {
    expect(
      corpLedger([
        { at: 6, action: 'influence', detail: 'возврат' },
        { at: 5, action: 'influence' },
        { at: 4, action: 'building_income', detail: 'много' },
        { at: 3, action: 'building_income', detail: '0' },
        { at: 2, action: 'building_start', target: 'headquarters', detail: '{"level":1,"cost":0}' },
        { at: 1, action: 'building_start', target: 'headquarters', detail: 'не json' },
        { at: 0, action: 'building_start', detail: '{"level":2,"cost":120}' },
      ]),
    ).toEqual([]);
  });

  it('доход в сутки — по зданиям текущих уровней', () => {
    const result = updateCorpInfrastructure(
      'c',
      'a',
      'head',
      0,
      {
        levels: { headquarters: 2, supply_center: 1, engineering_complex: 1 },
        construction: null,
        accruedAt: 0,
        remainder: 0,
      },
      0,
    ).result;
    if (!result.ok) throw new Error(result.code);
    expect(corpIncomeParts(result.infrastructure)).toEqual([
      { buildingId: 'headquarters', nameKey: 'corp.building.headquarters', perDay: 48 },
      { buildingId: 'supply_center', nameKey: 'corp.building.supply-center', perDay: 48 },
    ]);
    expect(result.infrastructure.influencePerDay).toBe(96);
  });
});
