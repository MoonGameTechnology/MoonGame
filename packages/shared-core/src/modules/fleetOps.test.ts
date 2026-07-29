import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { fleetOpsModule } from './fleetOps';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Hero,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, ApplyResult, Context } from '../action/types';

// fleetOps — the missing link between "built" (constructionModule fills a
// planet's garrison) and "playable" (a fleet that can move/fight): the core
// had no handler for fleet.launch/merge/split at all before this module.
// Port of the prototype's proven `fleetLaunchModule` (prototype/src/fleetLaunch.ts),
// adapted for canon: `domain: 'ground'` (not a trait, unlike the prototype's
// data), `ownFleet` (own-key lookup, A06/A08) for untrusted payload ids, no
// division-carrier re-pointing on merge (canon has no division concept).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 5, defense: 5, speed: 6, hp: 40, cargoCapacity: 2 },
    },
    scout: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 1, defense: 1, speed: 10, hp: 10 },
    },
    hero: {
      faction: 'x',
      domain: 'space',
      traits: ['hero'],
      stats: { attack: 2, defense: 2, speed: 6, hp: 60 },
    },
    militia: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 4, defense: 8, speed: 0, hp: 20, cargoSize: 1 },
    },
    orbital_aa: {
      faction: 'x',
      domain: 'ground',
      traits: ['immobile'],
      stats: { attack: 4, defense: 14, speed: 0, hp: 30, cargoSize: 2 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});
const ctx: Context = { now: 0, data };

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function planet(id: string, owner: string | null, garrison: Array<[string, number]> = []): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: garrison.map(([unit, count]) => ({ unit, count })),
    traits: [],
  };
}
function fleet(
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number]> = [],
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    traits: [],
  };
}
function hero(id: string, owner: string, fleetId: string): Hero {
  return {
    id,
    owner,
    name: id,
    location: 'A',
    cooldowns: {},
    grade: 'main',
    archetype: 'commander',
    abilities: [],
    passives: [],
    home: 'A',
    alive: true,
    fleetId,
  };
}
function stateWith(opts: {
  players?: Player[];
  planets?: Planet[];
  fleets?: Fleet[];
  heroes?: Hero[];
  battles?: GameState['battles'];
}): GameState {
  const s = createInitialState({ seed: 'fleetops', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  const heroes: Record<string, Hero> = {};
  for (const x of opts.heroes ?? []) heroes[x.id] = x;
  return { ...s, players, planets, fleets, heroes, battles: opts.battles ?? {} };
}
const launch = (planetId: string, playerId = 'p1'): Action => ({
  id: `a:${playerId}:1`,
  type: 'fleet.launch',
  playerId,
  payload: { planetId },
  issuedAt: 0,
});
const merge = (from: string, into: string, playerId = 'p1'): Action => ({
  id: `a:${playerId}:2`,
  type: 'fleet.merge',
  playerId,
  payload: { from, into },
  issuedAt: 0,
});
const split = (
  fleetId: string,
  take: Array<{ unit: string; count: number }>,
  playerId = 'p1',
): Action => ({
  id: `a:${playerId}:3`,
  type: 'fleet.split',
  playerId,
  payload: { fleetId, take },
  issuedAt: 0,
});
const engage = (fleetId: string, targetId: string, playerId = 'p1'): Action => ({
  id: `a:${playerId}:4`,
  type: 'fleet.engage',
  playerId,
  payload: { fleetId, targetId },
  issuedAt: 0,
});
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}

describe('fleetOps — fleet.launch (scramble a garrison into a mobile fleet)', () => {
  it('lifts ships into a fresh fleet, liftable ground troops within cargo capacity', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [
        planet('A', 'p1', [
          ['cruiser', 2], // cargoCapacity 2 each → 4 total
          ['militia', 5], // cargoSize 1 each — only 4 fit
          ['orbital_aa', 1], // immobile → stays behind regardless
        ]),
      ],
    });
    const r = okApply(kernel.applyAction(s, launch('A'), ctx));
    const newFleetId = Object.keys(r.state.fleets)[0]!;
    const f = r.state.fleets[newFleetId]!;
    expect(f.owner).toBe('p1');
    expect(f.location).toBe('A');
    expect(f.units).toEqual([{ unit: 'cruiser', count: 2 }]);
    expect(f.landing).toEqual([{ unit: 'militia', count: 4 }]);
    // 1 militia over cap + the immobile AA stay behind.
    expect(r.state.planets.A?.garrison).toEqual(
      expect.arrayContaining([
        { unit: 'militia', count: 1 },
        { unit: 'orbital_aa', count: 1 },
      ]),
    );
    expect(r.events.map((e) => e.type)).toContain('fleet.launched');
  });

  it('rejects a bad payload, a foreign/missing planet, and someone else\'s world', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p2', [['cruiser', 1]])],
    });
    expect(errCode(kernel.applyAction(s, launch(''), ctx))).toBe('E_NO_PLANET');
    expect(
      errCode(kernel.applyAction(s, { ...launch('A'), payload: {} }, ctx)),
    ).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(s, launch('missing'), ctx))).toBe('E_NO_PLANET');
    expect(errCode(kernel.applyAction(s, launch('A'), ctx))).toBe('E_FORBIDDEN'); // p2's world
  });

  it('rejects an empty garrison and a garrison with no ships (ground troops only)', () => {
    const kernel = createKernel([fleetOpsModule]);
    const empty = stateWith({ players: [player('p1')], planets: [planet('A', 'p1', [])] });
    expect(errCode(kernel.applyAction(empty, launch('A'), ctx))).toBe('E_EMPTY_GARRISON');
    const groundOnly = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1', [['militia', 3]])],
    });
    expect(errCode(kernel.applyAction(groundOnly, launch('A'), ctx))).toBe('E_NO_SHIPS');
  });

  it('rejects scrambling a garrison a battle currently holds (no mid-assault evacuation)', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1', [['cruiser', 1]])],
      battles: {
        b1: {
          id: 'b1',
          location: 'A',
          phase: 'ground',
          attacker: { ref: { kind: 'fleet', fleetId: 'x' }, owner: 'p2' },
          defender: { ref: { kind: 'garrison', planetId: 'A' }, owner: 'p1' },
          round: 1,
        },
      },
    });
    expect(errCode(kernel.applyAction(s, launch('A'), ctx))).toBe('E_UNDER_ASSAULT');
  });
});

describe('fleetOps — fleet.merge (fuse two co-located idle fleets)', () => {
  it('folds `from` into `into`, coalescing matching stacks, and deletes `from`', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [
        fleet('F1', 'p1', 'A', [['cruiser', 2]]),
        fleet('F2', 'p1', 'A', [
          ['cruiser', 1],
          ['scout', 1],
        ]),
      ],
    });
    const r = okApply(kernel.applyAction(s, merge('F1', 'F2'), ctx));
    expect(r.state.fleets.F1).toBeUndefined();
    expect(r.state.fleets.F2?.units).toEqual(
      expect.arrayContaining([
        { unit: 'cruiser', count: 3 },
        { unit: 'scout', count: 1 },
      ]),
    );
    expect(r.events.map((e) => e.type)).toContain('fleet.merged');
  });

  it('re-points a hero riding the absorbed fleet so it isn\'t orphaned', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [
        fleet('F1', 'p1', 'A', [['hero', 1]]),
        fleet('F2', 'p1', 'A', [['cruiser', 1]]),
      ],
      heroes: [hero('h1', 'p1', 'F1')],
    });
    const r = okApply(kernel.applyAction(s, merge('F1', 'F2'), ctx));
    expect(r.state.heroes?.h1?.fleetId).toBe('F2');
  });

  it('rejects merging the same fleet, a foreign fleet, or fleets not co-located/idle', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [
        fleet('F1', 'p1', 'A', [['cruiser', 1]]),
        fleet('F2', 'p1', 'A', [['cruiser', 1]]),
        fleet('F3', 'p2', 'A', [['cruiser', 1]]),
        fleet('F4', 'p1', 'B', [['cruiser', 1]]),
      ],
    });
    expect(errCode(kernel.applyAction(s, merge('F1', 'F1'), ctx))).toBe('E_SAME_FLEET');
    expect(errCode(kernel.applyAction(s, merge('missing', 'F2'), ctx))).toBe('E_NO_FLEET');
    expect(errCode(kernel.applyAction(s, merge('F3', 'F2'), ctx))).toBe('E_FORBIDDEN');
    expect(errCode(kernel.applyAction(s, merge('F1', 'F4'), ctx))).toBe('E_NOT_COLOCATED');
  });

  it('rejects a merge while either side is in battle', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [
        { ...fleet('F1', 'p1', 'A', [['cruiser', 1]]), battleId: 'b1' },
        fleet('F2', 'p1', 'A', [['cruiser', 1]]),
      ],
    });
    expect(errCode(kernel.applyAction(s, merge('F1', 'F2'), ctx))).toBe('E_IN_BATTLE');
  });

  it('a poisoned fleet id (`__proto__`) reads as no-fleet, not a crash', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [fleet('F1', 'p1', 'A', [['cruiser', 1]])],
    });
    expect(errCode(kernel.applyAction(s, merge('__proto__', 'F1'), ctx))).toBe('E_NO_FLEET');
  });
});

describe('fleetOps — fleet.split (peel ships off a fleet into a fresh one)', () => {
  it('peels the requested ships into a new co-located fleet, apportioning hull pro-rata', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [
        {
          ...fleet('F1', 'p1', 'A', []),
          units: [{ unit: 'cruiser', count: 4, hp: 160 }], // 40 hp/ship, full pool
        },
      ],
    });
    const r = okApply(kernel.applyAction(s, split('F1', [{ unit: 'cruiser', count: 1 }]), ctx));
    expect(r.state.fleets.F1?.units).toEqual([{ unit: 'cruiser', count: 3, hp: 120 }]);
    const newId = Object.keys(r.state.fleets).find((id) => id !== 'F1')!;
    expect(r.state.fleets[newId]?.units).toEqual([{ unit: 'cruiser', count: 1, hp: 40 }]);
    expect(r.state.fleets[newId]?.location).toBe('A');
    expect(r.events.map((e) => e.type)).toContain('fleet.split');
  });

  it('rejects splitting off a hero unit, more than the fleet has, all of it, or none', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [
        fleet('F1', 'p1', 'A', [
          ['cruiser', 2],
          ['hero', 1],
        ]),
      ],
    });
    expect(errCode(kernel.applyAction(s, split('F1', [{ unit: 'hero', count: 1 }]), ctx))).toBe(
      'E_HERO_UNIT',
    );
    expect(
      errCode(kernel.applyAction(s, split('F1', [{ unit: 'cruiser', count: 5 }]), ctx)),
    ).toBe('E_NOT_ENOUGH');
    expect(errCode(kernel.applyAction(s, split('F1', []), ctx))).toBe('E_SPLIT_EMPTY');
    expect(
      errCode(
        kernel.applyAction(
          s,
          split('F1', [
            { unit: 'cruiser', count: 2 },
            { unit: 'hero', count: 1 },
          ]),
          ctx,
        ),
      ),
      // hero rejection fires before the "takes everything" check
    ).toBe('E_HERO_UNIT');
  });

  it('rejects splitting a busy fleet (in battle or in transit)', () => {
    const kernel = createKernel([fleetOpsModule]);
    const inBattle = stateWith({
      players: [player('p1')],
      fleets: [{ ...fleet('F1', 'p1', 'A', [['cruiser', 2]]), battleId: 'b1' }],
    });
    expect(
      errCode(kernel.applyAction(inBattle, split('F1', [{ unit: 'cruiser', count: 1 }]), ctx)),
    ).toBe('E_IN_BATTLE');
    const transit = stateWith({
      players: [player('p1')],
      fleets: [fleet('F1', 'p1', null, [['cruiser', 2]])],
    });
    expect(
      errCode(kernel.applyAction(transit, split('F1', [{ unit: 'cruiser', count: 1 }]), ctx)),
    ).toBe('E_IN_TRANSIT');
  });
});

describe('fleetOps — fleet.engage (deliberate attack on a co-located hostile fleet)', () => {
  it('starts an orbital battle between two co-located hostile fleets', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [fleet('A', 'p1', 'X', [['cruiser', 2]]), fleet('D', 'p2', 'X', [['cruiser', 2]])],
    });
    const r = okApply(kernel.applyAction(s, engage('A', 'D'), ctx));
    expect(r.state.fleets.A?.battleId).toBeTruthy();
    expect(r.state.fleets.D?.battleId).toBe(r.state.fleets.A?.battleId);
    expect(r.events.map((e) => e.type)).toContain('battle.started');
    const battle = r.state.battles[r.state.fleets.A!.battleId!];
    expect(battle?.phase).toBe('orbital');
    expect(battle?.attacker.owner).toBe('p1');
    expect(battle?.defender.owner).toBe('p2');
  });

  it('rejects engaging your own fleet, yourself, or a fleet that does not exist', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1')],
      fleets: [fleet('A', 'p1', 'X', [['cruiser', 2]]), fleet('B', 'p1', 'X', [['cruiser', 2]])],
    });
    expect(errCode(kernel.applyAction(s, engage('A', 'A'), ctx))).toBe('E_SAME_FLEET');
    expect(errCode(kernel.applyAction(s, engage('A', 'B'), ctx))).toBe('E_NOT_HOSTILE'); // same owner
    expect(errCode(kernel.applyAction(s, engage('A', 'NOPE'), ctx))).toBe('E_NO_FLEET');
    expect(errCode(kernel.applyAction(s, { ...engage('A', 'B'), payload: {} }, ctx))).toBe(
      'E_BAD_PAYLOAD',
    );
  });

  it('a declared peace/pact/alliance blocks the attack (E_NOT_HOSTILE)', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [fleet('A', 'p1', 'X', [['cruiser', 2]]), fleet('D', 'p2', 'X', [['cruiser', 2]])],
    });
    setStance(s, 'p1', 'p2', 'peace');
    expect(errCode(kernel.applyAction(s, engage('A', 'D'), ctx))).toBe('E_NOT_HOSTILE');
  });

  it('rejects engaging a fleet not co-located, in transit, or already in battle', () => {
    const kernel = createKernel([fleetOpsModule]);
    const elsewhere = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [fleet('A', 'p1', 'X', [['cruiser', 2]]), fleet('D', 'p2', 'Y', [['cruiser', 2]])],
    });
    expect(errCode(kernel.applyAction(elsewhere, engage('A', 'D'), ctx))).toBe('E_NOT_COLOCATED');
    const busy = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [
        { ...fleet('A', 'p1', 'X', [['cruiser', 2]]), battleId: 'b1' },
        fleet('D', 'p2', 'X', [['cruiser', 2]]),
      ],
    });
    expect(errCode(kernel.applyAction(busy, engage('A', 'D'), ctx))).toBe('E_IN_BATTLE');
  });

  it('rejects engaging a ghost fleet (no live ships on either side)', () => {
    const kernel = createKernel([fleetOpsModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [fleet('A', 'p1', 'X', [['cruiser', 0]]), fleet('D', 'p2', 'X', [['cruiser', 2]])],
    });
    expect(errCode(kernel.applyAction(s, engage('A', 'D'), ctx))).toBe('E_NO_FLEET');
  });
});
