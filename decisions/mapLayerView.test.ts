import { describe, expect, it } from 'vitest';

import {
  FIRST_BAND_SHARE,
  CELL_WORK,
  EMPTY_WORK,
  MAX_BAKE_BUDGET_MS,
  MAX_BAKE_PIXELS,
  MAX_STRETCH,
  MIN_BAKE_BUDGET_MS,
  MIN_BAND_MS,
  MIN_BAND_ROWS,
  RESERVE_SHARE,
  bakeBudgetMs,
  bakeJobFate,
  bakeWork,
  bandRows,
  coversScreen,
  exactOffset,
  exposedStrips,
  gridNudge,
  layerTransform,
  mapLayerAction,
  onPixelGrid,
  overscanFor,
  recentredScroll,
  toBake,
  visibleInBake,
  type BakeJobFrame,
  type BandPlan,
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
    scroll: { x: 0, y: 0 },
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
    // Окно, уехавшее вслед за панорамой, покрывает уже её экран.
    expect(coversScreen({ k: 1, tx: 820, ty: 0 }, 1600, 900, m, { x: -420, y: 0 })).toBe(true);
    expect(coversScreen({ k: 1, tx: 821, ty: 0 }, 1600, 900, m, { x: -420, y: 0 })).toBe(false);
    expect(coversScreen({ k: 1, tx: 20, ty: 0 }, 1600, 900, m, { x: -420, y: 0 })).toBe(true);
    expect(coversScreen({ k: 1, tx: 19, ty: 0 }, 1600, 900, m, { x: -420, y: 0 })).toBe(false);
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
  });

  it('правило 3: панорама за край запаса сдвигает окно выпечки, а не перепекает её', () => {
    expect(mapLayerAction(frame({ transform: { k: 1, tx: 420, ty: 0 } }))).toBe('scroll');
    expect(mapLayerAction(frame({ transform: { k: 1, tx: -300, ty: 260 } }))).toBe('scroll');
    expect(recentredScroll({ k: 1, tx: 420, ty: 0 }, 1)).toEqual({ x: -420, y: 0 });
    // Сдвинутое окно снова покрывает экран, а дальше его ведёт уже его собственный сдвиг.
    const moved = frame({ scroll: { x: -420, y: 0 }, transform: { k: 1, tx: 420, ty: 0 } });
    expect(mapLayerAction(moved)).toBe('show');
    expect(mapLayerAction({ ...moved, transform: { k: 1, tx: 821, ty: 0 } })).toBe('scroll');
    // Сдвиг, после которого от выпечки ничего не осталось: копировать нечего.
    expect(mapLayerAction(frame({ transform: { k: 1, tx: 2399, ty: 0 } }))).toBe('scroll');
    expect(mapLayerAction(frame({ transform: { k: 1, tx: 2400, ty: 0 } }))).toBe('rebake');
    expect(mapLayerAction(frame({ transform: { k: 1, tx: 0, ty: -1350 } }))).toBe('rebake');
    // Зум за краем выпечки сдвигом не лечится: другой масштаб — это пересэмплирование.
    const shrink = (k: number) => ({ k, tx: 800 * (1 - k), ty: 450 * (1 - k) });
    expect(mapLayerAction(frame({ transform: shrink(0.6) }))).toBe('rebake');
  });

  it('правило 3: окно ездит на целые физические пиксели и ставит экран в середину', () => {
    for (const dpr of [1, 1.5, 2, 2.625]) {
      const margin = overscanFor(390, 844, dpr);
      for (const [tx, ty] of [
        [137.31, -402.77],
        [-0.2, 0.2],
        [-9000.5, 12345.25],
      ] as const) {
        const tr = { k: 1, tx, ty };
        const to = recentredScroll(tr, dpr);
        expect(Math.abs(to.x * dpr - Math.round(to.x * dpr))).toBeLessThan(1e-9);
        expect(Math.abs(to.y * dpr - Math.round(to.y * dpr))).toBeLessThan(1e-9);
        expect(Math.abs(to.x + tx)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        expect(Math.abs(to.y + ty)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        expect(coversScreen(onPixelGrid(tr, dpr), 390, 844, margin, to)).toBe(true);
        expect(
          mapLayerAction(
            frame({ width: 390, height: 844, dpr, margin, scroll: to, transform: tr }),
          ),
        ).toBe('show');
      }
    }
    expect(Object.is(recentredScroll({ k: 1, tx: 0.2, ty: -0.2 }, 1).x, 0)).toBe(true);
  });

  it('правило 3: без запаса окно едет за каждым кадром панорамы, но не по кругу', () => {
    const bare = { margin: { x: 0, y: 0 }, dpr: 1 };
    expect(mapLayerAction(frame({ ...bare, transform: { k: 1, tx: 10.3, ty: 0 } }))).toBe('scroll');
    // В движении картинка стоит на целом пикселе: сдвинутое окно её уже покрывает.
    const after = frame({
      ...bare,
      scroll: { x: -10, y: 0 },
      transform: { k: 1, tx: 10.3, ty: 0 },
    });
    expect(mapLayerAction(after)).toBe('show');
  });

  it('правило 3: открывшиеся полосы — ровно то, что не покрыли сдвинутые пиксели', () => {
    const W = 23;
    const H = 17;
    for (const dx of [-30, -23, -7, -1, 0, 1, 5, 22, 23])
      for (const dy of [-17, -4, 0, 3, 16, 40]) {
        const strips = exposedStrips(W, H, dx, dy);
        expect(strips.length).toBeLessThanOrEqual(2);
        for (let x = 0; x < W; x++)
          for (let y = 0; y < H; y++) {
            // Старый пиксель (x + dx, y + dy) переехал сюда, если он был на холсте.
            const copied = x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H;
            const painted = strips.filter(
              (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
            ).length;
            expect(painted, `(${dx}, ${dy}) пиксель ${x},${y}`).toBe(copied ? 0 : 1);
          }
      }
    expect(exposedStrips(W, H, 0, 0)).toEqual([]);
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
    // Панорама, вставшая между пикселями, ставит на сетку камеру, а не перепекает карту.
    expect(mapLayerAction(frame({ settled: true, transform: { k: 1, tx: 37.5, ty: -21 } }))).toBe(
      'snap',
    );
    // Зум на остановке: чёткая выпечка печётся в фоне (правило 7).
    expect(mapLayerAction(frame({ settled: true, transform: { k: 1.2, tx: -160, ty: -90 } }))).toBe(
      'refresh',
    );
    // На экране с плотностью 2 полпикселя CSS — целый физический пиксель.
    expect(
      mapLayerAction(frame({ settled: true, dpr: 2, transform: { k: 1, tx: 37.5, ty: -21 } })),
    ).toBe('show');
  });

  it('правило 4: камера встаёт на сетку меньше чем на полпикселя, и выпечка ложится точно', () => {
    for (const dpr of [1, 1.25, 2]) {
      for (const [tx, ty] of [
        [37.4, -21.3],
        [-0.26, 103.74],
        [12.5, -7.5],
      ] as const) {
        const nudge = gridNudge({ k: 1, tx, ty }, dpr);
        expect(Math.abs(nudge.x)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        expect(Math.abs(nudge.y)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
        // Камера сдвинулась — проекция кадра сдвинулась на столько же.
        const snapped = layerTransform(at(0.4, 0, 0), at(0.4, tx + nudge.x, ty + nudge.y));
        expect(exactOffset(snapped, dpr)).not.toBeNull();
        expect(mapLayerAction(frame({ settled: true, dpr, transform: snapped }))).toBe('show');
      }
    }
  });

  it('правило 7: на остановке после зума новая выпечка печётся в фоне, пока старая покрывает экран', () => {
    const shrink = (k: number) => ({ k, tx: 800 * (1 - k), ty: 450 * (1 - k) });
    expect(mapLayerAction(frame({ settled: true, transform: shrink(1.1) }))).toBe('refresh');
    expect(mapLayerAction(frame({ settled: true, transform: shrink(0.9) }))).toBe('refresh');
    // Край уже открылся бы: ждать нельзя.
    expect(mapLayerAction(frame({ settled: true, transform: shrink(0.66) }))).toBe('rebake');
    // Устаревшее содержимое — всегда сразу (правило 6).
    expect(mapLayerAction(frame({ fresh: false, settled: true, transform: shrink(1.1) }))).toBe(
      'rebake',
    );
  });

  it('правило 7: посреди зума новая выпечка начинается впрок, когда подходит край старой', () => {
    const zoom = (k: number) => ({ k, tx: 800 * (1 - k), ty: 450 * (1 - k) });
    // Приближение вокруг центра от края не уводит: растяжение впрок не печётся.
    expect(mapLayerAction(frame({ transform: zoom(MAX_STRETCH * 0.99) }))).toBe('show');
    // Отдаление вокруг центра при запасе в четверть стороны: до края экрана — k = 2/3, до
    // запаса в десятую долю стороны — k = (1/2 + 1/10) / (1/2 + 1/4) = 0,8.
    expect(RESERVE_SHARE).toBe(0.1);
    expect(mapLayerAction(frame({ transform: zoom(0.81) }))).toBe('show');
    expect(mapLayerAction(frame({ transform: zoom(0.79) }))).toBe('refresh');
    expect(mapLayerAction(frame({ transform: zoom(0.67) }))).toBe('refresh');
    expect(mapLayerAction(frame({ transform: zoom(0.66) }))).toBe('rebake');
    // Приближение у края выпечки: щипок увёл экран к её кромке (левый край — в 100 и в
    // 200 пикселях за экраном, запас — 160).
    expect(mapLayerAction(frame({ transform: { k: 1.2, tx: 400 * 1.2 - 100, ty: -270 } }))).toBe(
      'refresh',
    );
    expect(mapLayerAction(frame({ transform: { k: 1.2, tx: 400 * 1.2 - 200, ty: -270 } }))).toBe(
      'show',
    );
  });

  it('правило 7: покрытие с запасом — тот же экран, выросший на долю стороны с каждого края', () => {
    const m = { x: 400, y: 225 };
    expect(coversScreen({ k: 1, tx: 240, ty: 0 }, 1600, 900, m, undefined, 0.1)).toBe(true);
    expect(coversScreen({ k: 1, tx: 241, ty: 0 }, 1600, 900, m, undefined, 0.1)).toBe(false);
    expect(coversScreen({ k: 1, tx: 0, ty: -135 }, 1600, 900, m, undefined, 0.1)).toBe(true);
    expect(coversScreen({ k: 1, tx: 0, ty: -136 }, 1600, 900, m, undefined, 0.1)).toBe(false);
    expect(coversScreen({ k: 1, tx: 0, ty: 0 }, 1600, 900, { x: 0, y: 0 }, undefined, 0.1)).toBe(
      false,
    );
  });

  describe('правило 7: судьба фоновой выпечки', () => {
    const job = (over: Partial<BakeJobFrame>): BakeJobFrame => ({
      fresh: true,
      transform: { k: 1, tx: 0, ty: 0 },
      margin: { x: 400, y: 225 },
      final: false,
      ...over,
    });
    const zoom = (k: number) => ({ k, tx: 800 * (1 - k), ty: 450 * (1 - k) });

    it('устаревшее содержимое и выпечка, которую не показать, бросаются', () => {
      const layer = frame({ transform: zoom(1.6) });
      expect(bakeJobFate(layer, 'refresh', job({ fresh: false }))).toBe('drop');
      expect(bakeJobFate(layer, 'refresh', job({ transform: zoom(MAX_STRETCH * 1.01) }))).toBe(
        'drop',
      );
      expect(bakeJobFate(layer, 'refresh', job({ transform: zoom(0.66) }))).toBe('drop');
      expect(bakeJobFate(layer, 'refresh', job({ transform: { k: 1, tx: 401, ty: 0 } }))).toBe(
        'drop',
      );
      // Устаревшую не дописывают, даже когда показанную нужно перепечь сразу.
      expect(bakeJobFate(frame({ fresh: false }), 'rebake', job({ fresh: false }))).toBe('drop');
    });

    it('показанную пришлось бы перепечь сразу — годная фоновая дописывается', () => {
      const layer = frame({ transform: zoom(0.6) });
      expect(mapLayerAction(layer)).toBe('rebake');
      expect(bakeJobFate(layer, 'rebake', job({ transform: zoom(0.75) }))).toBe('finish');
      expect(bakeJobFate(layer, 'rebake', job({ transform: zoom(0.6) }))).toBe('drop');
      // И на остановке: оставшиеся полосы дешевле целой выпечки.
      expect(
        bakeJobFate({ ...layer, settled: true }, 'rebake', job({ transform: zoom(0.9) })),
      ).toBe('finish');
    });

    it('на остановке нужна та, что не дальше от камеры, чем показанная', () => {
      const layer = frame({ settled: true, transform: zoom(1.3) });
      expect(bakeJobFate(layer, 'refresh', job({ transform: { k: 1, tx: 0, ty: 0 } }))).toBe(
        'keep',
      );
      // Начатая посреди жеста ляжет не точно, но ближе показанной: её допекают, а не
      // начинают заново на каждой остановке.
      expect(bakeJobFate(layer, 'refresh', job({ transform: zoom(1.05) }))).toBe('keep');
      expect(bakeJobFate(layer, 'refresh', job({ transform: zoom(1.5) }))).toBe('drop');
      // Панорама после её начала: масштаб тот же, сдвиг потом решит правило 4.
      expect(bakeJobFate(layer, 'refresh', job({ transform: { k: 1, tx: 30.5, ty: -12 } }))).toBe(
        'keep',
      );
    });

    it('дописывание рельефа — для камеры на его масштабе', () => {
      const layer = frame({ transform: { k: 1, tx: 20, ty: 0 } });
      expect(
        bakeJobFate(layer, 'show', job({ final: true, transform: { k: 1, tx: 20, ty: 0 } })),
      ).toBe('keep');
      const zoomed = frame({ transform: zoom(1.05) });
      expect(bakeJobFate(zoomed, 'show', job({ final: true, transform: zoom(1.05) }))).toBe('drop');
    });

    it('в движении нужна та, что не дальше от камеры, чем показанная', () => {
      const layer = frame({ transform: zoom(1.6) });
      expect(bakeJobFate(layer, 'refresh', job({ transform: zoom(1.2) }))).toBe('keep');
      // Жест развернулся: показанная ближе, чем фоновая.
      const back = frame({ transform: zoom(1.1) });
      expect(bakeJobFate(back, 'show', job({ transform: zoom(1 / 1.3) }))).toBe('drop');
      expect(bakeJobFate(back, 'show', job({ transform: zoom(1 / 1.05) }))).toBe('keep');
    });
  });

  it('правило 7: бюджет — половина кадра в своих пределах', () => {
    expect(bakeBudgetMs(60)).toBeCloseTo(500 / 60, 9);
    expect(bakeBudgetMs(30)).toBeCloseTo(500 / 30, 9);
    expect(bakeBudgetMs(10)).toBe(MAX_BAKE_BUDGET_MS);
    expect(bakeBudgetMs(240)).toBe(MIN_BAKE_BUDGET_MS);
    expect(bakeBudgetMs(0)).toBe(MIN_BAKE_BUDGET_MS);
    expect(bakeBudgetMs(Number.NaN)).toBe(MIN_BAKE_BUDGET_MS);
  });

  describe('правило 7: работа выпечки', () => {
    const origin = { x: 0, y: 0 };
    const rows = (w: Float64Array) => [...w].slice(1).map((v, r) => v - w[r]!);

    it('пустая выпечка — только пиксели вне провинций', () => {
      expect([...bakeWork([], 100, 4, 1, origin)]).toEqual([0, 10, 20, 30, 40]);
    });

    it('провинция добавляет свои пиксели и свою цену на своих строках', () => {
      const w = rows(bakeWork([10, 1, 30, 3], 100, 4, 1, origin));
      expect(w[0]).toBeCloseTo(10, 9);
      expect(w[1]).toBeCloseTo(10 + 20 + CELL_WORK / 2, 9);
      expect(w[2]).toBeCloseTo(10 + 20 + CELL_WORK / 2, 9);
      expect(w[3]).toBeCloseTo(10, 9);
    });

    it('рамка ставится на холст масштабом и сдвигом и обрезается им', () => {
      // x: −50·2 + 40 = −60 → 0, 20·2 + 40 = 80; y: 0·2 + 1 = 1, 1·2 + 1 = 3. Вторая — за краем.
      const w = rows(bakeWork([-50, 0, 20, 1, 200, 0, 300, 1], 100, 4, 2, { x: 40, y: 1 }));
      expect(w[0]).toBeCloseTo(10, 9);
      expect(w[1]).toBeCloseTo(10 + 80 + CELL_WORK / 2, 9);
      expect(w[2]).toBeCloseTo(10 + 80 + CELL_WORK / 2, 9);
      expect(w[3]).toBeCloseTo(10, 9);
      expect(EMPTY_WORK).toBe(0.1);
    });
  });

  describe('правило 7: полосы', () => {
    // 2532 строки по 100 единиц работы; у густой — строки 1000–1499 заняты провинцией.
    const flat = bakeWork([], 1000, 2532, 1, { x: 0, y: 0 });
    const dense = bakeWork([0, 1000, 1000, 1500], 1000, 2532, 1, { x: 0, y: 0 });
    const plan = (over: Partial<BandPlan>): BandPlan => ({
      work: flat,
      done: 0,
      paintedMs: 0,
      lastRows: 0,
      lastMs: 0,
      budgetMs: 8,
      spentMs: 0,
      ...over,
    });

    it('первая — доля работы выпечки, если начало оставило полбюджета', () => {
      expect(bandRows(plan({}))).toBe(Math.floor(2532 * FIRST_BAND_SHARE));
      expect(bandRows(plan({ spentMs: 3.9 }))).toBe(Math.floor(2532 * FIRST_BAND_SHARE));
      expect(bandRows(plan({ spentMs: 4 }))).toBe(0);
      // Пустой край дёшев: первая полоса берёт его шире.
      expect(bandRows(plan({ work: dense }))).toBe(471);
    });

    it('дальше — по цене работы: средней или прошлой полосы, что дороже', () => {
      // 0,02 мс строка: в 8 мс влезает 400 строк.
      expect(bandRows(plan({ done: 300, paintedMs: 6, lastRows: 300, lastMs: 6 }))).toBe(400);
      // Прошлая полоса дороже средней — она ближе к следующей: 0,02 мс строка, а не 0,01.
      expect(bandRows(plan({ done: 1000, paintedMs: 10, lastRows: 500, lastMs: 10 }))).toBe(400);
      // Часы огрубили полосу до нуля — она всё равно стоила MIN_BAND_MS.
      expect(MIN_BAND_MS).toBe(1);
      expect(bandRows(plan({ done: 100, paintedMs: 0, lastRows: 100, lastMs: 0 }))).toBe(800);
      // Впереди густая середина: та же цена работы даёт полосу короче — 163 строки, а не 800.
      expect(bandRows(plan({ done: 900, paintedMs: 9, lastRows: 900, lastMs: 9 }))).toBe(800);
      expect(
        bandRows(plan({ work: dense, done: 900, paintedMs: 9, lastRows: 900, lastMs: 9 })),
      ).toBe(163);
    });

    it('самая узкая полоса — 1/32 выпечки или MIN_BAND_ROWS строк', () => {
      expect(bandRows(plan({ done: 300, paintedMs: 120, lastRows: 300, lastMs: 120 }))).toBe(80);
      const short = bakeWork([], 1000, 600, 1, { x: 0, y: 0 });
      expect(
        bandRows(plan({ work: short, done: 100, paintedMs: 120, lastRows: 100, lastMs: 120 })),
      ).toBe(MIN_BAND_ROWS);
    });

    it('хвост уже самой узкой полосы дописывается вместе с ней, выпечка кончается целиком', () => {
      expect(bandRows(plan({ done: 2400, paintedMs: 24, lastRows: 400, lastMs: 4 }))).toBe(132);
      expect(bandRows(plan({ done: 2532 }))).toBe(0);
      // Любая цена строк: строки складываются ровно в выпечку за ограниченное число кадров.
      for (const work of [flat, dense])
        for (const cost of [0, 0.001, 0.03, 0.2, 5]) {
          let done = 0;
          let painted = 0;
          let last = 0;
          let frames = 0;
          while (done < 2532) {
            const rows = bandRows(
              plan({ work, done, paintedMs: painted, lastRows: last, lastMs: last * cost }),
            );
            expect(rows).toBeGreaterThan(0);
            done += rows;
            painted += rows * cost;
            last = rows;
            frames++;
          }
          expect(done).toBe(2532);
          expect(frames).toBeLessThanOrEqual(33);
        }
    });
  });
});
