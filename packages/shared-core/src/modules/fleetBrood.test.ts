import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';
import { fleetBroodModule } from './fleetBrood';

const HOUR = 3_600_000;
const data = parseGameData({
  version: '1',
  resources: ['biomass', 'metal', 'microelectronics'],
  units: {
    mother: {
      faction: 'swarm',
      traits: ['brood_host'],
      slots: { utility: 1 },
      stats: { hp: 60, attack: 1, defense: 1, speed: 1, cargoCapacity: 4 },
    },
    lander: {
      faction: 'swarm',
      domain: 'ground',
      kind: 'infantry',
      stats: { hp: 16, attack: 8, defense: 5, speed: 1, cargoSize: 1 },
      cost: { biomass: 20, metal: 8, microelectronics: 2 },
    },
  },
  modules: {
    brood: {
      name: 'Brood',
      slot: 'utility',
      tag: 'horizontal',
      allowed: { domain: 'space', traits: ['brood_host'] },
      brood: { unit: 'lander', intervalHours: 3 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});
const kernel = createKernel([fleetBroodModule]);
function world(): GameState {
  const s = createInitialState({ seed: 'brood', version: { data: '1', manifest: '1' } });
  s.players.p = {
    id: 'p',
    name: 'Swarm',
    faction: 'swarm',
    status: 'active',
    resources: { biomass: 200, metal: 200, microelectronics: 60 },
  };
  s.fleets.f = {
    id: 'f',
    owner: 'p',
    location: 'A',
    movement: null,
    traits: [],
    units: [{ unit: 'mother', count: 2, modules: ['brood'] }],
  };
  return s;
}
function advance(s: GameState, now: number): GameState {
  const r = kernel.advanceTo(s, { now, data });
  if (!r.ok) throw new Error(r.code);
  expect(r.failures).toEqual([]);
  return r.state;
}
const prime = (s = world()) => advance(deepFreeze(s), 1);
const first = 3 * HOUR + 1;

describe('onboard brood growth', () => {
  it('waits a whole cycle and pays all three real resources per organism', () => {
    const input = world();
    const started = prime(input);
    expect(started.fleets.f!.landing).toBeUndefined();
    expect(advance(started, first - 1).fleets.f!.landing).toBeUndefined();
    const grown = advance(started, first);
    expect(grown.fleets.f!.landing).toEqual([{ unit: 'lander', count: 2 }]);
    expect(grown.players.p!.resources).toEqual({ biomass: 160, metal: 184, microelectronics: 56 });
    expect(input.players.p!.resources.biomass).toBe(200);
    expect(input.fleets.f!.landing).toBeUndefined();
  });
  it.each(['biomass', 'metal', 'microelectronics'])(
    'cannot grow without %s or charge a partial recipe',
    (resource) => {
      const s = world();
      s.players.p!.resources[resource] = 0;
      const grown = advance(prime(s), first);
      expect(grown.fleets.f!.landing).toBeUndefined();
      expect(grown.players.p!.resources).toEqual(s.players.p!.resources);
    },
  );
  it('respects live cargo and space promised to an incoming army load', () => {
    const s = world();
    s.fleets.f!.landing = [{ unit: 'lander', count: 6 }];
    s.fleets.f!.loading = [
      { from: 'A', unit: 'lander', count: 1, startAt: 1, doneAt: first + HOUR },
    ];
    const grown = advance(prime(s), first);
    expect(grown.fleets.f!.landing![0]!.count).toBe(7);
    expect(grown.players.p!.resources.biomass).toBe(180);
    const full = advance(grown, first + 3 * HOUR);
    expect(full.fleets.f!.landing![0]!.count).toBe(7);
    expect(full.players.p!.resources).toEqual(grown.players.p!.resources);
  });
  it('never adds troops to a running ground battle, and resumes after it', () => {
    const s = prime();
    s.fleets.f!.battleId = 'ground';
    const fighting = advance(s, first);
    expect(fighting.fleets.f!.landing).toBeUndefined();
    expect(fighting.players.p!.resources).toEqual(s.players.p!.resources);
    fighting.fleets.f!.battleId = null;
    expect(advance(fighting, first + 3 * HOUR).fleets.f!.landing![0]!.count).toBe(2);
  });
  it('does not manufacture for a foreign owner or an unfitted carrier', () => {
    const foreign = world();
    foreign.players.p!.faction = 'human';
    expect(prime(foreign).scheduled).toEqual([]);
    const bare = world();
    delete bare.fleets.f!.units[0]!.modules;
    expect(prime(bare).scheduled).toEqual([]);
  });
  it('losing the carrier cancels production; merging in new hulls grants no instant brood', () => {
    const lost = prime();
    delete lost.fleets.f;
    expect(advance(lost, first).scheduled).toEqual([]);
    const merged = prime();
    merged.fleets.f!.units[0]!.count = 10;
    expect(advance(merged, first).fleets.f!.landing![0]!.count).toBe(2);
  });
  it('replays armed cycles identically through an offline catch-up and a saved state', () => {
    const initial = prime();
    const jumped = advance(JSON.parse(JSON.stringify(initial)) as GameState, first + 6 * HOUR);
    let stepped = initial;
    for (const now of [first, first + 3 * HOUR, first + 6 * HOUR]) stepped = advance(stepped, now);
    expect(jumped).toEqual(stepped);
  });
});

// Exercise the public build path: organism templates are not human loot.
import { constructionModule } from './construction';
import { factionModule } from './faction';
it('rejects a human attempt to build a faction-exclusive organism', () => {
  const catalog = parseGameData({
    ...data,
    factions: { swarm: { name: 'Swarm', uniqueUnits: ['mother', 'lander'] } },
    buildings: { nest: { name: 'Nest', enablesShipConstruction: true, hp: 20 } },
  });
  const state = world();
  state.players.p!.faction = 'human';
  state.planets.A = {
    id: 'A',
    owner: 'p',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [{ type: 'nest', level: 1, hp: 20 }],
    garrison: [],
    traits: [],
  };
  const builder = createKernel([constructionModule, factionModule]);
  const result = builder.applyAction(
    deepFreeze(state),
    {
      id: 'build-mother',
      type: 'unit.build',
      playerId: 'p',
      issuedAt: 0,
      payload: { planetId: 'A', unit: 'mother', count: 1 },
    },
    { now: 0, data: catalog },
  );
  expect(result).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
});
