import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../packages/shared-core/src/index';
import { createInitialState, type GameState } from '../packages/shared-core/src/state/gameState';
import { INTEL_MAX_AGE_MS, freshIntel, knownGarrison } from './garrisonIntel';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    militia: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 4, defense: 8, hp: 14, speed: 44 } },
    scout: { faction: 'x', domain: 'space', stats: { attack: 1, defense: 1, hp: 10, speed: 90, radarRange: 200 } },
  },
  factions: {},
  buildings: {},
  events: {},
});

const HOUR = 3_600_000;

function world(opts: { scoutAt?: string; remembered?: number } = {}): GameState {
  const s = createInitialState({ seed: 'intel', version: { data: '0.1.0', manifest: '1' } });
  const st: GameState = {
    ...s,
    time: 100 * HOUR,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      HOME: { id: 'HOME', owner: 'p1', position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] },
      FOE: { id: 'FOE', owner: 'p2', position: { x: 900, y: 0 }, resources: {}, buildings: [], garrison: [{ unit: 'militia', count: 4 }], traits: [] },
    },
    fleets: {},
    heroes: {},
    battles: {},
  };
  if (opts.scoutAt) {
    st.fleets.S = {
      id: 'S', owner: 'p1', location: opts.scoutAt, movement: null,
      units: [{ unit: 'scout', count: 1 }], traits: [], battleId: null,
    };
  }
  if (opts.remembered !== undefined) {
    st.fog = { p1: { FOE: { owner: 'p2', garrison: [{ unit: 'militia', count: 1 }], buildings: [], at: opts.remembered } } };
  }
  return st;
}

describe('что бот ЗНАЕТ о гарнизоне', () => {
  it('НЕ ВИДЕЛ И НЕ ПОМНИТ — знания нет, и это НЕ «гарнизон пуст»', () => {
    expect(knownGarrison(world(), 'p1', 'FOE', data)).toBeNull();
  });

  it('ВИДИТ СЕЙЧАС — знание живое и точное', () => {
    const intel = knownGarrison(world({ scoutAt: 'FOE' }), 'p1', 'FOE', data);
    expect(intel?.live).toBe(true);
    expect(intel?.units).toEqual([{ unit: 'militia', count: 4 }]);
  });

  it('ПОМНИТ — знание есть, но это СНИМОК: числа из памяти, а не с планеты', () => {
    const intel = knownGarrison(world({ remembered: 99 * HOUR }), 'p1', 'FOE', data);
    expect(intel?.live).toBe(false);
    expect(intel?.units).toEqual([{ unit: 'militia', count: 1 }]); // запомнил одного, стоит четверо
    expect(intel?.at).toBe(99 * HOUR);
  });

  it('ПРОТУХШЕЕ ЗНАНИЕ НЕ СЧИТАЕТСЯ ЗНАНИЕМ', () => {
    const now = 100 * HOUR;
    const fresh = knownGarrison(world({ remembered: now - INTEL_MAX_AGE_MS + HOUR }), 'p1', 'FOE', data);
    const stale = knownGarrison(world({ remembered: now - INTEL_MAX_AGE_MS - HOUR }), 'p1', 'FOE', data);
    expect(freshIntel(fresh, now)).toBe(true);
    expect(freshIntel(stale, now)).toBe(false);
    expect(freshIntel(null, now)).toBe(false);
  });

  it('ЖИВОЕ НАБЛЮДЕНИЕ не протухает никогда', () => {
    const intel = knownGarrison(world({ scoutAt: 'FOE', remembered: 0 }), 'p1', 'FOE', data);
    expect(freshIntel(intel, 100 * HOUR)).toBe(true);
  });
});
