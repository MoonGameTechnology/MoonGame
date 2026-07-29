import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { forcedMarchModule, FORCED_MARCH_MULT, FORCED_MARCH_WEAR } from './forcedMarch';
import { movementModule } from './movement';
import { sectorModule } from './sector';
import { planetTypeModule } from './planetType';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

// forcedMarch — BOOST-1 "Ускорить": +50% скорость флота ценой 5% max-hp износа в
// час хода. Порт прототипного forcedMarchModule (prototype/src/forcedMarch.ts,
// REFP-16). Ни один тест не завязан на ИИ/бота.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 10, hp: 100 } },
  },
  factions: {},
  buildings: {},
  events: {},
});
const ctx: Context = { now: 0, data };

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function planet(id: string, x: number, y: number, links: string[] = []): Planet {
  return {
    id,
    owner: null,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function fleet(id: string, owner: string, location: string, units: Array<[string, number, number?]>): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count, hp]) => ({ unit, count, ...(hp !== undefined ? { hp } : {}) })),
    traits: [],
  };
}
function stateWith(opts: { players?: Player[]; planets?: Planet[]; fleets?: Fleet[] }): GameState {
  const s = createInitialState({ seed: 'fm', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  return { ...s, players, planets, fleets };
}
function act(fleetId: string, on: boolean, playerId = 'p1'): Action {
  return { id: `a:${playerId}:1`, type: 'fleet.forcemarch', playerId, payload: { fleetId, on }, issuedAt: 0 };
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

describe('forcedMarch — fleet.forcemarch (arm/disarm)', () => {
  it('arms and disarms the flag for an owned fleet', () => {
    const kernel = createKernel([forcedMarchModule]);
    const s = stateWith({ players: [player('p1')], planets: [planet('A', 0, 0)], fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]])] });
    let r = okApply(kernel.applyAction(s, act('f1', true), ctx));
    expect(r.state.forcedMarch).toEqual({ f1: true });
    r = okApply(kernel.applyAction(r.state, act('f1', false), ctx));
    expect(r.state.forcedMarch).toBeUndefined();
  });

  it('rejects a bad payload, a missing/foreign fleet, and a poisoned __proto__ id', () => {
    const kernel = createKernel([forcedMarchModule]);
    const s = stateWith({
      players: [player('p1'), player('p2')],
      fleets: [fleet('f2', 'p2', 'A', [['cruiser', 1]])],
    });
    expect(errCode(kernel.applyAction(s, { ...act('f1', true), payload: { fleetId: 'f1' } }, ctx))).toBe(
      'E_BAD_PAYLOAD',
    );
    expect(errCode(kernel.applyAction(s, act('missing', true), ctx))).toBe('E_NO_FLEET');
    expect(errCode(kernel.applyAction(s, act('f2', true), ctx))).toBe('E_NO_FLEET'); // p2's fleet
    expect(errCode(kernel.applyAction(s, act('__proto__', true), ctx))).toBe('E_NO_FLEET');
  });
});

describe('forcedMarch — fleet.speed hook', () => {
  it('speeds up an in-transit fleet by 1.5× and wears its hull over time', () => {
    const kernel = createKernel([sectorModule, planetTypeModule, movementModule, forcedMarchModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 0, 0, ['B']), planet('B', 100, 0, ['A'])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 200]])], // 2×100hp = 200 full
    });
    let r = okApply(kernel.applyAction(s, act('f1', true), ctx));
    r = okApply(
      kernel.applyAction(
        r.state,
        { id: 'a:p1:2', type: 'fleet.move', playerId: 'p1', payload: { fleetId: 'f1', to: 'B' }, issuedAt: 0 },
        ctx,
      ),
    );
    const baseHours = 100 / 10; // distance 100 / base speed 10
    const boostedHours = baseHours / FORCED_MARCH_MULT;
    const arrivesAt = r.state.fleets.f1?.movement?.arrivesAt;
    expect(arrivesAt).toBeCloseTo(boostedHours * 3_600_000, -1);

    // Advance halfway through the march and check wear accrued continuously.
    const halfway = boostedHours * 3_600_000 * 0.5;
    const advanced = okAdvance(kernel.advanceTo(r.state, { ...ctx, now: halfway }));
    const expectedWear = 200 * FORCED_MARCH_WEAR * (halfway / 3_600_000);
    expect(advanced.state.fleets.f1?.units[0]?.hp).toBeCloseTo(200 - expectedWear, 5);
  });

  it('a fleet not on the list travels at base speed and takes no wear', () => {
    const kernel = createKernel([sectorModule, planetTypeModule, movementModule, forcedMarchModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 0, 0, ['B']), planet('B', 100, 0, ['A'])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 200]])],
    });
    const r = okApply(
      kernel.applyAction(
        s,
        { id: 'a:p1:1', type: 'fleet.move', playerId: 'p1', payload: { fleetId: 'f1', to: 'B' }, issuedAt: 0 },
        ctx,
      ),
    );
    const baseHours = 100 / 10;
    expect(r.state.fleets.f1?.movement?.arrivesAt).toBeCloseTo(baseHours * 3_600_000, -1);
    const advanced = okAdvance(kernel.advanceTo(r.state, { ...ctx, now: baseHours * 3_600_000 * 0.5 }));
    expect(advanced.state.fleets.f1?.units[0]?.hp).toBe(200);
  });

  it('clears the flag on arrival', () => {
    const kernel = createKernel([sectorModule, planetTypeModule, movementModule, forcedMarchModule]);
    const s = stateWith({
      players: [player('p1')],
      planets: [planet('A', 0, 0, ['B']), planet('B', 100, 0, ['A'])],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 2, 200]])],
    });
    let r = okApply(kernel.applyAction(s, act('f1', true), ctx));
    r = okApply(
      kernel.applyAction(
        r.state,
        { id: 'a:p1:2', type: 'fleet.move', playerId: 'p1', payload: { fleetId: 'f1', to: 'B' }, issuedAt: 0 },
        ctx,
      ),
    );
    const arrivesAt = r.state.fleets.f1!.movement!.arrivesAt;
    const advanced = okAdvance(kernel.advanceTo(r.state, { ...ctx, now: arrivesAt }));
    expect(advanced.state.forcedMarch).toBeUndefined();
    expect(advanced.state.fleets.f1?.location).toBe('B');
  });
});
