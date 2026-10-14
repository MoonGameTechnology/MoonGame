import { describe, expect, it } from 'vitest';
import { type TerrainEnvironmentInput, type TerrainEnvironmentTile } from '../../decisions/terrainEnvironment';
import { projectTerrainTile, terrainKnowledge, TerrainEnvironmentSceneCache } from './terrainEnvironmentView';

function input(): TerrainEnvironmentInput {
  return {
    cells: [{ id: 'known', kind: 'asteroid', known: true, poly: [[0, 0], [512, 0], [512, 512], [0, 512]] },
      { id: 'secret', kind: 'nebula', known: false, poly: [[512, 0], [1024, 0], [1024, 512], [512, 512]] }],
    roads: [[{ x: 10, y: 30 }, { x: 90, y: 130 }, { x: 220, y: 230 }]],
    markers: [{ x: 110, y: 180, kind: 'capture' }, { x: 200, y: 100, kind: 'fork' }],
    seed: 'viewer-fixture',
  };
}

describe('terrain knowledge boundary', () => {
  it('uses current identified types and ignores obsolete memory', () => {
    expect(terrainKnowledge({ kind: 'planet', terrain: 'nebula' }, true,
      { environment: { kind: 'graveyard' } })).toEqual({ known: true, kind: 'planet', terrain: 'nebula' });
    expect(terrainKnowledge(undefined, true)).toEqual({ known: false });
  });

  it('uses remembered environment without consulting now-hidden live types', () => {
    const memory = { environment: { kind: 'asteroid', terrain: 'asteroid_field' } };
    const expected = { known: true, kind: 'asteroid', terrain: 'asteroid_field' };
    expect(terrainKnowledge({ kind: 'rift', terrain: 'dense_nebula' }, false, memory)).toEqual(expected);
    expect(terrainKnowledge({ kind: 'planet', terrain: 'ion_storm' }, false, memory)).toEqual(expected);
  });

  it('does not turn unknown or legacy-memory cells into a live geography disclosure', () => {
    for (const live of [undefined, { kind: 'dense_nebula' }, { kind: 'planet', terrain: 'graveyard' }]) {
      expect(terrainKnowledge(live, false)).toEqual({ known: false });
      expect(terrainKnowledge(live, false, {})).toEqual({ known: false });
    }
    expect(terrainKnowledge({ kind: 'rift' }, false, { environment: {} })).toEqual({ known: true });
  });
});

describe('world environment scene cache', () => {
  it('reuses geometry through order changes, roundoff and ownership changes', () => {
    const cache = new TerrainEnvironmentSceneCache();
    const original = input();
    const scene = cache.prepare(original);
    const equivalent: TerrainEnvironmentInput = {
      ...original,
      cells: [...original.cells].reverse().map(c => ({ ...c, owner: 'new-owner',
        poly: c.poly.map(([x, y]) => [x + 1e-9, y - 1e-9] as const) })),
      roads: original.roads!.map(r => [...r].reverse()),
      markers: [...original.markers!].reverse(),
    };
    expect(cache.prepare(equivalent)).toBe(scene);
    expect(cache.prepare(structuredClone(original))).toBe(scene);
  });

  it('keeps the scene when camera roundoff flips the last rounded digit of a vertex', () => {
    // 1799.0546875 sits exactly halfway between two 1e-6 steps; a zoom rebake nudged it
    // to either side and rebuilt the whole environment once per bake.
    const at = (x: number): TerrainEnvironmentInput => ({ ...input(), cells: input().cells.map(c =>
      c.known ? { ...c, poly: [[0, 0], [x, 0], [512, 512], [0, 512]] as const } : c) });
    const cache = new TerrainEnvironmentSceneCache();
    const scene = cache.prepare(at(1799.0546875 - 1e-10));
    expect(cache.prepare(at(1799.0546875 + 1e-10))).toBe(scene);
    expect(cache.prepare(at(1799.0546875 - 1e-10))).toBe(scene);
    expect(cache.prepare(at(1799.06))).not.toBe(scene);
  });

  it('excludes every unknown metadata value, identity and geometry from its key', () => {
    const cache = new TerrainEnvironmentSceneCache();
    const original = input();
    const scene = cache.prepare(original);
    const altered = { ...original, cells: original.cells.map(c => c.known ? c : {
      ...c, id: 'different-hidden-id', kind: 'rift', terrain: 'graveyard', poly: [[0, 0], [1, 0], [0, 1]] as const,
    }) };
    expect(cache.prepare(altered)).toBe(scene);
    expect(new TerrainEnvironmentSceneCache().prepare(altered)).toEqual(scene);
  });

  it('invalidates permitted geography, roads, markers, seed and viewer history', () => {
    const cache = new TerrainEnvironmentSceneCache();
    const original = input();
    const scene = cache.prepare(original);
    const changes: TerrainEnvironmentInput[] = [
      { ...original, cells: original.cells.map(c => c.known ? { ...c, terrain: 'dense_nebula' } : c) },
      { ...original, cells: original.cells.map(c => c.known ? { ...c, poly: [[0, 0], [500, 0], [500, 500], [0, 500]] } : c) },
      { ...original, roads: [] },
      { ...original, markers: [] },
      { ...original, seed: 'another-match' },
      { ...original, cells: original.cells.map(c => ({ ...c, known: false })) },
    ];
    for (const changed of changes) {
      const current = cache.prepare(original);
      expect(cache.prepare(changed)).not.toBe(current);
    }
    const current = cache.prepare(original);
    cache.clear();
    expect(cache.prepare(original)).not.toBe(current);
    expect(cache.prepare(original)).toEqual(scene);
  });

  it('returns to the original permitted scene without retaining another viewer mask', () => {
    const cache = new TerrainEnvironmentSceneCache();
    const original = input();
    const known = cache.prepare(original);
    const hidden = cache.prepare({ ...original, cells: original.cells.map(c => ({ ...c, known: false })) });
    expect(hidden.tiles).toEqual([]);
    expect(hidden.clipPolygons).toEqual([]);
    const restored = cache.prepare(original);
    expect(restored).not.toBe(known);
    expect(restored).toEqual(known);
  });
});

describe('terrain tile projection', () => {
  const tile: TerrainEnvironmentTile = {
    id: '0,-1', x: 0, y: -256, size: 256,
    box: { x: -17, y: -278, width: 305, height: 290 }, features: [],
    clipPolygons: [[[0, -256], [256, -256], [256, 0], [0, 0]]], fingerprint: 'fixture',
  };

  it('projects the full feature extent including overhang, retaining immutable world input', () => {
    const projection = { scale: 2.5, x: 41, y: -9 };
    const result = projectTerrainTile(tile, projection);
    expect(result).toMatchObject({ id: 'environment:0,-1', kind: 'environment', color: '', phase: 0,
      box: { x: -1.5, y: -704, width: 762.5, height: 725 }, environment: { tile, projection } });
    expect(result.poly).toEqual([[-1.5, -704], [761, -704], [761, 21], [-1.5, 21]]);
    expect(result.environment!.tile).toBe(tile);
    expect(result.environment!.projection).toBe(projection);
  });

  it('pans and zooms without changing the tile identity, fingerprint or clip geometry', () => {
    const before = structuredClone(tile);
    const close = projectTerrainTile(tile, { scale: 4, x: 120, y: 90 });
    const far = projectTerrainTile(tile, { scale: 0.25, x: -72, y: 8 });
    expect(close.id).toBe(far.id);
    expect(close.environment!.tile).toBe(far.environment!.tile);
    expect(close.box.width / far.box.width).toBe(16);
    expect(tile).toEqual(before);
  });
});
