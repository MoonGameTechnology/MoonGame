import { describe, it, expect } from 'vitest';
import type { Spy } from '../packages/shared-core/src/index';
import { spyFlashOf, spyMarks } from './spyMarks';

const flying: Spy = {
  id: 2,
  gen: 1,
  state: 'travel',
  location: 'E',
  from: 'H',
  departedAt: 0,
  arrivesAt: 300,
  op: 'theft',
  mission: 1,
  way: [
    { at: 'H', t: 0 },
    { at: 'N', t: 100 },
    { at: 'E', t: 300 },
  ],
};

describe('SPM-1 — шпионы на карте', () => {
  it('в пути: лейн, доля, остаток маршрута и конец пути', () => {
    const { flights, spots } = spyMarks([flying], 50);
    expect(spots).toEqual([]);
    expect(flights).toEqual([
      { id: 2, gen: 1, home: false, a: 'H', b: 'N', f: 0.5, ahead: ['E'], target: 'E', until: 300 },
    ]);
    expect(spyMarks([flying], 200).flights[0]).toMatchObject({ a: 'N', b: 'E', f: 0.5, ahead: [] });
  });

  it('путь старого сохранения не записан — прямой отрезок по времени', () => {
    const old: Spy = { ...flying, state: 'return', way: undefined };
    expect(spyMarks([old], 150).flights[0]).toMatchObject({
      home: true,
      a: 'H',
      b: 'E',
      f: 0.5,
      ahead: [],
    });
  });

  it('стоящие сходятся в значок мира, по номеру; вербовка и «на дне» не видны', () => {
    const spies: Spy[] = [
      { id: 3, gen: 1, state: 'work', location: 'E' },
      { id: 1, gen: 1, state: 'rest', location: 'H' },
      { id: 4, gen: 1, state: 'wait', location: 'E' },
      { id: 5, gen: 2, state: 'recruit', location: 'H' },
      { id: 6, gen: 1, state: 'hidden', location: 'G' },
    ];
    expect(spyMarks(spies, 0)).toEqual({
      flights: [],
      spots: [
        { planetId: 'E', spyIds: [3, 4] },
        { planetId: 'H', spyIds: [1] },
      ],
    });
    expect(spyMarks(undefined, 0)).toEqual({ flights: [], spots: [] });
  });

  it('вспышка — только по событию своего шпиона', () => {
    expect(spyFlashOf('espionage.succeeded', { owner: 'me', planetId: 'E' }, 'me')).toBe('win');
    expect(spyFlashOf('espionage.failed', { owner: 'me', planetId: 'E' }, 'me')).toBe('fail');
    expect(spyFlashOf('espionage.caught', { owner: 'me', planetId: 'E' }, 'me')).toBe('fail');
    expect(spyFlashOf('espionage.arrived', { owner: 'me', planetId: 'E' }, 'me')).toBe('arrive');
    expect(spyFlashOf('espionage.succeeded', { owner: 'rival', planetId: 'E' }, 'me')).toBeNull();
    expect(spyFlashOf('espionage.home', { owner: 'me', planetId: 'H' }, 'me')).toBeNull();
    expect(spyFlashOf('espionage.succeeded', { owner: 'me' }, 'me')).toBeNull();
  });
});
