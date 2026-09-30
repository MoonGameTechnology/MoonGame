/**
 * КТО НЕСЁТ МИНЫ (решение владельца 2026-09-29): «ракетную мину можно установить только на
 * корабль героя», «модуль мин обычных — только у фрегатов».
 *
 * Правило держит `allowed.units` модуля — то же, что проверяют верфь, приказ `unit.build`,
 * снаряжение корабля героя и подготовка Sector Zero (`moduleAllowed`/`canEquip`). У
 * фрегатов нет оружейного отсека, поэтому обычная мина переехала в системный (`utility`):
 * иначе правило «только фрегаты» значило бы «никто».
 *
 * Сторожим по шипнутым данным: универсальные отсеки усиленного крейсера тоже не обходят
 * правило модуля.
 */
import { describe, expect, it } from 'vitest';
import { canEquip } from '../packages/shared-core/src/index';
import { sectorModuleIds } from '../decisions/sectorZeroProgress';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const fits = (unit: string, module: string): boolean =>
  canEquip(unit, data.units[unit]!, [], module, data).ok;
const spaceHulls = Object.keys(data.units).filter((id) => data.units[id]!.domain === 'space');

describe('ракетная мина — только корабль героя', () => {
  it('встаёт на корабль героя и ни на один другой корпус, даже в универсальный отсек', () => {
    expect(fits('hero', 'rocket_mine_layer')).toBe(true);
    expect(spaceHulls.filter((u) => fits(u, 'rocket_mine_layer'))).toEqual(['hero']);
  });

  it('подготовка Sector Zero её показывает: корабль героя — корпус игрока', () => {
    expect(sectorModuleIds(data)).toContain('rocket_mine_layer');
  });
});

describe('обычная мина — только фрегаты', () => {
  it('встаёт на каждый фрегат и ни на что больше', () => {
    const carriers = spaceHulls.filter((u) => fits(u, 'mine_layer')).sort();
    expect(carriers).toEqual(['frigate', 'picket_frigate', 'pirate_frigate']);
  });

  it('занимает системный отсек: оружейного у фрегатов нет', () => {
    expect(data.modules.mine_layer?.slot).toBe('utility');
    expect(data.units.frigate?.slots.weapon ?? 0).toBe(0);
  });
});
