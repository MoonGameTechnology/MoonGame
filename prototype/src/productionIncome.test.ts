import { describe, expect, it } from 'vitest';
import { newGame } from './game';
import { netIncome } from './economy';
import { productionIncomeCard, productionIncomeDetails, productionIncomeHtml } from './productionIncome';
import { t } from '../../localization/runtime';

describe('planet production readout', () => {
  it('uses the HUD calculation and collects only this planet’s actual upkeep', () => {
    const state = newGame();
    const world = Object.values(state.planets).find(p => p.owner === 'p1')!;
    world.garrison = [{ unit: 'militia', count: 3 }];
    const before = structuredClone(state);
    const expected = netIncome(state, 'p1', undefined, world.id);
    const details = productionIncomeDetails(state, 'p1', world.id)!;
    expect(details.net).toEqual(expected);
    expect(Object.values(details.upkeep).some(n => n > 0)).toBe(true);
    expect(state).toEqual(before);
    expect(productionIncomeHtml(state, 'p1', world.id)).toContain(`data-pw-income="${world.id}"`);
    expect(productionIncomeCard(state, 'p1', world.id)).toContain('pw-income-table');
  });

  it('refuses foreign and absent planets', () => {
    const state = newGame();
    const other = Object.values(state.planets).find(p => p.owner === 'p2')!;
    expect(productionIncomeDetails(state, 'p1', other.id)).toBeNull();
    expect(productionIncomeDetails(state, 'p1', 'missing')).toBeNull();
    expect(productionIncomeHtml(state, 'p1', other.id)).toBe('');
    expect(productionIncomeCard(state, 'p1', other.id)).toContain(t('production.income-unavailable'));
  });
});
