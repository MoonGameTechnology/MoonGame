import { describe, expect, it } from 'vitest';
import { MIN_REVEAL_GAP, sheetRevealPan } from './sheetReveal';

const win = { top: 150, bottom: 500, left: 28, right: 362 };

describe('sheetRevealPan', () => {
  it('leaves an object already inside the window where it is', () => {
    expect(sheetRevealPan({ x: 190, y: 300 }, win)).toEqual({ dx: 0, dy: 0 });
  });

  it('lifts an object hidden under the sheet into the window', () => {
    expect(sheetRevealPan({ x: 190, y: 700 }, win)).toEqual({ dx: 0, dy: -200 });
  });

  it('pulls an object from under the top bar and the status line down', () => {
    expect(sheetRevealPan({ x: 10, y: 100 }, win)).toEqual({ dx: 18, dy: 50 });
  });

  it('does not move the camera when the expanded sheet leaves no window', () => {
    // Раскрытый лист: его верх выше низа верхней панели.
    expect(sheetRevealPan({ x: 190, y: 426 }, { ...win, bottom: 120 })).toBeNull();
    expect(
      sheetRevealPan({ x: 190, y: 426 }, { ...win, bottom: win.top + MIN_REVEAL_GAP - 1 }),
    ).toBeNull();
  });

  it('still reveals in the smallest usable window', () => {
    expect(
      sheetRevealPan({ x: 190, y: 600 }, { ...win, bottom: win.top + MIN_REVEAL_GAP }),
    ).toEqual({ dx: 0, dy: win.top + MIN_REVEAL_GAP - 600 });
  });
});
