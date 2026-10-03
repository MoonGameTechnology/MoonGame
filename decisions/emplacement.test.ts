import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { isEmplacementFleet } from './emplacement';

const data = shippedGameData();
const fleet = (...units: Array<[string, number]>) => ({
  units: units.map(([unit, count]) => ({ unit, count })),
});

describe('космическая крепость на карте — отряд-сооружение', () => {
  it('ОРУДИЯ КРЕПОСТИ — СООРУЖЕНИЕ: неподвижный космический юнит', () => {
    expect(isEmplacementFleet(fleet(['fortress_guns', 3]), data)).toBe(true);
  });

  it('обычный флот — не сооружение, даже с орудиями в составе', () => {
    expect(isEmplacementFleet(fleet(['frigate', 2]), data)).toBe(false);
    expect(isEmplacementFleet(fleet(['fortress_guns', 1], ['frigate', 1]), data)).toBe(false);
  });

  it('МИНА — НЕ КРЕПОСТЬ: она тоже неподвижна, но у неё свой знак и своё окно', () => {
    const mine = Object.entries(data.units).find(([, d]) => d.traits.includes('mine'))?.[0];
    expect(mine).toBeDefined();
    expect(isEmplacementFleet(fleet([mine!, 1]), data)).toBe(false);
  });

  it('выбитые стеки не в счёт; пустой отряд — не сооружение', () => {
    expect(isEmplacementFleet(fleet(['fortress_guns', 2], ['frigate', 0]), data)).toBe(true);
    expect(isEmplacementFleet(fleet(), data)).toBe(false);
  });
});
