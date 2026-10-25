import { describe, expect, it } from 'vitest';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { BuildingDefSchema, parseGameData, type GameData } from '../data/schemas';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { deepFreeze } from '../util/clone';
import { constructionModule } from './construction';
import { economyModule } from './economy';

const HOUR = 3_600_000;
const legacy: GameData = parseGameData({
  version: 'old',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {
    old_rig: {
      name: 'Old Rig',
      cost: { metal: 100 },
      buildTimeHours: 6,
      produces: { metal: 20 },
      hp: 20,
    },
    workshop: { name: 'Workshop', cost: { metal: 20 }, buildTimeHours: 1, hp: 10 },
  },
  events: {},
});
const retired: GameData = parseGameData({
  ...legacy,
  version: 'new',
  buildings: { ...legacy.buildings, old_rig: { ...legacy.buildings.old_rig, retired: true } },
});
const kernel = createKernel([constructionModule]);
const context = (now = 0, data = retired): Context => ({ now, data });
const restored = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState;

function initial(): GameState {
  const state = createInitialState({ seed: 'retirement', version: { data: 'old', manifest: '1' } });
  state.players = {
    p1: { id: 'p1', name: 'One', faction: 'x', status: 'active', resources: { metal: 1000 } },
    p2: { id: 'p2', name: 'Two', faction: 'x', status: 'active', resources: { metal: 0 } },
  };
  state.planets = {
    A: {
      id: 'A',
      owner: 'p1',
      position: { x: 0, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
    },
  };
  return state;
}

function action(type: string, payload: Record<string, unknown>): Action {
  return { id: `retirement:${type}`, type, playerId: 'p1', issuedAt: 0, payload };
}
const build = (building: string): Action =>
  action('building.construct', { planetId: 'A', building });
function ok(result: ApplyResult | AdvanceResult): GameState {
  if (!result.ok) throw new Error(result.code);
  return result.state;
}
function activeSeq(state: GameState): number {
  const event = state.scheduled.find((entry) => entry.type === 'construction.complete');
  if (!event) throw new Error('Expected accepted construction');
  return event.seq;
}

describe('retired building definitions preserve existing investments', () => {
  it('does not add a field to old parsed definitions and validates an explicit retirement', () => {
    expect(legacy.buildings.old_rig).not.toHaveProperty('retired');
    expect(retired.buildings.old_rig?.retired).toBe(true);
    expect(BuildingDefSchema.safeParse({ name: 'Rig', retired: 'true' }).success).toBe(false);
  });

  it('rejects direct new construction without charging or mutating the world', () => {
    const state = deepFreeze(initial());
    const before = JSON.stringify(state);
    const result = kernel.applyAction(state, build('old_rig'), context());
    expect(result.ok ? null : result.code).toBe('E_BUILDING_RETIRED');
    expect(JSON.stringify(state)).toBe(before);
    expect(
      ok(kernel.applyAction(state, build('workshop'), context())).players.p1?.resources.metal,
    ).toBe(980);
  });

  it('cannot bypass retirement by ordering behind a busy construction lane', () => {
    const state = ok(kernel.applyAction(initial(), build('workshop'), context()));
    const result = kernel.applyAction(state, build('old_rig'), context());
    expect(result.ok ? null : result.code).toBe('E_BUILDING_RETIRED');
    expect(state.planets.A?.buildQueue).toBeUndefined();
    expect(state.players.p1?.resources.metal).toBe(980);
  });

  it('finishes an already paid order after a snapshot round trip and catalogue retirement', () => {
    const accepted = ok(kernel.applyAction(initial(), build('old_rig'), context(0, legacy)));
    const finished = ok(kernel.advanceTo(restored(accepted), context(6 * HOUR)));
    expect(finished.planets.A?.buildings).toMatchObject([{ type: 'old_rig', level: 1, hp: 20 }]);
    expect(finished.players.p1?.resources.metal).toBe(900);
    expect(finished.scheduled).toEqual([]);
  });

  it('honours an accepted unpaid queue entry after restore and charges exactly once', () => {
    const head = ok(kernel.applyAction(initial(), build('workshop'), context(0, legacy)));
    const queued = ok(kernel.applyAction(head, build('old_rig'), context(0, legacy)));
    expect(queued.players.p1?.resources.metal).toBe(980);
    expect(queued.planets.A?.buildQueue?.[0]?.building).toBe('old_rig');
    const started = ok(kernel.advanceTo(restored(queued), context(HOUR)));
    expect(started.players.p1?.resources.metal).toBe(880);
    expect(started.planets.A?.buildQueue).toBeUndefined();
    const finished = ok(kernel.advanceTo(restored(started), context(7 * HOUR)));
    expect(finished.planets.A?.buildings.map((building) => building.type)).toEqual([
      'workshop',
      'old_rig',
    ]);
    expect(finished.players.p1?.resources.metal).toBe(880);
  });

  it('can pause an accepted order after retirement, restore it, and resume its remaining work', () => {
    const accepted = ok(kernel.applyAction(initial(), build('old_rig'), context(0, legacy)));
    const seq = activeSeq(accepted);
    const paused = ok(
      kernel.applyAction(
        restored(accepted),
        action('construction.cancel', {
          planetId: 'A',
          seq,
        }),
        context(3 * HOUR),
      ),
    );
    expect(paused.players.p1?.resources.metal).toBe(950);
    expect(paused.planets.A?.pausedConstruction?.[0]).toMatchObject({
      building: 'old_rig',
      remainingHours: 3,
      remainingCost: { metal: 50 },
    });
    const resumed = ok(
      kernel.applyAction(
        restored(paused),
        action('construction.resume', {
          planetId: 'A',
          id: seq,
        }),
        context(3 * HOUR),
      ),
    );
    expect(resumed.players.p1?.resources.metal).toBe(900);
    const finished = ok(kernel.advanceTo(resumed, context(6 * HOUR)));
    expect(finished.planets.A?.buildings).toMatchObject([{ type: 'old_rig', level: 1, hp: 20 }]);
    expect(finished.planets.A?.pausedConstruction).toEqual([]);
  });

  it('cannot invent a paused retired order through the resume action', () => {
    const result = kernel.applyAction(
      initial(),
      action('construction.resume', {
        planetId: 'A',
        id: 7,
        building: 'old_rig',
        remainingCost: {},
      }),
      context(),
    );
    expect(result.ok ? null : result.code).toBe('E_NOT_PAUSED');
  });

  it('continues production for the current owner after a saved retired building changes hands', () => {
    const state = initial();
    state.planets.A!.owner = 'p2';
    state.planets.A!.buildings = [{ type: 'old_rig', level: 1, hp: 20 }];
    const economy = createKernel([constructionModule, economyModule]);
    const next = ok(economy.advanceTo(restored(state), context(HOUR)));
    expect(next.players.p1?.resources.metal).toBe(1000);
    expect(next.players.p2?.resources.metal).toBe(20);
    expect(next.planets.A?.buildings).toEqual(state.planets.A?.buildings);
  });
});
