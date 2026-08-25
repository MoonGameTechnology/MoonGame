import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { autoRallyModule } from './autoRally';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { deepFreeze } from '../util/clone';

// auto-rally (CONV-10) — the port of the prototype's BF-29 behaviour into the
// canon: a built SHIP joins the world's RALLY fleet instead of waiting in the
// garrison for a manual `fleet.launch`. Tested THROUGH constructionModule (the
// producer of `unit.built`) rather than by hand-emitting the event: the payload
// contract between the two modules is exactly what a port can get wrong.
//
// Both canon-vocabulary fixes are pinned here: "ground" is `domain` (the copy
// read a `ground` TRAIT that shipped data never sets) and an `immobile`
// emplacement stays planetside (the copy promised it in a comment only).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      domain: 'space',
      slots: { weapon: 0, defense: 1, utility: 0 },
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 10 },
      buildTimeHours: 0, // instant: the completion fires inside the same advance
    },
    // Ground by DOMAIN and by nothing else — exactly the shipped catalogue's
    // shape (`data/units.json` has no `ground` trait at all).
    militia: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 1, defense: 2, speed: 0, hp: 8 },
      cost: { metal: 5 },
      buildTimeHours: 0,
    },
    // A space-domain emplacement: it is not ground, but it does not fly either.
    orbital_aa: {
      faction: 'x',
      domain: 'space',
      traits: ['immobile'],
      stats: { attack: 4, defense: 14, speed: 0, hp: 30 },
      cost: { metal: 8 },
      buildTimeHours: 0,
    },
  },
  factions: {},
  buildings: {
    shipyard: {
      name: 'Shipyard',
      cost: { metal: 100 },
      buildTimeHours: 4,
      enablesShipConstruction: true,
    },
    barracks: {
      name: 'Barracks',
      cost: { metal: 70 },
      buildTimeHours: 3,
      enablesGroundConstruction: true,
    },
  },
  events: {},
  modules: {
    plating: {
      name: 'P',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { hp: 12 } },
      cost: { metal: 5 },
    },
  },
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const kernel = createKernel([constructionModule, autoRallyModule]);
/** The same world WITHOUT the module — the delta this brick closes. */
const bare = createKernel([constructionModule]);

function player(id: string, metal = 1000): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal } };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [
      { type: 'shipyard', level: 1, hp: 100 },
      { type: 'barracks', level: 1, hp: 100 },
    ],
    garrison: [],
    traits: [],
  };
}
function stateWith(fleets: Fleet[] = []): GameState {
  const s = createInitialState({ seed: 'rally', version: { data: '0.1.0', manifest: '1' } });
  const byId: Record<string, Fleet> = {};
  for (const f of fleets) byId[f.id] = f;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: planet('A', 'p1') },
    fleets: byId,
  };
}
function build(unit: string, count = 1, modules?: string[], playerId = 'p1'): Action {
  return {
    id: `a:${playerId}:${unit}:${count}`,
    type: 'unit.build',
    playerId,
    payload: { planetId: 'A', unit, count, ...(modules ? { modules } : {}) },
    issuedAt: 0,
  };
}
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function okAdvance(r: AdvanceResult) {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
/** Order `unit` at the world's current time and run the clock past the
 *  (instant) completion, so calls chain onto an already-advanced state. */
function built(state: GameState, unit: string, count = 1, modules?: string[]): GameState {
  const now = state.time;
  const ordered = okApply(kernel.applyAction(state, build(unit, count, modules), ctx(now)));
  return okAdvance(kernel.advanceTo(ordered.state, ctx(now + HOUR))).state;
}
const rallyFleets = (s: GameState): Fleet[] =>
  Object.values(s.fleets).filter((f) => f.traits.includes('rally'));

describe('autoRally module', () => {
  it('sends a freshly built ship to orbit as a rally fleet', () => {
    const s = built(stateWith(), 'cruiser', 2);
    expect(s.planets.A?.garrison).toEqual([]); // it did not stay planetside
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.owner).toBe('p1');
    expect(rally[0]?.location).toBe('A');
    expect(rally[0]?.units).toEqual([{ unit: 'cruiser', count: 2 }]);
  });

  it('leaves the ship in the garrison when the module is absent (the gap it closes)', () => {
    const ordered = okApply(bare.applyAction(stateWith(), build('cruiser', 2), ctx(0)));
    const s = okAdvance(bare.advanceTo(ordered.state, ctx(HOUR))).state;
    expect(s.planets.A?.garrison).toEqual([{ unit: 'cruiser', count: 2 }]);
    expect(Object.keys(s.fleets)).toEqual([]);
  });

  it('pools ships from separate orders into ONE rally fleet', () => {
    const s = built(built(stateWith(), 'cruiser', 1), 'cruiser', 3);
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.units).toEqual([{ unit: 'cruiser', count: 4 }]);
  });

  it('never merges into an untagged fleet the player already had on the node', () => {
    const existing: Fleet = {
      id: 'F',
      owner: 'p1',
      location: 'A',
      movement: null,
      units: [{ unit: 'cruiser', count: 5 }],
      traits: [],
    };
    const s = built(stateWith([existing]), 'cruiser', 1);
    expect(s.fleets.F?.units).toEqual([{ unit: 'cruiser', count: 5 }]); // untouched
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.id).not.toBe('F');
    expect(rally[0]?.units).toEqual([{ unit: 'cruiser', count: 1 }]);
  });

  it('keeps ground troops planetside — by domain, with no `ground` trait in the data', () => {
    const s = built(stateWith(), 'militia', 3);
    expect(data.units.militia?.traits).toEqual([]); // the shape the copy misread
    expect(s.planets.A?.garrison).toEqual([{ unit: 'militia', count: 3 }]);
    expect(rallyFleets(s)).toEqual([]);
  });

  it('keeps an immobile emplacement planetside even though it is space-domain', () => {
    const s = built(stateWith(), 'orbital_aa', 1);
    expect(s.planets.A?.garrison).toEqual([{ unit: 'orbital_aa', count: 1 }]);
    expect(rallyFleets(s)).toEqual([]);
  });

  it('carries the paid loadout onto the rally stack and leaves other stacks alone', () => {
    const withBare = built(stateWith(), 'cruiser', 1); // one bare cruiser rallies first
    const s = built(withBare, 'cruiser', 2, ['plating']);
    const rally = rallyFleets(s);
    expect(rally).toHaveLength(1);
    expect(rally[0]?.units).toEqual([
      { unit: 'cruiser', count: 1 },
      { unit: 'cruiser', count: 2, modules: ['plating'] }, // fitted stack stays separate
    ]);
    expect(s.planets.A?.garrison).toEqual([]);
  });

  it('is pure: the input state is never mutated', () => {
    const before = stateWith();
    const ordered = okApply(kernel.applyAction(before, build('cruiser', 1), ctx(0)));
    deepFreeze(ordered.state);
    expect(() => okAdvance(kernel.advanceTo(ordered.state, ctx(HOUR)))).not.toThrow();
  });
});
