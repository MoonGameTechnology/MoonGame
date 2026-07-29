import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { capitalModule, capitalOf, capitalsOf } from './capital';
import {
  createInitialState,
  type GameState,
  type Hero,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// capital — a designatable respawn anchor. Port of the prototype's proven
// capitalModule (prototype/src/capital.ts, REFP-14). heroModule already reads
// hero.home as a respawn fallback; nothing let a player CHANGE it post-seed.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectorKinds: {
    // orbit + no allowedBuildings restriction → inhabited (mirrors tax.ts's rule)
    homeworld: { scoreValue: 10, capturable: true, buildable: true, orbit: true },
    // orbit but building-restricted → NOT inhabited
    outpost: {
      scoreValue: 5,
      capturable: true,
      buildable: true,
      orbit: true,
      allowedBuildings: ['metal_station'],
    },
    // no orbit at all → NOT inhabited
    asteroid: { scoreValue: 3, capturable: true, buildable: true, orbit: false },
  },
});
const ctx: Context = { now: 0, data };

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function planet(id: string, owner: string | null, kind: string): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    kind,
  };
}
function hero(id: string, owner: string, home: string): Hero {
  return {
    id,
    owner,
    name: id,
    location: home,
    cooldowns: {},
    grade: 'main',
    archetype: 'commander',
    abilities: [],
    passives: [],
    home,
  };
}
function stateWith(opts: { players?: Player[]; planets?: Planet[]; heroes?: Hero[] }): GameState {
  const s = createInitialState({ seed: 'capital', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const heroes: Record<string, Hero> = {};
  for (const x of opts.heroes ?? []) heroes[x.id] = x;
  return { ...s, players, planets, heroes };
}
const designate = (planetId: string, playerId = 'p1'): Action => ({
  id: `a:${playerId}:1`,
  type: 'capital.designate',
  playerId,
  payload: { planetId },
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

describe('capital — designating a home world (hero respawn anchor)', () => {
  it('designates an owned inhabited world as the capital', () => {
    const kernel = createKernel([capitalModule]);
    const s = stateWith({ players: [player('p1')], planets: [planet('A', 'p1', 'homeworld')] });
    const r = okApply(kernel.applyAction(s, designate('A'), ctx));
    expect(capitalOf(r.state, 'p1')).toBe('A');
    expect(capitalsOf(r.state)).toEqual({ p1: 'A' });
    expect(r.events.map((e) => e.type)).toContain('capital.designated');
  });

  it('re-points every owned hero\'s `home` to the new capital', () => {
    const kernel = createKernel([capitalModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1', 'homeworld'), planet('B', 'p1', 'homeworld')],
      heroes: [hero('h1', 'p1', 'A'), hero('h2', 'p1', 'A'), hero('h3', 'p2', 'A')],
    });
    const r = okApply(kernel.applyAction(s, designate('B'), ctx));
    expect(r.state.heroes?.h1?.home).toBe('B');
    expect(r.state.heroes?.h2?.home).toBe('B');
    expect(r.state.heroes?.h3?.home).toBe('A'); // another player's hero — untouched
  });

  it('rejects a bad payload, a foreign/missing world, and an uninhabited world', () => {
    const kernel = createKernel([capitalModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [
        planet('A', 'p2', 'homeworld'),
        planet('B', 'p1', 'outpost'),
        planet('C', 'p1', 'asteroid'),
      ],
    });
    expect(errCode(kernel.applyAction(s, { ...designate('A'), payload: {} }, ctx))).toBe(
      'E_BAD_PAYLOAD',
    );
    expect(errCode(kernel.applyAction(s, designate('missing'), ctx))).toBe('E_NO_PLANET');
    expect(errCode(kernel.applyAction(s, designate('A'), ctx))).toBe('E_FORBIDDEN'); // p2's world
    expect(errCode(kernel.applyAction(s, designate('B'), ctx))).toBe('E_NOT_INHABITED');
    expect(errCode(kernel.applyAction(s, designate('C'), ctx))).toBe('E_NOT_INHABITED');
  });

  it('capitalsOf/capitalOf degrade gracefully with no designation yet', () => {
    const s = stateWith({ players: [player('p1')] });
    expect(capitalOf(s, 'p1')).toBeUndefined();
    expect(capitalsOf(s)).toEqual({});
  });
});
