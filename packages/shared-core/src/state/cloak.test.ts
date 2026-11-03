import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { cloakFieldModule } from '../modules/cloakField';
import { moduleStarMultiplier } from '../util/loadout';
import { CLOAK_BREAK_MS, fleetCloak, fleetCloakRating } from './cloak';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from './gameState';
import { isVisibleTo, radarSignatures, visibleState } from './visibility';

// Маскировочное поле (SM-4.3): чужие глаза и радар замечают флот героя только с
// меньшего расстояния. Числа: радар мира 300 → опознание 150, отметка 300; поле 0,2
// сжимает их до 120 и 240.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 10, defense: 8, speed: 6, hp: 40 }, signature: 4 },
    hero: { faction: 'x', traits: ['hero'], stats: { attack: 4, defense: 4, speed: 6, hp: 60 }, slots: { utility: 1 }, signature: 4 },
  },
  factions: {},
  buildings: { radar: { name: 'Radar', radarRange: 300 } },
  events: {},
  modules: {
    cloak_field: {
      name: 'Cloak Field',
      rarity: 'legendary',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { cloak: 0.2 } },
      allowed: { units: ['hero'] },
    },
  },
});

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function planet(id: string, owner: string | null, x: number, links: string[], extra: Partial<Planet> = {}): Planet {
  return { id, owner, position: { x, y: 0 }, links, resources: {}, buildings: [], garrison: [], traits: [], ...extra };
}
function heroFleet(id: string, location: string, cloak: boolean, stars = 0): Fleet {
  const hero = cloak
    ? { unit: 'hero', count: 1, modules: ['cloak_field'], ...(stars ? { moduleStars: { cloak_field: stars } } : {}) }
    : { unit: 'hero', count: 1 };
  return { id, owner: 'p2', location, movement: null, units: [hero, { unit: 'cruiser', count: 2 }], traits: [] };
}

/** p1 держит A (x=0) с радаром 300. B (x=130) — в опознании без поля, но дальше 120.
 *  C (x=270) — в отметке без поля, но дальше 240. */
function scenario(cloak: boolean): GameState {
  const base = createInitialState({ seed: 'cloak', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: planet('A', 'p1', 0, ['B'], { buildings: [{ type: 'radar', level: 1, hp: 10 }] }),
      B: planet('B', null, 130, ['A', 'C']),
      C: planet('C', null, 270, ['B']),
    },
    fleets: { near: heroFleet('near', 'B', cloak), far: heroFleet('far', 'C', cloak) },
  };
}

describe('сила поля', () => {
  it('0,2 без звёзд, звезда множит, у флота без поля 0', () => {
    expect(fleetCloakRating(heroFleet('f', 'B', true), data)).toBeCloseTo(0.2, 9);
    expect(fleetCloakRating(heroFleet('f', 'B', true, 6), data)).toBeCloseTo(0.2 * moduleStarMultiplier(6, data), 9);
    expect(fleetCloakRating(heroFleet('f', 'B', false), data)).toBe(0);
  });

  it('срывается боем, обстрелом и часом после отметки', () => {
    const s = scenario(true);
    const f = s.fleets.near!;
    expect(fleetCloak(s, f, data)).toBeCloseTo(0.2, 9);
    expect(fleetCloak(s, { ...f, battleId: 'b1' }, data)).toBe(0);
    expect(fleetCloak(s, { ...f, bombarding: true }, data)).toBe(0);
    expect(fleetCloak(s, { ...f, cloakBrokenUntil: s.time + 1 }, data)).toBe(0);
    expect(fleetCloak(s, { ...f, cloakBrokenUntil: s.time }, data)).toBeCloseTo(0.2, 9);
  });
});

describe('туман для флота под полем', () => {
  it('без поля: флот у опознанного мира опознан, дальний — отметкой', () => {
    const s = scenario(false);
    const view = visibleState(s, 'p1', data);
    expect(view.fleets.near).toBeDefined();
    expect(view.fleets.far).toBeUndefined();
    expect(view.signatures.map((c) => c.location)).toEqual(['C']);
  });

  it('с полем: ближний только отметкой, дальний не виден вовсе', () => {
    const s = scenario(true);
    const view = visibleState(s, 'p1', data);
    expect(view.fleets.near).toBeUndefined();
    expect(view.fleets.far).toBeUndefined();
    expect(view.signatures.map((c) => c.location)).toEqual(['B']);
    expect(radarSignatures(s, 'p1', data).map((c) => c.location)).toEqual(['B']);
    expect(isVisibleTo(s, 'p1', { fleetId: 'near' }, data)).toBe(false);
    expect(isVisibleTo(s, 'p1', { fleetId: 'far' }, data)).toBe(false);
  });

  it('вплотную поле не спасает: в 120 от мира флот опознан', () => {
    const s = scenario(true);
    s.planets.B!.position = { x: 110, y: 0 };
    expect(visibleState(s, 'p1', data).fleets.near).toBeDefined();
    expect(isVisibleTo(s, 'p1', { fleetId: 'near' }, data)).toBe(true);
  });

  it('сорванное поле — флот виден как обычно', () => {
    const s = scenario(true);
    s.fleets.near!.cloakBrokenUntil = s.time + CLOAK_BREAK_MS;
    expect(visibleState(s, 'p1', data).fleets.near).toBeDefined();
    expect(isVisibleTo(s, 'p1', { fleetId: 'near' }, data)).toBe(true);
  });

  it('шпион на мире и скан героя поле видят', () => {
    const spied = scenario(true);
    spied.intel = { p1: [{ kind: 'planet', target: 'B', until: spied.time + 1000 }] };
    expect(visibleState(spied, 'p1', data).fleets.near).toBeDefined();
    expect(isVisibleTo(spied, 'p1', { fleetId: 'near' }, data)).toBe(true);

    const scanned = scenario(true);
    scanned.heroes = {
      h1: { id: 'h1', owner: 'p1', location: 'A', cooldowns: {}, alive: true,
        activeReveals: [{ center: 'B', radius: 40, until: scanned.time + 1000 }] },
    } as GameState['heroes'];
    expect(visibleState(scanned, 'p1', data).fleets.near).toBeDefined();
    expect(isVisibleTo(scanned, 'p1', { fleetId: 'near' }, data)).toBe(true);
  });
});

describe('модуль срыва', () => {
  const emitter: GameModule = {
    id: 'test-emitter',
    version: '1.0.0',
    setup(api) {
      api.onAction('test.emit', (action, h) => {
        const p = action.payload as { type: string; payload: Record<string, unknown> };
        h.emit(p.type, p.payload);
      });
    },
  };
  const kernel = createKernel([emitter, cloakFieldModule]);
  const fire = (s: GameState, type: string, payload: Record<string, unknown>, now = 1000): GameState => {
    const r = kernel.applyAction(s, { id: 't:p2:1', type: 'test.emit', playerId: 'p2', issuedAt: now, payload: { type, payload } }, { now, data });
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };

  it('залп обстрела, вылет с борта и бой срывают поле на час — только флоту с полем', () => {
    const s = scenario(true);
    s.fleets.plain = { ...heroFleet('plain', 'C', false), battleId: 'b1' };
    s.fleets.near!.battleId = 'b1';
    expect(fire(s, 'planet.bombarded', { fleetId: 'far' }).fleets.far!.cloakBrokenUntil).toBe(1000 + CLOAK_BREAK_MS);
    expect(fire(s, 'shuttle.launched', { from: 'far', fromKind: 'fleet' }).fleets.far!.cloakBrokenUntil).toBe(1000 + CLOAK_BREAK_MS);
    expect(fire(s, 'shuttle.launched', { from: 'far', fromKind: 'planet' }).fleets.far!.cloakBrokenUntil).toBeUndefined();
    const fought = fire(s, 'combat.round', { battleId: 'b1' });
    expect(fought.fleets.near!.cloakBrokenUntil).toBe(1000 + CLOAK_BREAK_MS);
    expect(fought.fleets.plain!.cloakBrokenUntil).toBeUndefined();
    expect(fought.fleets.far!.cloakBrokenUntil).toBeUndefined();
  });
});
