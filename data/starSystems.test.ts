/**
 * ЗВЁЗДНЫЕ СИСТЕМЫ (владелец 2026-11-17): «каждая такая моделька должна иметь свою
 * провинцию, а вокруг неё логичные и возможные для неё другие провинции». Звезда — провинция
 * вида `star`: непроходимая и незахватываемая, класс звезды — её `terrain` (семья `star` в
 * `data/sectors.json`). Раскладывают звёзды `scripts/lay-stars.mjs` (карты руками и Python)
 * и `scripts/generate-ffa.mjs` (FFA); генераторы карт о звёздах не знают, поэтому карта,
 * перегенерированная без них, падает здесь.
 */
import { describe, expect, it } from 'vitest';
import { matchMapEdges, parseMatchMap, type MatchMap } from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';
import team2 from './maps/team-2v2.json';
import team3 from './maps/team-3v3.json';
import duel1 from './maps/duel-1.json';
import ffa4 from './maps/ffa-4.json';
import ffa20 from './maps/ffa-20.json';
import ffa50 from './maps/ffa-50.json';
import testbed from './maps/duel-testbed.json';
import proving from './maps/proving-ground.json';

const data = shippedGameData();

/** Where each map's stars stand, and of which class. */
const STARS: Array<[unknown, Record<string, string>]> = [
  [team2, { reach_82: 'yellow_dwarf', reach_83: 'yellow_dwarf' }],
  [team3, { crown_104: 'blue_giant', crown_105: 'blue_giant' }],
  [duel1, { crossing: 'yellow_dwarf' }],
  [ffa4, { cinder: 'yellow_dwarf' }],
  [ffa20, { lights_182: 'binary_star' }],
  [ffa50, { suns_017: 'yellow_dwarf', suns_039: 'red_giant', suns_467: 'blue_giant', suns_495: 'white_dwarf' }],
  [testbed, { flare_2: 'pulsar' }],
  [proving, { C12R8: 'blue_giant' }],
];

/** Maps whose stars re-made their first ring (the competitive mirror maps lay the star alone). */
const RINGED = new Set(['ffa-20', 'ffa-50', 'duel-testbed', 'proving-ground']);

/** A class's ring: the kinds its plain neighbours take and the world its planets become. */
const RING: Record<string, { kinds: string[]; world: string | null }> = {
  yellow_dwarf: { kinds: ['solar_flare', 'asteroid'], world: null },
  red_giant: { kinds: ['solar_flare', 'dead_world'], world: 'volcanic' },
  blue_giant: { kinds: ['ion_storm', 'dense_nebula'], world: 'irradiated' },
  white_dwarf: { kinds: ['dead_world', 'nebula'], world: 'barren' },
  pulsar: { kinds: ['ion_storm', 'dead_world'], world: 'irradiated' },
  binary_star: { kinds: ['solar_flare', 'asteroid'], world: null },
};
const PLAIN = new Set(['asteroid', 'nebula', 'dead_world', 'ion_storm', 'dense_nebula', 'solar_flare']);

const maps = STARS.map(([json, stars]) => [parseMatchMap(json), stars] as [MatchMap, Record<string, string>]);

/** Every border of the mosaic, lane or sealed: who touches whom. */
function bordersOf(map: MatchMap): Map<string, string[]> {
  const near = new Map(Object.keys(map.sectors).map((id) => [id, [] as string[]]));
  const { paths, sealed } = matchMapEdges(map, data);
  for (const [a, b] of [...paths, ...sealed]) {
    near.get(a)!.push(b);
    near.get(b)!.push(a);
  }
  return near;
}

const isSeat = (map: MatchMap, id: string): boolean => {
  const owner = map.sectors[id]!.owner;
  return !!owner && (!!map.slots[owner] || !!map.players[owner]);
};

describe('звёздные системы — звезда в своей провинции', () => {
  it('каталог: вид «Звезда» непроходим и не захватывается, классы — семья star', () => {
    expect(data.sectorKinds.star).toMatchObject({ traversable: false, capturable: false, buildable: false });
    const family = Object.keys(data.sectors).filter((t) => data.sectors[t]!.family === 'star');
    expect(family.sort()).toEqual(Object.keys(RING).sort());
  });

  it.each(maps.map(([map, stars]) => [map.id, map, stars] as const))('%s: звёзды на своих местах', (_, map, stars) => {
    const found = Object.fromEntries(
      Object.entries(map.sectors)
        .filter(([, s]) => s.kind === 'star')
        .map(([id, s]) => [id, s.terrain]),
    );
    expect(found).toEqual(stars);
    for (const id of Object.keys(stars)) {
      const s = map.sectors[id]!;
      expect([id, s.owner ?? null, s.planetType ?? null, s.buildings ?? [], s.garrison ?? []]).toEqual([id, null, null, [], []]);
    }
  });

  it.each(maps.map(([map, stars]) => [map.id, map, stars] as const))(
    '%s: к звезде нет ходов, и она не соседствует со столицей',
    (_, map, stars) => {
      const { paths } = matchMapEdges(map, data);
      const near = bordersOf(map);
      for (const id of Object.keys(stars)) {
        expect(paths.filter((p) => p.includes(id))).toEqual([]);
        const capitals = near.get(id)!.filter((n) => !!map.slots[map.sectors[n]!.owner ?? '']);
        expect([id, capitals]).toEqual([id, []]);
      }
    },
  );

  it('гиганты занимают больше места, чем карлики', () => {
    for (const [map, stars] of maps)
      for (const [id, cls] of Object.entries(stars)) {
        const size = map.sectors[id]!.size ?? 1;
        if (cls.endsWith('_giant') || cls === 'binary_star') expect([id, size > 1]).toEqual([id, true]);
        else expect([id, size]).toEqual([id, 1]);
      }
  });

  it.each(maps.filter(([map]) => RINGED.has(map.id)).map(([map, stars]) => [map.id, map, stars] as const))(
    '%s: первое кольцо — то, что звезда своего класса делает с соседями',
    (_, map, stars) => {
      const near = bordersOf(map);
      const seatSide = new Set<string>();
      for (const id of Object.keys(map.sectors))
        if (isSeat(map, id)) for (const n of [id, ...near.get(id)!]) seatSide.add(n);
      const count = (field: 'kind' | 'planetType', value: string): number =>
        Object.values(map.sectors).filter((s) => s[field] === value).length;
      for (const [id, cls] of Object.entries(stars)) {
        const { kinds, world } = RING[cls]!;
        for (const n of near.get(id)!) {
          const s = map.sectors[n]!;
          // A seat's side, a prize or a story keeps its province; so does the map's last of a
          // kind or a world (the maps show the whole catalogue).
          if (seatSide.has(n) || s.owner || s.buildings?.length || s.garrison?.length) continue;
          if (s.recruitHero || s.rendezvous || s.vault || s.captive || s.transit) continue;
          if (s.kind === 'planet' && world && s.planetType !== world)
            expect([n, count('planetType', s.planetType!)]).toEqual([n, 1]);
          if (PLAIN.has(s.kind) && s.planetType === undefined && !kinds.includes(s.kind))
            expect([n, s.kind, count('kind', s.kind)]).toEqual([n, s.kind, 1]);
        }
      }
    },
  );
});
