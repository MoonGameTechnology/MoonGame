import { describe, expect, it } from 'vitest';
import { parseGameData } from '../packages/shared-core/src/index';
import { squadronHullPercent } from './squadronHull';

const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 0, defense: 0, speed: 1, hp: 20 },
    },
  },
});

describe('squadron hull', () => {
  it('shows nothing for an undamaged squadron', () => {
    expect(squadronHullPercent({ units: [{ unit: 'bomber', count: 2 }] }, data)).toBeNull();
    expect(
      squadronHullPercent({ units: [{ unit: 'bomber', count: 2 }], damage: 0 }, data),
    ).toBeNull();
  });

  it('reads the pooled damage against ONE machine hull, as the core downs them', () => {
    // Pool 10 of hull 20: the damaged board is at half, whatever the squadron size.
    expect(squadronHullPercent({ units: [{ unit: 'bomber', count: 3 }], damage: 10 }, data)).toBe(
      50,
    );
    expect(squadronHullPercent({ units: [{ unit: 'bomber', count: 1 }], damage: 15 }, data)).toBe(
      25,
    );
  });

  it('never rounds a damaged board to 100% or a flying one to 0%', () => {
    expect(squadronHullPercent({ units: [{ unit: 'bomber', count: 1 }], damage: 0.01 }, data)).toBe(
      99,
    );
    expect(
      squadronHullPercent({ units: [{ unit: 'bomber', count: 1 }], damage: 19.99 }, data),
    ).toBe(1);
  });

  it('shows nothing for a squadron with no machines left', () => {
    expect(
      squadronHullPercent({ units: [{ unit: 'bomber', count: 0 }], damage: 5 }, data),
    ).toBeNull();
  });
});
