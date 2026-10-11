import { describe, it, expect } from 'vitest';
import {
  SIGHT_TIERS,
  frontierBox,
  frontierLook,
  frontierShown,
  frontierTiles,
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

describe('граница видимости — коробка обратных клипов', () => {
  it('КОРОБКА ОБНИМАЕТ ВСЕ КРУГИ С ПОЛЕМ: за её краем заливка пуста, сглаживание края внутри', () => {
    expect(frontierBox([круг(100, 100, 10), круг(150, 120, 5)], 1000, 1000)).toEqual({
      x: 86,
      y: 86,
      width: 73,
      height: 43,
    });
  });

  it('дробные края округляются наружу: коробка не срезает пиксель края', () => {
    expect(frontierBox([круг(10.5, 20.25, 3.1)], 1000, 1000)).toEqual({
      x: 3,
      y: 13,
      width: 15,
      height: 15,
    });
  });

  it('КОРОБКА НЕ ШИРЕ ПРЕЖНЕГО КЛИПА: большой круг обрезается по экрану с запасом в единицу', () => {
    expect(frontierBox([круг(200, 150, 5000)], 390, 300)).toEqual({
      x: -1,
      y: -1,
      width: 392,
      height: 302,
    });
  });

  it('ВСЁ ЗА ЭКРАНОМ — РИСОВАТЬ НЕЧЕГО: иначе вышла бы коробка отрицательной площади', () => {
    expect(frontierBox([круг(-100, 50, 20)], 390, 300)).toBeNull();
    expect(frontierBox([круг(50, 500, 20)], 390, 300)).toBeNull();
  });

  it('круги без площади коробку не растят', () => {
    expect(frontierBox([круг(0, 0, 0), круг(300, 300, -2)], 1000, 1000)).toBeNull();
    expect(frontierBox([круг(50, 50, 0), круг(100, 100, 10)], 1000, 1000)).toEqual({
      x: 86,
      y: 86,
      width: 28,
      height: 28,
    });
  });
});

describe('граница видимости — плитки контура', () => {
  const целое = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-9;

  it('КРАЯ ПЛИТОК НА ЦЕЛЫХ ФИЗИЧЕСКИХ ПИКСЕЛЯХ: иначе пиксель шва закрасился бы дважды', () => {
    const dpr = 2.625;
    const tiles = frontierTiles([круг(150.3, 120.7, 90)], [круг(150.3, 120.7, 89)], 390, 844, dpr);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect([t.x, t.y, t.x + t.width, t.y + t.height].every((v) => целое(v * dpr))).toBe(true);
    }
  });

  it('КАЖДАЯ ТОЧКА КРОМКИ — РОВНО В ОДНОЙ ПЛИТКЕ: без щелей и без двойной заливки', () => {
    const tiles = frontierTiles([круг(300, 300, 200)], [круг(300, 300, 199)], 1000, 1000, 1);
    for (let k = 0; k < 360; k++) {
      const a = (k * Math.PI) / 180;
      const x = 300 + 199.5 * Math.cos(a);
      const y = 300 + 199.5 * Math.sin(a);
      const holders = tiles.filter(
        (t) => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height,
      );
      expect(holders).toHaveLength(1);
    }
  });

  it('ПЛИТКА ВНУТРИ ДИСКА ПРОПУСКАЕТСЯ: контура в ней нет, а маска стоила бы её площади', () => {
    const tiles = frontierTiles([круг(500, 500, 300)], [круг(500, 500, 299)], 1000, 1000, 1);
    expect(
      tiles.some((t) => t.x <= 500 && 500 < t.x + t.width && t.y <= 500 && 500 < t.y + t.height),
    ).toBe(false);
  });

  it('плитка, которой не задел ни один круг, пропускается', () => {
    const tiles = frontierTiles(
      [круг(20, 20, 10), круг(900, 900, 10)],
      [круг(20, 20, 9), круг(900, 900, 9)],
      1000,
      1000,
      1,
    );
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(8);
    for (const t of tiles) expect(t.fill.length).toBeGreaterThan(0);
  });

  it('ПЛИТКА ВЫЧИТАЕТ ТОЛЬКО ЗАДЕВШИЕ ЕЁ ДИСКИ: дальний радар не тратит маску', () => {
    const tiles = frontierTiles(
      [круг(20, 20, 10), круг(900, 900, 10)],
      [круг(20, 20, 9), круг(900, 900, 9)],
      1000,
      1000,
      1,
    );
    for (const t of tiles) expect(t.cut).toEqual(t.x < 500 ? [0] : [1]);
  });

  it('номера заливки — по внешним кругам, вычитания — по внутренним: сжатие выбрасывает мелкие', () => {
    const outer = [круг(30, 30, 0.5), круг(30, 30, 20)];
    const inner = unionArcs(outer, 1);
    const tiles = frontierTiles(outer, inner, 1000, 1000, 1);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.fill).toContain(1);
      expect(t.cut).toEqual([0]);
    }
  });

  it('всё за экраном — плиток нет', () => {
    expect(frontierTiles([круг(-100, 50, 20)], [круг(-100, 50, 19)], 390, 300, 2)).toEqual([]);
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
