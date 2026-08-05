import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  setStance,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '@void/shared-core';
import { parseGameData, createKernel, type Action, type GameData, type Context } from '@void/shared-core';
import { autoAssaultActions, patrolActions, standingOrderTickActions } from './standingOrderDriver';
import { DEV_MODULES } from './scenario';

// standingOrderDriver — the CC-2/CC-4 "who decides, and when" half of
// standingOrdersModule. Pure functions over explicit state: no AI/bot decision
// loop anywhere — every fixture below is a hand-built GameState.

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
  sectorKinds: {
    homeworld: { scoreValue: 10, capturable: true, buildable: true, orbit: true },
  },
});

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function planet(id: string, owner: string | null, x = 0, y = 0, links: string[] = []): Planet {
  return {
    id,
    owner,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    kind: 'homeworld',
  };
}
function fleet(
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number]> = [],
  extra: Partial<Fleet> = {},
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    traits: [],
    ...extra,
  };
}
function stateWith(opts: {
  players?: Player[];
  planets?: Planet[];
  fleets?: Fleet[];
  autoAssault?: GameState['autoAssault'];
  patrols?: GameState['patrols'];
}): GameState {
  const s = createInitialState({ seed: 'sod', version: { data: '0.1.0', manifest: '1' } });
  const players: Record<string, Player> = {};
  for (const x of opts.players ?? []) players[x.id] = x;
  const planets: Record<string, Planet> = {};
  for (const x of opts.planets ?? []) planets[x.id] = x;
  const fleets: Record<string, Fleet> = {};
  for (const x of opts.fleets ?? []) fleets[x.id] = x;
  return {
    ...s,
    players,
    planets,
    fleets,
    ...(opts.autoAssault ? { autoAssault: opts.autoAssault } : {}),
    ...(opts.patrols ? { patrols: opts.patrols } : {}),
  };
}

// RULES-3. Проба — НАСТОЯЩЕЕ ядро (DEV_MODULES), а не заглушка: драйвер больше не
// переписывает правила штурма, он их спрашивает, и тест обязан спрашивать так же.
// Заглушка здесь превратила бы сторожа в проверку самого себя.
const probeKernel = createKernel(DEV_MODULES);
const probe = (state: GameState, actions: readonly Action[]): string | null =>
  probeKernel.canApplyAll(state, actions, { now: state.time, data });

describe('autoAssaultActions — CC-2', () => {
  it('orbits then storms a flagged fleet at an idle, at-war, capturable foreign world', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2')],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]])],
      autoAssault: { f1: true },
    });
    setStance(s, 'p1', 'p2', 'war');
    const out = autoAssaultActions(s, probe);
    expect(out.map((a) => a.action.type)).toEqual(['fleet.orbit', 'fleet.assault']);
    expect(out.every((a) => a.playerId === 'p1')).toBe(true);
    expect(out[0]!.action.payload).toEqual({ fleetId: 'f1', orbit: 'near' });
  });

  it('skips straight to assault when already in orbit', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2')],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]], { orbit: 'near' })],
      autoAssault: { f1: true },
    });
    setStance(s, 'p1', 'p2', 'war');
    const out = autoAssaultActions(s, probe);
    expect(out.map((a) => a.action.type)).toEqual(['fleet.assault']);
  });

  it('holds fire at peace, on own worlds, mid-battle/transit, or with an enemy already there', () => {
    const dock = (extra: Partial<Fleet> = {}) =>
      stateWith({
        players: [player('p1'), player('p2')],
        planets: [planet('A', 'p2')],
        fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]], extra)],
        autoAssault: { f1: true },
      });

    const atPeace = dock();
    setStance(atPeace, 'p1', 'p2', 'peace');
    expect(autoAssaultActions(atPeace, probe)).toEqual([]);

    const ownWorld = stateWith({
      players: [player('p1')],
      planets: [planet('A', 'p1')],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]])],
      autoAssault: { f1: true },
    });
    expect(autoAssaultActions(ownWorld, probe)).toEqual([]);

    const inBattle = dock({ battleId: 'b1' });
    setStance(inBattle, 'p1', 'p2', 'war');
    expect(autoAssaultActions(inBattle, probe)).toEqual([]);

    const inTransit = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2'), planet('B', null)],
      fleets: [
        {
          ...fleet('f1', 'p1', null, [['cruiser', 1]]),
          movement: { to: 'A', from: 'B', departedAt: 0, arrivesAt: 100 },
        },
      ],
      autoAssault: { f1: true },
    });
    setStance(inTransit, 'p1', 'p2', 'war');
    expect(autoAssaultActions(inTransit, probe)).toEqual([]);

    const contested = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2')],
      fleets: [
        fleet('f1', 'p1', 'A', [['cruiser', 1]]),
        fleet('f2', 'p2', 'A', [['cruiser', 1]]),
      ],
      autoAssault: { f1: true },
    });
    setStance(contested, 'p1', 'p2', 'war');
    expect(autoAssaultActions(contested, probe)).toEqual([]);
  });
});

describe('patrolActions — CC-4', () => {
  function withPatrol(opts: {
    sortie?: { fuel: number; rearming: number };
    rearmAt?: number;
    targets?: Fleet[];
    stance?: 'war' | 'peace';
  }) {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0, ['B']), planet('B', 'p2', 10, 0, ['A'])],
      fleets: [fleet('f1', 'p1', 'A', [['carrier', 1]]), ...(opts.targets ?? [])],
      patrols: {
        f1: {
          center: { x: 0, y: 0 },
          radius: 50,
          sortie: opts.sortie ?? { fuel: 2, rearming: 0 },
          ...(opts.rearmAt !== undefined ? { rearmAt: opts.rearmAt } : {}),
        },
      },
    });
    setStance(s, 'p1', 'p2', opts.stance ?? 'war');
    return s;
  }

  it('scrambles at a co-located identified enemy — engage, and stamps the spent sortie', () => {
    const s = withPatrol({ targets: [fleet('f2', 'p2', 'A', [['cruiser', 1]])] });
    const out = patrolActions(s, data, 0);
    const strike = out.find((a) => a.action.type !== 'patrol.stamp');
    expect(strike?.action.type).toBe('fleet.engage');
    expect(strike?.action.payload).toEqual({ fleetId: 'f1', targetId: 'f2' });
    const stamp = out.find((a) => a.action.type === 'patrol.stamp');
    expect(stamp?.action.payload).toMatchObject({ fleetId: 'f1', sortie: { fuel: 1, rearming: 0 } });
  });

  it('moves to intercept when the enemy is elsewhere but in range', () => {
    const s = withPatrol({ targets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])] });
    const out = patrolActions(s, data, 0);
    const strike = out.find((a) => a.action.type !== 'patrol.stamp');
    expect(strike?.action.type).toBe('fleet.move');
    expect(strike?.action.payload).toEqual({ fleetId: 'f1', to: 'B' });
  });

  it('holds fire with no fuel, at peace, or out of range', () => {
    const dry = withPatrol({
      sortie: { fuel: 0, rearming: 3 },
      targets: [fleet('f2', 'p2', 'A', [['cruiser', 1]])],
    });
    expect(patrolActions(dry, data, 0).some((a) => a.action.type !== 'patrol.stamp')).toBe(false);

    const peace = withPatrol({
      rearmAt: 1_000_000, // already armed, far in the future — a bare re-evaluation at
      // now=0 must not itself produce a rearmAt-changed stamp
      targets: [fleet('f2', 'p2', 'A', [['cruiser', 1]])],
      stance: 'peace',
    });
    expect(patrolActions(peace, data, 0)).toEqual([]);

    const farAway = withPatrol({ rearmAt: 1_000_000, targets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])] });
    farAway.planets.B!.position = { x: 9999, y: 0 };
    expect(patrolActions(farAway, data, 0)).toEqual([]);
  });

  it('rearms on the game-hour cadence when overdue', () => {
    const HOUR = 3_600_000;
    const s = withPatrol({ sortie: { fuel: 0, rearming: 3 }, rearmAt: 0 });
    const out = patrolActions(s, data, HOUR * 3); // 3 rounds due
    const stamp = out.find((a) => a.action.type === 'patrol.stamp');
    expect(stamp?.action.payload).toMatchObject({ sortie: { fuel: 2, rearming: 0 } });
  });

  it('drops a fleet that lost its squadron — no crash, no actions, no stamp', () => {
    const s = withPatrol({ targets: [] });
    s.fleets.f1 = fleet('f1', 'p1', 'A', [['cruiser', 1]]); // squadron ship replaced
    expect(patrolActions(s, data, 0)).toEqual([]);
  });
});

describe('standingOrderTickActions — combines both drivers in a fixed order', () => {
  it('runs auto-assault before patrol', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2'), planet('B', 'p1', 0, 0)],
      fleets: [
        fleet('storm', 'p1', 'A', [['cruiser', 1]]),
        fleet('wing', 'p1', 'B', [['carrier', 1]]),
      ],
      autoAssault: { storm: true },
      patrols: { wing: { center: { x: 0, y: 0 }, radius: 50, sortie: { fuel: 2, rearming: 0 } } },
    });
    setStance(s, 'p1', 'p2', 'war');
    const out = standingOrderTickActions(s, data, 0, probe);
    expect(out[0]!.action.type).toBe('fleet.orbit'); // auto-assault first
    expect(out.some((a) => a.action.type === 'fleet.assault')).toBe(true);
  });
});

describe('integration — every emitted action is accepted by the REAL kernel', () => {
  // Guards against a payload-shape mismatch between this driver and the actual
  // action handlers (e.g. `fleet.orbit` needing an explicit `orbit: 'near'` field) —
  // the pure unit tests above only assert the shape this file itself expects, not
  // that the core reducer agrees. Applies each action through DEV_MODULES, in order,
  // and requires every one to be `ok: true`.
  const ctx: Context = { now: 0, data };
  const kernel = createKernel(DEV_MODULES);

  it('auto-assault: fleet.orbit then fleet.assault both apply', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p2')],
      fleets: [fleet('f1', 'p1', 'A', [['cruiser', 1]])],
      autoAssault: { f1: true },
    });
    setStance(s, 'p1', 'p2', 'war');
    let state = s;
    for (const { playerId, action } of autoAssaultActions(state, probe)) {
      const r = kernel.applyAction(state, action, ctx);
      expect(r.ok, `${playerId}: ${action.type} → ${!r.ok ? r.code : 'ok'}`).toBe(true);
      if (r.ok) state = r.state;
    }
  });

  it('patrol: fleet.engage applies against a co-located identified enemy', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0, ['B']), planet('B', 'p2', 10, 0, ['A'])],
      fleets: [
        fleet('f1', 'p1', 'A', [['carrier', 1]]),
        fleet('f2', 'p2', 'A', [['cruiser', 1]]),
      ],
      patrols: { f1: { center: { x: 0, y: 0 }, radius: 50, sortie: { fuel: 2, rearming: 0 } } },
    });
    setStance(s, 'p1', 'p2', 'war');
    const out = patrolActions(s, data, 0);
    let state = s;
    for (const { playerId, action } of out) {
      const r = kernel.applyAction(state, action, ctx);
      expect(r.ok, `${playerId}: ${action.type} → ${!r.ok ? r.code : 'ok'}`).toBe(true);
      if (r.ok) state = r.state;
    }
    expect(state.battles && Object.keys(state.battles).length).toBeGreaterThan(0);
  });

  it('patrol: fleet.move applies to intercept a distant identified enemy', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0, ['B']), planet('B', 'p2', 10, 0, ['A'])],
      fleets: [
        fleet('f1', 'p1', 'A', [['carrier', 1]]),
        fleet('f2', 'p2', 'B', [['cruiser', 1]]),
      ],
      patrols: { f1: { center: { x: 0, y: 0 }, radius: 50, sortie: { fuel: 2, rearming: 0 } } },
    });
    setStance(s, 'p1', 'p2', 'war');
    const out = patrolActions(s, data, 0);
    let state = s;
    for (const { playerId, action } of out) {
      const r = kernel.applyAction(state, action, ctx);
      expect(r.ok, `${playerId}: ${action.type} → ${!r.ok ? r.code : 'ok'}`).toBe(true);
      if (r.ok) state = r.state;
    }
    expect(state.fleets.f1?.movement).toBeTruthy();
  });
});
