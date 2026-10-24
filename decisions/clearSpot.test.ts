import { describe, expect, it } from 'vitest';
import { nearestClearSpot } from './clearSpot';

const view = { width: 1000, height: 600 };
/** Окно флота снизу посередине, как на ПК: всё, что ниже 300 px между 200 и 800 по x. */
const underWindow = (p: { x: number; y: number }) => p.y > 300 && p.x > 200 && p.x < 800;

describe('nearestClearSpot (ONB-14)', () => {
  it('выводит мир из-под окна в ближайшее свободное место', () => {
    const spot = nearestClearSpot({ x: 500, y: 400 }, view, (p) => !underWindow(p))!;
    expect(underWindow(spot)).toBe(false);
    // Прямо над окном ближе, чем сбоку от него.
    expect(spot).toEqual({ x: 480, y: 288 });
  });

  it('держит отступ от краёв: кольцо у края обрезалось бы', () => {
    const spot = nearestClearSpot({ x: 0, y: 0 }, view, () => true, { margin: 96 })!;
    expect(spot).toEqual({ x: 96, y: 96 });
  });

  it('некуда — так и отвечает, проверив не больше `limit` мест', () => {
    let probes = 0;
    const none = nearestClearSpot({ x: 500, y: 300 }, view, () => (probes++, false), {
      limit: 25,
    });
    expect(none).toBeNull();
    expect(probes).toBe(25);
  });
});
