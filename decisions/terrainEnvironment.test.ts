import { describe, expect, it } from 'vitest';
import {
  buildTerrainEnvironment, sampleTerrainEnvironment, TERRAIN_ENVIRONMENT_TILE_SIZE,
  type TerrainEnvironmentCell, type TerrainEnvironmentInput,
} from './terrainEnvironment';

function cell(id: string, kind: string, x: number, y: number, width: number, height = width): TerrainEnvironmentCell {
  return { id, kind, known: true, poly: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] };
}
const features = (input: TerrainEnvironmentInput) => buildTerrainEnvironment(input).tiles.flatMap(t => t.features);
const split = [cell('west', 'asteroid', -512, -512, 512, 1024), cell('east', 'asteroid', 0, -512, 512, 1024)];

describe('continuous terrain environment', () => {
  it('draws one formation across spatial neighbours even when no road exists', () => {
    const whole = [cell('whole', 'asteroid', -512, -512, 1024)];
    const joined = features({ cells: split });
    expect(joined.length).toBeGreaterThan(100);
    expect(joined).toEqual(features({ cells: whole }));
    expect(joined.some(f => {
      const xs = f.paths.flatMap(p => p.points.map(v => v[0]));
      return Math.min(...xs) < 0 && Math.max(...xs) > 0;
    })).toBe(true);
    const left = sampleTerrainEnvironment(split, -0.01, 100);
    expect(sampleTerrainEnvironment(split, 0.01, 100)).toEqual(left);
  });

  it('varies density and object scale through a dense core, ordinary field and open space', () => {
    const cells = [cell('core', 'asteroid_cluster', -600, -200, 400),
      cell('field', 'asteroid', -200, -200, 400), cell('open', 'planet', 200, -200, 400)];
    const core = sampleTerrainEnvironment(cells, -400, 0)[0]!;
    const field = sampleTerrainEnvironment(cells, 0, 0)[0]!;
    const edge = sampleTerrainEnvironment(cells, 215, 0)[0]!;
    expect(core.density).toBeGreaterThan(field.density);
    expect(core.scale).toBeGreaterThan(field.scale);
    expect(edge.density).toBeGreaterThan(0);
    expect(edge.density).toBeLessThan(field.density);
    expect(sampleTerrainEnvironment(cells, 400, 0)).toEqual([]);
    const near = sampleTerrainEnvironment(cells, 199.99, 0)[0]!;
    const beyond = sampleTerrainEnvironment(cells, 200.01, 0)[0]!;
    expect(Math.abs(near.density - beyond.density)).toBeLessThan(0.001);
  });

  it('keeps nebula structure distinct from stones at a mixed boundary', () => {
    const cells = [cell('cloud', 'nebula', -400, -200, 400), cell('rocks', 'asteroid', 0, -200, 400)];
    expect(sampleTerrainEnvironment(cells, 0, 0).map(m => m.family)).toEqual(['asteroid', 'nebula']);
    const art = features({ cells });
    const clouds = art.filter(f => f.family === 'nebula');
    expect(clouds.length).toBeGreaterThan(0);
    expect(clouds.every(f => f.paths.every(p => !p.closed && p.points.length >= 3))).toBe(true);
    expect(clouds.some(f => f.paths.some(p => {
      const [a, b, c] = p.points;
      return Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) > 0.001;
    }))).toBe(true);
    expect(art.some(f => f.family === 'asteroid' && f.paths.some(p => p.closed))).toBe(true);
    const dense = sampleTerrainEnvironment([cell('c', 'dense_nebula', -200, -200, 400)], 0, 0)[0]!;
    const ordinary = sampleTerrainEnvironment([cell('c', 'nebula', -200, -200, 400)], 0, 0)[0]!;
    expect(dense.density).toBeGreaterThan(ordinary.density);
    expect(dense.scale).toBeGreaterThan(ordinary.scale);
    expect(dense.contrast).toBeGreaterThan(ordinary.contrast);
  });

  it.each(['nebula', 'dust_lane'])('gives %s connected wisps with irregular spans and quiet ends', kind => {
    const art = features({ cells: [cell('field', kind, -512, -512, 1024)] });
    const spans: number[] = [];
    for (const f of art) {
      // Recover connected curves by geometry rather than relying on a fixed number of
      // segments, samples or bands. Tapering must not introduce gaps between portions.
      const ribbons: (typeof f.paths[number])[][] = [];
      for (const path of f.paths) {
        const current = ribbons.at(-1);
        const end = current?.at(-1)?.points.at(-1);
        const start = path.points[0]!;
        if (end && end[0] === start[0] && end[1] === start[1]) current!.push(path);
        else ribbons.push([path]);
      }
      for (const ribbon of ribbons) {
        expect(ribbon.every(path => !path.closed)).toBe(true);
        const brightest = Math.max(...ribbon.map(path => path.alpha));
        expect(ribbon[0]!.alpha).toBeLessThan(brightest);
        expect(ribbon.at(-1)!.alpha).toBeLessThan(brightest);
        const start = ribbon[0]!.points[0]!, end = ribbon.at(-1)!.points.at(-1)!;
        spans.push(Math.hypot(end[0] - start[0], end[1] - start[1]));
      }
    }
    expect(spans.length).toBeGreaterThan(5);
    expect(Math.max(...spans) / Math.min(...spans)).toBeGreaterThan(1.25);
    expect(new Set(spans.map(span => Math.round(span))).size).toBeGreaterThan(5);
  });

  it('normalizes triple junctions and preserves a small province interior', () => {
    const cells = [cell('left', 'nebula', -300, -150, 300),
      cell('right', 'asteroid', 0, 0, 300), cell('small', 'graveyard', 0, -40, 40)];
    const junction = sampleTerrainEnvironment(cells, 0, 0);
    expect(junction.map(m => m.family)).toEqual(['asteroid', 'nebula', 'debris']);
    expect(junction.reduce((sum, m) => sum + m.density, 0)).toBeLessThanOrEqual(1);
    const small = sampleTerrainEnvironment(cells, 20, -20);
    expect(small.find(m => m.family === 'debris')!.density).toBeGreaterThan(0.45);
  });

  it('never consults unknown kind, terrain, identity, ownership or array order', () => {
    const known = cell('known', 'nebula', -400, -200, 400);
    const secretA = { ...cell('secret', 'asteroid', 0, -200, 400), known: false };
    const secretB = { ...secretA, id: 'other-secret', kind: 'rift', terrain: 'dense_nebula' };
    expect(buildTerrainEnvironment({ cells: [known, secretA] })).toEqual(buildTerrainEnvironment({ cells: [secretB, known] }));
    const input = { cells: split.map(c => ({ ...c, owner: 'p1' })) };
    const captured = { cells: [...split].reverse().map(c => ({ ...c, owner: 'p2' })) };
    expect(buildTerrainEnvironment(input)).toEqual(buildTerrainEnvironment(captured));
    expect(buildTerrainEnvironment({ cells: [secretA] })).toEqual(buildTerrainEnvironment({ cells: [] }));
  });

  it('uses actual road polylines to calm terrain and does not connect their endpoints', () => {
    const cells = [cell('cloud', 'dense_nebula', -512, -512, 1024)];
    const roads = [[{ x: -450, y: -450 }, { x: -450, y: 450 }, { x: 450, y: 450 }]];
    const plain = buildTerrainEnvironment({ cells });
    const calm = buildTerrainEnvironment({ cells, roads });
    expect(calm.signature).not.toBe(plain.signature);
    // The centre is near the fictitious diagonal but far from both real road legs.
    expect(calm.tiles.find(t => t.id === '0,-1')!.features).toEqual(plain.tiles.find(t => t.id === '0,-1')!.features);
    const originals = new Map(plain.tiles.flatMap(t => t.features).map(f => [f.id, f]));
    const nearRoad = calm.tiles.flatMap(t => t.features).filter(f => {
      const old = originals.get(f.id);
      return old && f.paths[0]!.alpha < old.paths[0]!.alpha;
    });
    expect(nearRoad.length).toBeGreaterThan(0);
    for (const f of nearRoad) {
      // Calming changes contrast, never moves an asteroid, a cloud or a road.
      expect(f.paths.map(p => p.points)).toEqual(originals.get(f.id)!.paths.map(p => p.points));
      expect(f.paths[0]!.alpha).toBeGreaterThan(0);
    }
    expect(roads).toEqual([[{ x: -450, y: -450 }, { x: -450, y: 450 }, { x: 450, y: 450 }]]);
  });

  it('keeps independent formations stable after one local terrain or road edit', () => {
    const cells = [...split, cell('far', 'nebula', 2048, -512, 512, 1024)];
    const before = buildTerrainEnvironment({ cells });
    const after = buildTerrainEnvironment({ cells: cells.map(c => c.id === 'far' ? { ...c, kind: 'graveyard' } : c),
      roads: [[{ x: 2100, y: -400 }, { x: 2500, y: 400 }]] });
    const local = (scene: typeof before) => scene.tiles.filter(t => t.x < 1024);
    expect(local(after)).toEqual(local(before));
    expect(after.signature).not.toBe(before.signature);
  });

  it('retains whole features at tile borders and fingerprints the local known mask', () => {
    const scene = buildTerrainEnvironment({ cells: split });
    expect(scene.tiles.some(t => t.box.x < t.x || t.box.x + t.box.width > t.x + t.size)).toBe(true);
    for (const tile of scene.tiles) {
      expect(tile.size).toBe(TERRAIN_ENVIRONMENT_TILE_SIZE);
      expect(tile.features.length).toBeLessThanOrEqual(16 * 6);
      for (const f of tile.features) for (const p of f.paths) for (const [x, y] of p.points) {
        expect(x).toBeGreaterThanOrEqual(tile.box.x);
        expect(x).toBeLessThanOrEqual(tile.box.x + tile.box.width);
        expect(y).toBeGreaterThanOrEqual(tile.box.y);
        expect(y).toBeLessThanOrEqual(tile.box.y + tile.box.height);
      }
      expect(tile.clipPolygons.length).toBeGreaterThan(0);
    }
    const smaller = buildTerrainEnvironment({ cells: [split[0]!, { ...split[1]!, known: false }] });
    expect(smaller.signature).not.toBe(scene.signature);
    expect(smaller.clipPolygons).toHaveLength(1);
  });

  it('leaves bodies and impassable objects to the existing identity layer', () => {
    for (const kind of ['planet', 'void_station', 'black_hole', 'rift'])
      expect(features({ cells: [cell('body', kind, -256, -256, 512)] })).toEqual([]);
    // A world in a nebula still has environmental art without replacing its body.
    const world = { ...cell('world', 'planet', -256, -256, 512), terrain: 'nebula' };
    expect(features({ cells: [world] }).every(f => f.family === 'nebula')).toBe(true);
    expect(features({ cells: [world] }).length).toBeGreaterThan(0);
  });

  it('does not mutate allowed inputs and reproduces the scene on a fresh entry', () => {
    const input: TerrainEnvironmentInput = { cells: split, seed: 'review-fixture',
      markers: [{ x: 20, y: 0, kind: 'capture' }, { x: 130, y: 90, kind: 'fork' }] };
    const snapshot = structuredClone(input);
    const scene = buildTerrainEnvironment(input);
    expect(input).toEqual(snapshot);
    expect(buildTerrainEnvironment(structuredClone(input))).toEqual(scene);
    expect(scene.tiles.flatMap(t => t.features).every(f => ['major', 'minor'].includes(f.detail))).toBe(true);
  });
});
