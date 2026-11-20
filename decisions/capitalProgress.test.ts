import { describe, expect, it } from 'vitest';
import { createInitialState, parseGameData } from '../packages/shared-core/src/index';
import { capitalProgress, provinceShare } from './capitalProgress';

function state() {
  const s = createInitialState({ seed: 'progress', version: { data: 'test', manifest: 'test' } });
  s.modeId = 'capital_2v2';
  for (let i = 1; i <= 4; i++) {
    const id = `p${i}`;
    s.players[id] = {
      id,
      name: id,
      faction: '',
      resources: {},
      status: 'active',
      team: i <= 2 ? 'A' : 'B',
    };
  }
  return s;
}
describe('capital progress', () => {
  it('shows both targets before the first scoreboard update', () => {
    expect(capitalProgress(state(), 'p1')).toEqual({ captured: 0, total: 2 });
  });
  it('counts captures by both teammates from public goals without reading the fogged map', () => {
    const s = state();
    s.match.capitalObjectives = {
      p1: { planetId: 'a', owner: 'p1' },
      p2: { planetId: 'b', owner: 'p2' },
      p3: { planetId: 'c', owner: 'p1' },
      p4: { planetId: 'd', owner: 'p2' },
    };
    expect(capitalProgress(s, 'p1')).toEqual({ captured: 2, total: 2 });
    expect(capitalProgress(s, 'p2')).toEqual({ captured: 2, total: 2 });
    expect(capitalProgress(s, 'p3')).toEqual({ captured: 0, total: 2 });
    s.match.capitalObjectives.p3!.owner = 'p4';
    expect(capitalProgress(s, 'p1')).toEqual({ captured: 1, total: 2 });
  });
});

describe('province share', () => {
  const data = parseGameData({
    version: 'test', resources: ['metal'], units: {}, factions: {}, buildings: {}, events: {},
    sectorKinds: { planet: {}, star: { capturable: false } },
  });
  it('counts the side capturable provinces like the core: no star, no fortress site', () => {
    const s = state();
    const add = (id: string, owner: string | null, extra: Record<string, unknown> = {}) => {
      s.planets[id] = { id, owner, kind: 'planet', position: { x: 0, y: 0 }, buildings: [], garrison: [], resources: {}, traits: [], ...extra };
    };
    add('a', 'p1');
    add('b', 'p2'); // teammate
    add('c', 'p3');
    add('d', null);
    add('sun', null, { kind: 'star' });
    add('fort', 'p1', { kind: 'station_site', stationHost: 'a' });
    expect(provinceShare(s, 'p1', data)).toBe(0.5);
    expect(provinceShare(s, 'p3', data)).toBe(0.25);
  });
});
