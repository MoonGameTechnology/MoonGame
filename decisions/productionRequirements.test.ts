import { describe, expect, it } from 'vitest';
import { productionRequirements, facilityLevel } from './productionRequirements';
import { shippedGameData } from '../data/bundle';
import { createInitialState } from '../packages/shared-core/src/index';
const data = shippedGameData();
function newGame() {
  const s = createInitialState({
    seed: 'requirements',
    version: { data: data.version, manifest: 'test' },
  });
  s.players.p1 = {
    id: 'p1',
    name: 'Test',
    status: 'active',
    faction: 'terran',
    resources: {},
    technologies: { completed: [], queue: [], active: [] },
  };
  s.planets.home = {
    id: 'home',
    kind: 'planet',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  return s;
}

describe('production requirement resolution', () => {
  it('shows research and the missing facility together without modifying match state', () => {
    const s = newGame();
    const p = Object.values(s.planets).find((p) => p.owner === 'p1')!;
    p.buildings = [];
    s.techRules = { ruleset: 'main', dayGates: true, exclude: [] };
    s.players.p1!.technologies = { completed: [], queue: [], active: [] };
    const before = JSON.stringify(s);
    const result = productionRequirements(s, 'p1', p.id, data, 'unit', 'tank');
    expect(result.technology).not.toBeNull();
    expect(result.facilityCode).toBe('E_NO_FACTORY');
    expect(result.facilities).toContainEqual({ building: 'factory', level: 1 });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('offers the required yard level, never another level-one yard for a heavy hull', () => {
    const s = newGame();
    const p = Object.values(s.planets).find((p) => p.owner === 'p1')!;
    p.buildings = [{ type: 'shipyard', level: 1, hp: 100 }];
    const result = productionRequirements(s, 'p1', p.id, data, 'unit', 'heavy_cruiser');
    expect(result.facilityCode).toBe('E_YARD_TOO_SMALL');
    expect(result.facilities).toContainEqual({ building: 'shipyard', level: 3 });
    p.buildings[0]!.level = 3;
    expect(
      productionRequirements(s, 'p1', p.id, data, 'unit', 'heavy_cruiser').facilityCode,
    ).toBeNull();
  });
  it('uses data to distinguish factory, barracks and spaceport unlocks', () => {
    const p = Object.values(newGame().planets)[0]!;
    expect(facilityLevel(data, p, 'factory', 'tank')).toBe(1);
    expect(facilityLevel(data, p, 'barracks', 'tank')).toBeNull();
    expect(facilityLevel(data, p, 'spaceport', 'interceptor')).toBe(1);
  });
});
