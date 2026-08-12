import { describe, it, expect } from 'vitest';
import { GRID_BASE_PX, GRID_MIN_PX, gridGap, gridLines, gridOffset } from './backdropGrid';

describe('сетка фона — шаг', () => {
  it('при масштабе 1 клетка — базовая', () => {
    expect(gridGap(1)).toBe(GRID_BASE_PX);
  });

  it('вблизи клетка растёт вместе с масштабом', () => {
    expect(gridGap(2)).toBe(2 * GRID_BASE_PX);
    expect(gridGap(4)).toBe(4 * GRID_BASE_PX);
  });

  it('ШАГ НЕ МЕЛЬЧЕ ПОРОГА: иначе на общем плане линии слились бы в кашу', () => {
    expect(gridGap(0.1)).toBe(GRID_MIN_PX);
    expect(gridGap(0.01)).toBe(GRID_MIN_PX);
    expect(gridGap(0)).toBe(GRID_MIN_PX);
  });

  it('шаг монотонен по масштабу — сетка не дёргается при плавном зуме', () => {
    let prev = 0;
    for (let sc = 0.05; sc <= 8; sc += 0.05) {
      const g = gridGap(sc);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('сетка фона — смещение под камерой', () => {
  it('смещение всегда в пределах клетки', () => {
    for (const pan of [-1000, -57, -56, -55, -1, 0, 1, 55, 56, 57, 1000]) {
      const off = gridOffset(pan, 56);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(56);
    }
  });

  it('ОТРИЦАТЕЛЬНАЯ КАМЕРА НЕ ДАЁТ ОТРИЦАТЕЛЬНОГО СМЕЩЕНИЯ: иначе сетка прыгает на нуле', () => {
    expect(gridOffset(-1, 56)).toBe(55);
    expect(gridOffset(-56, 56)).toBe(0);
    expect(gridOffset(-57, 56)).toBe(55);
    expect(gridOffset(-1, 56)).not.toBe(-1); // наивный `%` вернул бы именно это
  });

  it('сетка едет НЕПРЕРЫВНО через ноль — соседние камеры дают соседние смещения', () => {
    const step = Math.abs(gridOffset(0.5, 56) - gridOffset(-0.5, 56));
    expect(Math.min(step, 56 - step)).toBeCloseTo(1, 6);
  });

  it('сдвиг ровно на клетку возвращает ту же картинку', () => {
    expect(gridOffset(13, 56)).toBeCloseTo(gridOffset(13 + 56, 56), 9);
    expect(gridOffset(13, 56)).toBeCloseTo(gridOffset(13 - 56, 56), 9);
  });
});

describe('сетка фона — где лежат линии', () => {
  it('первая линия — на смещении, дальше через клетку', () => {
    expect(gridLines(10, 200, 56)).toEqual([10, 66, 122, 178]);
  });

  it('КРАЙ ВКЛЮЧЁН: строгое «меньше» оставило бы непрокрашенную полосу у края', () => {
    expect(gridLines(0, 112, 56)).toEqual([0, 56, 112]);
  });

  it('линии покрывают всю ширину — до края не больше клетки', () => {
    for (const pan of [-333, -1, 0, 77, 500]) {
      const gap = gridGap(1.3);
      const lines = gridLines(gridOffset(pan, gap), 1280, gap);
      expect(lines[0]).toBeLessThan(gap);
      expect(1280 - lines[lines.length - 1]!).toBeLessThan(gap);
    }
  });

  it('экран уже клетки — линия всё равно одна, а не ноль', () => {
    expect(gridLines(0, 10, 56)).toEqual([0]);
  });

  it('смещение за краем не даёт линий', () => {
    expect(gridLines(30, 10, 56)).toEqual([]);
  });
});
