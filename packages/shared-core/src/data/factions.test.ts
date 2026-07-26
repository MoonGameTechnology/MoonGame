import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FactionDefSchema } from './schemas';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(dataDir, name), 'utf8')) as Record<string, unknown>;

describe('faction data (B1 / CR-1.1)', () => {
  const factions = readJson('factions.json');
  const unitIds = new Set(Object.keys(readJson('units.json')));
  const buildingIds = new Set(Object.keys(readJson('buildings.json')));
  const resourceIds = new Set(readJson('resources.json') as unknown as string[]);
  const ids = Object.keys(factions);

  it('ships the four playable factions plus the legacy pair', () => {
    // The four multiplayer houses (azure/crimson/amber/violet) + legacy vanguard/swarm.
    expect(ids.sort()).toEqual(['amber', 'azure', 'crimson', 'swarm', 'vanguard', 'violet']);
  });

  it('each faction validates and carries a loadout, unique units and passives', () => {
    for (const id of ids) {
      const f = FactionDefSchema.parse(factions[id]);
      expect(f.name).toBeTruthy();
      expect(Array.isArray(f.uniqueUnits)).toBe(true);
      expect(f.startingLoadout.fleet.length).toBeGreaterThan(0); // a starting fleet
      // At least one passive bonus (production / combat / speed).
      const p = f.passives;
      expect(
        typeof p.productionBonus === 'number' ||
        typeof p.combatDamageBonus === 'number' ||
        typeof p.fleetSpeedBonus === 'number',
      ).toBe(true);
    }
  });

  it('every referenced unit and building actually exists (no dangling ids)', () => {
    const missing: string[] = [];
    for (const id of ids) {
      const f = FactionDefSchema.parse(factions[id]);
      const units = [
        ...f.uniqueUnits,
        ...f.startingLoadout.fleet.map((s) => s.unit),
        ...f.startingLoadout.garrison.map((s) => s.unit),
      ];
      for (const u of units) if (!unitIds.has(u)) missing.push(`${id}: unit ${u}`);
      for (const b of f.startingLoadout.homeBuildings) {
        if (!buildingIds.has(b)) missing.push(`${id}: building ${b}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every starting resource is a defined resource (no phantom currencies)', () => {
    // Guards against a faction seeding an undefined resource (e.g. the old
    // `biomass`/`dark_matter`): the schema's ResourceBag accepts any string key,
    // so a typo passes validation but the faction can never spend/earn it.
    const bad: string[] = [];
    for (const id of ids) {
      const f = FactionDefSchema.parse(factions[id]);
      for (const key of Object.keys(f.startingLoadout.resources)) {
        if (!resourceIds.has(key)) bad.push(`${id}: resource ${key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('each faction can pay for its unique unit with resources it starts with or produces', () => {
    // Coherence: the currencies a faction's unique unit costs must be reachable —
    // present at start OR produced by a home building — else it can never build it.
    const units = readJson('units.json') as Record<string, { cost?: Record<string, number> }>;
    const buildings = readJson('buildings.json') as Record<string, { produces?: Record<string, number> }>;
    const stranded: string[] = [];
    for (const id of ids) {
      const f = FactionDefSchema.parse(factions[id]);
      const reachable = new Set(Object.keys(f.startingLoadout.resources));
      for (const b of f.startingLoadout.homeBuildings) {
        for (const r of Object.keys(buildings[b]?.produces ?? {})) reachable.add(r);
      }
      const cost = units[f.uniqueUnits[0] ?? '']?.cost ?? {};
      for (const r of Object.keys(cost)) {
        if (!reachable.has(r)) stranded.push(`${id}: unique unit needs ${r}`);
      }
    }
    expect(stranded).toEqual([]);
  });

  it('the factions are genuinely distinct — by passive, not by roster (FND-5, anchor 6)', () => {
    // game-vision-roadmap.md anchor 6: factions are symmetric (same units, same
    // gameplay) — distinctness is cosmetics + a small flat passive, never a
    // unique unit/building. All six ship an EMPTY uniqueUnits (see the schema
    // coverage test above); this checks the one axis that's actually allowed
    // to differ.
    const v = FactionDefSchema.parse(factions.vanguard);
    const s = FactionDefSchema.parse(factions.swarm);
    expect(v.passives.combatDamageBonus).toBeGreaterThan(0);
    expect(s.passives.productionBonus).toBeGreaterThan(0);
    expect(v.uniqueUnits).toEqual([]);
    expect(s.uniqueUnits).toEqual([]);
  });

  it('no faction has a unique unit (FND-5: symmetric roster, anchor 6)', () => {
    for (const id of ids) {
      expect(FactionDefSchema.parse(factions[id]).uniqueUnits, id).toEqual([]);
    }
  });
});
