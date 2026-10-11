import { describe, expect, it } from 'vitest';

import {
  LIVING_BANDS,
  MIN_LAYER_SEGMENTS,
  SHRINK_LIMIT,
  WAIT_SLACK,
  bandEdges,
  borderLayerAction,
  framedRect,
  glassPixels,
  intersectRect,
  layerShift,
  staleBand,
  uncoveredRects,
  type BorderLayerFrame,
} from './livingBorderLayer';
import { MAX_STRETCH } from './mapLayerView';

describe('glassPixels — стекло карты в физических пикселях (правило 1)', () => {
  it('округляет рамку наружу до целых пикселей', () => {
    const r = glassPixels(
      { x: 10.3, y: 20.6, width: 100.2, height: 50.1 },
      { k: 1, tx: 0, ty: 0 },
      2,
      1000,
      1000,
    );
    expect(r).toEqual({ x: 20, y: 41, width: 201, height: 101 });
  });

  it('ставит рамку преобразованием выпечки', () => {
    const r = glassPixels(
      { x: 10, y: 10, width: 100, height: 100 },
      { k: 1.5, tx: -5, ty: 7 },
      1,
      1000,
      1000,
    );
    expect(r).toEqual({ x: 10, y: 22, width: 150, height: 150 });
  });

  it('обрезает рамку краем холста', () => {
    const r = glassPixels(
      { x: -50, y: 300, width: 400, height: 400 },
      { k: 1, tx: 0, ty: 0 },
      1,
      200,
      500,
    );
    expect(r).toEqual({ x: 0, y: 300, width: 200, height: 200 });
  });

  it('стекло за краем холста — слоя нет', () => {
    expect(
      glassPixels({ x: 600, y: 0, width: 100, height: 100 }, { k: 1, tx: 0, ty: 0 }, 1, 500, 500),
    ).toBeNull();
    expect(
      glassPixels({ x: 0, y: 0, width: 0, height: 100 }, { k: 1, tx: 0, ty: 0 }, 1, 500, 500),
    ).toBeNull();
  });
});

describe('bandEdges — полосы поровну по работе (правило 2)', () => {
  const shares = (work: number[], edges: number[]): number[] =>
    edges.slice(1).map((end, i) => work.slice(edges[i], end).reduce((a, b) => a + b, 0));

  it('ровная работа — ровные полосы', () => {
    expect(bandEdges(new Array(12).fill(1), 3)).toEqual([0, 4, 8, 12]);
  });

  it('густая середина — полосы там уже, работа поровну', () => {
    const work = [1, 1, 1, 1, 10, 10, 10, 10, 1, 1, 1, 1];
    const edges = bandEdges(work, 4);
    expect(edges).toEqual([0, 5, 6, 7, 12]);
    expect(shares(work, edges)).toEqual([14, 10, 10, 14]);
    // Равные по высоте полосы дали бы середине по 21 из 48: кадр с ней стоил бы вдвое дороже.
    expect(shares(work, bandEdges(new Array(12).fill(0), 4))).toEqual([3, 21, 21, 3]);
  });

  it('без работы — равные по высоте', () => {
    expect(bandEdges(new Array(10).fill(0), 3)).toEqual([0, 3, 7, 10]);
  });

  it('ни одной пустой полосы, даже когда вся работа в одной строке', () => {
    const edges = bandEdges([0, 0, 100, 0, 0, 0], 4);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(6);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]!);
    expect(edges).toHaveLength(5);
  });

  it('строк меньше, чем полос, — по строке на полосу', () => {
    expect(bandEdges([5, 1, 3], LIVING_BANDS)).toEqual([0, 1, 2, 3]);
  });

  it('пустой слой — одна пустая полоса', () => {
    expect(bandEdges([], LIVING_BANDS)).toEqual([0, 0]);
  });
});

describe('staleBand — какую полосу перерисовать (правила 2 и 6)', () => {
  it('идёт по кругу с места, где остановилась', () => {
    expect(staleBand([1, 1, 1], 1, 2)).toBe(1);
    expect(staleBand([1, 1, 1], 3, 2)).toBe(0);
  });

  it('пропускает полосу, уже нарисованную на этот момент', () => {
    expect(staleBand([2, 2, 1], 0, 2)).toBe(2);
  });

  it('часы стоят — перерисовывать нечего', () => {
    expect(staleBand([5, 5, 5], 0, 5)).toBe(-1);
  });
});

it('через слой идут границы от тысячи отрезков (правило 5)', () => {
  expect(MIN_LAYER_SEGMENTS).toBe(1000);
});

describe('layerShift — слой едет за камерой на целые пиксели (правило 3)', () => {
  it('тот же масштаб — сдвиг в физических пикселях, округлённый', () => {
    expect(layerShift({ k: 1, tx: 12.5, ty: -3 }, 2)).toEqual({ x: 25, y: -6 });
    expect(layerShift({ k: 1, tx: 0.2, ty: 0.7 }, 1)).toEqual({ x: 0, y: 1 });
  });

  it('другой масштаб — не сдвиг', () => {
    expect(layerShift({ k: 1.01, tx: 0, ty: 0 }, 2)).toBeNull();
    expect(layerShift({ k: Number.NaN, tx: 0, ty: 0 }, 2)).toBeNull();
  });

  it('на месте — ноль без минуса', () => {
    expect(Object.is(layerShift({ k: 1, tx: -0.1, ty: 0 }, 1)!.x, 0)).toBe(true);
  });
});

describe('borderLayerAction — судьба слоя в кадре (правила 3 и 4)', () => {
  const at = (over: Partial<BorderLayerFrame>): BorderLayerFrame => ({
    fresh: true,
    transform: { k: 1, tx: 0, ty: 0 },
    dpr: 2,
    settled: true,
    sharp: true,
    ...over,
  });

  it('в покое на месте — слой кладётся, полоса обновляется', () => {
    expect(borderLayerAction(at({}))).toBe('keep');
  });

  it('панорама на целые пиксели — слой сдвигается, и в движении, и в покое', () => {
    expect(borderLayerAction(at({ settled: false, transform: { k: 1, tx: 3.5, ty: 0 } }))).toBe(
      'scroll',
    );
    expect(borderLayerAction(at({ transform: { k: 1, tx: 3.5, ty: -1 } }))).toBe('scroll');
  });

  it('камера встала между пикселями — слой рисуется заново, в движении сдвигается', () => {
    expect(borderLayerAction(at({ transform: { k: 1, tx: 0.2, ty: 0 } }))).toBe('paint');
    expect(borderLayerAction(at({ settled: false, transform: { k: 1, tx: 0.2, ty: 0 } }))).toBe(
      'keep',
    );
  });

  it('зум — слой растянут, пока не мылен и не открыл полстекла; дальше рисуется заново', () => {
    const moving = { settled: false } as const;
    const zoom = (k: number) =>
      borderLayerAction(at({ ...moving, transform: { k, tx: 9, ty: -4 } }));
    expect(zoom(1.6)).toBe('show');
    expect(zoom(MAX_STRETCH)).toBe('show');
    expect(zoom(SHRINK_LIMIT)).toBe('show');
    expect(zoom(MAX_STRETCH * 1.01)).toBe('paint');
    expect(zoom(SHRINK_LIMIT * 0.99)).toBe('paint');
    expect(zoom(Number.NaN)).toBe('paint');
  });

  it('после зума слой ждёт чёткую выпечку растянутым и рисуется, когда она легла', () => {
    const zoomed = { transform: { k: 1.4, tx: -10, ty: -20 } };
    expect(borderLayerAction(at({ ...zoomed, sharp: false }))).toBe('show');
    expect(borderLayerAction(at(zoomed))).toBe('paint');
  });

  it('в кадре, где перепеклась карта, годный слой ждёт кадр растянутым', () => {
    const over = { settled: false, transform: { k: MAX_STRETCH * 1.05, tx: 0, ty: 0 } } as const;
    expect(borderLayerAction(at({ ...over, baked: true }))).toBe('show');
    expect(borderLayerAction(at({ ...over, baked: false }))).toBe('paint');
    // Камера встала после зума, и в этом же кадре легла чёткая выпечка.
    expect(borderLayerAction(at({ transform: { k: 1.4, tx: 0, ty: 0 }, baked: true }))).toBe(
      'show',
    );
    // Сменились границы — ждать нельзя: старых границ слой не показывает.
    expect(borderLayerAction(at({ ...over, fresh: false, baked: true }))).toBe('paint');
    // Прыжок камеры, а не шаг жеста: растянутым слою не показаться.
    const jump = (k: number): string =>
      borderLayerAction(at({ settled: false, transform: { k, tx: 0, ty: 0 }, baked: true }));
    expect(jump(MAX_STRETCH * WAIT_SLACK)).toBe('show');
    expect(jump(SHRINK_LIMIT / WAIT_SLACK)).toBe('show');
    expect(jump(MAX_STRETCH * WAIT_SLACK * 1.01)).toBe('paint');
    expect(jump(SHRINK_LIMIT / WAIT_SLACK / 1.01)).toBe('paint');
    expect(jump(8)).toBe('paint');
    expect(jump(Number.NaN)).toBe('paint');
    // Остальное от перепечки не зависит.
    expect(borderLayerAction(at({ baked: true }))).toBe('keep');
    expect(
      borderLayerAction(at({ settled: false, transform: { k: 1, tx: 3, ty: 0 }, baked: true })),
    ).toBe('scroll');
  });

  it('сменились границы — слой рисуется заново сразу, и посреди жеста', () => {
    expect(borderLayerAction(at({ fresh: false, settled: false }))).toBe('paint');
    expect(borderLayerAction(at({ fresh: false, sharp: false }))).toBe('paint');
    expect(borderLayerAction(at({ fresh: false }))).toBe('paint');
  });
});

describe('прямоугольники слоя (правило 3)', () => {
  const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('intersectRect — общая часть или ничего', () => {
    expect(intersectRect(r(0, 0, 10, 10), r(5, -5, 10, 10))).toEqual(r(5, 0, 5, 5));
    expect(intersectRect(r(0, 0, 10, 10), r(10, 0, 5, 5))).toBeNull();
  });

  it('framedRect — слой в кадре, только целиком покрытые пиксели', () => {
    expect(framedRect(r(10, 20, 100, 50), { k: 1, tx: 3, ty: -2 }, 2)).toEqual(r(16, 16, 100, 50));
    expect(framedRect(r(10, 10, 100, 100), { k: 1.5, tx: 0.25, ty: 0 }, 2)).toEqual(
      r(16, 15, 149, 150),
    );
    expect(framedRect(r(0, 0, 1, 1), { k: 0.5, tx: 0.1, ty: 0 }, 1)).toBeNull();
  });

  it('uncoveredRects — открывшиеся края без перекрытий и без дыр', () => {
    const outer = r(0, 0, 100, 80);
    const strips = uncoveredRects(outer, r(10, 5, 70, 60));
    expect(strips).toEqual([r(0, 0, 100, 5), r(0, 65, 100, 15), r(0, 5, 10, 60), r(80, 5, 20, 60)]);
    const area = strips.reduce((a, s) => a + s.width * s.height, 0);
    expect(area + 70 * 60).toBe(100 * 80);
    for (const a of strips)
      for (const b of strips) if (a !== b) expect(intersectRect(a, b)).toBeNull();
  });

  it('uncoveredRects — сдвиг панорамы открывает полосу, а не весь слой', () => {
    expect(uncoveredRects(r(0, 0, 100, 80), r(-6, 0, 100, 80))).toEqual([r(94, 0, 6, 80)]);
    expect(uncoveredRects(r(0, 0, 100, 80), r(0, 0, 100, 80))).toEqual([]);
    expect(uncoveredRects(r(0, 0, 100, 80), null)).toEqual([r(0, 0, 100, 80)]);
    expect(uncoveredRects(r(0, 0, 100, 80), r(200, 0, 10, 10))).toEqual([r(0, 0, 100, 80)]);
  });
});
