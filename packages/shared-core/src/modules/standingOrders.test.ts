import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { standingOrdersModule } from './standingOrders';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// standingOrders — CC-1 order chains + CC-2 auto-storm + CC-4 дежурный вылет.
// Port of the prototype's proven `standingOrdersModule` (prototype/src/standingOrders.ts,
// REFP-15). Only the client-facing intent (order.auto/order.scramble/order.chain) and
// the two server-driver-only runtime stamps (patrol.stamp/chain.stamp — no gate schema,
// a client can never reach them); the actual scramble/chain driver stays out of scope
// (a server-side orchestration loop calling applyAction repeatedly, not a kernel module).
// No test here simulates an AI/bot decision loop — every fixture is an explicit action.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    carrier: {
      faction: 'x',
      domain: 'space',
      traits: ['squadron'],
      stats: { attack: 2, defense: 2, speed: 6, hp: 30, fuel: 2, rearmRounds: 3, strikeRange: 50 },
    },
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 5, defense: 5, speed: 6, hp: 40 },
    },
  },
  factions: {},
  buildings: {},
  events: {},
  // one real ability so an `ability` chain step can name it (CC-1 × HERO-4)
  heroAbilities: { corridor: { name: 'Corridor', type: 'temp_lane' } },
});
const ctx: Context = { now: 0, data };

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function planet(id: string, owner: string | null): Planet {
  return {
    id,
    owner,
    position: { x: 10, y: 20 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function fleet(
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number]> = [],
): Fleet {
  return { id, owner, location, movement: null, units: units.map(([unit, count]) => ({ unit, count })), traits: [] };
}
function stateWith(opts: { players?: Player[]; planets?: Planet[]; fleets?: Fleet[] }): GameState {
  const s = createInitialState({ seed: 'so', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  return { ...s, players, planets, fleets };
}
function act(type: string, playerId: string, payload: unknown): Action {
  return { id: `a:${playerId}:1`, type, playerId, payload, issuedAt: 0 };
}
function okApply(r: ApplyResult) {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
function okAdvance<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('advanceTo failed');
  return r as Extract<T, { ok: true }>;
}

describe('standingOrders — order.auto (CC-2 auto-storm)', () => {
  it('arms and disarms a flag for an owned fleet', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({ players: [player('p1')], fleets: [fleet('f1', 'p1', 'A')] });
    let r = okApply(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: 'f1', on: true }), ctx));
    expect(r.state.autoAssault).toEqual({ f1: true });
    r = okApply(kernel.applyAction(r.state, act('order.auto', 'p1', { fleetId: 'f1', on: false }), ctx));
    expect(r.state.autoAssault).toBeUndefined();
  });

  it('rejects a bad payload, a missing fleet, and a foreign fleet', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [fleet('f2', 'p2', 'A')],
    });
    expect(errCode(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: 'f2' }), ctx))).toBe(
      'E_BAD_PAYLOAD',
    );
    expect(
      errCode(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: 'missing', on: true }), ctx)),
    ).toBe('E_NO_FLEET');
    expect(
      errCode(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: 'f2', on: true }), ctx)),
    ).toBe('E_NO_FLEET'); // owned-key lookup: another player's fleet reads as absent
  });

  it('rejects a poisoned __proto__ fleet id', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({ players: [player('p1')] });
    expect(
      errCode(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: '__proto__', on: true }), ctx)),
    ).toBe('E_NO_FLEET');
  });
});

describe('standingOrders — order.scramble (CC-4 standing patrol)', () => {
  function withCarrier() {
    return stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A', [['carrier', 1]])],
    });
  }

  it('arms a patrol at the fleet\'s current position with a fresh sortie', () => {
    const kernel = createKernel([standingOrdersModule]);
    const r = okApply(
      kernel.applyAction(withCarrier(), act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx),
    );
    expect(r.state.patrols?.f1).toMatchObject({
      center: { x: 10, y: 20 },
      radius: 50,
      sortie: { fuel: 2, rearming: 0 },
      rearmAt: 3_600_000,
    });
  });

  it('disarming stashes the current sortie into wingSorties and clears the patrol', () => {
    const kernel = createKernel([standingOrdersModule]);
    let r = okApply(
      kernel.applyAction(withCarrier(), act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx),
    );
    r = okApply(kernel.applyAction(r.state, act('order.scramble', 'p1', { fleetId: 'f1', on: false }), ctx));
    expect(r.state.patrols).toBeUndefined();
    expect(r.state.wingSorties?.f1).toEqual({ fuel: 2, rearming: 0 });
  });

  it('re-arming carries the stashed sortie forward instead of resetting it', () => {
    const kernel = createKernel([standingOrdersModule]);
    let r = okApply(
      kernel.applyAction(withCarrier(), act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx),
    );
    r = okApply(kernel.applyAction(r.state, act('patrol.stamp', 'p1', {
      fleetId: 'f1',
      sortie: { fuel: 0, rearming: 3 },
    }), ctx));
    r = okApply(kernel.applyAction(r.state, act('order.scramble', 'p1', { fleetId: 'f1', on: false }), ctx));
    r = okApply(kernel.applyAction(r.state, act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx));
    expect(r.state.patrols?.f1?.sortie).toEqual({ fuel: 0, rearming: 3 });
  });

  it('rejects a fleet with no squadron ships, and a busy fleet', () => {
    const kernel = createKernel([standingOrdersModule]);
    const bare = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]])],
    });
    expect(
      errCode(kernel.applyAction(bare, act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx)),
    ).toBe('E_NO_SHIPS');

    const busy = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [
        {
          ...fleet('f1', 'p1', 'A', [['carrier', 1]]),
          movement: { to: 'B', from: 'A', departedAt: 0, arrivesAt: 100 },
        },
      ],
    });
    expect(
      errCode(kernel.applyAction(busy, act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx)),
    ).toBe('E_CONDITIONS_UNMET');
  });
});

describe('standingOrders — patrol.stamp (server-driver runtime stamp)', () => {
  it('updates the sortie and optional rearmAt on an armed patrol', () => {
    const kernel = createKernel([standingOrdersModule]);
    const r0 = okApply(
      kernel.applyAction(
        stateWith({
          players: [player('p1')],
          planets: [planet('A', 'p1')],
          fleets: [fleet('f1', 'p1', 'A', [['carrier', 1]])],
        }),
        act('order.scramble', 'p1', { fleetId: 'f1', on: true }),
        ctx,
      ),
    );
    const r = okApply(
      kernel.applyAction(
        r0.state,
        act('patrol.stamp', 'p1', { fleetId: 'f1', sortie: { fuel: 1, rearming: 0 }, rearmAt: 999 }),
        ctx,
      ),
    );
    expect(r.state.patrols?.f1?.sortie).toEqual({ fuel: 1, rearming: 0 });
    expect(r.state.patrols?.f1?.rearmAt).toBe(999);
  });

  it('rejects when there is no armed patrol, or an out-of-range sortie', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A', [['carrier', 1]])],
    });
    expect(
      errCode(
        kernel.applyAction(s, act('patrol.stamp', 'p1', { fleetId: 'f1', sortie: { fuel: 0, rearming: 0 } }), ctx),
      ),
    ).toBe('E_NO_TARGET');

    const r0 = okApply(kernel.applyAction(s, act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx));
    expect(
      errCode(
        kernel.applyAction(
          r0.state,
          act('patrol.stamp', 'p1', { fleetId: 'f1', sortie: { fuel: 99, rearming: 0 } }),
          ctx,
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
  });
});

describe('standingOrders — order.chain (CC-1 order queue)', () => {
  it('sets a validated chain, and clearing with [] removes it', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1'), planet('B', null)],
      fleets: [fleet('f1', 'p1', 'A')],
    });
    let r = okApply(
      kernel.applyAction(
        s,
        act('order.chain', 'p1', { fleetId: 'f1', steps: [{ kind: 'move', to: 'B' }, { kind: 'assault' }] }),
        ctx,
      ),
    );
    expect(r.state.orders?.f1?.steps).toEqual([{ kind: 'move', to: 'B' }, { kind: 'assault' }]);
    r = okApply(kernel.applyAction(r.state, act('order.chain', 'p1', { fleetId: 'f1', steps: [] }), ctx));
    expect(r.state.orders).toBeUndefined();
  });

  it('rejects a step naming an unknown world', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A')],
    });
    expect(
      errCode(
        kernel.applyAction(
          s,
          act('order.chain', 'p1', { fleetId: 'f1', steps: [{ kind: 'move', to: 'missing' }] }),
          ctx,
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
  });

  // The `ability` arm diverged between the three copies once (solo accepted the step,
  // a gated server rejected the whole plan) — these two pin the core validator to the
  // prototype's semantics so the vocabularies can't drift apart silently again.
  it('accepts an ability step naming a real ability (CC-1 × HERO-4)', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1'), planet('B', null)],
      fleets: [fleet('f1', 'p1', 'A')],
    });
    const r = okApply(
      kernel.applyAction(
        s,
        act('order.chain', 'p1', {
          fleetId: 'f1',
          steps: [
            { kind: 'move', to: 'B' },
            { kind: 'ability', abilityId: 'corridor', target: 'B' },
          ],
        }),
        ctx,
      ),
    );
    expect(r.state.orders?.f1?.steps).toEqual([
      { kind: 'move', to: 'B' },
      { kind: 'ability', abilityId: 'corridor', target: 'B' },
    ]);
  });

  it('rejects an ability step naming an unknown ability', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A')],
    });
    expect(
      errCode(
        kernel.applyAction(
          s,
          act('order.chain', 'p1', {
            fleetId: 'f1',
            steps: [{ kind: 'ability', abilityId: 'bogus' }],
          }),
          ctx,
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
  });
});

describe('standingOrders — chain.stamp (server-driver runtime stamp)', () => {
  it('replaces the chain and stamps waitUntil', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1'), planet('B', null)],
      fleets: [fleet('f1', 'p1', 'A')],
    });
    const r0 = okApply(
      kernel.applyAction(
        s,
        act('order.chain', 'p1', { fleetId: 'f1', steps: [{ kind: 'wait', hours: 2 }] }),
        ctx,
      ),
    );
    const r = okApply(
      kernel.applyAction(
        r0.state,
        act('chain.stamp', 'p1', { fleetId: 'f1', steps: [{ kind: 'wait', hours: 2 }], waitUntil: 500 }),
        ctx,
      ),
    );
    expect(r.state.orders?.f1).toEqual({ steps: [{ kind: 'wait', hours: 2 }], waitUntil: 500 });
  });

  it('rejects when the fleet has no chain to advance', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A')],
    });
    expect(
      errCode(kernel.applyAction(s, act('chain.stamp', 'p1', { fleetId: 'f1', steps: [] }), ctx)),
    ).toBe('E_NO_TARGET');
  });
});

describe('standingOrders — time.advanced garbage-collects dead fleets', () => {
  it('drops autoAssault/patrols/wingSorties/orders entries for fleets that no longer exist', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A', [['carrier', 1]]), fleet('f2', 'p1', 'A')],
    });
    let r = okApply(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: 'f2', on: true }), ctx));
    r = okApply(kernel.applyAction(r.state, act('order.scramble', 'p1', { fleetId: 'f1', on: true }), ctx));
    r = okApply(
      kernel.applyAction(r.state, act('order.chain', 'p1', { fleetId: 'f2', steps: [{ kind: 'assault' }] }), ctx),
    );
    // remove f2 entirely, then let a time.advanced pass sweep its orphaned entries
    const withoutF2: GameState = { ...r.state, fleets: { f1: r.state.fleets.f1! } };
    const advanced = okAdvance(kernel.advanceTo(withoutF2, { ...ctx, now: 1 }));
    expect(advanced.state.autoAssault).toBeUndefined();
    expect(advanced.state.orders).toBeUndefined();
    expect(advanced.state.patrols?.f1).toBeDefined(); // f1 still alive — untouched
  });
});
