import { describe, expect, it } from 'vitest';
import { arrowLabel, arrowShape, arrowWidth } from './battleArrows';

const low = { top: 200, bottom: 260, cx: 100 };
const high = { top: 20, bottom: 80, cx: 160 };

describe('стрелки залпов: геометрия', () => {
  it('снизу вверх — от верхнего края своей плитки к нижнему краю цели', () => {
    const s = arrowShape(low, high, false, true, 0, 0, false);
    expect(s.d.startsWith('M100,200 ')).toBe(true);
    expect(s.head.startsWith('160,80 ')).toBe(true);
    // Наконечник смотрит вверх: его основание ниже острия.
    const base = Number(s.d.split(' ').at(-1)!.split(',')[1]);
    expect(base).toBeGreaterThan(80);
  });

  it('внутри одного ряда — дуга наружу, а не через плитки', () => {
    const a = { top: 200, bottom: 260, cx: 40 };
    const s = arrowShape(a, low, false, false, 0, 0, false);
    // Нижний ряд: из нижнего края, опоры ниже него.
    expect(s.d).toMatch(/^M40,260 C40,282 /);
  });

  it('концы на одной плитке расходятся веером', () => {
    const a = arrowShape(low, high, false, true, -6, 0, false);
    const b = arrowShape(low, high, false, true, 6, 0, false);
    expect(a.d).not.toBe(b.d);
    expect(a.d.startsWith('M94,')).toBe(true);
  });
});

describe('стрелки залпов: толщина и подписи', () => {
  it('весь залп толще половины, ответ тоньше всех', () => {
    expect(arrowWidth({ reply: false, of: 1, n: 1 })).toBeGreaterThan(
      arrowWidth({ reply: false, of: 2, n: 1 }),
    );
    expect(arrowWidth({ reply: true, of: 1, n: 1 })).toBeLessThan(
      arrowWidth({ reply: false, of: 5, n: 1 }),
    );
  });

  it('доля подписана только на моих залпах; сливание в «+N» — числом', () => {
    expect(arrowLabel({ reply: false, of: 2, n: 1, mine: true })).toBe('½');
    expect(arrowLabel({ reply: false, of: 8, n: 1, mine: true })).toBe('1/8');
    expect(arrowLabel({ reply: false, of: 1, n: 1, mine: true })).toBeNull();
    expect(arrowLabel({ reply: false, of: 2, n: 1, mine: false })).toBeNull();
    expect(arrowLabel({ reply: true, of: 1, n: 1, mine: true })).toBeNull();
    expect(arrowLabel({ reply: false, of: 11, n: 4, mine: true })).toBe('4×1/11');
  });
});
