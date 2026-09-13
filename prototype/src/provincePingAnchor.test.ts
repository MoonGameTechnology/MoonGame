import { expect, it } from 'vitest';
import { provincePingTarget, provinceForPing } from './provincePingAnchor';

const map = [{ id: 'A', x: 12, y: 34 }, { id: 'B', x: 56, y: 78 }];

it('uses public coordinates for an unexplored province and preserves identified node targets', () => {
  expect(provincePingTarget('A', false, map)).toEqual({ point: { x: 12, y: 34 } });
  expect(provincePingTarget('A', true, map)).toEqual({ node: 'A' });
  expect(provincePingTarget('missing', false, map)).toBeNull();
});

it('accepts an exact point echo without inventing a province for an arbitrary point', () => {
  const target = provincePingTarget('A', false, map)!;
  expect(provinceForPing(target, map)).toBe('A');
  expect(provinceForPing({ node: 'B' }, map)).toBe('B');
  expect(provinceForPing({ point: { x: 12.01, y: 34 } }, map)).toBeNull();
  expect(provinceForPing({}, map)).toBeNull();
});
