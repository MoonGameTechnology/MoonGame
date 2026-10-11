import { describe, it, expect } from 'vitest';
import {
  SIGHT_TIERS,
  frontierLook,
  frontierOnScreen,
  frontierShown,
  ownRingLook,
  ownRingShown,
  unionArcs,
  unionLoops,
  type FrontierArc,
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

describe('граница видимости — какие круги рисовать', () => {
  it('круг на экране остаётся, круг целиком за любым краем уходит', () => {
    const shown = [круг(100, 100, 10)];
    const away = [круг(-30, 100, 20), круг(430, 100, 20), круг(100, -30, 20), круг(100, 330, 20)];
    expect(frontierOnScreen([...shown, ...away], 390, 300)).toEqual(shown);
  });

  it('КРУГ ШИРЕ ЭКРАНА ОСТАЁТСЯ: его заливка накрывает экран целиком', () => {
    expect(frontierOnScreen([круг(200, 150, 5000)], 390, 300)).toEqual([круг(200, 150, 5000)]);
  });

  it('ПОЛЕ ЗА КРАЕМ ЭКРАНА: сглаживание края круга чуть за экраном ещё ложится на экран', () => {
    expect(frontierOnScreen([круг(-13, 100, 10)], 390, 300)).toHaveLength(1);
    expect(frontierOnScreen([круг(-15, 100, 10)], 390, 300)).toEqual([]);
  });
});

describe('граница видимости — край объединения', () => {
  const TAU = Math.PI * 2;
  const начало = (a: FrontierArc): [number, number] => [
    a.x + a.r * Math.cos(a.from),
    a.y + a.r * Math.sin(a.from),
  ];
  const конец = (a: FrontierArc): [number, number] => [
    a.x + a.r * Math.cos(a.to),
    a.y + a.r * Math.sin(a.to),
  ];
  const разрыв = (p: [number, number], q: [number, number]): number =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  // Петля замкнута: каждая дуга кончается там, где начинается следующая.
  const замкнута = (loop: FrontierArc[]): boolean =>
    loop.every((a, k) => разрыв(конец(a), начало(loop[(k + 1) % loop.length]!)) < 1e-6);
  // Лежит ли точка внутри петли: петля — многоугольник по частым точкам дуг.
  const внутри = (loop: FrontierArc[], x: number, y: number): boolean => {
    const pts: Array<[number, number]> = [];
    for (const a of loop) {
      const n = Math.max(2, Math.ceil(((a.to - a.from) / TAU) * 2048));
      for (let k = 0; k < n; k++) {
        const t = a.from + ((a.to - a.from) * k) / n;
        pts.push([a.x + a.r * Math.cos(t), a.y + a.r * Math.sin(t)]);
      }
    }
    let inside = false;
    for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) {
      const [xi, yi] = pts[k]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // Детерминированный разброс: тест не меняется от прогона к прогону.
  const разброс = (seed: number): (() => number) => {
    let v = seed;
    return () => {
      v = (v * 1103515245 + 12345) % 2147483648;
      return v / 2147483648;
    };
  };

  it('одинокий круг — одна петля из целого круга', () => {
    expect(unionLoops([круг(10, 20, 30)])).toEqual([[{ x: 10, y: 20, r: 30, from: 0, to: TAU }]]);
  });

  it('КРУГ ВНУТРИ СОСЕДА КРАЯ НЕ ДАЁТ: граница видимости одна, а не по кольцу на источник', () => {
    expect(unionLoops([круг(0, 0, 100), круг(30, 0, 40)])).toEqual([
      [{ x: 0, y: 0, r: 100, from: 0, to: TAU }],
    ]);
  });

  it('СОВПАДАЮЩИЕ КРУГИ — ОДИН КРАЙ: иначе они спрятали бы друг друга и граница пропала', () => {
    expect(unionLoops([круг(5, 5, 10), круг(5, 5, 10)])).toEqual([
      [{ x: 5, y: 5, r: 10, from: 0, to: TAU }],
    ]);
  });

  it('два пересёкшихся круга — одна петля из двух дуг, сцепленных концами', () => {
    const loops = unionLoops([круг(0, 0, 50), круг(60, 10, 40)]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(2);
    expect(замкнута(loops[0]!)).toBe(true);
  });

  it('ДУГА ЧЕРЕЗ НУЛЕВОЙ УГОЛ ОСТАЁТСЯ ОДНОЙ: петля не рвётся на стыке углов', () => {
    const loops = unionLoops([круг(0, 0, 50), круг(-60, 0, 30)]);
    const own = loops.flat().filter((a) => a.x === 0);
    expect(own).toHaveLength(1);
    expect(own[0]!.from).toBeLessThan(TAU);
    expect(own[0]!.to).toBeGreaterThan(TAU);
  });

  it('ДЫРА МЕЖДУ ТРЕМЯ КРУГАМИ — СВОЯ ПЕТЛЯ: слепое пятно посреди обзора обведено', () => {
    // Центры в 57,7 от середины, круги по 52: попарно пересекаются, а середину не накрывают.
    const h = 50 / Math.sqrt(3);
    const loops = unionLoops([круг(0, -2 * h, 52), круг(50, h, 52), круг(-50, h, 52)]);
    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(замкнута(loop)).toBe(true);
  });

  it('круг, накрытый соседями вместе, но ни одним целиком, края не даёт', () => {
    const соседи = [0, 1, 2].map((k) =>
      круг(15 * Math.cos((k * TAU) / 3), 15 * Math.sin((k * TAU) / 3), 20),
    );
    const loops = unionLoops([круг(0, 0, 10), ...соседи]);
    expect(loops.flat().every((a) => a.r === 20)).toBe(true);
  });

  it('ТРИ КРУГА ЧЕРЕЗ ОДНУ ТОЧКУ НА КРАЮ: петля всё равно замкнута', () => {
    // Все три проходят через (0, 0), и (0, 0) лежит на краю объединения: центры веером в 90°.
    const loops = unionLoops(
      [0, 1, 2].map((k) => круг(40 * Math.cos((k * TAU) / 8), 40 * Math.sin((k * TAU) / 8), 40)),
    );
    expect(loops.length).toBeGreaterThan(0);
    for (const loop of loops) expect(замкнута(loop)).toBe(true);
  });

  it('ПОЛОСА — РОВНО ТО, ЧТО ОБХОДИТ НЕЧЁТНОЕ ЧИСЛО ПЕТЕЛЬ ОБОИХ КРАЁВ (правило 9)', () => {
    const rnd = разброс(7);
    for (let trial = 0; trial < 12; trial++) {
      const circles = Array.from({ length: 2 + (trial % 9) }, () =>
        круг(rnd() * 200, rnd() * 200, 4 + rnd() * 60),
      );
      const inset = 3;
      const outer = unionArcs(circles, 0);
      const inner = unionArcs(circles, inset);
      const loops = [...unionLoops(outer), ...unionLoops(inner)];
      for (const loop of loops) expect(замкнута(loop)).toBe(true);
      for (let k = 0; k < 150; k++) {
        const x = rnd() * 260 - 30;
        const y = rnd() * 260 - 30;
        // Точки у самой окружности многоугольник петли решает неточно — их пропускаем.
        const уКрая = [...outer, ...inner].some(
          (c) => Math.abs(Math.hypot(x - c.x, y - c.y) - c.r) < 0.05,
        );
        if (уКрая) continue;
        const в = (cs: ScreenCircle[]): boolean =>
          cs.some((c) => Math.hypot(x - c.x, y - c.y) < c.r);
        const нечётно = loops.filter((loop) => внутри(loop, x, y)).length % 2 === 1;
        expect(нечётно).toBe(в(outer) && !в(inner));
      }
    }
  });

  it('вход не меняется', () => {
    const circles = [круг(0, 0, 50), круг(60, 0, 30)];
    const copy = structuredClone(circles);
    unionLoops(circles);
    expect(circles).toEqual(copy);
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
