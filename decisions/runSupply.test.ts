import { describe, expect, it } from 'vitest';

import { shippedGameData } from '../data/bundle';
import { changeSectorZeroProgress, freshSectorZeroProgress } from './sectorZeroProgress';

const data = shippedGameData();

describe('пакет снабжения забега — оплата профилем (решение владельца 2026-09-24)', () => {
  it('цена — 5 ◆, пакет — 150 кредитов, 150 металла, 100 еды, 50 энергии, три на забег', () => {
    expect(data.sectorZeroShop.runSupply.price).toBe(5);
    expect(data.modes.pve_waves?.pve?.supply).toEqual({
      perRun: 3,
      pack: { credits: 150, metal: 150, food: 100, energy: 50 },
    });
  });

  it('хватает Суверенов — списывает цену, больше ничего не трогает', () => {
    const p = { ...freshSectorZeroProgress(data, 's'), sovereigns: 12 };
    const paid = changeSectorZeroProgress(p, { kind: 'run-supply' }, data);
    expect(paid?.sovereigns).toBe(7);
    expect({ ...paid, sovereigns: 12 }).toEqual(p);
  });

  it('не хватает — отказ, профиль прежний', () => {
    const p = { ...freshSectorZeroProgress(data, 's'), sovereigns: 4 };
    expect(changeSectorZeroProgress(p, { kind: 'run-supply' }, data)).toBeNull();
  });
});
