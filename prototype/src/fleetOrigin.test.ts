import { describe, expect, it } from 'vitest';
import { fleetOrigin, type OriginPoint } from './fleetOrigin';

const MAP: Record<string, OriginPoint> = {
  alpha: { x: 100, y: 100 },
  beta: { x: 300, y: 100 },
  gamma: { x: 100, y: 500 },
};
const at = (id: string): OriginPoint | null => MAP[id] ?? null;

describe('fleetOrigin', () => {
  it('стоящий флот отсчитывается от ЦЕНТРА мира (правило 1)', () => {
    expect(fleetOrigin({ location: 'alpha' }, 1_000, at)).toEqual({ x: 100, y: 100 });
  });

  it('орбита не сдвигает точку: время идёт, а отсчёт стоит', () => {
    // Кольцо вращается по игровому времени (`orbitRing.ts`), и если бы отсчёт брался с
    // него, эта точка ездила бы от кадра к кадру. Здесь она обязана быть неподвижной —
    // это и есть весь смысл разделения «якорь картинки / точка отсчёта».
    const f = { location: 'alpha' };
    const early = fleetOrigin(f, 0, at);
    const late = fleetOrigin(f, 9_999_999, at);
    expect(early).toEqual(late);
    expect(late).toEqual(MAP.alpha);
  });

  it('в пути — интерполяция по доле времени (правило 2)', () => {
    const f = { movement: { from: 'alpha', to: 'beta', departedAt: 0, arrivesAt: 1_000 } };
    expect(fleetOrigin(f, 500, at)).toEqual({ x: 200, y: 100 });
  });

  it('нога покрывает только кусок лейна (startT..endT)', () => {
    const f = {
      movement: { from: 'alpha', to: 'beta', departedAt: 0, arrivesAt: 1_000, startT: 0.5, endT: 1 },
    };
    expect(fleetOrigin(f, 0, at)).toEqual({ x: 200, y: 100 }); // старт на половине дороги
    expect(fleetOrigin(f, 1_000, at)).toEqual({ x: 300, y: 100 });
  });

  it('доля зажата в [0,1]: кадр после прибытия не уезжает за конец дороги', () => {
    const f = { movement: { from: 'alpha', to: 'beta', departedAt: 0, arrivesAt: 1_000 } };
    expect(fleetOrigin(f, 5_000, at)).toEqual({ x: 300, y: 100 });
    expect(fleetOrigin(f, -5_000, at)).toEqual({ x: 100, y: 100 });
  });

  it('мгновенная нога не даёт NaN', () => {
    const f = { movement: { from: 'alpha', to: 'beta', departedAt: 7, arrivesAt: 7 } };
    expect(fleetOrigin(f, 7, at)).toEqual({ x: 300, y: 100 });
  });

  it('стоянка НА лейне — доля t, а не ближайший узел (правило 3)', () => {
    const f = { edge: { from: 'alpha', to: 'gamma', t: 0.25 } };
    expect(fleetOrigin(f, 0, at)).toEqual({ x: 100, y: 200 });
  });

  it('свободный полёт интерполируется вне графа лейнов (правило 4)', () => {
    const f = {
      freePosition: { x: 0, y: 0 },
      freeMovement: { targetX: 400, targetY: 200, departedAt: 0, arrivesAt: 100 },
    };
    expect(fleetOrigin(f, 50, at)).toEqual({ x: 200, y: 100 });
  });

  it('припаркованная эскадрилья стоит в своей свободной точке', () => {
    expect(fleetOrigin({ freePosition: { x: 42, y: 7 } }, 0, at)).toEqual({ x: 42, y: 7 });
  });

  it('свободный полёт без исходной точки — null, а не подставной ноль', () => {
    const f = { freeMovement: { targetX: 1, targetY: 1, departedAt: 0, arrivesAt: 1 } };
    expect(fleetOrigin(f, 0, at)).toBeNull();
  });

  it('неизвестный узел даёт null (правило 5)', () => {
    expect(fleetOrigin({ location: 'nowhere' }, 0, at)).toBeNull();
    const f = { movement: { from: 'alpha', to: 'nowhere', departedAt: 0, arrivesAt: 1 } };
    expect(fleetOrigin(f, 0, at)).toBeNull();
  });

  it('флот без места — null', () => {
    expect(fleetOrigin({}, 0, at)).toBeNull();
    expect(fleetOrigin({ location: null, movement: null }, 0, at)).toBeNull();
  });

  it('возвращает КОПИЮ точки: рисующий не может испортить карту', () => {
    const got = fleetOrigin({ location: 'alpha' }, 0, at);
    expect(got).not.toBe(MAP.alpha);
    got!.x = -1;
    expect(MAP.alpha).toEqual({ x: 100, y: 100 });
  });
});
