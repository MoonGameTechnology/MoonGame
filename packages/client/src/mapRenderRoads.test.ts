import { describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  forkTAtStart,
  type GameData,
  type GameState,
  type Planet,
} from '@void/shared-core';
import { renderMap } from './mapRender';
import { centerOn, worldToScreen } from './camera';
import { drawAmbushMark, drawForkMark } from './forkMark';

vi.mock('./spaceBackdrop', () => ({ drawSpaceBackdrop: vi.fn() }));
vi.mock('./holoDraw', async (original) => ({
  ...(await original<typeof import('./holoDraw')>()),
  blitGlow: vi.fn(),
  blitSphere: vi.fn(),
}));
vi.mock('./forkMark', () => ({ drawForkMark: vi.fn(), drawAmbushMark: vi.fn() }));

/**
 * ROADS-4 в новом клиенте: он рисовал прямые между мирами, а ядро уже водило флот по
 * дорогам (`fleetPositionAt`), — корабли съезжали с нарисованных линий. Карта — та же, что
 * в тестах ядра: у B соседи A и C на одной тропе с развилкой F(60,0), D — на своей.
 */
function planet(id: string, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner: null,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function world(): GameState {
  const s = createInitialState({ seed: 'roads', version: { data: 't', manifest: 't' } });
  s.players.p1 = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} };
  const A = planet('A', 200, -150, ['B']);
  const B = planet('B', 0, 0, ['A', 'C', 'D']);
  const C = planet('C', 200, 150, ['B']);
  const D = planet('D', -300, 0, ['B']);
  const xab = { x: 100, y: -75 };
  const xcb = { x: 100, y: 75 };
  const xdb = { x: -150, y: 0 };
  A.roads = { crossings: { B: xab }, trails: [{ exits: ['B'], fork: null }] };
  C.roads = { crossings: { B: xcb }, trails: [{ exits: ['B'], fork: null }] };
  D.roads = { crossings: { B: xdb }, trails: [{ exits: ['B'], fork: null }] };
  B.roads = {
    crossings: { A: xab, C: xcb, D: xdb },
    trails: [
      { exits: ['A', 'C'], fork: { x: 60, y: 0 } },
      { exits: ['D'], fork: null },
    ],
  };
  return { ...s, planets: { A, B, C, D } };
}

const vp = { left: 0, top: 0, right: 800, bottom: 600 };
const bounds = { minX: -300, minY: -150, maxX: 200, maxY: 150 };
const opts = { data: { units: {} } as unknown as GameData, now: 0, dpr: 1 };

/** A context that records every path vertex, and ignores the rest. */
function recorder(): { g: CanvasRenderingContext2D; points: Array<{ x: number; y: number }> } {
  const points: Array<{ x: number; y: number }> = [];
  const context = {
    globalAlpha: 1,
    moveTo: (x: number, y: number) => points.push({ x, y }),
    lineTo: (x: number, y: number) => points.push({ x, y }),
    measureText: () => ({ width: 10 }),
  };
  const g = new Proxy(context, {
    get: (target, key) => Reflect.get(target, key) ?? (() => {}),
  }) as unknown as CanvasRenderingContext2D;
  return { g, points };
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

describe('ROADS-4 — новый клиент рисует дороги сетью', () => {
  it('дорога идёт через развилку, а прямой «мир → мир» больше нет', () => {
    const state = world();
    const cam = centerOn({ x: 0, y: 0, scale: 1 }, { x: 60, y: 0 }, 6, vp, bounds);
    const { g, points } = recorder();
    renderMap(g, state, cam, vp, bounds, opts);
    const fork = worldToScreen({ x: 60, y: 0 }, cam, vp, bounds);
    expect(points.some((p) => near(p, fork))).toBe(true);
    // Прямая A→B шла бы из экранной точки A прямо в экранную точку B, минуя развилку.
    const a = worldToScreen(state.planets.A!.position, cam, vp, bounds);
    const b = worldToScreen(state.planets.B!.position, cam, vp, bounds);
    for (let i = 1; i < points.length; i++) {
      expect(near(points[i - 1]!, a) && near(points[i]!, b)).toBe(false);
    }
  });

  it('развилка отмечена, а флот на ней — засада', () => {
    vi.mocked(drawForkMark).mockClear();
    vi.mocked(drawAmbushMark).mockClear();
    const state = world();
    state.fleets.g1 = {
      id: 'g1',
      owner: 'p1',
      location: null,
      movement: null,
      edge: { from: 'B', to: 'A', t: forkTAtStart(state, 'B', 'A') },
      units: [{ unit: 'scout', count: 1 }],
      traits: [],
    };
    const cam = centerOn({ x: 0, y: 0, scale: 1 }, { x: 60, y: 0 }, 6, vp, bounds);
    renderMap(recorder().g, state, cam, vp, bounds, opts);
    const fork = worldToScreen({ x: 60, y: 0 }, cam, vp, bounds);
    expect(vi.mocked(drawForkMark).mock.calls.map(([, x, y]) => ({ x, y }))).toEqual([fork]);
    expect(vi.mocked(drawAmbushMark)).toHaveBeenCalledTimes(1);
    const [, x, y] = vi.mocked(drawAmbushMark).mock.calls[0]!;
    expect(near({ x, y }, fork)).toBe(true);
  });

  it('флот не на развилке засадой не отмечен', () => {
    vi.mocked(drawAmbushMark).mockClear();
    const state = world();
    state.fleets.g1 = {
      id: 'g1',
      owner: 'p1',
      location: null,
      movement: null,
      edge: { from: 'B', to: 'A', t: 0.5 },
      units: [{ unit: 'scout', count: 1 }],
      traits: [],
    };
    const cam = centerOn({ x: 0, y: 0, scale: 1 }, { x: 60, y: 0 }, 6, vp, bounds);
    renderMap(recorder().g, state, cam, vp, bounds, opts);
    expect(vi.mocked(drawAmbushMark)).not.toHaveBeenCalled();
  });
});
