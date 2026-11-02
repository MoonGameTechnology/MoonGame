import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadGameData } from '../data/loadGameData';
import { buildingDevelopment, developmentOfLevel, planetDevelopment } from './development';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'));
const data = loadGameData(readJson);
const def = (id: string) => data.buildings[id]!;

describe('planet development', () => {
  it('a level is worth Σcost / 20 + build hours, rounded', () => {
    // Shipyard L1: (250 metal + 120 credits) / 20 + 12 h = 30.5 → 31.
    expect(developmentOfLevel(def('shipyard'), 1)).toBe(31);
    // L2 — its own upgrade step: (150 + 80) / 20 + 12 h = 23.5 → 24.
    expect(developmentOfLevel(def('shipyard'), 2)).toBe(24);
  });

  it('an upgraded building carries every level it went through', () => {
    const yard = def('shipyard');
    expect(buildingDevelopment(yard, 1)).toBe(31);
    expect(buildingDevelopment(yard, 2)).toBe(31 + 24);
    expect(buildingDevelopment(yard, 3)).toBe(31 + 24 + developmentOfLevel(yard, 3));
  });

  it('a pricier, longer build gives more than a cheap, quick one', () => {
    expect(buildingDevelopment(def('shipyard'), 1)).toBeGreaterThan(
      buildingDevelopment(def('barracks'), 1),
    );
  });

  it('sums the structures of a world; unknown ids and empty worlds count 0', () => {
    const buildings = [
      { type: 'shipyard', level: 2, hp: 1 },
      { type: 'barracks', level: 1, hp: 1 },
      { type: 'no_such_building', level: 3, hp: 1 },
    ];
    expect(planetDevelopment(data, { buildings })).toBe(
      31 + 24 + developmentOfLevel(def('barracks'), 1),
    );
    expect(planetDevelopment(data, { buildings: [] })).toBe(0);
  });

  it('every building in the data is worth at least one point per level', () => {
    for (const d of Object.values(data.buildings)) {
      for (let l = 1; l <= 1 + d.upgrades.length; l++)
        expect(developmentOfLevel(d, l)).toBeGreaterThan(0);
    }
  });
});
