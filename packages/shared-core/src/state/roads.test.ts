import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import { loadGameData } from '../data/loadGameData';
import { parseMatchMap } from '../data/mapSchema';
import { buildStateFromMap, matchMapEdges } from './buildFromMap';
import {
  BOUNDARY,
  SEED_WEIGHT,
  clampPowerWeights,
  clipHalfPlaneTagged,
  mosaicBorderSegments,
  mosaicFrame,
  type MosaicSeed,
} from './mosaic';
import { FORK_AT, FORK_DETOUR, deriveRoads, type RoadInput } from './roads';
import type { PlanetRoads, RoadPoint } from './gameState';

/**
 * ROADS-1 — the road network (`docs/roads-roadmap.md` §0.3).
 *
 * What is pinned here is what the rules will lean on in ROADS-2: every lane crosses the
 * border ON the shared edge and at the same point from both sides, every neighbour hangs
 * off exactly one trail, a fork lies inside its province and never lengthens a road by
 * more than the cap, and the whole network is a pure function of the map.
 */

const data = loadGameData((name) =>
  JSON.parse(readFileSync(new URL(`../../../../data/${name}`, import.meta.url), 'utf8')),
);
const mapsDir = new URL('../../../../data/maps/', import.meta.url);
const mapFiles = readdirSync(mapsDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

const dist = (a: RoadPoint, b: RoadPoint): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** The network of a shipped map, read exactly the way `buildStateFromMap` reads it —
 *  but without building players, so slot-owned AvA maps need no seat assignment. */
function networkOf(file: string): {
  roads: Record<string, PlanetRoads>;
  centre: (id: string) => RoadPoint;
  seeds: MosaicSeed[];
  terrain: (id: string) => string | undefined;
  lanes: Array<[string, string]>;
} {
  const map = parseMatchMap(JSON.parse(readFileSync(new URL(file, mapsDir), 'utf8')));
  const seeds: MosaicSeed[] = Object.keys(map.sectors)
    .sort()
    .map((id) => ({
      id,
      x: map.sectors[id]!.position.x,
      y: map.sectors[id]!.position.y,
      size: map.sectors[id]!.size,
    }));
  const edges = matchMapEdges(map, data);
  const roads = deriveRoads({
    sectors: Object.fromEntries(
      Object.entries(map.sectors).map(([id, s]) => [
        id,
        { x: s.position.x, y: s.position.y, terrain: s.terrain },
      ]),
    ),
    lanes: edges.paths,
    borders: edges.derived ? mosaicBorderSegments(seeds) : [],
    corridorsOf: (t) => (t ? data.sectors[t]?.corridors : undefined),
  });
  return {
    roads,
    centre: (id) => map.sectors[id]!.position,
    seeds,
    terrain: (id) => map.sectors[id]!.terrain,
    lanes: edges.paths,
  };
}

/** A province's power cell, from the same exported primitives the kernel uses. */
function cellOf(seeds: readonly MosaicSeed[], i: number): Array<[number, number]> {
  const frame = mosaicFrame(seeds);
  const sites = seeds.map((s) => ({ x: s.x, y: s.y, w: s.size * SEED_WEIGHT }));
  clampPowerWeights(sites);
  let poly: Array<[number, number]> = [
    [frame.x0, frame.y0],
    [frame.x1, frame.y0],
    [frame.x1, frame.y1],
    [frame.x0, frame.y1],
  ];
  let tags = [BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY];
  const si = sites[i]!;
  for (let j = 0; j < sites.length; j++) {
    if (j === i) continue;
    const sj = sites[j]!;
    const c = si.x * si.x + si.y * si.y - (sj.x * sj.x + sj.y * sj.y) + (sj.w - si.w);
    const next = clipHalfPlaneTagged(poly, tags, 2 * (sj.x - si.x), 2 * (sj.y - si.y), c, j);
    poly = next.poly;
    tags = next.tags;
  }
  return poly;
}

/** Inside a convex polygon (either winding): the point is on one side of every edge. */
function insideConvex(poly: ReadonlyArray<[number, number]>, p: RoadPoint): boolean {
  let sign = 0;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const cross = (b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0]);
    if (cross === 0) return false; // on the boundary is not inside
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

describe('ROADS-1 — one province, read by hand', () => {
  // A world at the origin with three neighbours: two to the east, 60° apart, one to the
  // west. Crossings sit at the midpoints (no mosaic edges given).
  const input = (corridors: number | undefined): RoadInput => ({
    sectors: {
      w: { x: 0, y: 0, terrain: 't' },
      ne: { x: 200 * Math.cos(Math.PI / 6), y: 200 * Math.sin(Math.PI / 6) },
      se: { x: 200 * Math.cos(-Math.PI / 6), y: 200 * Math.sin(-Math.PI / 6) },
      west: { x: -200, y: 0 },
    },
    lanes: [
      ['w', 'ne'],
      ['w', 'se'],
      ['w', 'west'],
    ],
    borders: [],
    corridorsOf: (t) => (t === 't' ? corridors : undefined),
  });

  it('БЕЗ ЧИСЛА ТРОП — к каждому соседу своя прямая дорога, развилок нет', () => {
    const w = deriveRoads(input(undefined)).w!;
    expect(w.trails).toHaveLength(3);
    expect(w.trails.every((t) => t.exits.length === 1 && t.fork === null)).toBe(true);
  });

  it('ДВЕ ТРОПЫ — соседи с одной стороны делят тропу, круг режется по широкому промежутку', () => {
    const w = deriveRoads(input(2)).w!;
    expect(w.trails).toHaveLength(2);
    const east = w.trails.find((t) => t.exits.length === 2)!;
    expect([...east.exits].sort()).toEqual(['ne', 'se']);
    expect(w.trails.find((t) => t.exits.length === 1)!.exits).toEqual(['west']);
    // Развилка на биссектрисе — на оси x, к востоку от мира.
    expect(east.fork!.y).toBeCloseTo(0, 9);
    expect(east.fork!.x).toBeGreaterThan(0);
  });

  it('РАЗВИЛКА НЕ УДЛИНЯЕТ ДОРОГУ сверх предела — и не уходит дальше полпути', () => {
    const w = deriveRoads(input(2)).w!;
    const east = w.trails.find((t) => t.exits.length === 2)!;
    for (const id of east.exits) {
      const x = w.crossings[id]!;
      const straight = dist({ x: 0, y: 0 }, x);
      const viaFork = dist({ x: 0, y: 0 }, east.fork!) + dist(east.fork!, x);
      expect(viaFork).toBeLessThanOrEqual(straight * (1 + FORK_DETOUR) + 1e-9);
    }
    const mean = {
      x: (w.crossings.ne!.x + w.crossings.se!.x) / 2,
      y: (w.crossings.ne!.y + w.crossings.se!.y) / 2,
    };
    expect(dist({ x: 0, y: 0 }, east.fork!)).toBeLessThanOrEqual(
      FORK_AT * dist({ x: 0, y: 0 }, mean) + 1e-9,
    );
  });

  it('ВЫХОДЫ В РАЗНЫЕ СТОРОНЫ — тропа идёт СКВОЗЬ мир, развилки на планете не бывает', () => {
    const w = deriveRoads(input(1)).w!;
    expect(w.trails).toHaveLength(1);
    // Три выхода вокруг мира тянут в разные стороны: их середина почти в центре.
    expect(w.trails[0]!.fork).toBeNull();
  });

  it('ЧИСТАЯ ФУНКЦИЯ — порядок провинций и дорог на входе не меняет ни байта', () => {
    const a = deriveRoads(input(2));
    const shuffled = input(2);
    shuffled.lanes = [...shuffled.lanes].reverse().map(([p, q]) => [q, p] as [string, string]);
    shuffled.sectors = Object.fromEntries(Object.entries(shuffled.sectors).reverse());
    expect(JSON.stringify(deriveRoads(shuffled))).toBe(JSON.stringify(a));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a); // живёт в состоянии — значит, чистый JSON
  });
});

describe('ROADS-1 — сеть на каждой шипнутой карте', () => {
  for (const file of mapFiles) {
    it(`${file}: переход на общей грани, одна тропа на соседа, развилка внутри и в пределе`, () => {
      const { roads, centre, seeds, terrain, lanes } = networkOf(file);
      const edges = new Map(mosaicBorderSegments(seeds).map((b) => [`${b.a}|${b.b}`, b]));
      for (const [a, b] of lanes) {
        const xa = roads[a]!.crossings[b]!;
        const xb = roads[b]!.crossings[a]!;
        expect(xa).toEqual(xb); // одна точка с обеих сторон границы
        const e = edges.get(a < b ? `${a}|${b}` : `${b}|${a}`);
        if (e) {
          // Точка лежит НА общей грани: расстояние до отрезка — ноль с точностью счёта.
          const dx = e.q[0] - e.p[0];
          const dy = e.q[1] - e.p[1];
          const t = Math.max(
            0,
            Math.min(1, ((xa.x - e.p[0]) * dx + (xa.y - e.p[1]) * dy) / (dx * dx + dy * dy)),
          );
          expect(dist(xa, { x: e.p[0] + dx * t, y: e.p[1] + dy * t })).toBeLessThan(1e-6);
        }
      }
      for (const [id, r] of Object.entries(roads)) {
        const onTrails = r.trails.flatMap((t) => t.exits).sort();
        expect(onTrails).toEqual(Object.keys(r.crossings).sort()); // каждый сосед — ровно на одной тропе
        const limit = data.sectors[terrain(id) ?? '']?.corridors;
        if (limit !== undefined) expect(r.trails.length).toBeLessThanOrEqual(limit);
        const cell = cellOf(
          seeds,
          seeds.findIndex((s) => s.id === id),
        );
        for (const trail of r.trails) {
          if (!trail.fork) continue;
          expect([id, insideConvex(cell, trail.fork)]).toEqual([id, true]);
          for (const n of trail.exits) {
            const x = r.crossings[n]!;
            const viaFork = dist(centre(id), trail.fork) + dist(trail.fork, x);
            expect(viaFork).toBeLessThanOrEqual(dist(centre(id), x) * (1 + FORK_DETOUR) + 1e-9);
          }
        }
      }
    });
  }

  it('развилки есть там, где их просил владелец: на каждой шипнутой карте хотя бы одна', () => {
    // Модель выбрана ради развилок (§0.2): «к каждому соседу своя дорога» давала ноль на
    // обеих главах. Карта без единой развилки означает, что данные троп разошлись с идеей.
    for (const file of mapFiles) {
      const forks = Object.values(networkOf(file).roads).flatMap((r) =>
        r.trails.filter((t) => t.fork),
      );
      expect([file, forks.length > 0]).toEqual([file, true]);
    }
  });

  it('открытый космос сети не ветвит: у провинции без числа троп каждая дорога своя', () => {
    const { roads, terrain } = networkOf('pve-2.json');
    for (const [id, r] of Object.entries(roads)) {
      if (data.sectors[terrain(id) ?? '']?.corridors !== undefined) continue;
      expect([id, r.trails.every((t) => t.exits.length === 1 && t.fork === null)]).toEqual([
        id,
        true,
      ]);
    }
  });
});

describe('ROADS-1 — сеть приезжает в состояние', () => {
  it('buildStateFromMap кладёт дороги в провинции с проходами, и только в них', () => {
    const map = parseMatchMap(JSON.parse(readFileSync(new URL('pve-1.json', mapsDir), 'utf8')));
    const state = buildStateFromMap(map, data);
    for (const p of Object.values(state.planets)) {
      if ((p.links ?? []).length === 0) expect(p.roads).toBeUndefined();
      else expect(Object.keys(p.roads!.crossings).sort()).toEqual([...p.links!].sort());
    }
  });

  it('та же карта — та же сеть, байт в байт', () => {
    const raw = JSON.parse(readFileSync(new URL('pve-2.json', mapsDir), 'utf8'));
    const one = buildStateFromMap(parseMatchMap(raw), data);
    const two = buildStateFromMap(parseMatchMap(JSON.parse(JSON.stringify(raw))), data);
    const roadsOf = (s: typeof one): string =>
      JSON.stringify(
        Object.keys(s.planets)
          .sort()
          .map((id) => [id, s.planets[id]!.roads ?? null]),
      );
    expect(roadsOf(two)).toBe(roadsOf(one));
  });
});
