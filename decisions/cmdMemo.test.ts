import { describe, expect, it } from 'vitest';
import { cmdMemoPlacement } from './cmdMemo';

describe('памятка плитки приказа', () => {
  const row = { left: 12, right: 378, top: 700, bottom: 832 };

  it('встаёт над рядом во всю его ширину, стрелкой к центру плитки', () => {
    const tile = { left: 84, right: 146, top: 700, bottom: 762 };
    expect(cmdMemoPlacement(tile, row, 390, 844)).toEqual({ left: 12, width: 366, bottom: 154, arrowX: 103 });
  });

  it('не выходит за края экрана: ряд шире экрана ужимается полями', () => {
    const wide = { left: -20, right: 420, top: 700, bottom: 832 };
    const p = cmdMemoPlacement({ left: 0, right: 60, top: 700, bottom: 760 }, wide, 390, 844);
    expect(p.left).toBe(8);
    expect(p.left + p.width).toBe(382);
  });

  it('стрелка у крайней плитки не заезжает на скругление окна', () => {
    const first = cmdMemoPlacement({ left: 12, right: 20, top: 700, bottom: 762 }, row, 390, 844);
    const last = cmdMemoPlacement({ left: 370, right: 378, top: 700, bottom: 762 }, row, 390, 844);
    expect(first.arrowX).toBe(16);
    expect(last.arrowX).toBe(366 - 16);
  });
});
