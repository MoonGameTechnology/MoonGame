import { describe, it, expect } from 'vitest';
import { canDockRepair, canRepair } from './repairOffer';

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

describe('ремонт — экспресс у дока', () => {
  it('ЭКСПРЕСС ТОЛЬКО У СВОЕГО ДОКА: дешевизна платится привязкой к месту', () => {
    expect(canDockRepair(true, true)).toBe(true);
    expect(canDockRepair(true, false)).toBe(false);
  });

  it('без общей части док не помогает — в бою и у дока ремонта нет', () => {
    expect(canDockRepair(canRepair(true, true, 40), true)).toBe(false);
    expect(canDockRepair(canRepair(false, false, 40), true)).toBe(false);
    expect(canDockRepair(canRepair(true, false, 0), true)).toBe(false);
  });

  it('ДОК НЕ ОТМЕНЯЕТ ПЛАТНОГО: у дока живы обе кнопки, выбор за игроком', () => {
    const общая = canRepair(true, false, 40);
    expect(общая).toBe(true); // платный за кредиты
    expect(canDockRepair(общая, true)).toBe(true); // и экспресс за металл
  });
});
