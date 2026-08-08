import { describe, it, expect } from 'vitest';
import {
  canAssaultFromOrbit,
  canMerge,
  canSplit,
  uniformMode,
  type AssaultSpot,
  type LoneFleet,
} from './cmdAvailability';

const ME = 'p1';
const флот = (over: Partial<LoneFleet> = {}): LoneFleet => ({
  location: 'W1',
  ships: 4,
  ...over,
});
const точка = (over: Partial<AssaultSpot> = {}): AssaultSpot => ({
  orbit: 'near',
  location: 'W1',
  worldOwner: 'p2',
  capturable: true,
  ...over,
});

describe('командная полоса — слияние', () => {
  it('группа сливается в один тап', () => {
    expect(canMerge(2, 5)).toBe(true);
  });

  it('ОДИНОЧКЕ НУЖЕН НАПАРНИК: иначе кнопка вооружает выбор несуществующей цели', () => {
    expect(canMerge(1, 2)).toBe(true);
    expect(canMerge(1, 1)).toBe(false);
  });

  it('пустое выделение слить нельзя', () => {
    expect(canMerge(0, 9)).toBe(false);
  });
});

describe('командная полоса — деление', () => {
  it('ДЕЛИТЬ МОЖНО ТОЛЬКО СТОЯЩИЙ ФЛОТ: на ходу состав не режут', () => {
    expect(canSplit(флот())).toBe(true);
    expect(canSplit(флот({ movement: { to: 'W2' } }))).toBe(false);
  });

  it('в бою тоже нельзя', () => {
    expect(canSplit(флот({ battleId: 'b1' }))).toBe(false);
  });

  it('ИЗ ОДНОГО КОРАБЛЯ НОВОГО ФЛОТА НЕ ВЫЙДЕТ', () => {
    expect(canSplit(флот({ ships: 1 }))).toBe(false);
    expect(canSplit(флот({ ships: 2 }))).toBe(true);
  });

  it('флот вне узла (в коридоре) делить нельзя', () => {
    expect(canSplit(флот({ location: null }))).toBe(false);
  });

  it('КОМАНДА СТРОГО ОДНОФЛОТОВАЯ: без одиночки её нет вовсе', () => {
    expect(canSplit(null)).toBe(false);
  });
});

describe('командная полоса — штурм с орбиты', () => {
  it('чужой захватываемый мир с ближней орбиты — можно', () => {
    expect(canAssaultFromOrbit(точка(), ME)).toBe(true);
  });

  it('СВОЙ МИР ШТУРМОВАТЬ НЕЗАЧЕМ', () => {
    expect(canAssaultFromOrbit(точка({ worldOwner: ME }), ME)).toBe(false);
  });

  it('ПУСТОЙ КОСМОС НЕ БЕРУТ', () => {
    expect(canAssaultFromOrbit(точка({ capturable: false }), ME)).toBe(false);
  });

  it('С ДАЛЬНЕЙ ОРБИТЫ ДЕСАНТУ НЕ ДОТЯНУТЬСЯ', () => {
    expect(canAssaultFromOrbit(точка({ orbit: 'far' }), ME)).toBe(false);
  });

  it('ничей мир захватываемым остаётся', () => {
    expect(canAssaultFromOrbit(точка({ worldOwner: null }), ME)).toBe(true);
  });

  it('флот не в узле штурмовать не может', () => {
    expect(canAssaultFromOrbit(точка({ location: null }), ME)).toBe(false);
  });
});

describe('командная полоса — общий режим огня', () => {
  it('ЕДИНОГЛАСИЕ — ПОКАЗЫВАЕМ РЕЖИМ', () => {
    expect(uniformMode(['standard', 'standard'])).toBe('standard');
  });

  it('РАЗНОБОЙ — НЕЙТРАЛЬНАЯ ПОДПИСЬ: иначе кнопка врёт про часть флотов', () => {
    expect(uniformMode(['standard', 'passive'])).toBeNull();
  });

  it('один флот — это тоже единогласие', () => {
    expect(uniformMode(['aggressive'])).toBe('aggressive');
  });

  it('показывать нечего — тоже null', () => {
    expect(uniformMode([])).toBeNull();
  });
});
