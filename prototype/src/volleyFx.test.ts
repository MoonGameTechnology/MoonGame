import { describe, it, expect } from 'vitest';
import { burstK, shellT, sparkAngle, volleyLife, type VolleySpec } from './volleyFx';

const SPEC: VolleySpec = { shells: 3, flightMs: 780, staggerMs: 130, burstMs: 520 };

describe('залп — время жизни', () => {
  it('ЖИЗНЬ СКЛАДЫВАЕТСЯ ИЗ ФАЗ: своё число разошлось бы с ними', () => {
    expect(volleyLife(SPEC)).toBe(780 + 130 * 2 + 520);
  });

  it('ЗАЛПА ХВАТАЕТ НА ПОСЛЕДНИЙ РАЗРЫВ: он гаснет ровно в конце жизни', () => {
    const life = volleyLife(SPEC);
    expect(burstK(life, SPEC.shells - 1, SPEC)).toBe(1);
    expect(burstK(life + 1, SPEC.shells - 1, SPEC)).toBeNull();
  });

  it('одиночный снаряд не платит за задержку', () => {
    expect(volleyLife({ ...SPEC, shells: 1 })).toBe(780 + 520);
  });
});

describe('залп — снаряды в полёте', () => {
  it('ДО СТАРТА СНАРЯДА НЕТ: он ещё не вышел из ствола', () => {
    expect(shellT(0, 0, SPEC)).toBeNull();
    expect(shellT(100, 1, SPEC)).toBeNull(); // второй стартует на 130
  });

  it('СНАРЯДЫ УХОДЯТ ОЧЕРЕДЬЮ, а не разом — иначе залп был бы одной чертой', () => {
    const age = 200;
    expect(shellT(age, 0, SPEC)).toBeGreaterThan(shellT(age, 1, SPEC)!);
    expect(shellT(age, 2, SPEC)).toBeNull(); // третий ещё не стартовал
  });

  it('ПОСЛЕ ПОПАДАНИЯ СНАРЯДА НЕТ: иначе он повис бы в цели поверх вспышки', () => {
    expect(shellT(780, 0, SPEC)).toBeNull();
    expect(shellT(1000, 0, SPEC)).toBeNull();
  });

  it('доля пути идёт от нуля к единице', () => {
    expect(shellT(390, 0, SPEC)).toBeCloseTo(0.5, 9);
    expect(shellT(1, 0, SPEC)).toBeLessThan(0.01);
  });
});

describe('залп — разрывы', () => {
  it('РАЗРЫВ НАЧИНАЕТСЯ ТАМ, ГДЕ КОНЧАЕТСЯ ПОЛЁТ СВОЕГО СНАРЯДА', () => {
    for (let sh = 0; sh < SPEC.shells; sh++) {
      const landing = sh * SPEC.staggerMs + SPEC.flightMs;
      expect(shellT(landing - 1, sh, SPEC)).not.toBeNull(); // ещё летит
      expect(burstK(landing - 1, sh, SPEC)).toBeNull(); // ещё не рвётся
      expect(shellT(landing, sh, SPEC)).toBeNull(); // долетел
      expect(burstK(landing, sh, SPEC)).toBe(0); // и сразу рвётся
    }
  });

  it('ни один момент не показывает снаряд и его же разрыв разом', () => {
    for (let age = 0; age <= volleyLife(SPEC); age += 7)
      for (let sh = 0; sh < SPEC.shells; sh++)
        expect(shellT(age, sh, SPEC) !== null && burstK(age, sh, SPEC) !== null).toBe(false);
  });

  it('отгоревший разрыв больше не рисуется', () => {
    expect(burstK(780 + 520, 0, SPEC)).toBe(1);
    expect(burstK(780 + 520 + 1, 0, SPEC)).toBeNull();
  });
});

describe('залп — искры', () => {
  it('УГОЛ ОТ СИДА, А НЕ ОТ СЛУЧАЙНОСТИ: иначе попадание дрожало бы каждый кадр', () => {
    expect(sparkAngle(11, 1, 2, 12)).toBe(sparkAngle(11, 1, 2, 12));
  });

  it('разные залпы бьют искры по-разному', () => {
    const a = [0, 1, 2, 3, 4].map((k) => sparkAngle(3, 0, k, 12));
    const b = [0, 1, 2, 3, 4].map((k) => sparkAngle(4, 0, k, 12));
    expect(a).not.toEqual(b);
  });

  it('углы лежат в круге и разнесены по лучам', () => {
    for (let seed = 0; seed < 20; seed++)
      for (let spk = 0; spk < 5; spk++) {
        const ang = sparkAngle(seed, 0, spk, 12);
        expect(ang).toBeGreaterThanOrEqual(0.35);
        expect(ang).toBeLessThan(Math.PI * 2 + 0.35);
      }
  });
});
