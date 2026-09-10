import { describe, expect, it } from 'vitest';
import {
  AA_ORBIT_OFFSET,
  AA_SHOTS_MAX,
  aaImpact,
  capShots,
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

describe('правило 3 — очередь вспышек ограничена и режет старые', () => {
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
  it('предел зениток положительный', () => {
    expect(AA_SHOTS_MAX).toBeGreaterThan(0);
  });
  it('работает на любой длине сверх предела', () => {
    const l = Array.from({ length: 100 }, (_, i) => i);
    capShots(l, AA_SHOTS_MAX);
    expect(l.length).toBe(AA_SHOTS_MAX);
    expect(l[l.length - 1]).toBe(99); // последняя вспышка — самая свежая
  });
});
