import { describe, expect, it } from 'vitest';
import { anchoredPopover } from './anchoredPopover';

const view = { width: 1280, height: 800 };
const pop = { width: 260, height: 180 };

describe('anchoredPopover — куда встать', () => {
  it('помещается под элементом — встаёт под ним, левым краем к нему (правила 1, 3)', () => {
    const at = anchoredPopover({ left: 400, top: 200, width: 90, height: 40 }, pop, view);
    expect(at).toEqual({ left: 400, top: 246, side: 'below', maxHeight: null });
  });

  it('под элементом тесно — встаёт над ним (правило 2)', () => {
    const at = anchoredPopover({ left: 400, top: 700, width: 90, height: 40 }, pop, view);
    expect(at.side).toBe('above');
    expect(at.top).toBe(700 - 6 - 180);
    expect(at.maxHeight).toBeNull();
  });

  it('не помещается нигде — туда, где места больше, с пределом высоты (правило 2)', () => {
    const tall = { width: 260, height: 700 };
    const high = anchoredPopover({ left: 10, top: 120, width: 90, height: 40 }, tall, view);
    expect(high.side).toBe('below');
    expect(high.maxHeight).toBe(800 - 8 - (120 + 40 + 6));
    expect(high.top + high.maxHeight!).toBe(800 - 8);

    const low = anchoredPopover({ left: 10, top: 600, width: 90, height: 40 }, tall, view);
    expect(low.side).toBe('above');
    expect(low.maxHeight).toBe(600 - 6 - 8);
    expect(low.top).toBe(8);
  });

  it('у правого края — сдвигается внутрь, а не обрезается (правило 3)', () => {
    const at = anchoredPopover({ left: 1200, top: 100, width: 60, height: 30 }, pop, view);
    expect(at.left).toBe(1280 - 8 - 260);
  });

  it('шире экрана — прижимается к левому полю (правило 3)', () => {
    const at = anchoredPopover({ left: 100, top: 100, width: 60, height: 30 }, { width: 400, height: 100 }, { width: 360, height: 640 });
    expect(at.left).toBe(8);
  });

  it('поля и зазор настраиваются (правило 4)', () => {
    const at = anchoredPopover({ left: 0, top: 0, width: 50, height: 20 }, pop, view, { margin: 16, gap: 2 });
    expect(at).toMatchObject({ left: 16, top: 22, side: 'below' });
  });

  it('элемент за пределами экрана — высота не уходит в минус', () => {
    const at = anchoredPopover({ left: 100, top: 900, width: 60, height: 30 }, pop, view);
    expect(at.side).toBe('above');
    expect(at.maxHeight === null || at.maxHeight >= 0).toBe(true);
  });
});
