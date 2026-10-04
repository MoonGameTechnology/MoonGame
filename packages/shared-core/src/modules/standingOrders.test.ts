import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { standingOrdersModule } from './standingOrders';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// standingOrders — CC-1 order chains + CC-2 auto-storm + RETR-2 auto-retreat.
// Был портом прототипного `standingOrdersModule` (REFP-15; с CONV-7 копии нет,
// REFP-15). Only the client-facing intent (order.auto/order.retreat/order.chain) and
// the server-driver-only runtime stamp (chain.stamp — no gate schema, a client can
// never reach it); the actual storm/chain driver stays out of scope (a server-side
// orchestration loop calling applyAction repeatedly, not a kernel module). Дежурного
// вылета (CC-4, `order.scramble`) больше нет: его заменил «Держать патруль» (SHU-6.6).
// No test here simulates an AI/bot decision loop — every fixture is an explicit action.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
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
  it('СНИМАЕТ приказы мёртвых флотов, приказы живых остаются', () => {
    const kernel = createKernel([standingOrdersModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]]), fleet('f2', 'p1', 'A')],
    });
    let r = okApply(kernel.applyAction(s, act('order.auto', 'p1', { fleetId: 'f2', on: true }), ctx));
    r = okApply(kernel.applyAction(r.state, act('order.auto', 'p1', { fleetId: 'f1', on: true }), ctx));
    r = okApply(
      kernel.applyAction(
        r.state,
        act('order.chain', 'p1', { fleetId: 'f2', steps: [{ kind: 'assault' }] }),
        ctx,
      ),
    );
    // Убираем f2 целиком — его приказы должны уйти, авто-штурм живого f1 остаться.
    const withoutF2: GameState = { ...r.state, fleets: { f1: r.state.fleets.f1! } };
    const advanced = okAdvance(kernel.advanceTo(withoutF2, { ...ctx, now: 1 }));
    expect(advanced.state.autoAssault).toEqual({ f1: true });
    expect(advanced.state.orders).toBeUndefined();
  });
});

describe('order.retreat — приказ на авто-отступление (RETR-2)', () => {
  const kernel = createKernel([standingOrdersModule]);
  const base = (): GameState =>
    stateWith({
      players: [player('p1')],
      planets: [planet('H', 'p1')],
      fleets: [fleet('A', 'p1', 'H')],
    });
  const arm = (at: unknown, to: unknown = 'H') =>
    act('order.retreat', 'p1', { fleetId: 'A', on: true, at, to });

  it('ставит порог и точку отхода', () => {
    const r = okApply(kernel.applyAction(base(), arm(0.3), ctx));
    expect(r.state.autoRetreat?.A).toEqual({ at: 0.3, to: 'H' });
  });

  it.each([0.2, 0.3, 0.4, 0.5])('ступень %s принимается', (at) => {
    expect(okApply(kernel.applyAction(base(), arm(at), ctx)).state.autoRetreat?.A?.at).toBe(at);
  });

  it('порог ВНЕ списка ступеней отбивается — это не свободное число', () => {
    expect(errCode(kernel.applyAction(base(), arm(0.35), ctx))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(base(), arm(0), ctx))).toBe('E_BAD_PAYLOAD');
    expect(errCode(kernel.applyAction(base(), arm('низко'), ctx))).toBe('E_BAD_PAYLOAD');
  });

  it('несуществующая точка отхода отбивается', () => {
    expect(errCode(kernel.applyAction(base(), arm(0.3, 'НЕТ_ТАКОГО'), ctx))).toBe(
      'E_NO_DESTINATION',
    );
  });

  it('чужой флот не армится — один непрозрачный код, как у соседей', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('H', 'p1')],
      fleets: [fleet('A', 'p2', 'H')],
    });
    expect(errCode(kernel.applyAction(s, arm(0.3), ctx))).toBe('E_NO_FLEET');
  });

  it('снимается одним `on: false`, без порога и точки', () => {
    const armed = okApply(kernel.applyAction(base(), arm(0.3), ctx)).state;
    const off = okApply(
      kernel.applyAction(armed, act('order.retreat', 'p1', { fleetId: 'A', on: false }), ctx),
    );
    expect(off.state.autoRetreat).toBeUndefined(); // пустая карта убирается целиком
  });

  it('приказ погибшего флота убирается ходом часов', () => {
    const armed = okApply(kernel.applyAction(base(), arm(0.3), ctx)).state;
    const orphaned: GameState = { ...armed, fleets: {} };
    const advanced = okAdvance(kernel.advanceTo(orphaned, { now: 3_600_000, data }));
    expect(advanced.state.autoRetreat).toBeUndefined();
  });
});
