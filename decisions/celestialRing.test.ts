import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RING_BODY, RING_OF, isCelestialRing, ringBodyOf, ringKindOf, ringReach } from './celestialRing';

const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const kinds = read('sectorKinds.json') as Record<string, { traversable?: boolean; overflight?: boolean }>;
const terrains = read('sectors.json') as Record<string, { family?: string }>;

describe('celestial rings — the provinces round a body', () => {
  it('names only kinds the data closes to passage and to aviation', () => {
    for (const kind of Object.keys(RING_BODY)) {
      expect(kinds[kind], kind).toBeDefined();
      expect(kinds[kind]!.traversable, kind).toBe(false);
      expect(kinds[kind]!.overflight, kind).toBe(false);
    }
    expect(isCelestialRing('corona')).toBe(true);
    expect(isCelestialRing('star')).toBe(false);
    expect(isCelestialRing(undefined)).toBe(false);
  });

  it('gives the black hole and every star class its own ring, and each ring one body', () => {
    const classes = Object.keys(terrains).filter((t) => terrains[t]!.family === 'star');
    expect(Object.keys(RING_OF).sort()).toEqual(['black_hole', ...classes].sort());
    expect(Object.values(RING_OF).sort()).toEqual(Object.keys(RING_BODY).sort());
    for (const [body, ring] of Object.entries(RING_OF))
      expect([body, RING_BODY[ring]]).toEqual([body, body === 'black_hole' ? 'black_hole' : 'star']);
    expect(ringKindOf({ kind: 'star', terrain: 'red_giant' })).toBe('dust_shell');
    expect(ringKindOf({ kind: 'black_hole', terrain: 'deep_void' })).toBe('accretion_disk');
    expect(ringKindOf({ kind: 'nebula', terrain: 'nebula' })).toBeUndefined();
  });

  it('draws a ring province round the nearest body of its kind, or round itself', () => {
    const nodes = [
      { x: 0, y: 0, sector: 'star' },
      { x: 1000, y: 0, sector: 'star' },
      { x: 500, y: 0, sector: 'black_hole' },
    ];
    expect(ringBodyOf(nodes, { x: 900, y: 40 }, 'dust_shell')).toBe(nodes[1]);
    expect(ringBodyOf(nodes, { x: 900, y: 40 }, 'accretion_disk')).toBe(nodes[2]);
    expect(ringBodyOf([], { x: 0, y: 0 }, 'corona')).toBeUndefined();
  });

  it('measures how far a ring reaches by its provinces round the body, past a lone disk', () => {
    const hole = { x: 0, y: 0, sector: 'black_hole' };
    const star = { x: 2000, y: 0, sector: 'star' };
    const ring = [100, 110, 120].map((x) => ({ x, y: 0, sector: 'accretion_disk' }));
    const lone = { x: 900, y: 0, sector: 'accretion_disk' };
    const corona = [1900, 2080].map((x) => ({ x, y: 0, sector: 'corona' }));
    const nodes = [hole, star, ...ring, lone, ...corona];
    expect(ringReach(nodes, hole)).toBe(115);
    expect(ringReach(nodes, star)).toBe(90);
    expect(ringReach([hole], hole)).toBeUndefined();
  });
});
