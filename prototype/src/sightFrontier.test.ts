import { describe, it, expect } from 'vitest';
import {
  SIGHT_TIERS,
  frontierLook,
  frontierShown,
  ownRingLook,
  ownRingShown,
  unionArcs,
  type ScreenCircle,
} from './sightFrontier';

const круг = (x: number, y: number, r: number): ScreenCircle => ({ x, y, r });

describe('граница видимости — из чего собирается путь', () => {
  it('круг отдаётся целиком — из него рисуется отдельный подпуть', () => {
    expect(unionArcs([круг(10, 20, 30)], 0)).toEqual([круг(10, 20, 30)]);
  });

  it('СЖАТИЕ УМЕНЬШАЕТ РАДИУС: вычитаемая копия и есть толщина контура', () => {
    expect(unionArcs([круг(0, 0, 10)], 1.2)).toEqual([круг(0, 0, 8.8)]);
  });

  it('СЖАТИЕ НЕ СЪЕДАЕТ КРУГ ЦЕЛИКОМ: вывернутая дуга выела бы дыру в зоне обзора', () => {
    expect(unionArcs([круг(0, 0, 1)], 1)).toEqual([]);
    expect(unionArcs([круг(0, 0, 0.5)], 1)).toEqual([]);
  });

  it('мелкий круг выпадает, крупный остаётся — граница не рвётся из-за соседа', () => {
    const out = unionArcs([круг(0, 0, 1), круг(50, 0, 20)], 1.4);
    expect(out).toEqual([круг(50, 0, 18.6)]);
  });

  it('нулевой и отрицательный экранный радиус в путь не попадают', () => {
    expect(unionArcs([круг(0, 0, 0), круг(0, 0, -3)], 0)).toEqual([]);
  });

  it('порядок кругов сохраняется', () => {
    const out = unionArcs([круг(1, 0, 9), круг(2, 0, 9), круг(3, 0, 9)], 0);
    expect(out.map((c) => c.x)).toEqual([1, 2, 3]);
  });

  it('вход не меняется — путь строится из копий', () => {
    const src = круг(4, 5, 6);
    unionArcs([src], 2);
    expect(src).toEqual(круг(4, 5, 6));
  });
});

describe('граница видимости — заходить ли в отрисовку', () => {
  it('БЕЗ РАДАРОВ ЭТАПА НЕТ: контур стоит оффскрин-канвы и блита каждый кадр', () => {
    expect(frontierShown([])).toBe(false);
  });

  it('круги без площади — то же самое, что их отсутствие', () => {
    expect(frontierShown([круг(0, 0, 0), круг(9, 9, -1)])).toBe(false);
  });

  it('хотя бы один живой круг — рисуем', () => {
    expect(frontierShown([круг(0, 0, 0), круг(9, 9, 4)])).toBe(true);
  });
});

describe('граница видимости — два тира', () => {
  const засечка = frontierLook('signature');
  const опознание = frontierLook('reveal');

  it('ВНУТРЕННИЙ ТИР СИЛЬНЕЕ ВНЕШНЕГО ПО ВСЕМ ТРЁМ ПРИЗНАКАМ: иначе граница опознания растворится', () => {
    expect(опознание.fillAlpha).toBeGreaterThan(засечка.fillAlpha);
    expect(опознание.strokeAlpha).toBeGreaterThan(засечка.strokeAlpha);
    expect(опознание.lineWidth).toBeGreaterThan(засечка.lineWidth);
  });

  // ЭТОТ тест заменяет гейты «прозрачность > 0» и «толщина > 0» в самой отрисовке
  // (REFM-120.1): невидимый тир — это работа впустую, и ловить её надо здесь, на сборке,
  // а не молчаливым `if` в кадре. Перечень берётся из `SIGHT_TIERS`, поэтому третий тир
  // попадёт под проверку сам — в отличие от гейта, который его молча пропустил бы.
  it('КАЖДЫЙ тир видим по всем трём числам — иначе кадр работает впустую', () => {
    for (const t of SIGHT_TIERS) {
      const l = frontierLook(t);
      expect(l.fillAlpha).toBeGreaterThan(0);
      expect(l.strokeAlpha).toBeGreaterThan(0);
      expect(l.lineWidth).toBeGreaterThan(0);
    }
  });

  it('ПЕРЕЧЕНЬ ТИРОВ НЕ ПУСТ И БЕЗ ПОВТОРОВ: из него выведен тип, по нему идут проверки', () => {
    expect(SIGHT_TIERS.length).toBeGreaterThan(0);
    expect(new Set(SIGHT_TIERS).size).toBe(SIGHT_TIERS.length);
  });

  it('вид тира стабилен', () => {
    for (const t of SIGHT_TIERS) expect(frontierLook(t)).toEqual(frontierLook(t));
  });

  it('заливка остаётся дымкой: даже внутренний тир не закрашивает карту', () => {
    expect(опознание.fillAlpha).toBeLessThan(0.1);
  });
});

describe('граница видимости — собственные кольца выбранного', () => {
  const засечка = ownRingLook('signature');
  const опознание = ownRingLook('reveal');

  it('ВНЕШНЕЕ КОЛЬЦО ПУНКТИРНОЕ, ВНУТРЕННЕЕ СПЛОШНОЕ: пунктир и значит «тут только засечка»', () => {
    expect(засечка.dash.length).toBeGreaterThan(0);
    expect(опознание.dash).toEqual([]);
  });

  it('внутреннее ярче внешнего — та же пара, что и у сводной границы', () => {
    expect(опознание.alpha).toBeGreaterThan(засечка.alpha);
  });

  it('вид кольца стабилен', () => {
    for (const t of SIGHT_TIERS) expect(ownRingLook(t)).toEqual(ownRingLook(t));
  });

  it('СХЛОПНУВШЕЕСЯ КОЛЬЦО НЕ РИСУЕМ: дуга отрицательного радиуса бросает', () => {
    expect(ownRingShown(0)).toBe(false);
    expect(ownRingShown(-0.4)).toBe(false);
    expect(ownRingShown(0.1)).toBe(true);
  });
});
