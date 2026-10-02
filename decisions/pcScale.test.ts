import { describe, expect, it } from 'vitest';
import { pcScale } from './pcScale';

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
