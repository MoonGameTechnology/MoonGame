import { describe, expect, it } from 'vitest';
import { SELECT_ROW_PX, selectPopupPlacement } from './selectPopup';

describe('игровой выпадающий список', () => {
  it('встаёт под полем, если там помещается, шириной не уже поля', () => {
    const field = { left: 220, right: 360, top: 110, bottom: 150 };
    expect(selectPopupPlacement(field, 2, 390, 844)).toEqual({
      left: 182,
      width: 200,
      top: 154,
      maxHeight: 2 * SELECT_ROW_PX + 8,
    });
  });

  it('у нижнего края встаёт над полем и листается, если не помещается и там', () => {
    const field = { left: 20, right: 370, top: 700, bottom: 740 };
    const p = selectPopupPlacement(field, 30, 390, 844);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(844 - 700 + 4);
    expect(p.maxHeight).toBe(700 - 8 - 4);
    expect(p.width).toBe(350);
  });

  it('не выходит за края экрана', () => {
    const wide = { left: -40, right: 500, top: 100, bottom: 140 };
    const p = selectPopupPlacement(wide, 3, 390, 844);
    expect(p.left).toBe(8);
    expect(p.left + p.width).toBe(382);
  });
});
