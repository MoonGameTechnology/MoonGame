import { describe, expect, it } from 'vitest';
import {
  placeTagStack,
  TAG,
  tagClearance,
  tagRowHeight,
  tagRowWidth,
  tagTitleAlpha,
} from './transferTags';

const view = { left: 0, top: 80, right: 390, bottom: 760 };

describe('плашки перевозок у мира', () => {
  it('подпись вида проявляется с детализацией карты, плашка растёт без скачка', () => {
    expect(tagTitleAlpha(0)).toBe(0);
    expect(tagTitleAlpha(0.4)).toBe(0);
    expect(tagTitleAlpha(0.6)).toBeCloseTo(0.5);
    expect(tagTitleAlpha(1)).toBe(1);
    expect(tagRowHeight(0)).toBe(TAG.compactH);
    expect(tagRowHeight(1)).toBe(TAG.fullH);
    expect(tagRowHeight(0.5)).toBeGreaterThan(TAG.compactH);
    expect(tagRowHeight(0.5)).toBeLessThan(TAG.fullH);
  });

  it('ширина — по времени и счёту флотов, длинная подпись расширяет плашку по мере проявления', () => {
    const compact = tagRowWidth(50, 0, 110, 0);
    const full = tagRowWidth(50, 0, 110, 1);
    expect(compact).toBe(TAG.textX + 50 + TAG.padR);
    expect(full).toBe(TAG.textX + 110 + TAG.padR);
    expect(tagRowWidth(50, 0, 110, 0.5)).toBeGreaterThan(compact);
    expect(tagRowWidth(50, 0, 110, 0.5)).toBeLessThan(full);
    // Короткая подпись не сужает строку времени со счётом флотов.
    expect(tagRowWidth(50, 20, 40, 1)).toBe(TAG.textX + 70 + TAG.padR);
  });

  it('при полной детализации — прежний отступ над кольцом и плашками флотов, на общем плане — у мира', () => {
    expect(tagClearance(20, 13, 1)).toBe(102);
    expect(tagClearance(0, 13, 1)).toBe(82);
    expect(tagClearance(55, 13, 1)).toBe(137);
    expect(tagClearance(12, 6, 0)).toBe(28);
    let last = 0;
    for (let d = 0; d <= 1; d += 0.1) {
      expect(tagClearance(12, 6, d)).toBeGreaterThan(last);
      last = tagClearance(12, 6, d);
    }
  });

  it('над миром по центру; выноска вертикальна и кончается на краю мира', () => {
    const at = placeTagStack({ x: 200, y: 400 }, 100, 34, 60, 20, view);
    expect(at).toMatchObject({ left: 150, top: 306, below: false });
    expect(at.leader).toEqual({ x1: 200, y1: 340, x2: 200, y2: 380 });
  });

  it('у бока экрана плашка прижата, а наклонная выноска всё равно доходит до мира', () => {
    const c = { x: 380, y: 400 };
    const at = placeTagStack(c, 120, 22, 40, 20, view);
    expect(at.left).toBe(view.right - TAG.margin - 120);
    const l = at.leader!;
    expect(l.x1).toBe(at.left + 120 - 8);
    expect(l.y1).toBe(at.top + 22);
    expect(Math.hypot(l.x2 - c.x, l.y2 - c.y)).toBeCloseTo(20);
    expect(l.x2).toBeLessThan(c.x);
  });

  it('у верхнего края плашка уходит под мир, а не на него', () => {
    const c = { x: 200, y: 120 };
    const at = placeTagStack(c, 100, 34, 60, 20, view);
    expect(at.below).toBe(true);
    expect(at.top).toBe(180);
    expect(at.leader).toEqual({ x1: 200, y1: 180, x2: 200, y2: 140 });
  });

  it('не влезает нигде — встаёт к той стороне, где места больше, внутри экрана', () => {
    const tall = 600;
    const high = placeTagStack({ x: 200, y: 150 }, 100, tall, 60, 20, view);
    expect(high.below).toBe(true);
    expect(high.top).toBeGreaterThanOrEqual(view.top + TAG.margin);
    expect(high.top + tall).toBeLessThanOrEqual(view.bottom - TAG.margin);
    const low = placeTagStack({ x: 200, y: 700 }, 100, tall, 60, 20, view);
    expect(low.below).toBe(false);
    expect(low.top).toBe(view.top + TAG.margin);
  });

  it('стопка вплотную к миру выноски не рисует', () => {
    expect(placeTagStack({ x: 200, y: 400 }, 100, 22, 20, 20, view).leader).toBeNull();
  });
});
