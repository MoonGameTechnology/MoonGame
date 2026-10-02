import { describe, expect, it } from 'vitest';
import { NARROW_LAYOUT_WIDTHS, SHORT_LAYOUT_HEIGHTS, narrowLayouts, pcScale } from './pcScale';

describe('масштаб интерфейса ПК (UIX-2.1)', () => {
  it('растёт с высотой окна: высота / 864', () => {
    expect(pcScale(1366, 768)).toBe(1);
    expect(pcScale(1920, 1080)).toBe(1.25);
    expect(pcScale(2560, 1440)).toBe(1.667);
  });

  it('ниже 864 px не мельчит, выше 2 не растёт', () => {
    expect(pcScale(1280, 600)).toBe(1);
    expect(pcScale(3840, 2160)).toBe(2);
    expect(pcScale(7680, 4320)).toBe(2);
  });

  it('раскладке под зумом остаётся не меньше 1366 px ширины', () => {
    // Браузер на половине монитора 2560×1440: по высоте было бы 1,667.
    expect(pcScale(1280, 1440)).toBe(1);
    // Монитор 4:3 растёт, пока ширина позволяет.
    expect(pcScale(1600, 1200)).toBe(1.171);
    expect(1600 / pcScale(1600, 1200)).toBeGreaterThanOrEqual(1366);
    // 16:10 упирается в высоту, как 16:9.
    expect(pcScale(1920, 1200)).toBe(1.389);
  });

  it('нечисловой замер окна — масштаб 1', () => {
    expect(pcScale(Number.NaN, 1080)).toBe(1);
    expect(pcScale(1920, Number.NaN)).toBe(1);
    expect(pcScale(0, 0)).toBe(1);
  });
});

describe('«Размер интерфейса» игрока (UIX-2.2)', () => {
  it('умножает масштаб по окну', () => {
    expect(pcScale(1920, 1080, 100)).toBe(1.25);
    expect(pcScale(1920, 1080, 150)).toBe(1.875);
    expect(pcScale(1920, 1080, 80)).toBe(1);
    expect(pcScale(1366, 768, 80)).toBe(0.8);
    // Потолок 2 — только у масштаба по окну: 4K при 150 % — втрое, при 80 % — 1,6.
    expect(pcScale(3840, 2160, 150)).toBe(3);
    expect(pcScale(3840, 2160, 80)).toBe(1.6);
  });

  it('на экранах от 1366×768 доступны все 150 %', () => {
    expect(pcScale(1366, 768, 150)).toBe(1.5);
    expect(pcScale(2560, 1440, 150)).toBe(2.5);
  });

  it('раскладку меньше 900 × 500 px множитель не сжимает', () => {
    // 1280×720: по ширине 1280 / 900 = 1,422.
    expect(pcScale(1280, 720, 150)).toBe(1.422);
    // 1024×600: по ширине 1024 / 900 = 1,138.
    expect(pcScale(1024, 600, 150)).toBe(1.138);
    // Окно уже 900 px: расти некуда, остаётся масштаб по окну.
    expect(pcScale(880, 700, 150)).toBe(1);
  });

  it('нечисловой множитель — 100 %', () => {
    expect(pcScale(1920, 1080, Number.NaN)).toBe(1.25);
    expect(pcScale(1920, 1080, 0)).toBe(1.25);
  });
});

describe('узкие раскладки под зумом (UIX-2.2)', () => {
  const on = (layouts: Record<string, boolean>): string[] =>
    Object.entries(layouts)
      .filter(([, v]) => v)
      .map(([k]) => k);

  it('при зуме 1 совпадают с медиа-запросами по окну', () => {
    for (const w of [720, 899, 900, 901, 980, 1050, 1100, 1199, 1200, 1201, 1366])
      for (const n of NARROW_LAYOUT_WIDTHS)
        expect(narrowLayouts(w, 900, 1)[`holo-w${n}`]).toBe(w <= n);
    for (const h of [520, 649, 650, 651, 760, 761])
      for (const n of SHORT_LAYOUT_HEIGHTS)
        expect(narrowLayouts(1366, h, 1)[`holo-h${n}`]).toBe(h <= n);
  });

  it('под зумом считаются от раскладки', () => {
    // Ноутбук при 150 %: раскладка 911×512.
    expect(on(narrowLayouts(1366, 768, 1.5))).toEqual([
      'holo-w1200',
      'holo-w1100',
      'holo-w1050',
      'holo-w980',
      'holo-h760',
      'holo-h650',
    ]);
    // 1080p при 100 %: раскладка 1536×864 — узких нет, как и по окну.
    expect(on(narrowLayouts(1920, 1080, 1.25))).toEqual([]);
    // 1080p при 150 %: раскладка 1024×576.
    expect(on(narrowLayouts(1920, 1080, 1.875))).toEqual([
      'holo-w1200',
      'holo-w1100',
      'holo-w1050',
      'holo-h760',
      'holo-h650',
    ]);
    // 80 % на окне 1100×700: раскладка 1375×875 — просторнее окна, узких нет.
    expect(on(narrowLayouts(1100, 700, 0.8))).toEqual([]);
  });

  it('нечисловой зум — как зум 1', () => {
    expect(narrowLayouts(1000, 700, Number.NaN)).toEqual(narrowLayouts(1000, 700, 1));
    expect(narrowLayouts(1000, 700, 0)).toEqual(narrowLayouts(1000, 700, 1));
  });
});
