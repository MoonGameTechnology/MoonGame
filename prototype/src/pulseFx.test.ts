import { describe, expect, it } from 'vitest';
import { breath, phaseAt, phaseOfId } from './pulseFx';

describe('дыхание слоёв', () => {
  it('колеблется вокруг середины на размах, и не дальше', () => {
    const b = { period: 200, base: 0.5, amp: 0.5 };
    let min = 1e9;
    let max = -1e9;
    for (let now = 0; now < 2000; now += 3) {
      const v = breath(now, b);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeCloseTo(1, 2); // размах пройден целиком
  });

  it('ПЕРИОД — ДЕЛО СЛОЯ: короткий частит, длинный дышит (правило 3)', () => {
    const быстро = { period: 120, base: 0.5, amp: 0.5 };
    const медленно = { period: 620, base: 0.5, amp: 0.5 };
    const переходы = (b: typeof быстро) => {
      let n = 0;
      let prev = breath(0, b) > 0.5;
      for (let now = 1; now < 4000; now += 2) {
        const cur = breath(now, b) > 0.5;
        if (cur !== prev) n++;
        prev = cur;
      }
      return n;
    };
    expect(переходы(быстро)).toBeGreaterThan(переходы(медленно) * 3);
  });

  it('середина и размах слоя соблюдаются (свечение владельца не гаснет в ноль)', () => {
    let min = 1e9;
    for (let now = 0; now < 4000; now += 5)
      min = Math.min(min, breath(now, { period: 620, base: 0.64, amp: 0.36 }));
    expect(min).toBeCloseTo(0.28, 2);
  });
});

describe('фаза дыхания', () => {
  it('РАЗНЫЕ МЕСТА — РАЗНЫЕ ФАЗЫ: иначе карта мигает в такт', () => {
    expect(phaseAt(100, 200)).not.toBe(phaseAt(101, 200));
    expect(phaseAt(100, 200)).not.toBe(phaseAt(100, 201));
  });

  it('ДЛИНА ИДЕНТИФИКАТОРА ФАЗОЙ НЕ РАБОТАЕТ, а хэш — работает (правило 2)', () => {
    const ids = ['p1-1', 'p2-3', 'p9-7', 'p1-2', 'p3-4'];
    // прежний источник: длина строки — одна на всех
    expect(new Set(ids.map((id) => id.length)).size).toBe(1);
    // хэш различает каждый
    expect(new Set(ids.map(phaseOfId)).size).toBe(ids.length);
  });

  it('ХЭШ УСТОЙЧИВ: та же строка — та же фаза, иначе объект дёргается (правило 4)', () => {
    expect(phaseOfId('p1-1')).toBe(phaseOfId('p1-1'));
    expect(phaseOfId('')).toBe(phaseOfId(''));
  });

  it('фаза лежит в круге', () => {
    for (const id of ['a', 'p10-42', 'wing:zzz', '', 'очень длинный идентификатор флота']) {
      expect(phaseOfId(id)).toBeGreaterThanOrEqual(0);
      expect(phaseOfId(id)).toBeLessThan(Math.PI * 2 + 0.01);
    }
  });

  it('фазированное дыхание в один момент даёт РАЗНЫЕ значения у разных объектов', () => {
    const b = { period: 120, base: 0.55, amp: 0.45 };
    const момент = 1234;
    const значения = ['p1-1', 'p2-3', 'p9-7'].map((id) =>
      breath(момент, { ...b, phase: phaseOfId(id) }).toFixed(4),
    );
    expect(new Set(значения).size).toBe(3);
  });
});
