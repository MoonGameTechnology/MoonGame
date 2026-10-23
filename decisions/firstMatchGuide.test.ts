import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import {
  GUIDE_TARGET,
  guideCourseSet,
  guideFleet,
  guideMineLevel,
  guideShipCount,
} from './firstMatchGuide';

const fresh = () => {
  const s = createInitialState({
    seed: 'guide',
    version: { data: 'test', manifest: 'test', dataHash: 'test' },
  });
  s.planets.home_1 = {
    id: 'home_1',
    owner: 'p1',
    position: { x: 0, y: 0 },
    buildings: [{ type: 'mine', level: 1, hp: 20 }],
    resources: {},
    garrison: [],
    traits: [],
  };
  s.planets[GUIDE_TARGET] = { ...s.planets.home_1, id: GUIDE_TARGET, owner: null, buildings: [] };
  s.fleets.starter = {
    id: 'starter',
    owner: 'p1',
    location: 'home_1',
    movement: null,
    units: [{ unit: 'scout', count: 1 }],
    landing: [],
    traits: [],
    battleId: null,
  };
  return s;
};

describe('first match progress', () => {
  it('starts with a scout, a level-one mine and an undefended capture target', () => {
    const s = fresh();
    expect(guideMineLevel(s, 'home_1')).toBe(1);
    expect(guideShipCount(s, 'p1')).toBe(0);
    expect(guideFleet(s, 'p1')).toBeUndefined();
    expect(s.planets[GUIDE_TARGET]?.owner).toBeNull();
    expect(s.planets[GUIDE_TARGET]?.garrison).toEqual([]);
  });
  it('counts construction even when ships join an existing fleet, excluding enemies', () => {
    const s = fresh();
    const fleet = Object.values(s.fleets).find((f) => f.owner === 'p1')!;
    const before = Object.keys(s.fleets).length;
    fleet.units.push({ unit: 'frigate', count: 2 });
    expect(Object.keys(s.fleets)).toHaveLength(before);
    expect(guideShipCount(s, 'p1')).toBe(2);
    expect(guideShipCount(s, 'p2')).toBe(0);
    expect(guideFleet(s, 'p1')?.id).toBe(fleet.id);
  });
  it('requires the frigate route to the designated sector, including multi-hop travel', () => {
    const s = fresh();
    const fleet = Object.values(s.fleets).find((f) => f.owner === 'p1')!;
    fleet.location = GUIDE_TARGET;
    expect(guideCourseSet(s, 'p1')).toBe(false); // arriving scout does not qualify
    fleet.units.push({ unit: 'frigate', count: 1 });
    expect(guideCourseSet(s, 'p1')).toBe(true);
    fleet.location = null;
    fleet.movement = {
      from: 'home_1',
      to: 'world_2',
      departedAt: 0,
      arrivesAt: 100,
      destination: 'world_2',
    };
    expect(guideCourseSet(s, 'p1')).toBe(false);
    fleet.movement.destination = GUIDE_TARGET;
    expect(guideCourseSet(s, 'p1')).toBe(true);
    fleet.movement.to = GUIDE_TARGET;
    fleet.movement.destination = 'drift';
    expect(guideCourseSet(s, 'p1')).toBe(false); // passing the target is not setting it as destination
  });
});
