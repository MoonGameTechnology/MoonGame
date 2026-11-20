import { describe, expect, it } from 'vitest';
import { MIN_REVEAL_GAP, sheetRevealPan, windowRevealPan } from './sheetReveal';

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

describe('windowRevealPan', () => {
  const screen = { width: 1920, height: 1080 };
  // Широкое окно планеты на ПК 1920: по центру, у нижнего края.
  const box = { x: 440, y: 500, width: 1040, height: 520 };

  it('leaves the camera alone when the window does not cover the object', () => {
    expect(windowRevealPan({ x: 300, y: 300 }, box, screen, 80)).toBeNull();
  });

  it('lifts a planet hidden under a bottom window into the room above it', () => {
    expect(windowRevealPan({ x: 960, y: 700 }, box, screen, 80)).toEqual({ dx: 0, dy: 468 - 700 });
  });

  it('takes the nearest free side', () => {
    // Объект у левого края окна ближе к месту слева, чем к месту сверху.
    expect(windowRevealPan({ x: 450, y: 900 }, box, screen, 80)).toEqual({ dx: 408 - 450, dy: 0 });
  });

  it('treats an object just outside the frame as covered', () => {
    expect(windowRevealPan({ x: 960, y: 490 }, box, screen, 80)).toEqual({ dx: 0, dy: -22 });
  });

  it('does not move the camera when no side has room', () => {
    const full = { x: 0, y: 60, width: 1920, height: 1020 };
    expect(windowRevealPan({ x: 960, y: 500 }, full, screen, 80)).toBeNull();
  });
});
