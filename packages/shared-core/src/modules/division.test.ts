import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { divisionModule, divisionsOf } from './division';
import { formationStats } from '../data/formations';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

const HOUR = 3_600_000;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    militia: {
      faction: 'x',
      domain: 'ground',
      cost: { metal: 10 },
      stats: { attack: 4, defense: 5, speed: 0, hp: 14, cargoSize: 1 },
    },
    heavy_infantry: {
      faction: 'x',
      domain: 'ground',
      cost: { metal: 20 },
      stats: { attack: 7, defense: 10, speed: 0, hp: 34, cargoSize: 2 },
    },
    special_forces: {
      faction: 'x',
      domain: 'ground',
      cost: { metal: 30 },
      stats: { attack: 12, defense: 11, speed: 0, hp: 26, cargoSize: 2 },
    },
    tank: {
      faction: 'x',
      domain: 'ground',
      cost: { metal: 40 },
      stats: { attack: 16, defense: 18, speed: 0, hp: 46, cargoSize: 3 },
    },
    dropship: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 1, defense: 2, speed: 6, hp: 50, cargoCapacity: 12 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
});
const ctx: Context = { now: 0, data };

function player(id: string, metal = 1000): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal } };
}
function planet(id: string, owner: string | null): Planet {
  return { id, owner, position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] };
}
function fleet(id: string, owner: string, location: string | null, units: Array<[string, number]> = []): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    landing: [],
    traits: [],
  };
}
function stateWith(opts: { players?: Player[]; planets?: Planet[]; fleets?: Fleet[] }): GameState {
  const s = createInitialState({ seed: 'div', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  return { ...s, players, planets, fleets };
}
const mobilize = (planetId: string, template: number, playerId = 'p1', officer?: boolean): Action => ({
  id: `a:${playerId}:mob`,
  type: 'division.mobilize',
  playerId,
  payload: { planetId, template, ...(officer !== undefined ? { officer } : {}) },
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

describe('formationStats', () => {
  it('sums cost and hp across the template slots, counts by type', () => {
    const stats = formationStats(
      { name: 'x', slots: ['heavy_infantry', 'heavy_infantry', 'militia', 'militia', 'tank', 'tank'] },
      data,
    );
    expect(stats.byType).toEqual({ militia: 2, heavy_infantry: 2, special_forces: 0, tank: 2 });
    expect(stats.count).toBe(6);
    expect(stats.cost.metal).toBe(2 * 10 + 2 * 20 + 2 * 40);
    expect(stats.hp).toBe(2 * 14 + 2 * 34 + 2 * 46);
  });

  it('flags the combined-arms synergy when infantry and armour mix', () => {
    const stats = formationStats({ name: 'x', slots: ['militia', 'tank', null, null, null, null] }, data);
    expect(stats.synergies.map((s) => s.key)).toContain('combined');
  });

  it('an empty template has zero count and no synergies', () => {
    const stats = formationStats({ name: 'x', slots: [null, null, null, null, null, null] }, data);
    expect(stats.count).toBe(0);
    expect(stats.synergies).toEqual([]);
  });
});

describe('division module — mobilize', () => {
  it('mobilizes the default template 0 (line) on an owned world, paying its cost', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p1')] });
    const before = st.players.p1!.resources.metal;
    const r = okApply(kernel.applyAction(st, mobilize('A', 0), ctx));
    const divs = divisionsOf(r.state);
    const ids = Object.keys(divs);
    expect(ids).toHaveLength(1);
    const div = divs[ids[0]!]!;
    expect(div.owner).toBe('p1');
    expect(div.location).toBe('A');
    expect(div.max).toEqual({ militia: 2, heavy_infantry: 2, special_forces: 0, tank: 2 });
    expect(r.state.players.p1!.resources.metal).toBeLessThan(before as number);
    expect(r.events.map((e) => e.type)).toContain('division.mobilized');
  });

  it('rejects mobilizing on a world you do not own', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p2')] });
    expect(errCode(kernel.applyAction(st, mobilize('A', 0), ctx))).toBe('E_FORBIDDEN');
  });

  it('rejects mobilizing without enough funds', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1', 1)], planets: [planet('A', 'p1')] });
    expect(errCode(kernel.applyAction(st, mobilize('A', 0), ctx))).toBe('E_NO_FUNDS');
  });

  it('rejects an unknown template index', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p1')] });
    expect(errCode(kernel.applyAction(st, mobilize('A', 99), ctx))).toBe('E_NO_TEMPLATE');
  });

  it('an officer premade mobilization attaches the locked officer', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p1')] });
    const r = okApply(kernel.applyAction(st, mobilize('A', 0, 'p1', true), ctx));
    const div = Object.values(divisionsOf(r.state))[0]!;
    expect(div.officer).toBe('assault'); // OFFICER_TEMPLATES[0]
  });
});

describe('division module — template designer', () => {
  it('edits a custom template slot, materialising from the defaults on first edit', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p1')] });
    const edit: Action = {
      id: 'a:1',
      type: 'division.template',
      playerId: 'p1',
      payload: { template: 0, slot: 0, unit: 'tank' },
      issuedAt: 0,
    };
    const r = okApply(kernel.applyAction(st, edit, ctx));
    expect(r.state.players.p1!.divisionTemplates?.[0]!.slots[0]).toBe('tank');
  });

  it('renames a custom template (trimmed, capped at 24 chars)', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p1')] });
    const rename: Action = {
      id: 'a:1',
      type: 'division.rename',
      playerId: 'p1',
      payload: { template: 0, name: '  My Line  ' },
      issuedAt: 0,
    };
    const r = okApply(kernel.applyAction(st, rename, ctx));
    expect(r.state.players.p1!.divisionTemplates?.[0]!.name).toBe('My Line');
  });

  it('rejects an out-of-range slot', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({ players: [player('p1')], planets: [planet('A', 'p1')] });
    const edit: Action = {
      id: 'a:1',
      type: 'division.template',
      playerId: 'p1',
      payload: { template: 0, slot: 99, unit: 'tank' },
      issuedAt: 0,
    };
    expect(errCode(kernel.applyAction(st, edit, ctx))).toBe('E_BAD_PAYLOAD');
  });
});

describe('division module — load/unload aboard a fleet', () => {
  function mobilized(): { kernel: ReturnType<typeof createKernel>; state: GameState; divId: string } {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('F', 'p1', 'A', [['dropship', 1]])], // capacity 12
    });
    const r = okApply(kernel.applyAction(st, mobilize('A', 2), ctx)); // template 2 (raid): fits in 12
    const divId = Object.keys(divisionsOf(r.state))[0]!;
    return { kernel, state: r.state, divId };
  }

  it('loads a garrisoning division aboard a co-located idle fleet', () => {
    const { kernel, state, divId } = mobilized();
    const load: Action = {
      id: 'a:1',
      type: 'division.load',
      playerId: 'p1',
      payload: { divisionId: divId, fleetId: 'F' },
      issuedAt: 0,
    };
    const r = okApply(kernel.applyAction(state, load, ctx));
    expect(divisionsOf(r.state)[divId]!.carriedBy).toBe('F');
  });

  it('rejects loading beyond the fleet cargo capacity', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('F', 'p1', 'A', [])], // no cargo at all
    });
    const mob = okApply(kernel.applyAction(st, mobilize('A', 0), ctx)); // line template: heavy cargo
    const divId = Object.keys(divisionsOf(mob.state))[0]!;
    const load: Action = {
      id: 'a:1',
      type: 'division.load',
      playerId: 'p1',
      payload: { divisionId: divId, fleetId: 'F' },
      issuedAt: 0,
    };
    expect(errCode(kernel.applyAction(mob.state, load, ctx))).toBe('E_NO_CARGO');
  });

  it('unloads and captures an undefended, capturable world on arrival', () => {
    const { kernel, state, divId } = mobilized();
    const load: Action = {
      id: 'a:1',
      type: 'division.load',
      playerId: 'p1',
      payload: { divisionId: divId, fleetId: 'F' },
      issuedAt: 0,
    };
    const loaded = okApply(kernel.applyAction(state, load, ctx));
    loaded.state.planets.A!.owner = null; // neutral, undefended
    loaded.state.fleets.F!.location = 'A';
    const unload: Action = {
      id: 'a:2',
      type: 'division.unload',
      playerId: 'p1',
      payload: { divisionId: divId },
      issuedAt: 0,
    };
    const r = okApply(kernel.applyAction(loaded.state, unload, ctx));
    expect(r.state.planets.A!.owner).toBe('p1');
    expect(divisionsOf(r.state)[divId]!.carriedBy).toBeNull();
  });
});

describe('division module — ground combat (time.advanced driver)', () => {
  it('resolves a contested world: the stronger side wipes the weaker and captures it', () => {
    const kernel = createKernel([divisionModule]);
    const st = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2')],
    });
    // p2 garrisons with a token militia; p1 lands a tank-heavy raider — both divisions
    // placed directly (mobilize requires owning the world, which only p2 does here).
    st.divisions = {
      'div:p2:1': {
        id: 'div:p2:1',
        owner: 'p2',
        name: 'defender',
        template: 0,
        max: { militia: 1 },
        units: [{ type: 'militia', count: 1, hp: 14, hpEach: 14 }],
        location: 'A',
      },
      'div:p1:1': {
        id: 'div:p1:1',
        owner: 'p1',
        name: 'attacker',
        template: 0,
        max: { tank: 6 },
        units: [{ type: 'tank', count: 6, hp: 6 * 46, hpEach: 46 }],
        location: 'A',
      },
    };
    const advanced = kernel.advanceTo(st, { ...ctx, now: 48 * HOUR });
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.state.planets.A!.owner).toBe('p1');
  });
});
