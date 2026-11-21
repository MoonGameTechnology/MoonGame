import { describe, expect, it } from 'vitest';
import { SPY_SHIP_SHAPES, type SpyShipId } from './spyShipShapes';
import { SPY_TASK_ICONS, spyClockSvg, spyShipSvg, spyTaskIconSvg } from './spyTaskIcons';

describe('spy task icons', () => {
  it('every task has its own icon in the 24×24 box, and no two tasks share one', () => {
    const icons = Object.values(SPY_TASK_ICONS);
    expect(Object.keys(SPY_TASK_ICONS).sort()).toEqual([
      'counter',
      'delay',
      'disrupt',
      'recon',
      'relocate',
      'research',
      'sabotage',
      'theft',
    ]);
    expect(new Set(icons).size).toBe(icons.length);
    for (const icon of icons) {
      expect(icon).toMatch(/^<(path|circle|rect)\b/);
      // Only coordinates inside the box: every number of the markup lies in 0..24.
      for (const n of icon.match(/-?\d+(\.\d+)?/g) ?? [])
        expect(Math.abs(Number(n))).toBeLessThanOrEqual(24);
    }
  });

  it('the SVG is decorative and takes its colour from the stylesheet', () => {
    const svg = spyTaskIconSvg('sabotage');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).not.toMatch(/stroke="#|fill="#/);
    expect(spyTaskIconSvg('recon', 'x')).toContain('class="x"');
    expect(spyClockSvg()).toContain('<circle');
  });

  it('the ship next to the name is the same silhouette the map draws', () => {
    for (const id of Object.keys(SPY_SHIP_SHAPES) as SpyShipId[]) {
      const svg = spyShipSvg(id);
      expect(svg).toContain(`d="${SPY_SHIP_SHAPES[id].hull}"`);
      expect(svg).toContain('class="h"');
      expect(svg).toContain('aria-hidden="true"');
    }
  });
});
