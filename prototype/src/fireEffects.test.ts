import { describe, expect, it } from 'vitest';
import {
  AA_ORBIT_OFFSET,
  AA_SHOTS_MAX,
  SIEGE_SHOTS_MAX,
  aaImpact,
  capShots,
  siegeImpact,
} from './fireEffects';

describe('правила 1–2 — зенитка всегда куда-то бьёт', () => {
  it('живая цель — бьём в неё', () => {
    expect(aaImpact({ x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });
  it('цель погибла этим же залпом — вспышка над своей орбитой', () => {
    expect(aaImpact(null, { x: 100, y: 200 })).toEqual({
      x: 100 + AA_ORBIT_OFFSET.x,
      y: 200 + AA_ORBIT_OFFSET.y,
    });
  });
  it('цели нет вовсе (undefined) — тоже над орбитой, залп не пропадает', () => {
    expect(aaImpact(undefined, { x: 0, y: 0 })).toEqual(AA_ORBIT_OFFSET);
  });
  it('смещение уводит вспышку ВВЕРХ от центра мира', () => {
    expect(AA_ORBIT_OFFSET.y).toBeLessThan(0);
  });
});

describe('правила 3–4 — артиллерия рисует дугу только когда есть куда', () => {
  it('живая жертва важнее присланного узла', () => {
    expect(siegeImpact({ x: 1, y: 2 }, { x: 9, y: 9 })).toEqual({ x: 1, y: 2 });
  });
  it('жертвы уже нет — бьём в присланный узел', () => {
    expect(siegeImpact(null, { x: 9, y: 9 })).toEqual({ x: 9, y: 9 });
  });
  it('нет ни жертвы, ни узла — выстрела нет', () => {
    expect(siegeImpact(null, null)).toBeNull();
    expect(siegeImpact(undefined, undefined)).toBeNull();
  });
});

describe('правило 5 — очередь вспышек ограничена и режет старые', () => {
  it('короткая очередь не трогается', () => {
    const l = [1, 2, 3];
    capShots(l, 5);
    expect(l).toEqual([1, 2, 3]);
  });
  it('лишнее срезается С НАЧАЛА — свежее остаётся', () => {
    const l = [1, 2, 3, 4, 5];
    capShots(l, 3);
    expect(l).toEqual([3, 4, 5]);
  });
  it('ровно предел не трогается', () => {
    const l = [1, 2, 3];
    capShots(l, 3);
    expect(l).toEqual([1, 2, 3]);
  });
  it('пределы у зениток и артиллерии разные и положительные', () => {
    expect(AA_SHOTS_MAX).toBeGreaterThan(0);
    expect(SIEGE_SHOTS_MAX).toBeGreaterThan(0);
    expect(AA_SHOTS_MAX).not.toBe(SIEGE_SHOTS_MAX);
  });
  it('работает на любой длине сверх предела', () => {
    const l = Array.from({ length: 100 }, (_, i) => i);
    capShots(l, AA_SHOTS_MAX);
    expect(l.length).toBe(AA_SHOTS_MAX);
    expect(l[l.length - 1]).toBe(99); // последняя вспышка — самая свежая
  });
});
