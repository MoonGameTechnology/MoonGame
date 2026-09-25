import { describe, expect, it } from 'vitest';
import { fitWindowPosition } from './floatingWindows';

describe('movable windows stay reachable without camera input', () => {
  const viewport = { width: 1400, height: 960 };
  const size = { width: 410, height: 580 };
  it('retains an intentional on-screen placement', () => {
    expect(fitWindowPosition({ x: 130, y: 160 }, size, viewport)).toEqual({ x: 130, y: 160 });
  });
  it('keeps title and controls inside every viewport edge', () => {
    expect(fitWindowPosition({ x: -120, y: -50 }, size, viewport)).toEqual({ x: 12, y: 12 });
    expect(fitWindowPosition({ x: 1600, y: 1100 }, size, viewport)).toEqual({ x: 978, y: 368 });
  });
  it('recovers the window after the browser shrinks, even for oversized content', () => {
    expect(fitWindowPosition({ x: 978, y: 368 }, size, { width: 820, height: 500 })).toEqual({ x: 398, y: 12 });
    expect(fitWindowPosition({ x: 978, y: 368 }, size, { width: 300, height: 200 })).toEqual({ x: 12, y: 12 });
  });
  it('never goes under the HUD chrome: the title stays graspable (owner, 2026-09-25)', () => {
    // Dragged up — stops at the chrome, not under the resource bar.
    expect(fitWindowPosition({ x: 130, y: 20 }, size, viewport, 176)).toEqual({ x: 130, y: 176 });
    // Taller than the room below the chrome — stays at the chrome and scrolls inside,
    // instead of being pushed up underneath it.
    expect(fitWindowPosition({ x: 130, y: 300 }, size, { width: 1024, height: 700 }, 176)).toEqual({ x: 130, y: 176 });
  });
});
