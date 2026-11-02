import { describe, expect, it } from 'vitest';
import type { Fleet } from '../packages/shared-core/src/index';
import {
  activeTroopTransfers,
  transferArc,
  transferPoint,
  transferProgress,
} from './troopTransferEffects';

const claim = { unit: 'militia', count: 2, startAt: 100, doneAt: 1000 };
const fleet = {
  owner: 'p1',
  location: 'earth',
  movement: null,
  loading: [
    { ...claim, from: 'earth' },
    { ...claim, unit: 'tank', from: 'earth' },
  ],
  unloading: [{ ...claim, to: 'earth' }],
  assaultLanding: { planetId: 'earth', startAt: 100, doneAt: 1000 },
} satisfies Pick<
  Fleet,
  'owner' | 'location' | 'movement' | 'loading' | 'unloading' | 'assaultLanding'
>;

describe('транспортные потоки карты', () => {
  it('свои активные заявки: один путь на вид операции, без изменения мира', () => {
    const before = structuredClone(fleet);
    expect(activeTroopTransfers(fleet, 'p1', 100)).toEqual([
      { target: 'earth', kind: 'load' },
      { target: 'earth', kind: 'unload' },
      { target: 'earth', kind: 'assault' },
    ]);
    expect(fleet).toEqual(before);
    expect(activeTroopTransfers(fleet, 'p2', 500)).toEqual([]);
  });

  it('будущая, истёкшая, отменённая и оставшаяся после ухода заявка не оставляет частиц', () => {
    expect(activeTroopTransfers(fleet, 'p1', 99)).toEqual([]);
    expect(activeTroopTransfers(fleet, 'p1', 1000)).toEqual([]);
    for (const location of [null, 'mars']) {
      expect(activeTroopTransfers({ ...fleet, location }, 'p1', 500)).toEqual([]);
    }
    expect(
      activeTroopTransfers(
        { ...fleet, loading: [], unloading: [], assaultLanding: undefined },
        'p1',
        500,
      ),
    ).toEqual([]);
    expect(
      activeTroopTransfers(
        {
          ...fleet,
          loading: [{ ...claim, count: 0, from: 'earth' }],
          unloading: [],
          assaultLanding: undefined,
        },
        'p1',
        500,
      ),
    ).toEqual([]);
  });

  it('погрузка идёт к флоту, высадка и штурм к поверхности; встречные пути разведены', () => {
    const planet = { x: 10, y: 20 },
      ship = { x: 110, y: 20 };
    const load = transferArc(planet, ship, 'load')!;
    const unload = transferArc(planet, ship, 'unload')!;
    expect(load.from.x).toBeLessThan(load.to.x);
    expect(unload.from.x).toBeGreaterThan(unload.to.x);
    expect(transferArc(planet, ship, 'assault')).toEqual(unload);
    expect(load.control.y).toBeLessThan(planet.y);
    expect(unload.control.y).toBeGreaterThan(planet.y);
    expect(transferPoint(load, 0)).toMatchObject(load.from);
    expect(transferPoint(load, 1)).toMatchObject(load.to);
    expect(transferPoint(load, 0.25).x).toBeLessThan(transferPoint(load, 0.75).x);
    expect(transferPoint(unload, 0.25).x).toBeGreaterThan(transferPoint(unload, 0.75).x);
    expect(transferArc(planet, planet, 'load')).toBeNull();
    expect(transferArc(planet, { x: planet.x + 18, y: planet.y }, 'load')).not.toBeNull();
  });

  it('фаза зависит от времени, после фона нет накопленных частиц; reduced motion видим и неподвижен', () => {
    const at = transferProgress(1000, 0.2, 0, true);
    expect(transferProgress(1000 + 2600, 0.2, 0, true)).toBeCloseTo(at);
    expect(transferProgress(1100, 0.2, 0, true)).toBeGreaterThan(at);
    for (const index of [0, 1, 2]) {
      expect(transferProgress(0, 0.2, index, false)).toBe((index + 1) / 4);
      expect(transferProgress(100_000, 0.9, index, false)).toBe((index + 1) / 4);
    }
  });
});
