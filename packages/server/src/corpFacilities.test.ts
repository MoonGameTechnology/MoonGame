import { describe, expect, it } from 'vitest';
import { corpFacilities, validateShowcase } from './corpFacilities';
import type { CorpInfrastructureState } from '@void/protocol';

const state = (levels: Record<string, number>): CorpInfrastructureState => ({ levels, construction: null, accruedAt: 0, remainder: 0 });
describe('corporation facilities', () => {
  it('uses completed levels and never grants the next level early', () => {
    expect(corpFacilities(null, 0)).toEqual({ warehouseItems: 0, showcaseSlots: 0, monument: false });
    expect(corpFacilities(state({ warehouse: 1, hall_of_fame: 2, monument: 1 }), 0)).toEqual({ warehouseItems: 2, showcaseSlots: 10, monument: true });
    const building = { ...state({ warehouse: 1 }), construction: { buildingId: 'warehouse', level: 2, startedAt: 0, completesAt: 100, cost: 300 } };
    expect(corpFacilities(building, 99).warehouseItems).toBe(2);
    expect(corpFacilities(building, 100).warehouseItems).toBe(4);
  });
  it('only pins distinct corporation-earned medals within hall capacity', () => {
    expect(validateShowcase(['ava_first_victory'], 0, { wins: 10, matches: 20 })).toBe('E_CORP_HALL_REQUIRED');
    expect(validateShowcase(['ava_first_victory'], 5, { wins: 0, matches: 20 })).toBe('E_CORP_MEDAL_NOT_EARNED');
    expect(validateShowcase(['ava_first_victory', 'ava_first_victory'], 5, { wins: 10, matches: 20 })).toBe('E_BAD_SHOWCASE');
    expect(validateShowcase(['invented'], 5, { wins: 10, matches: 20 })).toBe('E_CORP_MEDAL_NOT_EARNED');
    expect(validateShowcase(['ava_first_victory', 'ava_veteran_10'], 5, { wins: 1, matches: 10 })).toBe(null);
  });
});
