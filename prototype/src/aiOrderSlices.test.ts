import { expect, it } from 'vitest';
import {
  loadSquadronTroops,
  moveFleet,
  retreatFleet,
  splitFleet,
  strikeShuttle,
} from '../../decisions/actions';
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

it('погрузка десанта и вылет одной эскадры не разделяются (ai.ts:1188)', () => {
  const base = { planetId: 'p1' };
  const actions = [
    loadSquadronTroops('a', base, 'sq1', [{ unit: 'militia', count: 2 }]),
    strikeShuttle('a', base, 'sq1', { targetPlanetId: 'foe' }),
    strikeShuttle('a', base, 'sq2', { targetPlanetId: 'foe' }),
  ];
  const slices = aiOrderSlices(actions);
  expect(slices.map((s) => s.length)).toEqual([2, 1]);
  expect(slices.flat()).toEqual(actions);
});

it('деление флота и его вылет не разделяются (ai.ts:723)', () => {
  const actions = [
    splitFleet('a', 'f1', [{ unit: 'frigate', count: 1 }]),
    moveFleet('a', 'f1', 'target'),
  ];
  const slices = aiOrderSlices(actions);
  expect(slices.map((s) => s.length)).toEqual([2]);
  expect(slices.flat()).toEqual(actions);
});

it('чужая сущность между зависимыми приказами разрывает пару, порядок сохраняется', () => {
  const base = { planetId: 'p1' };
  const actions = [
    loadSquadronTroops('a', base, 'sq1', [{ unit: 'militia', count: 2 }]),
    moveFleet('a', 'f9', 'home'), // другая сущность вклинилась — склеивать нечего
    strikeShuttle('a', base, 'sq1', { targetPlanetId: 'foe' }),
  ];
  const slices = aiOrderSlices(actions);
  expect(slices.map((s) => s.length)).toEqual([1, 1, 1]);
  expect(slices.flat()).toEqual(actions);
});

it('одна сущность, но ОДИН И ТОТ ЖЕ тип — это повтор, а не зависимость', () => {
  const actions = [moveFleet('a', 'f1', 'x'), moveFleet('a', 'f1', 'y')];
  expect(aiOrderSlices(actions).map((s) => s.length)).toEqual([1, 1]);
});

it('одна сущность у РАЗНЫХ игроков парой не становится', () => {
  const actions = [retreatFleet('a', 'f1'), moveFleet('b', 'f1', 'home')];
  expect(aiOrderSlices(actions).map((s) => s.length)).toEqual([1, 1]);
});
