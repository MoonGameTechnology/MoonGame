import { describe, it, expect } from 'vitest';
import {
  fitTransform,
  worldToScreen,
  type Bounds,
  type Cam,
  type Viewport,
} from '../../packages/client/src/camera';
import { mapScale, screenRadius } from './mapRadius';

const VP: Viewport = { left: 0, right: 1280, top: 0, bottom: 800 };
const B: Bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 2400 };

describe('дальность карты на экране', () => {
  it('МНОЖИТЕЛЬ — ПОДГОН ПОД ЭКРАН × ЗУМ: один зум камеры дал бы круг меньше настоящей дальности', () => {
    const fit = fitTransform(VP, B).scale;
    expect(mapScale(fit, 2)).toBe(fit * 2);
    // именно эта ошибка и была: множитель без подгона занижает радиус во столько раз,
    // во сколько карта вписана в экран
    expect(mapScale(fit, 2)).toBeLessThan(2);
    expect(screenRadius(100, mapScale(fit, 1))).toBeCloseTo(100 * fit);
  });

  it('перевод линеен: вдвое большая дальность — вдвое больший круг', () => {
    const k = mapScale(0.3, 2);
    expect(screenRadius(200, k)).toBeCloseTo(2 * screenRadius(100, k));
    expect(screenRadius(0, k)).toBe(0);
  });

  it('ПРОЕКЦИЯ РАВНОМЕРНА ПО ОСЯМ: круг остаётся кругом, эллипс обещал бы небывалое', () => {
    for (const scale of [1, 1.7, 3, 6])
      for (const cam of [
        { x: 0, y: 0 },
        { x: -320, y: 140 },
      ]) {
        const c: Cam = { scale, ...cam };
        const at = { x: 1500, y: 900 };
        const centre = worldToScreen(at, c, VP, B);
        const пoX = worldToScreen({ x: at.x + 250, y: at.y }, c, VP, B).x - centre.x;
        const пoY = worldToScreen({ x: at.x, y: at.y + 250 }, c, VP, B).y - centre.y;
        expect(пoY).toBeCloseTo(пoX, 9); // полуоси совпадают — это и есть круг
      }
  });

  it('ОКОЛЬНЫЙ ПУТЬ ДАЁТ ТО ЖЕ ЧИСЛО: проекция смещённой точки — тот же множитель', () => {
    const fit = fitTransform(VP, B).scale;
    for (const scale of [1, 2.5, 6])
      for (const reach of [10, 137, 900]) {
        const c: Cam = { scale, x: -200, y: 90 };
        const at = { x: 2000, y: 1200 };
        const пробой =
          worldToScreen({ x: at.x + reach, y: at.y }, c, VP, B).x - worldToScreen(at, c, VP, B).x;
        expect(screenRadius(reach, mapScale(fit, scale))).toBeCloseTo(пробой, 9);
      }
  });
});
