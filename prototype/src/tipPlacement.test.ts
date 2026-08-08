import { describe, it, expect } from 'vitest';
import {
  HOLD_EDGE,
  HOLD_GAP,
  HOLD_SLOP_PX,
  TIP_EDGE,
  TIP_PAD,
  cursorTipPos,
  holdTipPos,
  movedTooFar,
} from './tipPlacement';

const ЭКРАН = { width: 1000, height: 800 };
const ПОДСКАЗКА = { width: 200, height: 100 };

describe('подсказка у курсора', () => {
  it('ОТСТУПАЕТ ОТ КУРСОРА: иначе указатель закроет первую строку своего же текста', () => {
    expect(cursorTipPos({ x: 300, y: 300 }, ПОДСКАЗКА, ЭКРАН)).toEqual({
      x: 300 + TIP_PAD,
      y: 300 + TIP_PAD,
    });
  });

  it('У ПРАВОГО КРАЯ ПЕРЕВОРАЧИВАЕТСЯ ВЛЕВО, а не выезжает за экран', () => {
    const p = cursorTipPos({ x: 950, y: 300 }, ПОДСКАЗКА, ЭКРАН);
    expect(p.x).toBe(950 - ПОДСКАЗКА.width - TIP_PAD);
    expect(p.x + ПОДСКАЗКА.width).toBeLessThanOrEqual(ЭКРАН.width);
  });

  it('у нижнего края переворачивается вверх', () => {
    const p = cursorTipPos({ x: 300, y: 780 }, ПОДСКАЗКА, ЭКРАН);
    expect(p.y).toBe(780 - ПОДСКАЗКА.height - TIP_PAD);
  });

  it('в углу переворачивается по обеим осям сразу', () => {
    const p = cursorTipPos({ x: 990, y: 790 }, ПОДСКАЗКА, ЭКРАН);
    expect(p.x).toBeLessThan(990);
    expect(p.y).toBeLessThan(790);
  });

  it('ДАЖЕ ПЕРЕВЁРНУТАЯ НЕ ПРИЖИМАЕТСЯ К КРАЮ — остаётся поле', () => {
    const p = cursorTipPos({ x: 5, y: 5 }, ПОДСКАЗКА, ЭКРАН);
    expect(p.x).toBeGreaterThanOrEqual(TIP_EDGE);
    expect(p.y).toBeGreaterThanOrEqual(TIP_EDGE);
  });

  it('подсказка шире экрана всё равно не уходит в минус', () => {
    const p = cursorTipPos({ x: 500, y: 400 }, { width: 5000, height: 5000 }, ЭКРАН);
    expect(p.x).toBeGreaterThanOrEqual(TIP_EDGE);
    expect(p.y).toBeGreaterThanOrEqual(TIP_EDGE);
  });
});

describe('пузырь удержания', () => {
  const плитка = { left: 400, top: 300, width: 80 };

  it('ЦЕНТРИРУЕТСЯ НАД ПЛИТКОЙ: он объясняет её, а не закрывает', () => {
    const p = holdTipPos(плитка, ПОДСКАЗКА, ЭКРАН.width);
    expect(p.x + ПОДСКАЗКА.width / 2).toBe(плитка.left + плитка.width / 2);
    expect(p.y).toBe(плитка.top - ПОДСКАЗКА.height - HOLD_GAP);
  });

  it('у левого края зажимается полем, а не уезжает за экран', () => {
    expect(holdTipPos({ left: 0, top: 300, width: 40 }, ПОДСКАЗКА, ЭКРАН.width).x).toBe(HOLD_EDGE);
  });

  it('у правого края — симметрично', () => {
    const p = holdTipPos({ left: 980, top: 300, width: 40 }, ПОДСКАЗКА, ЭКРАН.width);
    expect(p.x).toBe(ЭКРАН.width - ПОДСКАЗКА.width - HOLD_EDGE);
  });

  it('плитка у верхней кромки — пузырь не уезжает вверх за экран', () => {
    expect(holdTipPos({ left: 400, top: 0, width: 80 }, ПОДСКАЗКА, ЭКРАН.width).y).toBe(HOLD_EDGE);
  });
});

describe('удержание против прокрутки', () => {
  it('ДВИЖУЩИЙСЯ ПАЛЕЦ — ЭТО СКРОЛЛ: иначе прокрутка засыплет экран подсказками', () => {
    expect(movedTooFar({ x: 0, y: 0 }, { x: 0, y: HOLD_SLOP_PX + 1 })).toBe(true);
  });

  it('дрожание пальца удержание не срывает', () => {
    expect(movedTooFar({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
  });

  it('допуск считается по обеим осям, а не по одной', () => {
    // 9 + 9 по осям — это 12.7 px по диагонали, то есть уже прокрутка
    expect(movedTooFar({ x: 0, y: 0 }, { x: 9, y: 9 })).toBe(true);
  });

  it('ровно на границе допуска удержание живо', () => {
    expect(movedTooFar({ x: 0, y: 0 }, { x: HOLD_SLOP_PX, y: 0 })).toBe(false);
  });
});
