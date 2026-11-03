/**
 * МАСКИРОВОЧНОЕ ПОЛЕ (SM-4.3, выбор владельца 2026-11-03): легендарный модуль, только
 * флагман героя. По шипнутым данным: встаёт лишь на корабль героя, легендарное сразу, на
 * ★6 сжимает чужой радиус ровно вдвое, и бот его не ставит (сторож — `aiHero.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { canEquip, fleetCloakRating } from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();

describe('маскировочное поле', () => {
  it('встаёт только на корабль героя, в системный отсек, легендарное сразу', () => {
    const fits = Object.keys(data.units).filter(
      (u) => canEquip(u, data.units[u]!, [], 'cloak_field', data).ok,
    );
    expect(fits).toEqual(['hero']);
    expect(data.modules.cloak_field).toMatchObject({ slot: 'utility', rarity: 'legendary' });
  });

  it('−20% без звёзд, −32% на ★6', () => {
    const fleet = (stars: number) => ({
      units: [{ unit: 'hero', count: 1, modules: ['cloak_field'], moduleStars: { cloak_field: stars } }],
    });
    expect(fleetCloakRating(fleet(0), data)).toBeCloseTo(0.2, 9);
    expect(fleetCloakRating(fleet(6), data)).toBeCloseTo(0.32, 9);
  });
});
