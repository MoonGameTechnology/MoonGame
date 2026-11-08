import { describe, expect, it } from 'vitest';
import {
  combatModule,
  constructionModule,
  createInitialState,
  createKernel,
  fleetOpsModule,
  movementModule,
  orbitalModule,
  parseGameData,
  type Action,
  type Fleet,
  type GameState,
} from '../index';

// Часы флота принадлежат его кораблям: раскол и слияние не должны их сбрасывать
// (ponytail-аудит 2026-11-08). Иначе одно нажатие обходило задержку щитов после
// попадания, перезарядку ПРО и час между залпами обстрела.
const MIN = 60_000;
const data = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  factions: {},
  events: {},
  units: {
    ship: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 10, defense: 10, hp: 1000, shield: 1000, speed: 10 },
    },
  },
  buildings: { fort: { name: 'Fort', hp: 10000 } },
});
const kernel = createKernel([
  constructionModule,
  movementModule,
  orbitalModule,
  combatModule,
  fleetOpsModule,
]);

function fleet(id: string, extra: Partial<Fleet> = {}): Fleet {
  return {
    id,
    owner: 'p1',
    location: 'P',
    movement: null,
    orbit: 'near',
    units: [{ unit: 'ship', count: 4 }],
    landing: [],
    traits: [],
    ...extra,
  };
}
function world(owner: string): GameState {
  return {
    ...createInitialState({ seed: 'fleet-clocks', version: { data: '0.1.0', manifest: '1' } }),
    players: Object.fromEntries(
      ['p1', 'p2'].map((id) => [
        id,
        { id, name: id, faction: 'x', status: 'active' as const, resources: {} },
      ]),
    ),
    planets: {
      P: {
        id: 'P',
        owner,
        position: { x: 0, y: 0 },
        links: [],
        resources: {},
        traits: [],
        buildings: [{ type: 'fort', level: 1, hp: 10000 }],
        garrison: [],
      },
    },
    fleets: { A: fleet('A'), S: fleet('S') },
    battles: {},
  };
}
function act(state: GameState, type: string, payload: unknown): GameState {
  const r = kernel.applyAction(
    state,
    { id: `t:${type}`, type, playerId: 'p1', payload, issuedAt: state.time } as Action,
    { now: state.time, data },
  );
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(state: GameState, now: number): GameState {
  const r = kernel.advanceTo(state, { now, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const shields = (f: Fleet | undefined) => (f?.units ?? []).map((s) => s.shieldHp);

describe('fleet clocks survive split and merge', () => {
  it('a split-off part of a just-hit fleet waits out the shield delay too', () => {
    let s = world('p1');
    s.fleets.A = fleet('A', { units: [{ unit: 'ship', count: 4, shieldHp: 400 }], lastDamagedAt: 0 });
    s = act(s, 'fleet.split', { fleetId: 'A', take: [{ unit: 'ship', count: 2 }] });
    const part = Object.values(s.fleets).find((f) => f.id !== 'A' && f.id !== 'S')!;
    expect(part.lastDamagedAt).toBe(0);
    s = advance(s, s.time + 30 * MIN);
    expect(shields(s.fleets.A)).toEqual([200]);
    expect(shields(s.fleets[part.id])).toEqual([200]);
  });

  it('merging a just-hit fleet into a fresh one keeps the shield delay', () => {
    let s = world('p1');
    s.fleets.A = fleet('A', { units: [{ unit: 'ship', count: 3, shieldHp: 300 }], lastDamagedAt: 0 });
    s = act(s, 'fleet.merge', { from: 'A', into: 'S' });
    expect(s.fleets.S!.lastDamagedAt).toBe(0);
    s = advance(s, s.time + 30 * MIN);
    expect(shields(s.fleets.S).filter((v) => v !== undefined)).toEqual([300]);
  });

  it('point-defense reload rides with the ships, the later deadline wins', () => {
    let s = world('p1');
    s.fleets.A = fleet('A', { pdCooldownUntil: 20 * MIN });
    s.fleets.S = fleet('S', { pdCooldownUntil: 5 * MIN });
    s = act(s, 'fleet.split', { fleetId: 'A', take: [{ unit: 'ship', count: 1 }] });
    const part = Object.values(s.fleets).find((f) => f.id !== 'A' && f.id !== 'S')!;
    expect(part.pdCooldownUntil).toBe(20 * MIN);
    s = act(s, 'fleet.merge', { from: 'A', into: 'S' });
    expect(s.fleets.S!.pdCooldownUntil).toBe(20 * MIN);
  });

  it('a cloak break is stamped only on a fleet that carries the field', () => {
    let s = world('p1');
    s.fleets.A = fleet('A', { cloakBrokenUntil: 60 * MIN });
    s = act(s, 'fleet.merge', { from: 'A', into: 'S' });
    expect(s.fleets.S!.cloakBrokenUntil).toBeUndefined();
  });

  it('ships that just fired a bombardment volley do not fire again on a merged earlier clock', () => {
    let s = world('p2');
    s.fleets.A = fleet('A', { units: [{ unit: 'ship', count: 30 }] });
    s.fleets.S = fleet('S', { units: [{ unit: 'ship', count: 1 }] });
    s = act(s, 'fleet.bombard', { fleetId: 'S', on: true }); // volley at +60m
    s = advance(s, s.time + 50 * MIN);
    s = act(s, 'fleet.bombard', { fleetId: 'A', on: true }); // volley at +110m
    s = advance(s, s.time + 60 * MIN + 1000); // A just fired; S fires at +120m
    expect(s.fleets.A!.bombardNextAt! - s.time).toBeGreaterThan(59 * MIN);
    s = act(s, 'fleet.merge', { from: 'S', into: 'A' });
    expect(s.fleets.A!.bombardNextAt! - s.time).toBeGreaterThan(59 * MIN);
    // Either direction keeps the later deadline.
    let t = world('p2');
    t.fleets.A = fleet('A', { bombarding: true, bombardNextAt: 50 * MIN });
    t.fleets.S = fleet('S', { bombarding: true, bombardNextAt: 10 * MIN });
    t = act(t, 'fleet.merge', { from: 'A', into: 'S' });
    expect(t.fleets.S!.bombardNextAt).toBe(50 * MIN);
  });
});
