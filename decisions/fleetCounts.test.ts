import { describe, expect, it } from 'vitest';
import { fleetCounts } from './fleetCounts';

describe('подпись флота: корабли и десант', () => {
  it('десант пишется, пока он есть', () => {
    expect(fleetCounts(3, 2, false)).toEqual(['side.fleet.sub', { s: 3, tr: 2 }]);
    expect(fleetCounts(3, 2, true)).toEqual(['side.fleet.sub.pc', { s: 3, tr: 2 }]);
  });

  it('без десанта — только корабли, на телефоне и на ПК', () => {
    expect(fleetCounts(1, 0, false)).toEqual(['side.fleet.sub.ships', { s: 1, tr: 0 }]);
    expect(fleetCounts(1, 0, true)).toEqual(['side.fleet.sub.pc.ships', { s: 1, tr: 0 }]);
  });
});
