import { describe, it, expect } from 'vitest';
import {
  MENU_GUTTER,
  TOP_CHROME,
  clampMenuLeft,
  fromScreen,
  pushBelowChrome,
  stickToPoint,
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

// ── Общая посадка коробки (REFM-133) ─────────────────────────────────────────
describe('коробка над точкой карты — обе поправки разом', () => {
  const ЭКРАН = 1280;
  const КОРОБКА = { width: 172, top: 300 };

  it('в середине экрана и ниже хрома не двигается никуда', () => {
    expect(stickToPoint({ x: 640, y: 300 }, КОРОБКА, ЭКРАН)).toEqual({ x: 640, y: 300 });
  });

  it('У КРАЯ ЗАЖИМАЕТ: коробка центрирована по точке, иначе её срезало бы', () => {
    expect(stickToPoint({ x: 1270, y: 300 }, КОРОБКА, ЭКРАН).x).toBe(1280 - (172 / 2 + 6));
    expect(stickToPoint({ x: 4, y: 300 }, КОРОБКА, ЭКРАН).x).toBe(172 / 2 + 6);
  });

  it('ИЗ-ПОД ХРОМА ОПУСКАЕТ НА РАЗНИЦУ, а не ставит в абсолютные 96', () => {
    expect(stickToPoint({ x: 640, y: 110 }, { width: 172, top: 20 }, ЭКРАН).y).toBe(110 + 76);
  });

  it('обе поправки применяются в одном жесте', () => {
    expect(stickToPoint({ x: 1270, y: 110 }, { width: 172, top: 20 }, ЭКРАН)).toEqual({
      x: 1280 - (172 / 2 + 6),
      y: 186,
    });
  });

  it('положение выдаётся целыми пикселями — коробку ставят в них же (правило 5)', () => {
    const at = stickToPoint({ x: 33, y: 111 }, { width: 171, top: 21 }, ЭКРАН);
    expect(Number.isInteger(at.x)).toBe(true);
    expect(Number.isInteger(at.y)).toBe(true);
  });
});

// ── Обратный перевод (REFM-134) ──────────────────────────────────────────────
describe('страница → холст', () => {
  // холст РАСТЯНУТ: 1200×600 css-пикселей под 800×600 своих единиц, масштаб по осям разный
  const ХОЛСТ = { left: 40, top: 20, width: 1200, height: 600 };
  const VW = 800;
  const VH = 600;

  it('углы холста переводятся в углы его системы координат', () => {
    expect(fromScreen({ x: 40, y: 20 }, ХОЛСТ, VW, VH)).toEqual({ x: 0, y: 0 });
    expect(fromScreen({ x: 1240, y: 620 }, ХОЛСТ, VW, VH)).toEqual({ x: VW, y: VH });
  });

  it('СЧИТАЕТ ОТ ИЗМЕРЕННОГО ПРЯМОУГОЛЬНИКА: отступ страницы вычитается, а не игнорируется', () => {
    // без вычитания left/top тап уезжал бы на величину бокового отступа
    expect(fromScreen({ x: 640, y: 320 }, ХОЛСТ, VW, VH)).toEqual({ x: 400, y: 300 });
  });

  it('ТОЧНАЯ ПАРА ПРЯМОМУ: «спроецировал → расспроецировал» возвращает ту же точку', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 137, y: 401 },
      { x: 799, y: 599 },
      { x: 400, y: 300 },
    ]) {
      const назад = fromScreen(toScreen(p, ХОЛСТ, VW, VH), ХОЛСТ, VW, VH);
      expect(назад.x).toBeCloseTo(p.x, 9);
      expect(назад.y).toBeCloseTo(p.y, 9);
    }
  });

  it('пара держится и в обратную сторону, и на других размерах холста', () => {
    for (const box of [
      { left: 0, top: 0, width: 360, height: 640 },
      { left: 12, top: 96, width: 1917, height: 903 },
    ])
      for (const pt of [
        { x: box.left, y: box.top },
        { x: box.left + box.width / 3, y: box.top + box.height / 7 },
      ]) {
        const туда = toScreen(fromScreen(pt, box, VW, VH), box, VW, VH);
        expect(туда.x).toBeCloseTo(pt.x, 9);
        expect(туда.y).toBeCloseTo(pt.y, 9);
      }
  });
});
