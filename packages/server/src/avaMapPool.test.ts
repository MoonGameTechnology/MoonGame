import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  Rng,
  avaShape,
  matchMapEdges,
  neutralSector,
  seedRng,
  parseMatchMap,
  type MatchMap,
} from '@void/shared-core';
import type { AvaFormat, AvaFormatMap } from './avaFormats';
import { avaMapView, buildAvaMapPool, pickAvaMap } from './avaMapPool';
import { loadAvaMaps, loadShippedData } from './scenario';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readMap = (name: string): MatchMap =>
  parseMatchMap(JSON.parse(readFileSync(path.join(repoRoot, 'data/maps', name), 'utf8')));

const shipped = (): MatchMap[] => [
  readMap('skirmish-1.json'),
  readMap('ava-duel-1.json'),
  readMap('ava-2v2-1.json'),
];
const rng = (seed: string): Rng => new Rng(seedRng(seed));

describe('pickAvaMap (AVA-5) — the AvA map pool', () => {
  it('answers "an AvA map for N×M" from the shipped maps: 2×1 → duel, 2×2 → the 2v2 map', () => {
    expect(pickAvaMap(shipped(), 2, 1, rng('s'))?.id).toBe('ava-duel-1');
    expect(pickAvaMap(shipped(), 2, 2, rng('s'))?.id).toBe('ava-2v2-1');
  });

  it('returns null when no eligible map matches the requested size', () => {
    expect(pickAvaMap(shipped(), 3, 1, rng('s'))).toBeNull();
    expect(pickAvaMap([], 2, 1, rng('s'))).toBeNull();
  });

  it('never picks a map that is not tagged eligible, even if its shape matches', () => {
    const untagged = readMap('ava-duel-1.json');
    untagged.avaEligible = false;
    expect(pickAvaMap([untagged], 2, 1, rng('s'))).toBeNull();
  });

  it('is deterministic: same pool + same seed → the same map, whatever the array order', () => {
    const a = readMap('ava-duel-1.json');
    const b = { ...readMap('ava-duel-1.json'), id: 'ava-duel-2' };
    const c = { ...readMap('ava-duel-1.json'), id: 'ava-duel-3' };
    const pick1 = pickAvaMap([a, b, c], 2, 1, rng('match-42'))!;
    const pick2 = pickAvaMap([c, a, b], 2, 1, rng('match-42'))!;
    expect(pick1.id).toBe(pick2.id);
    // any seed stays within the candidate pool
    const ids = new Set(['ava-duel-1', 'ava-duel-2', 'ava-duel-3']);
    for (const s of ['x', 'y', 'z']) {
      expect(ids.has(pickAvaMap([a, b, c], 2, 1, rng(s))!.id)).toBe(true);
    }
  });
});

describe('avaMapView (CORP-8) — the map a battle is played on', () => {
  const ffa = readMap('ffa-20.json');
  const team = readMap('team-2v2.json');
  const teams = (map: MatchMap): Record<string, string> =>
    Object.fromEntries(Object.entries(map.slots).map(([id, slot]) => [id, slot.team]));

  it('plays a team map as authored', () => {
    const view = avaMapView(team);
    expect(view).toEqual({ ...team, avaEligible: true });
    expect(avaShape(view)).toEqual({ sides: 2, slotsPerSide: 2 });
  });

  it('cuts a larger map to the starts in play: the rest are neutral and lose their fleets', () => {
    const view = avaMapView(ffa, [
      ['slot_15', 'slot_19'],
      ['slot_16', 'slot_18'],
    ]);
    expect(teams(view)).toEqual({ slot_15: 'A', slot_19: 'B', slot_16: 'A', slot_18: 'B' });
    expect(view.avaEligible).toBe(true);
    expect(view.sectors.home_15).toEqual(ffa.sectors.home_15);
    expect(view.sectors.home_1).toEqual(neutralSector(ffa.sectors.home_1!));
    const slotFleets = Object.values(view.fleets).filter((f) => f.owner.startsWith('slot_'));
    expect(slotFleets.map((f) => f.owner).sort()).toEqual([
      'slot_15',
      'slot_16',
      'slot_18',
      'slot_19',
    ]);
    // The map's inhabitants stay as authored.
    expect(view.players).toEqual(ffa.players);
    expect(Object.values(view.fleets).filter((f) => !f.owner.startsWith('slot_'))).toEqual(
      Object.values(ffa.fleets).filter((f) => !f.owner.startsWith('slot_')),
    );
    // The input map is untouched.
    expect(ffa.slots.slot_15!.team).toBe('slot_15');
    expect(ffa.sectors.home_1!.owner).toBe('slot_1');
  });
});

describe('buildAvaMapPool (CORP-8) — the formats catalog against the map files', () => {
  const data = loadShippedData();
  const files = [readMap('team-2v2.json'), readMap('ffa-20.json')];
  const row = (format: number, ...maps: AvaFormatMap[]): AvaFormat => ({
    format,
    cost: 1,
    reward: 1,
    minPlayers: 1,
    maps,
  });
  const build = (...formats: AvaFormat[]): MatchMap[] =>
    buildAvaMapPool({ baseMaxFormat: 2, formats }, files, data);
  const top = [
    ['slot_15', 'slot_19'],
    ['slot_16', 'slot_18'],
    ['slot_14', 'slot_20'],
  ] as Array<[string, string]>;

  it('builds a map per format entry, team maps and cuts alike', () => {
    const pool = build(
      row(2, { id: 'team-2v2' }, { id: 'ffa-20', pairs: top.slice(0, 2) }),
      row(3, { id: 'ffa-20', pairs: top }),
    );
    expect(pool.map((m) => [m.id, avaShape(m)?.slotsPerSide])).toEqual([
      ['team-2v2', 2],
      ['ffa-20', 2],
      ['ffa-20', 3],
    ]);
  });

  it('refuses to boot on a catalog that cannot seat its formats', () => {
    for (const [formats, code] of [
      [[row(2, { id: 'nowhere' })], 'E_UNKNOWN_MAP'],
      [
        [
          row(2, {
            id: 'ffa-20',
            pairs: [
              ['slot_15', 'slot_19'],
              ['slot_16', 'slot_99'],
            ],
          }),
        ],
        'E_UNKNOWN_START',
      ],
      [[row(3, { id: 'team-2v2' })], 'E_AVA_SHAPE'], // a 2 на 2 map under 3 на 3
      [[row(11, { id: 'team-2v2' })], 'E_NO_MODE'],
      // A start that changes sides between formats would settle a battle for the wrong side.
      [
        [
          row(2, { id: 'ffa-20', pairs: top.slice(0, 2) }),
          row(3, { id: 'ffa-20', pairs: [['slot_19', 'slot_15'], ...top.slice(1)] }),
        ],
        'E_SIDE_CHANGED',
      ],
    ] as Array<[AvaFormat[], string]>) {
      expect(() => build(...formats)).toThrow(code);
    }
  });
});

describe('the shipped AvA pool (CORP-8)', () => {
  const data = loadShippedData();
  const { pool, retired } = loadAvaMaps(data);
  const cuts = pool.filter((m) => m.id === 'ffa-20');

  it('2 на 2 on team-2v2, 3 на 3 on team-3v3, 4 на 4 to 10 на 10 on the 20-start map', () => {
    expect(pool.map((m) => [m.id, avaShape(m)?.slotsPerSide])).toEqual([
      ['team-2v2', 2],
      ['team-3v3', 3],
      ...[4, 5, 6, 7, 8, 9, 10].map((n) => ['ffa-20', n]),
    ]);
    for (let n = 2; n <= 10; n++) expect(pickAvaMap(pool, 2, n, rng('any'))).toBe(pool[n - 2]);
    // The small authored AvA maps stay for battles raised on them before.
    expect(retired.map((m) => m.id)).toEqual(['ava-2v2-1', 'ava-duel-1']);
  });

  it('cuts the 20-start map in two: the challenger above the black hole, the target below', () => {
    const middle = cuts[0]!.sectors.heart!.position.y;
    for (const cut of cuts) {
      for (const [slot, { team }] of Object.entries(cut.slots)) {
        const home = Object.values(cut.sectors).find((s) => s.owner === slot)!;
        expect([slot, home.position.y < middle ? 'A' : 'B']).toEqual([slot, team]);
      }
    }
  });

  // A guard against gross skew, as on the team maps (prototype `teamMap.test.ts`): the
  // 20-start map was drawn for a free-for-all, so its halves are not mirror-exact. The
  // starts of each format are picked so neither side is nearer to more of the map.
  it('gives both sides of every cut about the same land', () => {
    const links = new Map(Object.keys(cuts[0]!.sectors).map((id) => [id, [] as string[]]));
    for (const [a, b] of matchMapEdges(cuts[0]!, data).paths) {
      links.get(a)!.push(b);
      links.get(b)!.push(a);
    }
    const hops = new Map<string, Map<string, number>>();
    const from = (start: string): Map<string, number> => {
      const known = hops.get(start);
      if (known) return known;
      const d = new Map([[start, 0]]);
      const queue = [start];
      for (const id of queue)
        for (const next of links.get(id)!)
          if (!d.has(next)) {
            d.set(next, d.get(id)! + 1);
            queue.push(next);
          }
      hops.set(start, d);
      return d;
    };
    for (const cut of cuts) {
      const homes = (team: string): string[] =>
        Object.keys(cut.slots)
          .filter((slot) => cut.slots[slot]!.team === team)
          .map((slot) => Object.keys(cut.sectors).find((id) => cut.sectors[id]!.owner === slot)!);
      const [a, b] = [homes('A'), homes('B')];
      const near = (side: string[], id: string): number =>
        Math.min(...side.map((home) => from(home).get(id) ?? Infinity));
      let closerA = 0;
      let closerB = 0;
      let sumA = 0;
      let sumB = 0;
      for (const id of Object.keys(cut.sectors)) {
        if (a.includes(id) || b.includes(id) || links.get(id)!.length === 0) continue;
        const [da, db] = [near(a, id), near(b, id)];
        sumA += da;
        sumB += db;
        if (da < db) closerA++;
        if (db < da) closerB++;
      }
      const format = a.length;
      expect([format, Math.abs(closerA - closerB) <= 6]).toEqual([format, true]);
      expect([format, Math.abs(sumA - sumB) / Math.max(sumA, sumB) < 0.06]).toEqual([format, true]);
    }
  });
});
