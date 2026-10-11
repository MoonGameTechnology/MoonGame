import { describe, expect, it } from 'vitest';

import {
  LIVING_BANDS,
  MIN_LAYER_SEGMENTS,
  bandEdges,
  glassPixels,
  staleBand,
} from './livingBorderLayer';

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

describe('staleBand — какую полосу перерисовать (правила 2 и 5)', () => {
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

it('через слой идут границы от тысячи отрезков (правило 4)', () => {
  expect(MIN_LAYER_SEGMENTS).toBe(1000);
});
