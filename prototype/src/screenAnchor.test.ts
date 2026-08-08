import { describe, it, expect } from 'vitest';
import {
  MENU_GUTTER,
  TOP_CHROME,
  clampMenuLeft,
  pushBelowChrome,
  toScreen,
  type CanvasBox,
} from './screenAnchor';

const VW = 1000;
const VH = 500;
// холст ужат панелью справа и сдвинут рамкой страницы
const холст: CanvasBox = { left: 40, top: 20, width: 500, height: 250 };

describe('якорь на экране — проекция холста', () => {
  it('СЧИТАЕМ ОТ ХОЛСТА, А НЕ ОТ ОКНА: иначе меню уедет на ширину боковой панели', () => {
    expect(toScreen({ x: 0, y: 0 }, холст, VW, VH)).toEqual({ x: 40, y: 20 });
  });

  it('дальний угол холста — его дальний угол на странице', () => {
    expect(toScreen({ x: VW, y: VH }, холст, VW, VH)).toEqual({ x: 540, y: 270 });
  });

  it('МАСШТАБ ПО КАЖДОЙ ОСИ СВОЙ — иначе на нестандартном соотношении разъедется по вертикали', () => {
    const узкий: CanvasBox = { left: 0, top: 0, width: 500, height: 500 };
    // по X сжатие вдвое, по Y растяжение вдвое — единый множитель дал бы одно и то же
    expect(toScreen({ x: 500, y: 250 }, узкий, VW, VH)).toEqual({ x: 250, y: 250 });
  });

  it('середина холста — середина его места на странице', () => {
    expect(toScreen({ x: VW / 2, y: VH / 2 }, холст, VW, VH)).toEqual({ x: 290, y: 145 });
  });
});

describe('якорь на экране — меню не уезжает за край', () => {
  it('в середине экрана меню стоит там, где точка', () => {
    expect(clampMenuLeft(400, 200, 1000)).toBe(400);
  });

  it('У ЛЕВОГО КРАЯ ОТОДВИГАЕТСЯ НА ПОЛШИРИНЫ: меню центрировано по точке', () => {
    expect(clampMenuLeft(10, 200, 1000)).toBe(100 + MENU_GUTTER);
  });

  it('у правого края — симметрично', () => {
    expect(clampMenuLeft(990, 200, 1000)).toBe(1000 - 100 - MENU_GUTTER);
  });

  it('ровно на границе зажатия ничего не двигается', () => {
    const край = 100 + MENU_GUTTER;
    expect(clampMenuLeft(край, 200, 1000)).toBe(край);
  });
});

describe('якорь на экране — из-под верхнего хрома', () => {
  it('ОПУСКАЕМ НА РАЗНИЦУ, А НЕ В АБСОЛЮТНЫЕ 96: меню сдвинуто трансформом', () => {
    // css-top 300, измеренная кромка 50 — сдвиг трансформа 250 px
    expect(pushBelowChrome(300, 50)).toBe(300 + (TOP_CHROME - 50));
  });

  it('меню ниже хрома не трогаем', () => {
    expect(pushBelowChrome(300, TOP_CHROME + 1)).toBe(300);
  });

  it('кромка ровно по хрому — уже не под ним', () => {
    expect(pushBelowChrome(300, TOP_CHROME)).toBe(300);
  });

  it('кромка выше экрана — опускаем и её', () => {
    expect(pushBelowChrome(10, -40)).toBe(10 + TOP_CHROME + 40);
  });
});
