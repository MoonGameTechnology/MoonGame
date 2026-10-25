import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { constructionModule } from '../modules/construction';
import { salvageModule } from '../modules/salvage';
import { createInitialState, type GameState, type MatchPricing } from '../state/gameState';
import type { Action, ApplyResult, Context } from '../action/types';
import { matchCost, matchHours, matchUnitCost } from './pricing';

const data = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits', 'microelectronics'],
  units: {
    hull: {
      faction: 'x',
      hullClass: 'medium',
      stats: { hp: 40, attack: 1, defense: 1, speed: 1 },
      cost: { metal: 55, credits: 15, microelectronics: 2 },
      buildTimeHours: 4,
      slots: { weapon: 1 },
    },
    troop: {
      faction: 'x',
      domain: 'ground',
      stats: { hp: 10, attack: 1, defense: 1, speed: 1 },
      cost: { metal: 25 },
    },
    shuttle: {
      faction: 'x',
      traits: ['shuttle'],
      stats: { hp: 10, attack: 1, defense: 1, speed: 1 },
      cost: { metal: 25 },
    },
    missile: {
      faction: 'x',
      traits: ['issued', 'missile'],
      stats: { hp: 10, attack: 1, defense: 1, speed: 1 },
      cost: { metal: 25 },
    },
    hero: {
      faction: 'x',
      hullClass: 'heavy',
      traits: ['hero'],
      stats: { hp: 10, attack: 1, defense: 1, speed: 1 },
      cost: { metal: 25 },
    },
    issued: {
      faction: 'x',
      hullClass: 'light',
      traits: ['issued'],
      stats: { hp: 10, attack: 1, defense: 1, speed: 1 },
      cost: { metal: 25 },
    },
  },
  buildings: {
    yard: {
      name: 'Yard',
      enablesShipConstruction: true,
      upgrades: [{ enablesShipConstruction: true }],
    },
  },
  modules: {
    gun: { name: 'Gun', slot: 'weapon', tag: 'horizontal', cost: { metal: 5, credits: 3 } },
  },
  factions: {},
  events: {},
});
const HOUR = 3_600_000;
const PRICING: MatchPricing = {
  cost: { metal: 1.5, credits: 3, microelectronics: 2 },
  shipCost: { metal: 2.5, credits: 2, microelectronics: 1.5 },
  hours: 2,
};
const RICH = { metal: 1000, credits: 1000, microelectronics: 1000 };
const ctx = (now = 0): Context => ({ now, data });
function state(pricing: MatchPricing | undefined = PRICING): GameState {
  const s = createInitialState({
    seed: 'ship-price',
    version: { data: data.version, manifest: '1' },
  });
  s.players.p1 = { id: 'p1', name: 'P1', faction: 'x', status: 'active', resources: { ...RICH } };
  s.planets.A = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [{ type: 'yard', level: 2, hp: 100 }],
    garrison: [],
    traits: [],
  };
  if (pricing) s.pricing = pricing;
  return s;
}
const action = (type: string, payload: unknown): Action => ({
  id: `test:${type}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
function ok(result: ApplyResult) {
  if (!result.ok) throw new Error(result.code);
  return result;
}
const build = (count = 1, modules: string[] = []) =>
  action('unit.build', { planetId: 'A', unit: 'hull', count, modules });

describe('ship hull prices', () => {
  it('combines resource factors before rounding once', () => {
    expect(matchUnitCost({ pricing: PRICING }, data.units.hull!)).toEqual({
      metal: 207,
      credits: 90,
      microelectronics: 6,
    });
    expect(matchUnitCost({}, data.units.hull!)).toBe(data.units.hull!.cost);
    expect(matchUnitCost({}, undefined)).toBeUndefined();
  });

  it('preserves an old match without the optional ship premium', () => {
    const { shipCost: _shipCost, ...old } = PRICING;
    expect(matchUnitCost({ pricing: old }, data.units.hull!)).toEqual({
      metal: 83,
      credits: 45,
      microelectronics: 4,
    });
  });

  it.each(['troop', 'shuttle', 'missile', 'hero', 'issued'])(
    '%s does not inherit the ship hull premium',
    (unit) => {
      expect(matchUnitCost({ pricing: PRICING }, data.units[unit]!)).toEqual({ metal: 38 });
    },
  );

  it('does not alter modules, construction time or ordinary building costs', () => {
    expect(matchCost({ pricing: PRICING }, data.modules.gun!.cost)).toEqual({
      metal: 8,
      credits: 9,
    });
    expect(matchCost({ pricing: PRICING }, { metal: 80 })).toEqual({ metal: 120 });
    expect(matchHours({ pricing: PRICING }, 4)).toBe(8);
  });

  it('treats missing and invalid resource factors as one', () => {
    const pricing = { cost: { metal: 1.5 }, shipCost: { metal: 0, credits: Number.NaN } };
    expect(matchUnitCost({ pricing }, data.units.hull!)).toEqual({
      metal: 83,
      credits: 15,
      microelectronics: 2,
    });
  });
});

describe('ship price payment and recovery', () => {
  const kernel = createKernel([constructionModule]);

  it('charges each hull and its modules separately, then multiplies by quantity', () => {
    const built = ok(kernel.applyAction(state(), build(2, ['gun']), ctx()));
    expect(built.state.players.p1!.resources).toEqual({
      metal: 570,
      credits: 802,
      microelectronics: 988,
    });
    expect(built.state.scheduled.find((e) => e.type === 'construction.complete')?.at).toBe(
      8 * HOUR,
    );
  });

  it('rejects a budget that only covers the old ship price without mutating it', () => {
    const s = state();
    s.players.p1!.resources = { metal: 100, credits: 100, microelectronics: 10 };
    const result = kernel.applyAction(s, build(), ctx());
    expect(result.ok ? 'ok' : result.code).toBe('E_INSUFFICIENT');
    expect(s.players.p1!.resources.metal).toBe(100);
    expect(s.scheduled).toEqual([]);
  });

  it('cancel and resume return and charge only the unbuilt share of the paid price', () => {
    const ordered = ok(kernel.applyAction(state(), build(2, ['gun']), ctx())).state;
    const seq = ordered.scheduled.find((e) => e.type === 'construction.complete')!.seq;
    const cancelled = ok(
      kernel.applyAction(
        ordered,
        action('construction.cancel', { planetId: 'A', seq }),
        ctx(4 * HOUR),
      ),
    ).state;
    expect(cancelled.players.p1!.resources).toEqual({
      metal: 785,
      credits: 901,
      microelectronics: 994,
    });
    const site = cancelled.planets.A!.pausedConstruction![0]!;
    expect(site.remainingCost).toEqual({ metal: 215, credits: 99, microelectronics: 6 });
    const resumed = ok(
      kernel.applyAction(
        cancelled,
        action('construction.resume', { planetId: 'A', id: site.id }),
        ctx(4 * HOUR),
      ),
    ).state;
    expect(resumed.players.p1!.resources).toEqual({
      metal: 570,
      credits: 802,
      microelectronics: 988,
    });
    expect(resumed.scheduled.find((e) => e.type === 'construction.complete')?.at).toBe(8 * HOUR);
  });

  it('waiting orders pay the same ship price when the unit lane becomes free', () => {
    const first = ok(kernel.applyAction(state(), build(), ctx())).state;
    const queued = ok(kernel.applyAction(first, build(), ctx())).state;
    expect(queued.players.p1!.resources).toEqual(first.players.p1!.resources);
    const advanced = kernel.advanceTo(queued, ctx(8 * HOUR));
    if (!advanced.ok) throw new Error(advanced.code);
    expect(advanced.state.players.p1!.resources).toEqual({
      metal: 586,
      credits: 820,
      microelectronics: 988,
    });
  });

  it('an existing match keeps its payment and cancellation amounts', () => {
    const s = state({ cost: PRICING.cost, hours: 2 });
    const ordered = ok(kernel.applyAction(s, build(), ctx())).state;
    expect(ordered.players.p1!.resources.metal).toBe(917);
    const seq = ordered.scheduled.find((e) => e.type === 'construction.complete')!.seq;
    const cancelled = ok(
      kernel.applyAction(
        ordered,
        action('construction.cancel', { planetId: 'A', seq }),
        ctx(4 * HOUR),
      ),
    ).state;
    expect(cancelled.players.p1!.resources.metal).toBe(958.5);
  });
});

it('battle salvage values a lost hull using the same price as construction', () => {
  const emitter: GameModule = {
    id: 'casualty',
    version: '1.0.0',
    setup(api) {
      api.onAction('casualty', (_action, h) => {
        h.emit('unit.died', { battleId: 'B', at: 'A', unit: 'hull', owner: 'p1', count: 2 });
      });
    },
  };
  const kernel = createKernel([emitter, salvageModule]);
  const result = ok(kernel.applyAction(state(), action('casualty', {}), ctx()));
  expect(result.state.salvage?.A?.pool).toEqual({ metal: 414, credits: 180, microelectronics: 12 });
});
