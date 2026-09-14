import { expect, it } from 'vitest';
import { moveFleet, retreatFleet } from '../../decisions/actions';
import { aiOrderSlices } from './aiOrderSlices';

it('отступление и вылет одного флота не разделяются боевым кадром', () => {
  const actions = [
    retreatFleet('a', 'f1'),
    moveFleet('a', 'f1', 'home'),
    moveFleet('a', 'f2', 'home'),
  ];
  const slices = aiOrderSlices(actions);
  expect(slices.map((s) => s.length)).toEqual([2, 1]);
  expect(slices.flat()).toEqual(actions);
});

it('разные флоты и места не образуют зависимую пару, длинный список дробится', () => {
  const actions = [
    retreatFleet('a', 'f1'),
    moveFleet('a', 'f2', 'home'),
    retreatFleet('a', 'f1'),
    moveFleet('b', 'f1', 'home'),
    ...Array.from({ length: 100 }, () => moveFleet('a', 'f3', 'home')),
  ];
  const slices = aiOrderSlices(actions);
  expect(slices.every((s) => s.length === 1)).toBe(true);
  expect(slices.flat()).toEqual(actions);
});
