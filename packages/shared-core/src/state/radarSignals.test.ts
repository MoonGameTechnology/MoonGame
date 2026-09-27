import { describe, expect, it } from 'vitest';
import { parseGameData, safeParseGameData } from '../data/schemas';
import { createInitialState, type Fleet, type GameState } from './gameState';
import { radarSignatures, visibleState } from './visibility';

const data = parseGameData({
  version: 'radar-test',
  resources: ['metal'],
  factions: {},
  technologies: {},
  events: {},
  units: {
    scout: { faction: 'x', signature: 1, stats: { attack: 1, defense: 1, speed: 1, hp: 10 } },
    frigate: { faction: 'x', signature: 5, stats: { attack: 1, defense: 1, speed: 1, hp: 10 } },
    heavy: { faction: 'x', signature: 13, stats: { attack: 1, defense: 1, speed: 1, hp: 10 } },
    sensor: {
      faction: 'x',
      signature: 1,
      radarRange: 100,
      radarLevel: 2,
      stats: { attack: 1, defense: 1, speed: 1, hp: 10 },
      slots: { utility: 1 },
    },
  },
  buildings: {
    radar: {
      name: 'Radar',
      radarRange: 300,
      radarLevel: 1,
      upgrades: [
        { radarRange: 300, radarLevel: 2 },
        { radarRange: 300, radarLevel: 3 },
      ],
    },
    short: { name: 'Short', radarRange: 180, radarLevel: 3 },
  },
  modules: {
    dish: {
      name: 'Dish',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { radarRange: 200 } },
    },
  },
});

function fleet(id: string, location: string, count = 1, unit = 'scout'): Fleet {
  return { id, owner: 'foe', location, movement: null, units: [{ unit, count }], traits: [] };
}

function scenario(level = 1): GameState {
  const s = createInitialState({ seed: 'signals', version: { data: data.version, manifest: '1' } });
  for (const id of ['me', 'foe', 'ally'])
    s.players[id] = { id, name: id, faction: 'x', status: 'active', resources: {} };
  for (const [id, x] of [
    ['home', 0],
    ['near', 230],
    ['close', 250],
    ['far', 290],
    ['outside', 340],
  ] as const)
    s.planets[id] = {
      id,
      owner: id === 'home' ? 'me' : null,
      position: { x, y: 0 },
      links: [],
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
    };
  s.planets.home!.buildings = [{ type: 'radar', level, hp: 10 }];
  return s;
}

describe('radar signal detection', () => {
  it('rejects invalid radar tiers and preserves legacy catalogs without a tier', () => {
    for (const radarLevel of [0, 4, 1.5]) {
      expect(
        safeParseGameData({ ...data, units: { scout: { ...data.units.scout, radarLevel } } })
          .success,
      ).toBe(false);
      expect(
        safeParseGameData({
          ...data,
          buildings: { radar: { ...data.buildings.radar, radarLevel } },
        }).success,
      ).toBe(false);
    }
    const { radarLevel: _level, ...radar } = data.buildings.radar!;
    expect(parseGameData({ ...data, buildings: { radar } }).buildings.radar!.radarLevel).toBe(3);
  });

  it.each([
    [1, 'scout', false],
    [1, 'frigate', false],
    [1, 'heavy', true],
    [2, 'scout', false],
    [2, 'frigate', true],
    [2, 'heavy', true],
    [3, 'scout', true],
    [3, 'frigate', true],
    [3, 'heavy', true],
  ] as const)('radar level %i detects %s: %s at the same distance', (level, unit, detected) => {
    const s = scenario(level);
    s.fleets.target = fleet('target', 'near', 1, unit);
    const v = visibleState(s, 'me', data);
    expect(v.signatures.length > 0).toBe(detected);
    expect(v.fleets.target).toBeUndefined();
  });

  it('combines nearby separate fleets and loses them when they disperse', () => {
    const s = scenario(2);
    s.fleets.a = fleet('a', 'near', 3);
    s.fleets.b = fleet('b', 'close', 2);
    expect(visibleState(s, 'me', data).signatures).toEqual([{ location: 'near', size: 'M' }]);
    s.fleets.b!.location = 'far'; // 60 map units apart, beyond the grouping radius
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
    expect(data.units.scout!.signature).toBe(1);
  });

  it('crosses the high threshold at 13 scouts, independent of fleet splitting', () => {
    const s = scenario();
    s.fleets.a = fleet('a', 'near', 12);
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
    s.fleets.b = fleet('b', 'near');
    expect(visibleState(s, 'me', data).signatures).toEqual([{ location: 'near', size: 'L' }]);
    s.fleets.a!.units[0]!.count = 13;
    delete s.fleets.b;
    expect(visibleState(s, 'me', data).signatures).toEqual([{ location: 'near', size: 'L' }]);
  });

  it('does not chain distant fleets into one signal', () => {
    const s = scenario();
    s.planets.far!.position.x = 270;
    s.fleets.a = fleet('a', 'near', 4);
    s.fleets.b = fleet('b', 'close', 4);
    s.fleets.c = fleet('c', 'far', 4);
    s.planets.outside!.position.x = 290;
    s.fleets.d = fleet('d', 'outside', 4);
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
  });

  it('keeps sensitivity paired with its own reach and does not sum radar strengths', () => {
    const s = scenario();
    s.planets.home!.buildings.push({ type: 'short', level: 1, hp: 10 });
    s.fleets.a = fleet('a', 'near', 5);
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
  });

  it('only sums the part of a cluster actually within a sensor range', () => {
    const s = scenario(2);
    s.planets.outside!.position.x = 310;
    s.fleets.a = fleet('a', 'far', 3);
    s.fleets.b = fleet('b', 'outside', 2);
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
    s.planets.outside!.position.x = 300; // boundary is included
    expect(visibleState(s, 'me', data).signatures).toEqual([{ location: 'far', size: 'M' }]);
  });

  it('uses actual travelling positions for grouping and radar range', () => {
    const s = scenario(2);
    s.planets.near!.links = ['outside'];
    s.planets.outside!.links = ['near'];
    s.fleets.a = fleet('a', 'near', 3);
    s.fleets.b = {
      ...fleet('b', 'near', 2),
      location: null,
      movement: { from: 'near', to: 'outside', departedAt: 0, arrivesAt: 110 },
    };
    s.time = 10;
    expect(visibleState(s, 'me', data).signatures).toHaveLength(1);
    s.time = 100;
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
  });

  it('retains close identification, private fleet intel and own fleets', () => {
    const s = scenario();
    s.planets.near!.position.x = 100;
    s.fleets.a = fleet('a', 'near');
    s.fleets.mine = { ...fleet('mine', 'close', 100), owner: 'me' };
    s.fleets.hidden = fleet('hidden', 'close');
    s.intel = { me: [{ kind: 'fleets', target: 'foe', until: 10 }] };
    const v = visibleState(s, 'me', data);
    expect(Object.keys(v.fleets).sort()).toEqual(['a', 'hidden', 'mine']);
    expect(v.signatures).toEqual([]);
  });

  it('shares an ally sensor without pooling another sensor quality', () => {
    const s = scenario();
    s.planets.home!.owner = 'ally';
    s.planets.home!.buildings[0]!.level = 3;
    s.diplomacy = { 'ally|me': 'alliance' };
    s.fleets.a = fleet('a', 'near');
    expect(visibleState(s, 'me', data).signatures).toHaveLength(1);
    s.diplomacy = {};
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
  });

  it('uses a radar ship level with its installed module reach', () => {
    const s = scenario();
    s.planets.home!.buildings = [];
    s.fleets.sensor = { ...fleet('sensor', 'home', 1, 'sensor'), owner: 'me' };
    s.fleets.target = fleet('target', 'near', 5);
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
    s.fleets.sensor!.units[0]!.modules = ['dish'];
    expect(visibleState(s, 'me', data).signatures).toHaveLength(1);
    s.fleets.target!.units[0]!.count = 1;
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
  });

  it('is deterministic, pure and sends only the coarse contact', () => {
    const s = scenario(2);
    s.fleets.secret_a = fleet('secret_a', 'near', 3);
    s.fleets.secret_b = fleet('secret_b', 'close', 2);
    const before = JSON.stringify(s);
    const a = visibleState(s, 'me', data);
    expect(JSON.stringify(s)).toBe(before);
    s.fleets = Object.fromEntries(Object.entries(s.fleets).reverse());
    expect(visibleState(s, 'me', data).signatures).toEqual(a.signatures);
    expect(JSON.stringify(a)).not.toContain('secret_');
    expect(Object.keys(a.signatures[0]!).sort()).toEqual(['location', 'size']);
    expect(radarSignatures(s, 'me', data)).toEqual(a.signatures); // solo and wire use one projection
  });

  it('does not emit contacts for empty fleets or zero-emission hulls', () => {
    const s = scenario(3);
    s.fleets.a = fleet('a', 'near', 0);
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
    s.fleets.a!.units[0]!.count = 1;
    const quiet = parseGameData({
      ...data,
      units: { ...data.units, scout: { ...data.units.scout, signature: 0 } },
    });
    expect(visibleState(s, 'me', quiet).signatures).toEqual([]);
  });

  it('applies sensitivity to decoys and removes expired phantoms', () => {
    const s = scenario(2);
    s.heroes = {
      decoy: {
        id: 'decoy',
        owner: 'foe',
        location: 'outside',
        cooldowns: {},
        alive: true,
        activeDecoys: [{ at: 'near', signature: 1, until: 10 }],
      },
    };
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
    s.heroes.decoy!.activeDecoys![0]!.signature = 5;
    expect(visibleState(s, 'me', data).signatures).toEqual([{ location: 'near', size: 'M' }]);
    s.time = 10;
    expect(visibleState(s, 'me', data).signatures).toEqual([]);
  });

  it('does not reveal an exact moving fleet identity with the contact position', () => {
    const s = scenario(3);
    s.fleets.secret = {
      ...fleet('secret', 'near'),
      location: null,
      movement: { from: 'near', to: 'outside', departedAt: 0, arrivesAt: 110 },
    };
    s.time = 10;
    const v = visibleState(s, 'me', data);
    expect(v.signatures).toEqual([{ location: 'near', size: 'S', position: { x: 240, y: 0 } }]);
    expect(JSON.stringify(v)).not.toContain('secret');
  });
});
