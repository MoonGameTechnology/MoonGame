import { describe, expect, it } from 'vitest';

import {
  MAX_BAKE_PIXELS,
  MAX_STRETCH,
  coversScreen,
  exactOffset,
  layerTransform,
  mapLayerAction,
  onPixelGrid,
  overscanFor,
  toBake,
  visibleInBake,
  type MapLayerFrame,
  type MapProjection,
} from './mapLayerView';

const at = (a: number, x: number, y: number): MapProjection => ({ a, x, y });
const project = (p: MapProjection, x: number, y: number) => ({
  x: p.a * x + p.x,
  y: p.a * y + p.y,
});

function frame(over: Partial<MapLayerFrame>): MapLayerFrame {
  return {
    fresh: true,
    transform: { k: 1, tx: 0, ty: 0 },
    width: 1600,
    height: 900,
    dpr: 1,
    margin: { x: 400, y: 225 },
    settled: false,
    ...over,
  };
}

describe('mapLayerView', () => {
  it('правило 1: преобразование переводит точку выпечки ровно туда, куда её ставит новая камера', () => {
    const baked = at(0.37, 120.5, -48.25);
    const now = at(0.37 * 1.6, -310.75, 92.5);
    const tr = layerTransform(baked, now);
    for (const [x, y] of [
      [0, 0],
      [1000, -250],
      [-3000, 4200],
    ] as const) {
      const from = project(baked, x, y);
      const to = project(now, x, y);
      expect(tr.k * from.x + tr.tx).toBeCloseTo(to.x, 9);
      expect(tr.k * from.y + tr.ty).toBeCloseTo(to.y, 9);
      const back = toBake(tr, to.x, to.y);
      expect(back.x).toBeCloseTo(from.x, 9);
      expect(back.y).toBeCloseTo(from.y, 9);
    }
  });

  it('правило 1: панорама — масштаб ровно 1, сдвиг — разность камер', () => {
    const tr = layerTransform(at(0.5, 10, 20), at(0.5, 47, -1));
    expect(tr.k).toBe(1);
    expect(tr.tx).toBeCloseTo(37, 12);
    expect(tr.ty).toBeCloseTo(-21, 12);
  });

  it('видимая часть выпечки — экран кадра, переведённый обратно', () => {
    expect(visibleInBake({ k: 2, tx: -100, ty: 50 }, 800, 600)).toEqual({
      x: 50,
      y: -25,
      width: 400,
      height: 300,
    });
  });

  it('правило 2: запас — четверть стороны, если влезает в бюджет, и кратен физическому пикселю', () => {
    expect(overscanFor(1600, 900, 1)).toEqual({ x: 400, y: 225 });
    const phone = overscanFor(390, 844, 2.625);
    expect(phone.x).toBeGreaterThan(0);
    expect(Math.abs(phone.x * 2.625 - Math.round(phone.x * 2.625))).toBeLessThan(1e-9);
    expect(Math.abs(phone.y * 2.625 - Math.round(phone.y * 2.625))).toBeLessThan(1e-9);
  });

  it('правило 2: плотный экран получает меньший запас, и выпечка не выходит за бюджет', () => {
    for (const [w, h, dpr] of [
      [390, 844, 3],
      [1920, 1080, 1],
      [1440, 900, 2],
    ] as const) {
      const m = overscanFor(w, h, dpr);
      const pixels = (w + 2 * m.x) * dpr * (h + 2 * m.y) * dpr;
      expect(pixels).toBeLessThanOrEqual(MAX_BAKE_PIXELS);
      expect(m.x).toBeLessThanOrEqual(w / 2);
    }
    // Экран больше бюджета: запаса нет, но сам экран печётся.
    expect(overscanFor(2560, 1440, 2)).toEqual({ x: 0, y: 0 });
  });

  it('целый сдвиг при масштабе 1 — пиксель в пиксель, дробный или зум — нет', () => {
    expect(exactOffset({ k: 1, tx: 36.99999999999999, ty: -21 }, 1)).toEqual({ x: 37, y: -21 });
    expect(exactOffset({ k: 1, tx: 18.5, ty: 3 }, 2)).toEqual({ x: 37, y: 6 });
    expect(exactOffset({ k: 1, tx: 18.5, ty: 3 }, 1)).toBeNull();
    expect(exactOffset({ k: 1.0001, tx: 0, ty: 0 }, 1)).toBeNull();
  });

  it('покрытие: панорама в пределах запаса покрывает экран, за его краем — нет', () => {
    const m = { x: 400, y: 225 };
    expect(coversScreen({ k: 1, tx: 400, ty: -225 }, 1600, 900, m)).toBe(true);
    expect(coversScreen({ k: 1, tx: 401, ty: 0 }, 1600, 900, m)).toBe(false);
    expect(coversScreen({ k: 1, tx: 0, ty: -226 }, 1600, 900, m)).toBe(false);
    // Отдаление вокруг центра: выпечка сжимается, её края входят в экран.
    const shrink = (k: number) => ({ k, tx: 800 * (1 - k), ty: 450 * (1 - k) });
    expect(coversScreen(shrink(0.67), 1600, 900, m)).toBe(true);
    expect(coversScreen(shrink(0.66), 1600, 900, m)).toBe(false);
  });

  it('правило 5: панорама в движении ложится на целые физические пиксели, зум — нет', () => {
    const pan = onPixelGrid({ k: 1, tx: 120.3, ty: -80.9 }, 2);
    expect(pan).toEqual({ k: 1, tx: 120.5, ty: -81 });
    expect(exactOffset(pan, 2)).toEqual({ x: 241, y: -162 });
    const zoom = { k: 1.25, tx: 3.3, ty: 4.4 };
    expect(onPixelGrid(zoom, 2)).toBe(zoom);
  });

  it('правило 6: устаревшее содержимое перепекается, где бы ни стояла камера', () => {
    expect(mapLayerAction(frame({ fresh: false }))).toBe('rebake');
    expect(mapLayerAction(frame({ fresh: false, settled: true }))).toBe('rebake');
  });

  it('правило 3: в движении показывается старая выпечка, пока она покрывает экран', () => {
    expect(mapLayerAction(frame({ transform: { k: 1, tx: 120.25, ty: -80.5 } }))).toBe('show');
    expect(mapLayerAction(frame({ transform: { k: 1.5, tx: -400, ty: -225 } }))).toBe('show');
    expect(mapLayerAction(frame({ transform: { k: 1, tx: 420, ty: 0 } }))).toBe('rebake');
  });

  it('правило 3: слишком растянутая выпечка перепекается и посреди жеста', () => {
    const zoom = (k: number) => ({ k, tx: 800 * (1 - k), ty: 450 * (1 - k) });
    expect(mapLayerAction(frame({ transform: zoom(MAX_STRETCH * 0.99) }))).toBe('show');
    expect(mapLayerAction(frame({ transform: zoom(MAX_STRETCH * 1.01) }))).toBe('rebake');
    expect(mapLayerAction(frame({ transform: { k: 0, tx: 0, ty: 0 } }))).toBe('rebake');
    expect(mapLayerAction(frame({ transform: { k: Number.NaN, tx: 0, ty: 0 } }))).toBe('rebake');
  });

  it('правило 4: в покое остаётся только выпечка, что ложится пиксель в пиксель', () => {
    expect(mapLayerAction(frame({ settled: true, transform: { k: 1, tx: 37, ty: -21 } }))).toBe(
      'show',
    );
    expect(mapLayerAction(frame({ settled: true, transform: { k: 1, tx: 37.5, ty: -21 } }))).toBe(
      'rebake',
    );
    expect(mapLayerAction(frame({ settled: true, transform: { k: 1.2, tx: -160, ty: -90 } }))).toBe(
      'rebake',
    );
    // На экране с плотностью 2 полпикселя CSS — целый физический пиксель.
    expect(
      mapLayerAction(frame({ settled: true, dpr: 2, transform: { k: 1, tx: 37.5, ty: -21 } })),
    ).toBe('show');
  });
});
