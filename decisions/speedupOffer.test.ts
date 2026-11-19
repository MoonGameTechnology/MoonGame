import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  parseGameData,
  type Context,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';
import { resourceOffer, speedupAnswerFinal, speedupOffer } from './speedupOffer';

/** TEC-3.2: what the player is offered at a running queue. 10 ◆ per hour, +10% per hour,
 *  K = 1.5, the last 5 minutes free. */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  technologies: {},
  events: {},
  timeValue: {
    referenceHour: { metal: 10 },
    weights: { metal: 1 },
    sovereignsPerHour: 10,
    warrantsPerHour: 4,
    speedupCap: 1.5,
    escalation: 0.1,
    freeFinishMinutes: 5,
  },
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

function world(usedHours = 0): GameState {
  const s = createInitialState({ seed: 'so', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: {
      p1: {
        id: 'p1',
        name: 'p1',
        faction: 'x',
        status: 'active',
        resources: {},
        ...(usedHours ? { speedup: { usedHours, day: 1, dayHours: usedHours } } : {}),
      },
    },
  };
}

describe('speedupOffer (TEC-3.2)', () => {
  it('the last free minutes are a free finish, even without a wallet', () => {
    expect(speedupOffer(world(), 'p1', 4 / 60, ctx(24 * HOUR), false)).toEqual({ kind: 'finish' });
    expect(speedupOffer(world(), 'p1', 5 / 60, ctx(24 * HOUR), true)).toEqual({ kind: 'finish' });
  });

  it('a step of one hour priced by the core', () => {
    // A day in: budget 12 h. One hour at +10%: 10 × 1.05 → 11 ◆.
    expect(speedupOffer(world(), 'p1', 6, ctx(24 * HOUR), true)).toEqual({
      kind: 'buy',
      hours: 1,
      price: 11,
      leftHours: 12,
    });
  });

  it('never sells the free tail: the step stops where the free minutes begin', () => {
    const offer = speedupOffer(world(), 'p1', 0.5, ctx(24 * HOUR), true);
    expect(offer).toMatchObject({ kind: 'buy', hours: 25 / 60 });
  });

  it('the step is capped by the budget and floored to a minute', () => {
    // Six hours in: budget 3 h, 2 h 50.5 min used → 9.5 min left → 9 min.
    const offer = speedupOffer(world(2 + 50.5 / 60), 'p1', 6, ctx(6 * HOUR), true);
    expect(offer).toMatchObject({ kind: 'buy', hours: 9 / 60, leftHours: 0 });
  });

  it('nothing to sell when the budget is spent, gold is off or there is no wallet', () => {
    expect(speedupOffer(world(3), 'p1', 6, ctx(6 * HOUR), true)).toEqual({ kind: 'none' });
    const noGold = world();
    noGold.match.goldActions = false;
    expect(speedupOffer(noGold, 'p1', 6, ctx(24 * HOUR), true)).toEqual({ kind: 'none' });
    expect(speedupOffer(world(), 'p1', 6, ctx(24 * HOUR), false)).toEqual({ kind: 'none' });
    expect(speedupOffer(world(), 'p1', 0, ctx(24 * HOUR), true)).toEqual({ kind: 'none' });
  });

  it('the remaining budget is floored to 10 minutes', () => {
    // Ten hours in: budget 5 h, 1 h 47 min used → 3 h 13 min → 3 h 10 min.
    const offer = speedupOffer(world(1 + 47 / 60), 'p1', 6, ctx(10 * HOUR), true);
    expect(offer.kind === 'buy' && Math.round(offer.leftHours * 60)).toBe(190);
  });
});

describe('resourceOffer (TEC-4)', () => {
  it('an hour of the resource at the speed-up price', () => {
    // 10 metal per hour, weight 1 → 1 ЭЧ = 10 metal; the first hour costs 11 ◆.
    expect(resourceOffer(world(), 'p1', 'metal', ctx(24 * HOUR), true)).toEqual({ hours: 1, amount: 10, price: 11, leftHours: 12 });
  });

  it('the rest of the budget when less than an hour is left', () => {
    expect(resourceOffer(world(2.5), 'p1', 'metal', ctx(6 * HOUR), true)).toMatchObject({ hours: 0.5, amount: 5 });
  });

  it('nothing without a wallet, gold, budget or a priced resource', () => {
    expect(resourceOffer(world(), 'p1', 'metal', ctx(24 * HOUR), false)).toBeNull();
    expect(resourceOffer(world(3), 'p1', 'metal', ctx(6 * HOUR), true)).toBeNull();
    expect(resourceOffer(world(), 'p1', 'credits', ctx(24 * HOUR), true)).toBeNull();
    const noGold = world();
    noGold.match.goldActions = false;
    expect(resourceOffer(noGold, 'p1', 'metal', ctx(24 * HOUR), true)).toBeNull();
  });
});

describe('speedup answers', () => {
  it('only an unknown answer is retried with the same request id', () => {
    expect(speedupAnswerFinal(503)).toBe(false);
    expect(speedupAnswerFinal(0)).toBe(false);
    expect(speedupAnswerFinal(401)).toBe(false);
    for (const status of [200, 400, 403, 404, 409, 429]) expect(speedupAnswerFinal(status)).toBe(true);
  });
});
