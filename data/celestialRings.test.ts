/**
 * КОЛЬЦА ВОКРУГ ТЕЛ (владелец 2026-11-18/19): «вокруг чёрной дыры должны быть непроходимые
 * провинции. И вокруг других таких объектов тоже». Чёрная дыра стоит внутри аккреционного
 * диска, звезда — внутри кольца своего класса (`RING_OF`, `decisions/celestialRing.ts`); тело
 * с кольцом — около трёх провинций (макет колец, «Раздвинуть соседей»), и авиация над ними не
 * летает (`overflight: false`). Кольца раскладывают `scripts/lay-rings.mjs` и
 * `scripts/generate-ffa.mjs`; карта, переложенная без них, падает здесь.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mosaicBorderSegments, parseMatchMap, type MatchMap } from '../packages/shared-core/src/index';
import { RING_OF, isCelestialRing, ringKindOf } from '../decisions/celestialRing';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const dir = new URL('./maps/', import.meta.url);
const maps: MatchMap[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMatchMap(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))))
  .filter((m) => Object.values(m.sectors).some((s) => ringKindOf(s) !== undefined || isCelestialRing(s.kind)));

/** A lone disk province stands in for a rift on the two test maps (2026-11-10, before the
 *  rings): a hole in the map, not part of a ring. */
const LONE_DISK: Record<string, string[]> = { 'duel-testbed': ['scar_nw'], 'proving-ground': ['C10R5'] };

/** Who borders whom, and each cell's area in units of the map's median place. */
function mosaicOf(map: MatchMap) {
  const ids = Object.keys(map.sectors).sort();
  const segments = mosaicBorderSegments(
    ids.map((id) => {
      const s = map.sectors[id]!;
      return { id, x: s.position.x, y: s.position.y, size: s.size ?? 1 };
    }),
    map.edge,
  );
  const near = new Map(ids.map((id) => [id, [] as string[]]));
  const area = new Map(ids.map((id) => [id, 0]));
  for (const { a, b, p, q } of segments) {
    near.get(a)!.push(b);
    near.get(b)!.push(a);
    for (const id of [a, b]) {
      const { x, y } = map.sectors[id]!.position;
      area.set(id, area.get(id)! + Math.abs((p[0] - x) * (q[1] - y) - (q[0] - x) * (p[1] - y)) / 2);
    }
  }
  const places = ids
    .filter((id) => data.sectorKinds[map.sectors[id]!.kind]?.traversable !== false)
    .map((id) => area.get(id)!)
    .sort((x, y) => x - y);
  const median = places[places.length >> 1]!;
  return { near, share: (id: string) => area.get(id)! / median };
}

describe('кольца вокруг тел — на каждой карте', () => {
  it('карты с телами найдены, и у каждого тела есть вид кольца', () => {
    expect(maps.map((m) => m.id).sort()).toEqual(
      ['duel-1', 'duel-testbed', 'ffa-20', 'ffa-4', 'ffa-50', 'proving-ground', 'pve-4', 'team-2v2', 'team-3v3'],
    );
    for (const kind of Object.values(RING_OF)) expect(data.sectorKinds[kind], kind).toBeDefined();
  });

  it.each(maps.map((m) => [m.id, m] as const))('%s: тело касается только своего кольца, кольцо замкнуто', (_, map) => {
    const { near } = mosaicOf(map);
    for (const [body, s] of Object.entries(map.sectors)) {
      const kind = ringKindOf(s);
      if (kind === undefined) continue;
      const ring = near.get(body)!;
      expect([body, ring.length >= 8]).toEqual([body, true]);
      for (const cell of ring) {
        expect([body, cell, map.sectors[cell]!.kind]).toEqual([body, cell, kind]);
        // Two ring neighbours each: one closed loop round the body, no gap to fly through.
        expect([cell, near.get(cell)!.filter((n) => ring.includes(n)).length]).toEqual([cell, 2]);
      }
    }
  });

  it.each(maps.map((m) => [m.id, m] as const))('%s: каждая провинция кольца стоит в кольце своего тела', (_, map) => {
    const { near } = mosaicOf(map);
    const ringed = new Set(
      Object.keys(map.sectors).flatMap((id) => (ringKindOf(map.sectors[id]!) === undefined ? [] : near.get(id)!)),
    );
    const loose = Object.keys(map.sectors).filter((id) => isCelestialRing(map.sectors[id]!.kind) && !ringed.has(id));
    expect(loose.sort()).toEqual(LONE_DISK[map.id] ?? []);
  });

  it.each(maps.map((m) => [m.id, m] as const))('%s: тело с кольцом — около трёх провинций, клетка кольца не щель', (_, map) => {
    const { near, share } = mosaicOf(map);
    for (const [body, s] of Object.entries(map.sectors)) {
      if (ringKindOf(s) === undefined) continue;
      const ring = near.get(body)!;
      const whole = share(body) + ring.reduce((sum, cell) => sum + share(cell), 0);
      expect([body, whole >= 2.3]).toEqual([body, true]);
      for (const cell of ring) expect([cell, share(cell) >= 0.15]).toEqual([cell, true]);
    }
  });
});
