import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKernel } from '../kernel/kernel';
import { COUNTER_POSTED, espionageModule, MISSION_HOURS } from './espionage';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context, DomainEvent as GameEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: { cruiser: { faction: 'x', stats: { attack: 4, defense: 4, speed: 6, hp: 20 } } },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const END = MISSION_HOURS * HOUR; // a mission sent at 0 resolves here
const ctx = (now = 0, d: GameData = data): Context => ({ now, data: d });

/** Pin the outcome deterministically: chance 0.95 max / 0.05 min are clamps, so a
 *  hook forcing 1 / 0 lands on "always" / "never" within them for the first roll. */
const sureShot: GameModule = {
  id: 'sure-shot',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.chance', () => 1);
  },
};
const dudShot: GameModule = {
  id: 'dud-shot',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.chance', () => 0);
  },
};
// Detection pins (SPY-2): the detect clamp is [0,1], so 1/0 are exact always/never.
const alwaysDetect: GameModule = {
  id: 'always-detect',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.detect', () => 1);
  },
};
const neverDetect: GameModule = {
  id: 'never-detect',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.detect', () => 0);
  },
};
// Death pins (SPY-7): the kill clamp is [0,1] too.
const alwaysKill: GameModule = {
  id: 'always-kill',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.kill', () => 1);
  },
};
const neverKill: GameModule = {
  id: 'never-kill',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.kill', () => 0);
  },
};

function player(id: string, credits = 500): Player {
  return { id, name: id, faction: '', status: 'active', resources: { credits } };
}
function planet(id: string, owner: string | null, x = 0): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: [{ unit: 'cruiser', count: 3 }],
    traits: [],
  };
}
function baseState(): GameState {
  const s = createInitialState({ seed: 'spy', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    // far apart: nobody's own world sees another's
    planets: { B: planet('B', 'p2'), C: planet('C', 'p3', 10_000), H: planet('H', 'p1', -10_000) },
  };
}
function spy(playerId: string, payload: unknown): Action {
  return { id: `s:${playerId}:1`, type: 'espionage.spy', playerId, payload, issuedAt: 0 };
}
const recon = (planetId = 'B') => ({ planetId, op: 'recon' });
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected a rejection');
  return r.code;
}
/** Send a mission at `at` and run the world clock to its end. */
function mission(
  modules: GameModule[],
  s: GameState = baseState(),
  payload: unknown = recon(),
  at = 0,
  d: GameData = data,
): { state: GameState; events: GameEvent[] } {
  const k = createKernel([espionageModule, ...modules]);
  const sent = okApply(k.applyAction(s, spy('p1', payload), ctx(at, d)));
  const done = k.advanceTo(sent.state, ctx(at + END, d));
  if (!done.ok) throw new Error(done.code);
  return { state: done.state, events: done.events };
}
const ofType = (events: GameEvent[], type: string) => events.filter((e) => e.type === type);

describe('espionage — sending an agent to a world (SPY-8)', () => {
  const kernel = createKernel([espionageModule, sureShot]);

  it('pays the fee, takes an agent and resolves nothing until the mission ends', () => {
    const r = okApply(kernel.applyAction(baseState(), spy('p1', recon()), ctx(0)));
    expect(r.state.players.p1?.resources.credits).toBe(350); // 500 − 150 base fee
    expect(r.state.spyAgents?.p1).toEqual([{ until: END, mission: 1, op: 'recon', planetId: 'B' }]);
    expect(r.state.intel).toBeUndefined();
    expect(r.events).toEqual([
      { type: 'espionage.sent', payload: { owner: 'p1', planetId: 'B', op: 'recon', until: END } },
    ]);
    const early = kernel.advanceTo(r.state, ctx(END - 1));
    if (!early.ok) throw new Error(early.code);
    expect(early.state.intel).toBeUndefined();
  });

  it('a successful recon opens the first layer on the world and posts the agent there (SPY-13)', () => {
    const r = mission([sureShot, neverDetect]);
    expect(r.state.intel?.p1).toEqual([
      { kind: 'planet', target: 'B', until: COUNTER_POSTED, layer: 1, mission: 1 },
    ]);
    expect(ofType(r.events, 'intel.stolen')).toEqual([
      {
        type: 'intel.stolen',
        payload: { owner: 'p1', target: 'p2', kind: 'recon', planetId: 'B', until: COUNTER_POSTED, layer: 1 },
      },
    ]);
    // the agent stays on post until recalled or caught
    expect(r.state.spyAgents?.p1).toEqual([
      { until: COUNTER_POSTED, mission: 1, op: 'recon', planetId: 'B', posted: true },
    ]);
  });

  it('a failed mission burns the fee, grants nothing, and reports to the actor only', () => {
    const r = mission([dudShot, neverDetect]);
    expect(r.state.players.p1?.resources.credits).toBe(350); // spying is a gamble
    expect(r.state.intel).toBeUndefined();
    expect(ofType(r.events, 'espionage.failed')).toEqual([
      { type: 'espionage.failed', payload: { owner: 'p1', target: 'p2', kind: 'recon', planetId: 'B' } },
    ]);
    expect(ofType(r.events, 'espionage.detected')).toEqual([]);
  });

  it('the mission resolves against whoever owns the world at its end', () => {
    const k = createKernel([espionageModule, dudShot, alwaysDetect, neverKill]);
    const sent = okApply(k.applyAction(baseState(), spy('p1', recon()), ctx(0)));
    sent.state.planets.B!.owner = 'p3'; // the world changed hands mid-mission
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(ofType(done.events, 'espionage.detected')[0]?.payload).toMatchObject({ owner: 'p3' });
  });

  it('a world the spy took (or that fell empty) aborts the mission: no rolls, the agent comes home', () => {
    const k = createKernel([espionageModule, sureShot]);
    const sent = okApply(k.applyAction(baseState(), spy('p1', recon()), ctx(0)));
    sent.state.planets.B!.owner = 'p1';
    const rngBefore = sent.state.rng;
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(done.events).toContainEqual({
      type: 'espionage.aborted',
      payload: { owner: 'p1', planetId: 'B', kind: 'recon' },
    });
    expect(done.state.intel).toBeUndefined();
    expect(done.state.rng).toEqual(rngBefore);
    expect(done.state.spyAgents?.p1).toEqual([{ until: END + 6 * HOUR }]);
  });

  it.each([
    ['unknown operation', { planetId: 'B', op: 'pings' }, 'E_BAD_PAYLOAD'],
    ['no world', { op: 'recon' }, 'E_BAD_PAYLOAD'],
    ['unknown world', { planetId: 'ghost', op: 'recon' }, 'E_NO_PLANET'],
    ['own world', { planetId: 'H', op: 'recon' }, 'E_BAD_TARGET'],
  ])('fail-secure: %s → %s', (_n, payload, code) => {
    expect(errCode(kernel.applyAction(baseState(), spy('p1', payload), ctx(0)))).toBe(code);
  });

  it('fail-secure: an unclaimed world has nobody to spy on (E_BAD_TARGET)', () => {
    const s = baseState();
    s.planets.B!.owner = null;
    expect(errCode(kernel.applyAction(s, spy('p1', recon()), ctx(0)))).toBe('E_BAD_TARGET');
  });

  it('rejects a mission the actor cannot pay for', () => {
    const s = baseState();
    s.players.p1!.resources.credits = 10;
    expect(errCode(kernel.applyAction(s, spy('p1', recon()), ctx(0)))).toBe('E_INSUFFICIENT');
  });

  // Status guards, mirroring the BF-32 block in diplomacy.test.ts: a DEFEATED
  // seat neither spies nor is spied upon — both sides of the table must hold.
  it('fail-secure: a defeated actor cannot spy (E_FORBIDDEN)', () => {
    const s = baseState();
    s.players.p1!.status = 'defeated';
    expect(errCode(kernel.applyAction(s, spy('p1', recon()), ctx(0)))).toBe('E_FORBIDDEN');
  });

  it('fail-secure: a defeated owner is no target (E_NO_PLAYER)', () => {
    const s = baseState();
    s.players.p2!.status = 'defeated';
    expect(errCode(kernel.applyAction(s, spy('p1', recon()), ctx(0)))).toBe('E_NO_PLAYER');
  });

  it('keeps at most 8 grants per beneficiary (oldest evicted)', () => {
    const s = baseState();
    s.players.p1!.resources.credits = 10_000;
    s.intel = { p1: Array.from({ length: 8 }, (_, i) => ({ kind: 'planet' as const, target: `t${i}`, until: 999 * HOUR })) };
    const r = mission([sureShot, neverDetect], s);
    expect(r.state.intel?.p1).toHaveLength(8);
    expect(r.state.intel?.p1?.[0]?.target).toBe('t1'); // t0 evicted
    expect(r.state.intel?.p1?.[7]).toMatchObject({ kind: 'planet', target: 'B' });
  });

  it('housekeeping drops expired windows as time advances', () => {
    const k = createKernel([espionageModule]);
    const s = baseState();
    s.intel = { p1: [{ kind: 'planet', target: 'B', until: 1 * HOUR }] };
    s.scheduled = [{ id: 'evt:t', at: 2 * HOUR, type: 'noop', payload: {}, seq: 0 }];
    s.scheduleSeq = 1;
    const r = k.advanceTo(s, ctx(2 * HOUR));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.intel).toBeUndefined();
  });
});

describe('espionage — counter-intelligence (SPY-2)', () => {
  it('a caught FAILED mission exposes the spy to the victim', () => {
    const r = mission([dudShot, alwaysDetect, neverKill]);
    expect(ofType(r.events, 'espionage.detected')).toEqual([
      // owner = the VICTIM — the fog filter routes this event to them, not the spy
      { type: 'espionage.detected', payload: { owner: 'p2', kind: 'recon', planetId: 'B', spy: 'p1' } },
    ]);
  });

  it('SPY-16: any exposure is public news naming both players and the world, not the operation', () => {
    const news = { type: 'espionage.exposed', payload: { a: 'p2', b: 'p1', planetId: 'B' } };
    expect(ofType(mission([dudShot, alwaysDetect, neverKill]).events, 'espionage.exposed')).toEqual([news]);
    expect(ofType(mission([sureShot, alwaysDetect, neverKill]).events, 'espionage.exposed')).toEqual([news]);
    expect(ofType(mission([dudShot, neverDetect]).events, 'espionage.exposed')).toEqual([]);
  });

  it('a noticed SUCCESSFUL mission reveals the leak but not the thief', () => {
    const r = mission([sureShot, alwaysDetect, neverKill]);
    const det = ofType(r.events, 'espionage.detected');
    expect(det).toHaveLength(1);
    expect(det[0]!.payload).toEqual({ owner: 'p2', kind: 'recon', planetId: 'B' }); // no `spy` field
    // the recon itself still went through
    expect(r.state.intel?.p1?.[0]).toMatchObject({ kind: 'planet', target: 'B' });
  });

  it('perfect spies are never detected (hook pinned to 0)', () => {
    const r = mission([sureShot, neverDetect]);
    expect(ofType(r.events, 'espionage.detected')).toHaveLength(0);
  });

  it('the detect pipeline receives the mission outcome (defence can price them apart)', () => {
    const seen: boolean[] = [];
    const probe: GameModule = {
      id: 'probe',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('espionage.detect', (v, args) => {
          seen.push((args as { succeeded: boolean }).succeeded);
          return v;
        });
      },
    };
    mission([sureShot, probe]);
    mission([dudShot, probe]);
    expect(seen).toEqual([true, false]);
  });
});

describe('espionage — the projection honors live recon windows only', () => {
  function granted(until = 999 * HOUR): GameState {
    const s = baseState();
    s.planets.B!.buildings = [{ type: 'mine', level: 2, hp: 10 }];
    s.fleets = {
      F2: { id: 'F2', owner: 'p2', location: 'B', movement: null, units: [{ unit: 'cruiser', count: 2 }], traits: [] },
    };
    s.intel = { p1: [{ kind: 'planet', target: 'B', until }] };
    return s;
  }

  it('the window opens the world: buildings, ground army and the fleets in its orbit', () => {
    const view = visibleState(granted(), 'p1', data);
    expect(view.planets.B?.owner).toBe('p2');
    expect(view.planets.B?.garrison).toEqual([{ unit: 'cruiser', count: 3 }]);
    expect(view.planets.B?.buildings).toEqual([{ type: 'mine', level: 2, hp: 10 }]);
    expect(view.fleets.F2?.units).toEqual([{ unit: 'cruiser', count: 2 }]);
  });

  it('a bystander sees nothing, and the victim never sees the theft', () => {
    expect(visibleState(granted(), 'p3', data).fleets.F2).toBeUndefined();
    expect(visibleState(granted(), 'p3', data).planets.B?.garrison).toEqual([]);
    expect(visibleState(granted(), 'p2', data).intel).toBeUndefined();
  });

  it('the victim treasury is not part of a recon', () => {
    const s = granted();
    s.players.p2!.resources = { credits: 777 };
    expect(visibleState(s, 'p1', data).players.p2?.resources).toEqual({});
  });

  it('an EXPIRED window opens nothing (enforced at the boundary, not only by cleanup)', () => {
    const s = granted(1 * HOUR);
    s.time = 2 * HOUR;
    const view = visibleState(s, 'p1', data);
    expect(view.fleets.F2).toBeUndefined();
    expect(view.planets.B?.garrison).toEqual([]);
  });

  it('anti-leak: the serialized third-party view carries no trace of the theft', () => {
    const json = JSON.stringify(visibleState(granted(), 'p3', data));
    expect(json).not.toContain('intel');
  });
});

describe('espionage — the agent network (SPY-6)', () => {
  const rich = (): GameState => {
    const s = baseState();
    s.players.p1!.resources.credits = 10_000;
    return s;
  };

  it('an unnoticed failure sends the agent home for 6h; a killed one is lost for 24h', () => {
    const a = mission([dudShot, neverDetect], rich());
    expect(a.state.spyAgents?.p1).toEqual([{ until: END + 6 * HOUR }]);
    expect(ofType(a.events, 'espionage.failed')[0]?.payload).not.toHaveProperty('agentLost');

    const b = mission([dudShot, alwaysDetect, alwaysKill], rich());
    expect(b.state.spyAgents?.p1).toEqual([{ until: END + 24 * HOUR, lost: true }]);
    expect(ofType(b.events, 'espionage.failed')).toEqual([
      {
        type: 'espionage.failed',
        payload: { owner: 'p1', target: 'p2', kind: 'recon', planetId: 'B', agentLost: true },
      },
    ]);
  });

  it('a detected agent that survives escapes: home in 6h after a failure, still on post after a success', () => {
    const a = mission([dudShot, alwaysDetect, neverKill], rich());
    expect(a.state.spyAgents?.p1).toEqual([{ until: END + 6 * HOUR }]);
    expect(ofType(a.events, 'espionage.failed')[0]?.payload).not.toHaveProperty('agentLost');
    const b = mission([sureShot, alwaysDetect, neverKill], rich());
    expect(b.state.spyAgents?.p1).toEqual([
      { until: COUNTER_POSTED, mission: 1, op: 'recon', planetId: 'B', posted: true },
    ]);
  });

  it('a killed agent after a SUCCESS: the window stays, the agent is lost, both sides are told', () => {
    const r = mission([sureShot, alwaysDetect, alwaysKill], rich());
    expect(r.state.intel?.p1?.[0]).toMatchObject({ kind: 'planet', target: 'B' });
    expect(r.state.spyAgents?.p1).toEqual([{ until: END + 24 * HOUR, lost: true }]);
    expect(ofType(r.events, 'intel.stolen')[0]?.payload).toMatchObject({ agentLost: true });
    expect(r.events).toContainEqual({
      type: 'espionage.detected',
      payload: { owner: 'p2', kind: 'recon', planetId: 'B', killed: true },
    });
  });

  it('no detection, no death — even with the kill hook pinned to 1', () => {
    const r = mission([dudShot, neverDetect, alwaysKill], rich());
    expect(r.state.spyAgents?.p1).toEqual([{ until: END + 6 * HOUR }]);
  });

  it('the kill roll is drawn even when nothing was detected (stable RNG shape)', () => {
    const a = mission([dudShot, neverDetect], rich());
    const b = mission([dudShot, alwaysDetect], rich());
    expect(a.state.rng).toEqual(b.state.rng);
  });

  it('the fourth mission with all three agents away is refused — free of charge', () => {
    const k = createKernel([espionageModule, dudShot, neverDetect]);
    let s = rich();
    // one recon agent per world (SPY-13): the third agent goes on a theft
    for (const payload of [recon('B'), recon('C'), { planetId: 'B', op: 'theft' }])
      s = okApply(k.applyAction(s, spy('p1', payload), ctx(0))).state;
    expect(s.players.p1?.resources.credits).toBe(10_000 - 2 * 150 - 300);
    expect(s.spyAgents?.p1?.map((a) => a.mission)).toEqual([1, 2, 3]);
    expect(errCode(k.applyAction(s, spy('p1', { planetId: 'B', op: 'sabotage' }), ctx(0)))).toBe('E_NO_AGENT');
    // an agent back home (12h mission + 6h return) frees a slot again
    const later = k.advanceTo(s, ctx(END + 6 * HOUR));
    if (!later.ok) throw new Error(later.code);
    okApply(k.applyAction(later.state, spy('p1', recon()), ctx(END + 6 * HOUR)));
  });

  it('anti-leak: a rival never sees the spy network', () => {
    const s = baseState();
    s.spyAgents = { p1: [{ until: 9 * HOUR }] };
    expect(visibleState(s, 'p1', data).spyAgents).toEqual({ p1: [{ until: 9 * HOUR }] });
    expect(JSON.stringify(visibleState(s, 'p2', data))).not.toContain('spyAgents');
  });
});

describe('espionage — counter-intelligence building (SPY-7)', () => {
  const bureauData: GameData = parseGameData({
    version: '0.1.0',
    resources: ['credits'],
    units: { cruiser: { faction: 'x', stats: { attack: 4, defense: 4, speed: 6, hp: 20 } } },
    factions: {},
    buildings: {
      bureau: {
        name: 'Bureau',
        cost: {},
        spyDetectBonus: 0.15,
        spyKillBonus: 0.1,
        upgrades: [{ cost: {}, spyDetectBonus: 0.25, spyKillBonus: 0.2 }],
      },
      mine: { name: 'Mine', cost: {} },
    },
    events: {},
  });
  /** Records the base odds the detect / kill pipelines receive — the building's share is in it. */
  const seen = { detect: [] as number[], kill: [] as number[] };
  const probe: GameModule = {
    id: 'detect-probe',
    version: '1.0.0',
    setup(api) {
      api.hook<number>('espionage.detect', (v) => {
        seen.detect.push(v);
        return v;
      });
      api.hook<number>('espionage.kill', (v) => {
        seen.kill.push(v);
        return v;
      });
    },
  };
  const attempt = (s: GameState, shot: GameModule = sureShot) => {
    seen.detect.length = 0;
    seen.kill.length = 0;
    mission([shot, probe], s, recon(), 0, bureauData);
    return { detect: seen.detect[0]!, kill: seen.kill[0]! };
  };
  const withBuildings = (...bs: Array<{ type: string; level: number }>): GameState => {
    const s = baseState();
    s.planets.B!.buildings = bs.map((b) => ({ ...b, hp: 10 }));
    return s;
  };

  it('the victim bureau raises the base detection odds by its level bonus', () => {
    expect(attempt(withBuildings()).detect).toBeCloseTo(0.25); // clean theft, no bureau
    expect(attempt(withBuildings({ type: 'bureau', level: 1 })).detect).toBeCloseTo(0.4);
    expect(attempt(withBuildings({ type: 'bureau', level: 2 })).detect).toBeCloseTo(0.5);
    expect(attempt(withBuildings({ type: 'bureau', level: 2 }), dudShot).detect).toBeCloseTo(0.75); // 0.5 + 0.25
  });

  it('only the strongest bureau of the victim counts, and only the victim', () => {
    const s = withBuildings({ type: 'bureau', level: 1 }, { type: 'mine', level: 1 });
    s.planets.C = { ...s.planets.B!, id: 'C', buildings: [{ type: 'bureau', level: 2, hp: 10 }] };
    expect(attempt(s).detect).toBeCloseTo(0.5); // max 0.25, not 0.15 + 0.25
    // a bureau of someone else (here the spy's own world) does not guard p2
    s.planets.C.owner = 'p1';
    s.planets.B!.buildings = [];
    expect(attempt(s).detect).toBeCloseTo(0.25);
  });

  it('the victim bureau raises the death odds of a detected agent', () => {
    expect(attempt(withBuildings()).kill).toBeCloseTo(0.5);
    expect(attempt(withBuildings({ type: 'bureau', level: 1 })).kill).toBeCloseTo(0.6);
    expect(attempt(withBuildings({ type: 'bureau', level: 2 })).kill).toBeCloseTo(0.7);
  });

  it('the shipped catalogue carries the bureau with a rising bonus', () => {
    const shipped = JSON.parse(readFileSync(new URL('../../../../data/buildings.json', import.meta.url), 'utf8')) as Record<string, { spyDetectBonus?: number; spyKillBonus?: number; upgrades?: Array<{ spyDetectBonus?: number; spyKillBonus?: number }> }>;
    const bureau = shipped.counterintel!;
    const levels = [bureau.spyDetectBonus!, ...bureau.upgrades!.map((u) => u.spyDetectBonus!)];
    expect(levels).toEqual([0.15, 0.25, 0.35]);
    expect([bureau.spyKillBonus!, ...bureau.upgrades!.map((u) => u.spyKillBonus!)]).toEqual([0.1, 0.2, 0.3]);
  });
});
