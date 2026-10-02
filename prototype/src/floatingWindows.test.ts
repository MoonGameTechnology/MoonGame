import { describe, expect, it } from 'vitest';
import { fitWindowPosition, onWindowEdge, zoomedPlacement } from './floatingWindows';

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

describe('окно тянется за любой край (заказ владельца 2026-09-27)', () => {
  const box = { x: 100, y: 200, width: 600, height: 300 };
  it('полоса у каждой из четырёх сторон — хватка', () => {
    expect(onWindowEdge({ x: 104, y: 350 }, box, 8)).toBe(true); // левый край
    expect(onWindowEdge({ x: 697, y: 350 }, box, 8)).toBe(true); // правый
    expect(onWindowEdge({ x: 400, y: 202 }, box, 8)).toBe(true); // верх
    expect(onWindowEdge({ x: 400, y: 495 }, box, 8)).toBe(true); // низ
  });
  it('середина окна — не хватка: там кнопки и прокрутка', () => {
    expect(onWindowEdge({ x: 400, y: 350 }, box, 8)).toBe(false);
    expect(onWindowEdge({ x: 110, y: 350 }, box, 8)).toBe(false);
  });
  it('снаружи окна — не хватка, даже вплотную к рамке', () => {
    expect(onWindowEdge({ x: 98, y: 350 }, box, 8)).toBe(false);
    expect(onWindowEdge({ x: 400, y: 501 }, box, 8)).toBe(false);
  });
  it('пальцу полоса шире, чем курсору', () => {
    expect(onWindowEdge({ x: 112, y: 350 }, box, 8)).toBe(false);
    expect(onWindowEdge({ x: 112, y: 350 }, box, 16)).toBe(true);
  });
});

describe('окно под зумом ПК встаёт туда, куда его поставили (UIX-2.1)', () => {
  it('в масштабе 1 экранные px и есть px окна', () => {
    expect(zoomedPlacement({ x: 500, y: 200 }, 768, 1)).toEqual({ left: 500, top: 200, room: 556 });
  });
  it('под зумом 1,25 точку и место под окном делят на зум', () => {
    // Без деления окно встало бы в 625 × 250 экранных px — на четверть дальше от угла.
    expect(zoomedPlacement({ x: 500, y: 200 }, 1080, 1.25)).toEqual({ left: 400, top: 160, room: 694.4 });
  });
  it('место под окном не меньше 80 px, нулевой зум считается за 1', () => {
    expect(zoomedPlacement({ x: 10, y: 1070 }, 1080, 1.25).room).toBe(80);
    expect(zoomedPlacement({ x: 500, y: 200 }, 768, 0)).toEqual({ left: 500, top: 200, room: 556 });
  });
});
