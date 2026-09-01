import { describe, expect, it } from 'vitest';
import { INTEL_MS, PROGRESS_MS, intelVisible, repaintDue } from './liveWindows';

describe('repaintDue', () => {
  // Правило 1: закрытое окно не перерисовывается, сколько бы ни прошло.
  it('never repaints a closed window', () => {
    expect(repaintDue(false, 100000, 0, PROGRESS_MS)).toBe(false);
  });

  it('repaints an open window once the interval has passed', () => {
    expect(repaintDue(true, 501, 0, PROGRESS_MS)).toBe(true);
  });

  it('holds an open window until the interval has passed', () => {
    expect(repaintDue(true, 499, 0, PROGRESS_MS)).toBe(false);
  });

  // Граница строгая: ровно на пороге ещё рано — так было и в старом коде.
  it('holds at exactly the interval', () => {
    expect(repaintDue(true, 500, 0, PROGRESS_MS)).toBe(false);
    expect(repaintDue(true, 5000, 0, INTEL_MS)).toBe(false);
    expect(repaintDue(true, 5001, 0, INTEL_MS)).toBe(true);
  });

  // Правило 5: отметка своя у каждого окна — здесь это видно как независимость аргументов.
  it('measures each window from its own mark', () => {
    const now = 1000;
    expect(repaintDue(true, now, 400, PROGRESS_MS)).toBe(true); // отстало на 600
    expect(repaintDue(true, now, 700, PROGRESS_MS)).toBe(false); // отстало на 300
  });

  // Первый кадр: отметка ещё нулевая, окно рисуется сразу.
  it('repaints on the first frame after a window opens', () => {
    expect(repaintDue(true, 16, 0, 0)).toBe(true);
  });
});

describe('intelVisible', () => {
  // Правило 2: обе половины обязательны.
  it('is visible only with the dialog open on the intel tab', () => {
    expect(intelVisible(true, 'intel')).toBe(true);
  });

  it('is invisible on another tab of the same open dialog', () => {
    expect(intelVisible(true, 'stances')).toBe(false);
    expect(intelVisible(true, 'offers')).toBe(false);
  });

  it('is invisible while the dialog is closed', () => {
    expect(intelVisible(false, 'intel')).toBe(false);
  });
});

describe('the two intervals', () => {
  // Правило 4: числа названы и разведка заведомо ленивее прогресса.
  it('keeps progress windows an order of magnitude livelier than intel', () => {
    expect(PROGRESS_MS).toBe(500);
    expect(INTEL_MS).toBe(5000);
    expect(INTEL_MS).toBeGreaterThan(PROGRESS_MS);
  });
});
