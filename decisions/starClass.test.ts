import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STAR_CLASSES, starClassOf } from './starClass';

const terrains = JSON.parse(
  readFileSync(new URL('../data/sectors.json', import.meta.url), 'utf8'),
) as Record<string, { family?: string }>;

describe('starClassOf — the star a star province holds', () => {
  it('reads the class from the terrain, and every star terrain of the data is a class it knows', () => {
    const family = Object.keys(terrains).filter((t) => terrains[t]!.family === 'star');
    expect(family.sort()).toEqual([...STAR_CLASSES].sort());
    for (const cls of STAR_CLASSES) expect(starClassOf(cls)).toBe(cls);
  });

  it('draws a yellow dwarf for a terrain no class names, instead of nothing', () => {
    expect(starClassOf(undefined)).toBe('yellow_dwarf');
    expect(starClassOf('solar_flare_zone')).toBe('yellow_dwarf');
  });
});
