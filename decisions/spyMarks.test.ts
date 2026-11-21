import { describe, it, expect } from 'vitest';
import type { GameState, Planet, Spy } from '../packages/shared-core/src/index';
import {
  createInitialState,
  laneRoad,
  pointAlong,
  spyTurnBack,
} from '../packages/shared-core/src/index';
import { spyFlashOf, spyFlightRoad, spyMarks, turnedOnTo } from './spyMarks';

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
      {
        id: 2,
        gen: 1,
        home: false,
        a: 'H',
        b: 'N',
        f: 0.5,
        ahead: ['E'],
        behind: [],
        target: 'E',
        until: 300,
      },
    ]);
    expect(spyMarks([flying], 200).flights[0]).toMatchObject({
      a: 'N',
      b: 'E',
      f: 0.5,
      ahead: [],
      behind: ['H'],
    });
  });

  it('в миг вылета весь путь впереди, после прибытия — позади', () => {
    expect(spyMarks([flying], 0).flights[0]).toMatchObject({
      a: 'H',
      b: 'H',
      ahead: ['N', 'E'],
      behind: [],
    });
    expect(spyMarks([flying], 300).flights[0]).toMatchObject({
      a: 'E',
      b: 'E',
      ahead: [],
      behind: ['H', 'N'],
    });
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

/**
 * Дорога шпиона — как у флота (правило 2а, замечание владельца 2026-11-21). Карта та же, что в
 * `roadsMovement.test.ts`: провинция N в начале координат, соседи H и E — на ОДНОЙ тропе N с
 * развилкой F (60, 0), W — на своей тропе.
 *
 *            H (200,−150)
 *           /
 *   W —— N(0,0) — F(60,0)
 *           \
 *            E (200,150)
 */
function roads(): GameState {
  const s = createInitialState({ seed: 'spy-road', version: { data: '0.1.0', manifest: '1' } });
  const planet = (id: string, x: number, y: number, links: string[]): Planet => ({
    id,
    owner: null,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  });
  const H = planet('H', 200, -150, ['N']);
  const N = planet('N', 0, 0, ['H', 'E', 'W']);
  const E = planet('E', 200, 150, ['N']);
  const W = planet('W', -300, 0, ['N']);
  const xhn = { x: 100, y: -75 };
  const xen = { x: 100, y: 75 };
  const xwn = { x: -150, y: 0 };
  H.roads = { crossings: { N: xhn }, trails: [{ exits: ['N'], fork: null }] };
  E.roads = { crossings: { N: xen }, trails: [{ exits: ['N'], fork: null }] };
  W.roads = { crossings: { N: xwn }, trails: [{ exits: ['N'], fork: null }] };
  N.roads = {
    crossings: { H: xhn, E: xen, W: xwn },
    trails: [
      { exits: ['H', 'E'], fork: { x: 60, y: 0 } },
      { exits: ['W'], fork: null },
    ],
  };
  s.planets = { H, N, E, W };
  return s;
}
const flight = (a: string, b: string, f: number, ahead: string[], behind: string[] = []) => ({
  a,
  b,
  f,
  ahead,
  behind,
});
const has = (pts: { x: number; y: number }[], x: number, y: number) =>
  pts.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);

describe('SPM-1 — дорога шпиона как у флота', () => {
  it('мимо мира той же тропой — по развилке, в узел мира не заходит', () => {
    const s = roads();
    const pts = spyFlightRoad(s, flight('H', 'N', 0, ['E']));
    expect(pts[0]).toEqual({ x: 200, y: -150 });
    expect(has(pts, 60, 0)).toBe(true);
    expect(has(pts, 0, 0)).toBe(false);
    expect(pts.at(-1)).toEqual({ x: 200, y: 150 });
  });

  it('по разным тропам — через мир, как флот', () => {
    const s = roads();
    const pts = spyFlightRoad(s, flight('H', 'N', 0, ['W']));
    expect(has(pts, 0, 0)).toBe(true);
    expect(pts.at(-1)).toEqual({ x: -300, y: 0 });
  });

  it('корабль идёт к развилке, а не к миру: лейн до неё — вся доля времени лейна', () => {
    const s = roads();
    // Конец первого лейна — развилка F: в конце его времени корабль на ней.
    expect(spyFlightRoad(s, flight('H', 'N', 1, ['E']))[0]).toEqual({ x: 60, y: 0 });
    // Второй лейн начинается с развилки и кончается в мире цели.
    expect(spyFlightRoad(s, flight('N', 'E', 0, [], ['H']))[0]).toEqual({ x: 60, y: 0 });
    expect(spyFlightRoad(s, flight('N', 'E', 1, [], ['H']))[0]).toEqual({ x: 200, y: 150 });
    // Середина времени первого лейна — середина дороги H → переход → F (125 + 85 = 210), то
    // есть 105 от H на первом отрезке, а не середина H → N.
    const mid = spyFlightRoad(s, flight('H', 'N', 0.5, ['E']))[0]!;
    expect(mid).not.toEqual(pointAlong(laneRoad(s, 'H', 'N')!, 0.5));
    expect(Math.hypot(mid.x - 200, mid.y + 150)).toBeCloseTo(105, 9);
  });

  it('стоит в мире: точка мира; путь впереди — с этого мира', () => {
    const s = roads();
    expect(spyFlightRoad(s, flight('E', 'E', 0, [], ['H', 'N']))).toEqual([{ x: 200, y: 150 }]);
    const start = spyFlightRoad(s, flight('H', 'H', 0, ['N', 'E']));
    expect(start[0]).toEqual({ x: 200, y: -150 });
    expect(has(start, 60, 0)).toBe(true);
    expect(has(start, 0, 0)).toBe(false);
  });

  it('отозванный разворачивается с той же точки, где летел к развилке', () => {
    const s = roads();
    const out: Spy = {
      id: 1,
      gen: 1,
      state: 'travel',
      location: 'E',
      from: 'H',
      departedAt: 0,
      arrivesAt: 300,
      op: 'relocate',
      mission: 1,
      way: [
        { at: 'H', t: 0 },
        { at: 'N', t: 100 },
        { at: 'E', t: 300 },
      ],
    };
    const now = 70;
    const there = spyFlightRoad(s, spyMarks([out], now).flights[0]!)[0]!;
    // Отзыв: обратный путь ядра — с мира впереди (N), отмеченного в прошлом, и домой.
    const lead = spyTurnBack(out.way, now)!;
    const back: Spy = {
      ...out,
      state: 'return',
      location: 'H',
      departedAt: now,
      arrivesAt: now + 70,
      mission: 2,
      way: lead,
    };
    const outbound = new Map([[1, out.way!]]);
    const fl = spyMarks([back], now, outbound).flights[0]!;
    expect(fl.behind).toEqual(['E']);
    const turned = spyFlightRoad(s, fl)[0]!;
    expect(turned.x).toBeCloseTo(there.x, 9);
    expect(turned.y).toBeCloseTo(there.y, 9);
    // Без пути туда (перезагрузка) — дорога целиком, без развилки: разворот не на глазах.
    expect(spyMarks([back], now).flights[0]!.behind).toEqual([]);
  });

  it('путь туда узнаётся по времени мира разворота; чужой путь не подходит', () => {
    const way = [
      { at: 'H', t: 0 },
      { at: 'N', t: 100 },
      { at: 'E', t: 300 },
    ];
    const back = spyTurnBack(way, 70)!;
    expect(turnedOnTo(back, 70, way)).toBe('E');
    expect(turnedOnTo(back, 70, undefined)).toBeUndefined();
    expect(
      turnedOnTo(
        back,
        70,
        way.map((p) => ({ ...p, t: p.t + 50 })),
      ),
    ).toBeUndefined();
    // Обычный путь домой начинается в миг вылета — это не разворот.
    expect(
      turnedOnTo(
        [
          { at: 'N', t: 70 },
          { at: 'H', t: 140 },
        ],
        70,
        way,
      ),
    ).toBeUndefined();
  });

  it('мира пути нет на карте — пусто', () => {
    expect(spyFlightRoad(roads(), flight('H', 'Z', 0.5, []))).toEqual([]);
  });
});
