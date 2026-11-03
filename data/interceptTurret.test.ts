/**
 * ПЕРЕХВАТНАЯ ТУРЕЛЬ (SM-4.2, выбор владельца 2026-11-03): оружейный модуль перехватчика,
 * +5 урона по авиации (`shuttleDamage`). У перехватчика один оружейный отсек, и до турели
 * туда вставала лишь система наведения, которая перехватчику почти ничего не давала.
 *
 * Сторожим по шипнутым данным: модуль встаёт только на перехватчик, его прибавку видит тот
 * же `effectiveStats`, которым вылет считает огонь по чужому вылету и ракете, а звёзды и
 * редкость множат её как у любого модуля.
 */
import { describe, expect, it } from 'vitest';
import { canEquip, cappedUnitStat, effectiveStats } from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const interceptor = data.units.interceptor!;
const fits = (unit: string): boolean => canEquip(unit, data.units[unit]!, [], 'intercept_turret', data).ok;

describe('перехватная турель', () => {
  it('встаёт только на перехватчик', () => {
    expect(Object.keys(data.units).filter(fits)).toEqual(['interceptor']);
    expect(data.modules.intercept_turret!.slot).toBe('weapon');
  });

  it('даёт перехватчику +5 урона по авиации и не трогает удар по кораблям', () => {
    const bare = effectiveStats(interceptor, {}, data);
    const armed = effectiveStats(interceptor, { modules: ['intercept_turret'] }, data);
    expect(armed.shuttleDamage).toBe(bare.shuttleDamage! + 5);
    expect(armed.attack).toBe(bare.attack);
  });

  it('звено с турелью бьёт воздушную цель сильнее тем же счётом, что и вылет', () => {
    const plain = cappedUnitStat([{ unit: 'interceptor', count: 4 }], data, 'shuttleDamage');
    const armed = cappedUnitStat(
      [{ unit: 'interceptor', count: 4, modules: ['intercept_turret'] }],
      data,
      'shuttleDamage',
    );
    expect(armed).toBeGreaterThan(plain);
  });

  it('легендарная ★6 упирается в +10,4: звезда множит и базу, и строку редкости', () => {
    const top = effectiveStats(
      interceptor,
      { modules: ['intercept_turret'], moduleStars: { intercept_turret: 6 }, moduleRarity: { intercept_turret: 'legendary' } },
      data,
    );
    expect(top.shuttleDamage! - interceptor.stats.shuttleDamage!).toBeCloseTo(10.4, 6);
  });
});
