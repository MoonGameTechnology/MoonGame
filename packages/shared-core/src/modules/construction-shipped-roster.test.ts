import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import { parseGameData, type GameData } from '../data/schemas';
import { composeGameDataBundle } from '../data/loadGameData';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import type { Action } from '../action/types';

/**
 * ORB-4 — the golden table of WHAT THE SHIPPED CATALOGUE actually hosts, measured
 * through the real reducer rather than read off the JSON.
 *
 * Why a golden table and not a rule ("every kind must declare a roster"): the sibling
 * test `construction-sector.test.ts` proves the MECHANISM on synthetic kinds, and it
 * stayed green for weeks while the shipped `asteroid` hosted all twenty buildings —
 * because it never looks at `data/`. A rule about `undefined` would not have helped
 * either: `planet` is legitimately roster-less. What was missing is a place where the
 * answer per province type is written down and has to be re-confirmed on purpose.
 *
 * So: add a sector kind, or widen a roster, and this table fails until you update it.
 * That is the point — a new province type cannot silently inherit "anything goes".
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dataDir = path.join(repoRoot, 'data');
const data: GameData = parseGameData(
  composeGameDataBundle((name) => JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'))),
);

const kernel = createKernel([constructionModule]);

function world(kind: string): GameState {
  const base = createInitialState({ seed: 'roster', version: { data: '0.1.0', manifest: '1' } });
  const player: Player = {
    id: 'p1',
    name: 'p1',
    faction: 'x',
    status: 'active',
    // Rich enough that nothing is refused for price — this test is about the province
    // type, and E_INSUFFICIENT would hide a roster hole behind a money answer.
    resources: Object.fromEntries(data.resources.map((r) => [r, 1_000_000])),
  };
  const node: Planet = {
    id: 'N',
    owner: 'p1',
    position: { x: 0, y: 0 },
    kind,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  return { ...base, players: { p1: player }, planets: { N: node } };
}

/** Building ids the reducer lets a player raise on a province of this kind. */
function hosts(kind: string): string[] {
  const state = world(kind);
  return Object.keys(data.buildings).filter((building) => {
    const action: Action = {
      id: `a:${kind}:${building}`,
      type: 'building.construct',
      playerId: 'p1',
      payload: { planetId: 'N', building },
      issuedAt: 0,
    };
    return kernel.applyAction(state, action, { now: 0, data }).ok;
  });
}

/**
 * Buildings that name their own ground (`onlyOn`) and are therefore NOT part of what a
 * roster-less province hosts. Written out, not derived: a building that starts
 * restricting itself must be DECIDED into this list, and until it is, the `planet` row
 * below fails — the same "no silent inheritance" the table gives province types.
 */
const SELF_RESTRICTED = [
  'metal_station', // owner decision 3: dead worlds / asteroids / fortresses
  // The fortress CORE (owner decision 18): `onlyOn: []` — "raised nowhere" by hand. It
  // appears only with the fortress itself, placed by `station.deploy`. Without this the
  // core would be buildable on a planet, which has no roster at all.
  'starfort',
  // Ангар крепости (owner decision 14): её собственное здание под челноки, `onlyOn`
  // держит его на крепости и нигде больше.
  'void_hangar',
];

/** Every shipped province type, and what it hosts. `null` = roster-less: anything in the
 *  catalogue that does not restrict itself (see {@link SELF_RESTRICTED}). */
const EXPECTED: Record<string, string[] | null> = {
  planet: null, // the prize: the only roster-less province
  asteroid: ['metal_station'], // ore field: the rig that mines it — the fortress core moved out (decision 18)
  nebula: [],
  empty: [],
  debris_field: [],
  dead_world: ['metal_station'], // salvage rig only (AI-BAL-8)
  graveyard: [],
  ion_storm: [],
  dense_nebula: [],
  solar_flare: [],
  black_hole: [],
  pirate_base: ['shipyard', 'spaceport', 'radar', 'fort', 'power_plant', 'fabricator', 'orbital_aa'],
  neutral_base: ['shipyard', 'spaceport', 'radar', 'fort', 'power_plant', 'fabricator', 'orbital_aa'],
  // owner decision 8: a fortress does not exclude mining — the rig can be rebuilt here
  // after it is destroyed, otherwise conversion would take the node's ore away for good.
  void_station: [
    'shipyard',
    // `spaceport` уехал отсюда решением 14 — его место занял `void_hangar` ниже.
    'radar',
    'fort',
    'power_plant',
    'fabricator',
    'orbital_aa',
    'metal_station',
    'void_hangar',
    // FORT-5.9: госпиталь лечит не только гарнизон узла, но и десант в трюме
    // припаркованных рядом флотов — своих и союзных.
    'hospital',
  ],
};

describe('shipped province types: what each one hosts (ORB-4 golden table)', () => {
  it('covers every kind in data/sectorKinds.json — a new kind must be decided, not defaulted', () => {
    expect(Object.keys(data.sectorKinds).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [kind, expected] of Object.entries(EXPECTED)) {
    it(`${kind} hosts ${expected === null ? 'everything that will have it' : expected.length + ' building(s)'}`, () => {
      const actual = hosts(kind);
      if (expected === null) {
        const anything = Object.keys(data.buildings).filter((b) => !SELF_RESTRICTED.includes(b));
        expect(actual.sort()).toEqual(anything.sort());
      } else {
        expect(actual.sort()).toEqual([...expected].sort());
      }
    });
  }

  it('an asteroid field refuses an ordinary colony building', () => {
    const state = world('asteroid');
    const action: Action = {
      id: 'a:asteroid:farm',
      type: 'building.construct',
      playerId: 'p1',
      payload: { planetId: 'N', building: 'farm' },
      issuedAt: 0,
    };
    const result = kernel.applyAction(state, action, { now: 0, data });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.code).toBe('E_WRONG_SECTOR');
  });
});
