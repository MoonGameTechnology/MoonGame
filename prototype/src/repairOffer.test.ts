import { describe, it, expect } from 'vitest';
import { canRepair } from './repairOffer';

describe('ремонт — общая часть', () => {
  it('свой, вне боя, есть что чинить — предлагаем', () => {
    expect(canRepair(true, false, 40)).toBe(true);
  });

  it('ЧУЖОЙ ФЛОТ ЧИНИТ ЕГО ВЛАДЕЛЕЦ: кнопка обещала бы приказ, который ядро отобьёт', () => {
    expect(canRepair(false, false, 40)).toBe(false);
  });

  it('В БОЮ РЕМОНТА НЕТ: латать корпуса под огнём нельзя', () => {
    expect(canRepair(true, true, 40)).toBe(false);
  });

  it('НЕЧЕГО ЧИНИТЬ — НЕЧЕГО ПРЕДЛАГАТЬ: кнопка на здоровом флоте выглядит поломкой', () => {
    expect(canRepair(true, false, 0)).toBe(false);
  });
});
