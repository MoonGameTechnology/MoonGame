import { describe, it, expect } from 'vitest';
import {
  canConfirm,
  clampTake,
  normalizeTake,
  shipCounts,
  splitTotals,
  stepTake,
} from './splitPlan';

describe('деление флота — состав', () => {
  it('стопки одного типа складываются', () => {
    expect(
      shipCounts([
        { unit: 'scout', count: 2 },
        { unit: 'scout', count: 3 },
      ]),
    ).toEqual({
      scout: 5,
    });
  });

  it('разные типы считаются отдельно', () => {
    expect(
      shipCounts([
        { unit: 'scout', count: 1 },
        { unit: 'cruiser', count: 2 },
      ]),
    ).toEqual({
      scout: 1,
      cruiser: 2,
    });
  });

  it('пустой флот — пустой состав', () => {
    expect(shipCounts([])).toEqual({});
  });
});

describe('деление флота — сколько уводим', () => {
  it('БОЛЬШЕ, ЧЕМ ЕСТЬ, УВЕСТИ НЕЛЬЗЯ', () => {
    expect(clampTake(99, 4)).toBe(4);
  });

  it('ОТРИЦАТЕЛЬНОГО ОТБОРА НЕ БЫВАЕТ: «−1» на нуле не уводит флот в минус', () => {
    expect(clampTake(-3, 4)).toBe(0);
    expect(stepTake(0, 4, 'dec', 1)).toBe(0);
  });

  it('«+10» У ОСТАТКА МЕНЬШЕ ДЕСЯТИ БЕРЁТ ОСТАТОК, а не ломается', () => {
    expect(stepTake(0, 4, 'inc', 10)).toBe(4);
    expect(stepTake(2, 4, 'inc', 10)).toBe(4);
  });

  it('«всё» берёт ровно наличное', () => {
    expect(stepTake(0, 7, 'all')).toBe(7);
    expect(stepTake(3, 7, 'all')).toBe(7);
  });

  it('обычный шаг работает как шаг', () => {
    expect(stepTake(1, 9, 'inc', 1)).toBe(2);
    expect(stepTake(5, 9, 'dec', 1)).toBe(4);
  });
});

describe('деление флота — пересчёт под живой состав', () => {
  it('КОРАБЛИ ПОГИБЛИ — ВЧЕРАШНИЙ ОТБОР УЖИМАЕТСЯ, а не уезжает в отказ на сервере', () => {
    expect(normalizeTake({ scout: 5 }, { scout: 2 })).toEqual({ scout: 2 });
  });

  it('тип исчез из состава — исчезает и из отбора', () => {
    expect(normalizeTake({ scout: 3, cruiser: 1 }, { scout: 3 })).toEqual({ scout: 3 });
  });

  it('новый тип во флоте начинается с нуля', () => {
    expect(normalizeTake({}, { scout: 3 })).toEqual({ scout: 0 });
  });
});

describe('деление флота — итоги и подтверждение', () => {
  const counts = { scout: 3, cruiser: 2 };

  it('считает уходящих, всех и остающихся', () => {
    expect(splitTotals(counts, { scout: 1, cruiser: 2 })).toEqual({
      takeTotal: 3,
      total: 5,
      left: 2,
    });
  });

  it('итоги тоже зажаты наличным — раздутый отбор их не сломает', () => {
    expect(splitTotals(counts, { scout: 99 }).takeTotal).toBe(3);
  });

  it('НОЛЬ УВЕСТИ НЕЛЬЗЯ — это не деление', () => {
    expect(canConfirm(0, 5)).toBe(false);
  });

  it('ВСЁ УВЕСТИ НЕЛЬЗЯ — это переименование флота, а не новый', () => {
    expect(canConfirm(5, 5)).toBe(false);
  });

  it('хотя бы один уходит и хотя бы один остаётся — можно', () => {
    expect(canConfirm(1, 5)).toBe(true);
    expect(canConfirm(4, 5)).toBe(true);
  });

  it('пустой флот подтвердить нельзя', () => {
    expect(canConfirm(0, 0)).toBe(false);
  });
});
