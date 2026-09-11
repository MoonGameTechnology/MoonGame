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
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 4, defense: 1, speed: 12, hp: 8, fuel: 3, rearmRounds: 2, strikeRange: 60 },
    },
    carrier: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 2, defense: 2, speed: 6, hp: 30, fuel: 2, rearmRounds: 3, strikeRange: 50 },
    },
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 5, defense: 5, speed: 6, hp: 40 },
    },
  },
  factions: {},
  buildings: { spaceport: { name: 'Spaceport', shuttleBay: 4, hp: 100 } },
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
describe('patrolActions — CC-4 (дежурит БАЗА, SHU-2.2)', () => {
  /** Мой мир с портом, эскадрой в ангаре и полным запасом вылетов. */
  function withPatrol(opts: {
    targets?: Fleet[];
    stance?: 'war' | 'peace';
    sortie?: { fuel: number; rearming: number };
    hangar?: boolean;
  }) {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0, ['B']), planet('B', 'p2', 10, 0, ['A'])],
      fleets: opts.targets ?? [],
      patrols: { A: { kind: 'planet' } },
    });
    s.planets.A = {
      ...s.planets.A!,
      buildings: [{ type: 'spaceport', level: 1, hp: 100 }],
      hangar:
        opts.hangar === false
          ? []
          : [{ id: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] }],
      ...(opts.sortie ? { sortie: opts.sortie } : {}),
    };
    setStance(s, 'p1', 'p2', opts.stance ?? 'war');
    return s;
  }

  it('ПОДНИМАЕТ ЭСКАДРУ по опознанному врагу в радиусе — обычным `shuttle.strike`', () => {
    const s = withPatrol({ targets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])] });
    const out = patrolActions(s, data);
    expect(out).toHaveLength(1);
    expect(out[0]!.action.type).toBe('shuttle.strike');
    expect(out[0]!.action.payload).toEqual({
      planetId: 'A',
      squadronId: 'sq:p1:1',
      targetFleetId: 'f2',
    });
  });

  it('МИР — НЕ ЦЕЛЬ: без объявленной войны дежурство молчит', () => {
    const s = withPatrol({
      targets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])],
      stance: 'peace',
    });
    expect(patrolActions(s, data)).toEqual([]);
  });

  it('ПУСТОЙ АНГАР — ВЫЛЕТА НЕТ: дежурить нечем', () => {
    const s = withPatrol({ targets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])], hangar: false });
    expect(patrolActions(s, data)).toEqual([]);
  });

  it('СУХОЙ БАК — ВЫЛЕТА НЕТ: заведомо отклоняемый приказ не подаём', () => {
    const s = withPatrol({
      targets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])],
      sortie: { fuel: 0, rearming: 2 },
    });
    expect(patrolActions(s, data)).toEqual([]);
  });

  it('ЦЕЛЕЙ НЕТ — ВЫЛЕТА НЕТ', () => {
    expect(patrolActions(withPatrol({}), data)).toEqual([]);
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
      patrols: { B: { kind: 'planet' } },
    });
    setStance(s, 'p1', 'p2', 'war');
    const out = standingOrderTickActions(s, data, probe);
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

  it('дежурный вылет: `shuttle.strike` принимается настоящим редьюсером', () => {
    const s = stateWith({
      players: [player('p1'), player('p2')],
      planets: [planet('A', 'p1', 0, 0, ['B']), planet('B', 'p2', 10, 0, ['A'])],
      fleets: [fleet('f2', 'p2', 'B', [['cruiser', 1]])],
      patrols: { A: { kind: 'planet' } },
    });
    s.planets.A = {
      ...s.planets.A!,
      buildings: [{ type: 'spaceport', level: 1, hp: 100 }],
      hangar: [{ id: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] }],
    };
    setStance(s, 'p1', 'p2', 'war');
    const out = patrolActions(s, data);
    expect(out).toHaveLength(1);
    let state = s;
    for (const { playerId, action } of out) {
      const r = kernel.applyAction(state, action, ctx);
      expect(r.ok, `${playerId}: ${action.type} → ${!r.ok ? r.code : 'ok'}`).toBe(true);
      if (r.ok) state = r.state;
    }
    // Машины ушли из ангара в воздух — вылет состоялся.
    expect(state.strikes ?? []).toHaveLength(1);
    expect(state.planets.A!.hangar ?? []).toHaveLength(0);
  });
});
