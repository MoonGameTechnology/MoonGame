import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../data/loadGameData';
import { TimeValueDefSchema } from '../data/schemas';
import {
  bundleHours,
  gameHoursOfReal,
  hasTimeValue,
  hourBundle,
  resourceForHours,
  sovereignsForHours,
  speedupBudgetHours,
  unitHours,
  warrantsForHours,
} from './timeValue';

const dataDir = fileURLToPath(new URL('../../../../data/', import.meta.url));
const shipped = loadGameData((f) => JSON.parse(readFileSync(dataDir + f, 'utf8'))).timeValue;
const RES = ['metal', 'credits', 'food', 'energy', 'microelectronics'];

/** Детерминированный псевдослучайный поток для перебора наборов (тест, не ядро). */
function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('матрица времени: опоры в данных (TEC-1)', () => {
  it('шипнутая матрица — опоры владельца 2026-11-19', () => {
    expect(hasTimeValue(shipped)).toBe(true);
    expect(shipped.sovereignsPerHour).toBe(10);
    expect(shipped.warrantsPerHour).toBe(4);
    expect(shipped.speedupCap).toBe(1.5);
    expect(Object.keys(shipped.referenceHour).sort()).toEqual([...RES].sort());
  });

  it('весь набор эталонного часа стоит ровно 1 ЭЧ', () => {
    expect(bundleHours(shipped.referenceHour, shipped)).toBeCloseTo(1, 12);
    expect(bundleHours(hourBundle(3, shipped), shipped)).toBeCloseTo(3, 12);
  });

  it('схема не пропускает веса, которые не сходятся в 1 или называют чужой ресурс', () => {
    const base = { referenceHour: { metal: 10, credits: 20 } };
    expect(TimeValueDefSchema.safeParse({ ...base, weights: { metal: 0.5, credits: 0.5 } }).success).toBe(true);
    expect(TimeValueDefSchema.safeParse({ ...base, weights: { metal: 0.5, credits: 0.4 } }).success).toBe(false);
    expect(TimeValueDefSchema.safeParse({ ...base, weights: { metal: 0.5, food: 0.5 } }).success).toBe(false);
    expect(TimeValueDefSchema.safeParse({ ...base, weights: { metal: 1 } }).success).toBe(false);
  });
});

describe('матрица времени: лазеек нет', () => {
  it('цена набора — сумма цен частей: по одному не дешевле и не дороже', () => {
    const next = lcg(7);
    for (let i = 0; i < 200; i++) {
      const bag = Object.fromEntries(RES.map((r) => [r, Math.floor(next() * 500)]));
      const parts = RES.reduce((sum, r) => sum + bundleHours({ [r]: bag[r]! }, shipped), 0);
      expect(bundleHours(bag, shipped)).toBeCloseTo(parts, 9);
    }
  });

  it('купить ресурс на N часов и оценить его — снова N часов, в любом ресурсе', () => {
    for (const r of RES)
      for (const hours of [0.25, 1, 4, 8])
        expect(bundleHours({ [r]: resourceForHours(r, hours, shipped) }, shipped)).toBeCloseTo(hours, 9);
  });

  it('◆ и ⌖ за одно и то же время не зависят от того, как его нарезать', () => {
    expect(sovereignsForHours(1, shipped) * 3).toBeCloseTo(sovereignsForHours(3, shipped), 12);
    expect(warrantsForHours(0.5, shipped) + warrantsForHours(1.5, shipped)).toBeCloseTo(
      warrantsForHours(2, shipped),
      12,
    );
  });

  it('скорость партии ×N делает реальный час в N раз дороже', () => {
    expect(sovereignsForHours(gameHoursOfReal(1, 4), shipped)).toBe(4 * sovereignsForHours(1, shipped));
  });
});

describe('матрица времени: потолок ускорения и пустые данные', () => {
  it('K = 1,5: за прошедшие сутки партии ускорить можно 12 часов', () => {
    expect(speedupBudgetHours(24, shipped)).toBe(12);
    expect(speedupBudgetHours(0, shipped)).toBe(0);
  });

  it('пустой referenceHour — матрицы нет, всё по нулям', () => {
    const none = TimeValueDefSchema.parse({});
    expect(hasTimeValue(none)).toBe(false);
    expect(unitHours('metal', none)).toBe(0);
    expect(bundleHours({ metal: 100 }, none)).toBe(0);
    expect(resourceForHours('metal', 1, none)).toBe(0);
    expect(sovereignsForHours(5, none)).toBe(0);
    expect(speedupBudgetHours(24, none)).toBe(0);
  });

  it('ресурс вне матрицы ничего не стоит и не покупается', () => {
    expect(unitHours('biomass', shipped)).toBe(0);
    expect(resourceForHours('biomass', 1, shipped)).toBe(0);
  });
});
