import { describe, expect, it } from 'vitest';
import type { Fleet } from '../packages/shared-core/src/index';
import {
  activeTroopTransfers,
  landingBurst,
  podAlpha,
  podCount,
  podCycle,
  podScale,
  podTail,
  podTravel,
  POD_TRIP_MS,
  touchdownAge,
  touchdownRing,
  TOUCHDOWN_MS,
  transferArc,
  transferPoint,
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

  it('рейс идёт по часам, после фона нет накопленных капсул; без движения места ровные и неподвижные', () => {
    const at = podCycle(1000, 0.2, 0, 3, true);
    expect(podCycle(1000 + POD_TRIP_MS, 0.2, 0, 3, true)).toBeCloseTo(at);
    expect(podCycle(1100, 0.2, 0, 3, true)).toBeGreaterThan(at);
    // Капсулы одного потока разнесены по рейсу поровну.
    const spread = [0, 1, 2].map((i) => podCycle(500, 0, i, 3, true));
    expect(spread[1]! - spread[0]!).toBeCloseTo(1 / 3);
    for (const index of [0, 1, 2]) {
      expect(podCycle(0, 0.2, index, 3, false)).toBe((index + 1) / 4);
      expect(podCycle(100_000, 0.9, index, 3, false)).toBe((index + 1) / 4);
    }
  });

  it('к миру капсула разгоняется, к борту тормозит; концы рейса на концах дуги', () => {
    for (const kind of ['load', 'unload', 'assault'] as const) {
      expect(podTravel(0, kind)).toBe(0);
      expect(podTravel(1, kind)).toBe(1);
      let last = -1;
      for (let u = 0; u <= 1; u += 0.05) {
        expect(podTravel(u, kind)).toBeGreaterThan(last);
        last = podTravel(u, kind);
      }
    }
    expect(podTravel(0.5, 'assault')).toBeLessThan(0.5);
    expect(podTravel(0.5, 'unload')).toBeLessThan(0.5);
    expect(podTravel(0.5, 'load')).toBeGreaterThan(0.5);
    // След длиннее там, где капсула быстрее.
    expect(podTail(0.9, 'assault')).toBeGreaterThan(podTail(0.1, 'assault'));
    expect(podTail(0.1, 'load')).toBeGreaterThan(podTail(0.9, 'load'));
    expect(podTail(0, 'assault')).toBeGreaterThan(0);
  });

  it('капсула проявляется у борта, яркая до касания; касание даёт всплеск только в движении', () => {
    expect(podAlpha(0)).toBe(0);
    expect(podAlpha(0.05)).toBeGreaterThan(0);
    expect(podAlpha(0.5)).toBe(1);
    expect(podAlpha(0.999)).toBe(1);
    expect(touchdownAge(0, true)).toBe(0);
    expect(touchdownAge(0.5, true)).toBeNull();
    const fresh = touchdownAge((0.25 * TOUCHDOWN_MS) / POD_TRIP_MS, true)!;
    expect(fresh).toBeCloseTo(0.25);
    expect(touchdownAge(TOUCHDOWN_MS / POD_TRIP_MS, true)).toBeNull();
    expect(touchdownAge(0, false)).toBeNull();
    const young = touchdownRing(0.1, 1);
    const old = touchdownRing(0.9, 1);
    expect(old.r).toBeGreaterThan(young.r);
    expect(old.alpha).toBeLessThan(young.alpha);
    expect(touchdownRing(1, 1).alpha).toBe(0);
    expect(touchdownRing(0.5, 0.7).r).toBeLessThan(touchdownRing(0.5, 1.2).r);
  });

  it('число и размер капсул идут от длины дуги: на короткой дуге они не слипаются', () => {
    expect(podCount(20)).toBe(2);
    expect(podCount(50)).toBe(3);
    expect(podCount(120)).toBe(4);
    expect(podScale(10)).toBe(0.7);
    expect(podScale(64)).toBe(1);
    expect(podScale(400)).toBe(1.25);
  });

  it('высадка кончается кольцом от края мира: разлёт с торможением, без движения — стоит и гаснет', () => {
    const start = landingBurst(0, true);
    const mid = landingBurst(0.5, true);
    const end = landingBurst(1, true);
    expect(start).toEqual({ ring: 15, glow: 9, alpha: 1 });
    expect(end.ring).toBe(40);
    expect(end.alpha).toBe(0);
    // Первая половина жизни уносит кольцо дальше второй: удар, а не ровное расползание.
    expect(mid.ring - start.ring).toBeGreaterThan(end.ring - mid.ring);
    expect(mid.alpha).toBeLessThan(1);
    const still = [0, 0.5, 0.9].map((k) => landingBurst(k, false));
    expect(new Set(still.map((b) => b.ring)).size).toBe(1);
    expect(still[2]!.alpha).toBeLessThan(still[0]!.alpha);
    expect(landingBurst(-1, true)).toEqual(start);
  });
});
