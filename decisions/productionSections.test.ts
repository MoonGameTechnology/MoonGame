import { describe, expect, it } from 'vitest';
import { BUILD_LANES } from '../packages/shared-core/src/index';
import { LANE_SECTIONS, PRODUCTION_LANES, laneOfSection, sectionForLane } from './productionSections';

describe('production lanes', () => {
  it('lists the core lanes in the core order', () => {
    expect(PRODUCTION_LANES).toEqual([...BUILD_LANES]);
  });

  it('gives every section exactly one lane', () => {
    const all = PRODUCTION_LANES.flatMap((lane) => LANE_SECTIONS[lane]);
    expect(new Set(all).size).toBe(all.length);
    for (const lane of PRODUCTION_LANES)
      for (const section of LANE_SECTIONS[lane]) expect(laneOfSection(section)).toBe(lane);
  });

  it('keeps the previous section only inside its own lane', () => {
    expect(sectionForLane('mobilization', 'heroes')).toBe('heroes');
    expect(sectionForLane('mobilization', 'ships')).toBe('infantry');
    expect(sectionForLane('ships')).toBe('ships');
    expect(sectionForLane('shuttles', 'support')).toBe('squads');
  });
});
