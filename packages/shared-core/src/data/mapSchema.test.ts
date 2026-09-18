import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseMatchMap, safeParseMatchMap } from './mapSchema';
import { loadGameData } from './loadGameData';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function readMap(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, 'data', 'maps', name), 'utf8'));
}

describe('map schema (map-roadmap.md M1.1)', () => {
  it('parses the shipped example map and applies defaults', () => {
    const map = parseMatchMap(readMap('skirmish-1.json'));
    expect(map.id).toBe('skirmish-1');
    expect(Object.keys(map.sectors)).toContain('nexus');
    expect(map.paths.length).toBe(4);
    // defaults: a sector with no owner → null; no kind → 'planet'; empty arrays
    expect(map.sectors.nexus!.owner).toBeNull();
    expect(map.sectors.nexus!.kind).toBe('nebula');
    expect(map.sectors.drift!.kind).toBe('asteroid');
    expect(map.sectors.home_green!.buildings.length).toBe(3);
    expect(map.sectors.veil!.garrison).toEqual([]);
    // building level defaults to 1
    expect(map.sectors.home_green!.buildings[0]!.level).toBe(1);
  });

  it('parses a slot-based AvA map — teams, decoupled from concrete players', () => {
    const map = parseMatchMap(readMap('ava-duel-1.json'));
    expect(Object.keys(map.players)).toEqual([]); // no baked-in players
    expect(map.slots.slot_a!.team).toBe('A');
    expect(map.slots.slot_b!.team).toBe('B');
    expect(map.sectors.home_a!.owner).toBe('slot_a'); // a sector owner names a slot
    expect(map.fleets.fleet_a!.owner).toBe('slot_a'); // a fleet owner too
    expect(map.slots.slot_a!.resources).toEqual({ credits: 300, metal: 300 });
  });

  it('defaults a slot spawn policy to fixed and rejects an unknown one', () => {
    const ok = safeParseMatchMap({
      id: 'x',
      seed: 'x',
      sectors: { a: { position: { x: 0, y: 0 } } },
      slots: { s: { team: 'A' } },
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.slots.s!.spawn).toBe('fixed');
    const bad = safeParseMatchMap({
      id: 'x',
      seed: 'x',
      sectors: { a: { position: { x: 0, y: 0 } } },
      slots: { s: { team: 'A', spawn: 'teleport' } },
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a malformed map (missing sectors)', () => {
    expect(safeParseMatchMap({ id: 'x', seed: 'x' }).success).toBe(false);
  });

  it('rejects a sector with a non-numeric position', () => {
    const bad = { id: 'x', seed: 'x', sectors: { a: { position: { x: 'NaN', y: 0 } } } };
    expect(safeParseMatchMap(bad).success).toBe(false);
  });

  it('rejects a garrison stack with a zero/negative count', () => {
    const bad = {
      id: 'x',
      seed: 'x',
      sectors: { a: { position: { x: 0, y: 0 }, garrison: [{ unit: 'militia', count: 0 }] } },
    };
    expect(safeParseMatchMap(bad).success).toBe(false);
  });
});

/**
 * A map's `kind` / `terrain` / `planetType` are free-form strings: an id the bundle does
 * not know does NOT fail the parse. It degrades — an unknown kind falls back to the
 * permissive defaults in `sectorKind.ts`, an unknown terrain simply carries no bonus. So
 * a typo ships as "this province quietly behaves like open space", which is exactly the
 * kind of defect no one notices. The map schema cannot check this (it has no catalogue);
 * this sweep can.
 */
describe('shipped maps resolve against the shipped catalogue', () => {
  const data = loadGameData((name) => JSON.parse(readFileSync(path.join(repoRoot, 'data', name), 'utf8')));
  const files = readdirSync(path.join(repoRoot, 'data', 'maps')).filter((f) => f.endsWith('.json'));

  it('there are shipped maps at all — otherwise the sweep below is green over nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: every kind, terrain and planet type is in the bundle`, () => {
      const map = parseMatchMap(readMap(file));
      for (const [id, sec] of Object.entries(map.sectors)) {
        expect([id, sec.kind, sec.kind in data.sectorKinds]).toEqual([id, sec.kind, true]);
        if (sec.terrain !== undefined)
          expect([id, sec.terrain, sec.terrain in data.sectors]).toEqual([id, sec.terrain, true]);
        if (sec.planetType !== undefined)
          expect([id, sec.planetType, sec.planetType in data.planetTypes]).toEqual([id, sec.planetType, true]);
      }
    });
  }

  /** Catalogue entries nobody places are content that cannot be met in a canonical match.
   *  The shipped maps used to be three kinds and two terrains wide while the catalogue
   *  carried eight terrains; this pins the spread so a map edit cannot quietly narrow it
   *  back. Widening it is a deliberate edit of this list, which is the point. */
  it('the maps exercise the terrain catalogue, not just nebula and asteroid', () => {
    const kinds = new Set<string>();
    const terrains = new Set<string>();
    for (const file of files) {
      for (const sec of Object.values(parseMatchMap(readMap(file)).sectors)) {
        kinds.add(sec.kind);
        if (sec.terrain !== undefined) terrains.add(sec.terrain);
      }
    }
    expect([...terrains].sort()).toEqual([
      'asteroid_cluster',
      'asteroid_field',
      'dense_nebula',
      'empty_space',
      'ion_storm',
      'nebula',
      'solar_flare_zone',
    ]);
    // `empty` joined the spread with the Sector Zero fork rebuild: a fork is a point
    // where lines meet, NOT a province, and `empty` is the catalogue's non-capturable,
    // non-buildable kind — the only way to say "nothing is here but the junction".
    expect([...kinds].sort()).toEqual([
      'asteroid',
      'asteroid_cluster',
      'dense_nebula',
      'empty',
      'ion_storm',
      'nebula',
      'planet',
    ]);
  });
});
