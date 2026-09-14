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

/** Every shipped province type, and what it hosts. `null` = anything in the catalogue. */
const EXPECTED: Record<string, string[] | null> = {
  planet: null, // the prize: the only province with the full catalogue
  asteroid: ['starfort'], // ore field — a guard post, not a colony
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
  void_station: ['shipyard', 'spaceport', 'radar', 'fort', 'power_plant', 'fabricator', 'orbital_aa'],
};

describe('shipped province types: what each one hosts (ORB-4 golden table)', () => {
  it('covers every kind in data/sectorKinds.json — a new kind must be decided, not defaulted', () => {
    expect(Object.keys(data.sectorKinds).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [kind, expected] of Object.entries(EXPECTED)) {
    it(`${kind} hosts ${expected === null ? 'the whole catalogue' : expected.length + ' building(s)'}`, () => {
      const actual = hosts(kind);
      if (expected === null) {
        expect(actual.sort()).toEqual(Object.keys(data.buildings).sort());
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
