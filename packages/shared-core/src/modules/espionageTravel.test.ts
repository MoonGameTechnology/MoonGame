import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { espionageModule, MISSION_HOURS, SPY_OP_COST } from './espionage';
import { capitalModule } from './capital';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { setStance } from '../state/diplomacy';
import { spyPath, spyRoster, spyTerritoryFactor, spyTravelMs, SPY_SPEED } from '../state/spyTravel';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context, DomainEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

// SPY-23 (owner's resolution 2026-11-10): a spy flies to its world, works there, waits for
// orders when it cannot, and always comes home to the capital.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const WORK = MISSION_HOURS * HOUR;
const ctx = (now = 0): Context => ({ now, data });

const pin = (id: string, hook: string, value: number): GameModule => ({
  id,
  version: '1.0.0',
  setup(api) {
    api.hook<number>(hook, () => value);
  },
});
const sure = pin('sure', 'espionage.chance', 1);
const unseen = pin('unseen', 'espionage.detect', 0);

function player(id: string): Player {
  return { id, name: id, faction: '', status: 'active', resources: { credits: 5000 } };
}
function planet(id: string, owner: string | null, x: number, links: string[]): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    links,
  };
}
/**
 * H (p1's capital) — N (nobody's) — E (p2's, at war by default) — F (p2's), one lane each,
 * 640 apart: a spy covers 640 in an hour at full speed. G is p1's second world, off to the
 * other side of H.
 */
function baseState(): GameState {
  const s = createInitialState({ seed: 'travel', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      G: planet('G', 'p1', -640, ['H']),
      H: planet('H', 'p1', 0, ['G', 'N']),
      N: planet('N', null, 640, ['H', 'E']),
      E: planet('E', 'p2', 1280, ['N', 'F']),
      F: planet('F', 'p2', 1920, ['E']),
    },
    capital: { p1: 'H', p2: 'F' },
  };
}
/** H → N: 320 at home + 320 over N at ¾ = 1⅙ h. N → E: 320 at ¾ + 320 at war at ½ = 1⅔ h. */
const H_N = Math.round(((320 + 320 / 0.75) / SPY_SPEED) * HOUR);
const H_E = Math.round(((320 + 320 / 0.75 + 320 / 0.75 + 320 / 0.5) / SPY_SPEED) * HOUR);

let seq = 0;
const act = (playerId: string, type: string, payload: unknown): Action => ({
  id: `${type}:${++seq}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const order = (planetId: string, op: string, spyId?: number) =>
  act('p1', 'espionage.spy', { planetId, op, ...(spyId !== undefined ? { spyId } : {}) });
function ok(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
const ofType = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type);
const kernel = (...extra: GameModule[]) => createKernel([capitalModule, espionageModule, ...extra]);
function advance(k: ReturnType<typeof kernel>, s: GameState, to: number) {
  const r = k.advanceTo(s, ctx(to));
  if (!r.ok) throw new Error(r.code);
  return r;
}
const spy1 = (s: GameState) => s.spies?.p1?.find((x) => x.id === 1);

describe('SPY-23 — territory sets the pace', () => {
  it('full speed over own and allied worlds, ¾ over neutral ones and at peace, ½ at war', () => {
    const s = baseState();
    expect(spyTerritoryFactor(s, 'p1', 'H')).toBe(1);
    expect(spyTerritoryFactor(s, 'p1', 'N')).toBe(0.75);
    expect(spyTerritoryFactor(s, 'p1', 'E')).toBe(0.5); // war is the default stance
    setStance(s, 'p1', 'p2', 'peace');
    expect(spyTerritoryFactor(s, 'p1', 'E')).toBe(0.75);
    setStance(s, 'p1', 'p2', 'alliance');
    expect(spyTerritoryFactor(s, 'p1', 'E')).toBe(1);
  });

  it('each half of a lane is flown at the pace of the province it lies in', () => {
    const path = spyPath(baseState(), 'p1', 'H', 'E');
    expect(path?.route).toEqual(['N', 'E']);
    expect(path?.length).toBeCloseTo(320 + 320 / 0.75 + 320 / 0.75 + 320 / 0.5, 9);
    expect(spyPath(baseState(), 'p1', 'H', 'H')).toEqual({ route: [], length: 0 });
  });

  it('takes the quickest way, not the shortest: a detour over neutral space beats a war zone', () => {
    const s = baseState();
    // N moves aside, so the way over it is longer; a straight way runs over p2's world X.
    s.planets.N!.position = { x: 640, y: 400 };
    s.planets.X = planet('X', 'p2', 640, ['H', 'E']);
    s.planets.H!.links = ['G', 'N', 'X'];
    s.planets.E!.links = ['N', 'F', 'X'];
    expect(spyPath(s, 'p1', 'H', 'E')?.route).toEqual(['N', 'E']);
    // Allied, X is full speed: now the straight way is the quickest too.
    setStance(s, 'p1', 'p2', 'alliance');
    expect(spyPath(s, 'p1', 'H', 'E')?.route).toEqual(['X', 'E']);
  });

  it('no lane, no way', () => {
    const s = baseState();
    s.planets.N!.links = ['H'];
    s.planets.E!.links = ['F'];
    expect(spyPath(s, 'p1', 'H', 'E')).toBeNull();
    expect(ok(kernel().applyAction(baseState(), order('E', 'theft'), ctx(0))).ok).toBe(true);
    expect(kernel().applyAction(s, order('E', 'theft'), ctx(0))).toMatchObject({
      ok: false,
      code: 'E_NO_ROUTE',
    });
  });
});

describe('SPY-23 — to the world, the deed, and home', () => {
  it('starts at rest in the capital: three spies, ids 1–3', () => {
    expect(spyRoster(baseState(), 'p1')).toEqual([
      { id: 1, gen: 1, state: 'rest', location: 'H' },
      { id: 2, gen: 1, state: 'rest', location: 'H' },
      { id: 3, gen: 1, state: 'rest', location: 'H' },
    ]);
  });

  it('flies there, works 12 h after arrival, then flies back to the capital and rests', () => {
    const k = kernel(sure, unseen);
    const sent = ok(k.applyAction(baseState(), order('E', 'theft'), ctx(0)));
    expect(sent.state.players.p1!.resources.credits).toBe(5000 - SPY_OP_COST.theft); // paid up front
    expect(spy1(sent.state)).toEqual({
      id: 1,
      gen: 1,
      state: 'travel',
      location: 'E',
      from: 'H',
      departedAt: 0,
      arrivesAt: H_E,
      op: 'theft',
      mission: 1,
    });
    expect(ofType(sent.events, 'espionage.sent')[0]!.payload).toEqual({
      owner: 'p1',
      spyId: 1,
      planetId: 'E',
      op: 'theft',
      arrivesAt: H_E,
      until: H_E + WORK,
    });
    // the preview agrees with the order
    expect(spyTravelMs(baseState(), { data }, 'p1', 1, 'E')).toBe(H_E);

    const there = advance(k, sent.state, H_E);
    expect(spy1(there.state)).toMatchObject({
      state: 'work',
      location: 'E',
      op: 'theft',
      arrivesAt: H_E + WORK,
    });
    expect(ofType(there.events, 'espionage.succeeded')).toEqual([]);

    const done = advance(k, there.state, H_E + WORK);
    expect(ofType(done.events, 'espionage.succeeded')).toHaveLength(1);
    // home is the same way back
    expect(spy1(done.state)).toMatchObject({
      state: 'return',
      location: 'H',
      from: 'E',
      arrivesAt: H_E + WORK + H_E,
    });

    const home = advance(k, done.state, H_E + WORK + H_E);
    expect(spy1(home.state)).toMatchObject({ state: 'rest', location: 'H' });
    expect(spy1(home.state)).not.toHaveProperty('op');
    expect(ofType(home.events, 'espionage.home')[0]!.payload).toEqual({
      owner: 'p1',
      spyId: 1,
      planetId: 'H',
    });
  });

  it('a speed pipeline (a spy level) shortens the way', () => {
    const fast = pin('fast', 'espionage.speed', 2);
    const sent = ok(kernel(fast).applyAction(baseState(), order('E', 'theft'), ctx(0)));
    expect(spy1(sent.state)?.arrivesAt).toBe(Math.round(H_E / 2));
    expect(spyTravelMs(baseState(), { data }, 'p1', 1, 'E', 2)).toBe(Math.round(H_E / 2));
  });

  it('the match travel factor speeds spies like fleets', () => {
    const rules = { data, config: { travelSpeedFactor: 5 } } as Pick<Context, 'data' | 'config'>;
    expect(spyTravelMs(baseState(), rules, 'p1', 1, 'E')).toBe(Math.round(H_E / 5));
  });

  it('on arrival a deed that can no longer start waits there for orders — the fee stays paid', () => {
    const k = kernel(sure, unseen);
    const sent = ok(k.applyAction(baseState(), order('E', 'theft'), ctx(0)));
    sent.state.planets.E!.owner = 'p1'; // taken on the way
    const there = advance(k, sent.state, H_E);
    expect(spy1(there.state)).toEqual({ id: 1, gen: 1, state: 'wait', location: 'E', mission: 1 });
    expect(ofType(there.events, 'espionage.waiting')[0]!.payload).toEqual({
      owner: 'p1',
      spyId: 1,
      planetId: 'E',
      kind: 'theft',
    });
    expect(there.state.players.p1!.resources.credits).toBe(5000 - SPY_OP_COST.theft);
  });

  it('relocate is free, waits on arrival, and the next order sets out from there', () => {
    const k = kernel(sure, unseen);
    const moved = ok(k.applyAction(baseState(), order('N', 'relocate'), ctx(0)));
    expect(moved.state.players.p1!.resources.credits).toBe(5000);
    const there = advance(k, moved.state, H_N);
    expect(spy1(there.state)).toMatchObject({ state: 'wait', location: 'N' });
    expect(ofType(there.events, 'espionage.arrived')[0]!.payload).toEqual({
      owner: 'p1',
      spyId: 1,
      planetId: 'N',
    });
    // from N, E is only the second lane away; an order without a spyId picks the closest spy
    const next = ok(k.applyAction(there.state, order('E', 'theft'), ctx(H_N)));
    expect(spy1(next.state)).toMatchObject({
      state: 'travel',
      from: 'N',
      arrivesAt: H_N + (H_E - H_N),
    });
  });

  it('a spy waiting on the target starts at once', () => {
    const k = kernel(sure, unseen);
    let s = advance(
      k,
      ok(k.applyAction(baseState(), order('E', 'relocate'), ctx(0))).state,
      H_E,
    ).state;
    s = ok(k.applyAction(s, order('E', 'theft', 1), ctx(H_E))).state;
    expect(spy1(s)).toMatchObject({ state: 'work', location: 'E', arrivesAt: H_E + WORK });
  });

  it('a named spy must be free: busy, unknown or lying low → E_NO_AGENT', () => {
    const k = kernel();
    const sent = ok(k.applyAction(baseState(), order('N', 'relocate', 1), ctx(0)));
    expect(k.applyAction(sent.state, order('E', 'theft', 1), ctx(1))).toMatchObject({
      ok: false,
      code: 'E_NO_AGENT',
    });
    expect(k.applyAction(baseState(), order('E', 'theft', 9), ctx(0))).toMatchObject({
      ok: false,
      code: 'E_NO_AGENT',
    });
    expect(ok(k.applyAction(sent.state, order('E', 'theft', 2), ctx(1))).ok).toBe(true);
  });
});

describe('SPY-23 — calling a spy off', () => {
  it('on its way, the spy turns back: home after as long as it had flown', () => {
    const k = kernel();
    const sent = ok(k.applyAction(baseState(), order('E', 'theft'), ctx(0)));
    const off = ok(
      k.applyAction(sent.state, act('p1', 'espionage.cancel', { spyId: 1 }), ctx(HOUR)),
    );
    expect(spy1(off.state)).toMatchObject({
      state: 'return',
      location: 'H',
      from: 'H',
      arrivesAt: 2 * HOUR,
    });
    expect(ofType(off.events, 'espionage.cancelled')[0]!.payload).toEqual({
      owner: 'p1',
      spyId: 1,
      planetId: 'E',
    });
    // the trip out is over: its arrival finds nobody to start
    const later = advance(k, off.state, H_E + WORK);
    expect(spy1(later.state)).toMatchObject({ state: 'rest', location: 'H' });
    expect(ofType(later.events, 'espionage.succeeded')).toEqual([]);
  });

  it('at work or waiting, it flies home from the world', () => {
    const k = kernel();
    const there = advance(
      k,
      ok(k.applyAction(baseState(), order('E', 'theft'), ctx(0))).state,
      H_E,
    );
    const off = ok(
      k.applyAction(there.state, act('p1', 'espionage.cancel', { spyId: 1 }), ctx(H_E + HOUR)),
    );
    expect(spy1(off.state)).toMatchObject({
      state: 'return',
      from: 'E',
      arrivesAt: H_E + HOUR + H_E,
    });
    expect(ofType(advance(k, off.state, H_E + WORK).events, 'espionage.failed')).toEqual([]);
  });

  it('fail-secure: nothing to call off at rest, a bad id is a bad payload', () => {
    const k = kernel();
    expect(
      k.applyAction(baseState(), act('p1', 'espionage.cancel', { spyId: 1 }), ctx(0)),
    ).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(
      k.applyAction(baseState(), act('p1', 'espionage.cancel', { spyId: 'x' }), ctx(0)),
    ).toMatchObject({
      ok: false,
      code: 'E_BAD_PAYLOAD',
    });
  });
});

describe('SPY-23 — the capital moves, or falls', () => {
  it('a spy coming home to a former capital flies on to the new one', () => {
    const k = kernel(sure, unseen);
    const done = advance(
      k,
      ok(k.applyAction(baseState(), order('E', 'theft'), ctx(0))).state,
      H_E + WORK,
    );
    const moved = ok(
      k.applyAction(done.state, act('p1', 'capital.designate', { planetId: 'G' }), ctx(H_E + WORK)),
    );
    const atOld = advance(k, moved.state, H_E + WORK + H_E);
    const H_G = Math.round((640 / SPY_SPEED) * HOUR);
    expect(spy1(atOld.state)).toMatchObject({
      state: 'return',
      from: 'H',
      location: 'G',
      arrivesAt: H_E + WORK + H_E + H_G,
    });
    expect(spy1(advance(k, atOld.state, H_E + WORK + H_E + H_G).state)).toMatchObject({
      state: 'rest',
      location: 'G',
    });
  });

  it('spies resting in the old capital move to the new one', () => {
    const k = kernel();
    // the registry exists once any order was given
    const s = ok(k.applyAction(baseState(), order('N', 'relocate'), ctx(0))).state;
    const moved = ok(k.applyAction(s, act('p1', 'capital.designate', { planetId: 'G' }), ctx(0)));
    expect(moved.state.spies?.p1?.[1]).toMatchObject({ state: 'return', from: 'H', location: 'G' });
  });

  it('with no capital the spies lie low: no orders, no risk — and head home once there is one', () => {
    const k = kernel(sure, unseen);
    let s = ok(k.applyAction(baseState(), order('N', 'relocate'), ctx(0))).state;
    s.planets.H!.owner = 'p2'; // the capital fell
    s = advance(k, s, H_N).state;
    expect(s.spies?.p1?.[1]).toMatchObject({ state: 'hidden', location: 'H' });
    expect(spyRoster(s, 'p1')[1]?.state).toBe('hidden');
    // the one waiting on N can still take orders; the hidden ones cannot
    expect(k.applyAction(s, order('E', 'theft', 2), ctx(H_N))).toMatchObject({
      ok: false,
      code: 'E_NO_AGENT',
    });
    // spy 1 called home has no home to go to: it lies low where it is
    s = ok(k.applyAction(s, act('p1', 'espionage.cancel', { spyId: 1 }), ctx(H_N))).state;
    expect(spy1(s)).toMatchObject({ state: 'hidden', location: 'N' });
    // a new capital: everyone heads there from where they lie low
    s = ok(k.applyAction(s, act('p1', 'capital.designate', { planetId: 'G' }), ctx(H_N))).state;
    expect(spy1(s)).toMatchObject({ state: 'return', from: 'N', location: 'G' });
    expect(s.spies?.p1?.[1]).toMatchObject({ state: 'return', location: 'G' });
  });
});

describe('SPY-23 — waiting is not safe on a hostile world', () => {
  it('every 12 h the waiting spy is checked at half the odds of a working one', () => {
    const seen: number[] = [];
    const probe: GameModule = {
      id: 'probe',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('espionage.detect', (v, args) => {
          if ((args as { kind?: string }).kind === 'wait') seen.push(v);
          return 0;
        });
      },
    };
    const k = kernel(probe);
    const there = advance(
      k,
      ok(k.applyAction(baseState(), order('E', 'relocate'), ctx(0))).state,
      H_E,
    );
    advance(k, there.state, H_E + 12 * HOUR - 1);
    expect(seen).toEqual([]);
    advance(k, there.state, H_E + 24 * HOUR);
    expect(seen).toEqual([0.125, 0.125]); // ½ × the bare 0.25 of a clean deed
  });

  it('caught waiting: exposed, and home if it lives', () => {
    const k = kernel(pin('seen', 'espionage.detect', 1), pin('lives', 'espionage.kill', 0));
    const there = advance(
      k,
      ok(k.applyAction(baseState(), order('E', 'relocate'), ctx(0))).state,
      H_E,
    );
    const r = advance(k, there.state, H_E + 12 * HOUR);
    expect(ofType(r.events, 'espionage.caught')[0]!.payload).toEqual({
      owner: 'p1',
      spyId: 1,
      planetId: 'E',
    });
    expect(ofType(r.events, 'espionage.exposed')).toHaveLength(1);
    expect(ofType(r.events, 'espionage.detected')[0]!.payload).toMatchObject({
      owner: 'p2',
      kind: 'wait',
      spy: 'p1',
    });
    expect(spy1(r.state)).toMatchObject({ state: 'return', location: 'H' });
  });

  it('on its own or a neutral world it waits in peace', () => {
    const k = kernel(pin('seen', 'espionage.detect', 1));
    const there = advance(
      k,
      ok(k.applyAction(baseState(), order('N', 'relocate'), ctx(0))).state,
      H_N,
    );
    const r = advance(k, there.state, H_N + 48 * HOUR);
    expect(ofType(r.events, 'espionage.caught')).toEqual([]);
    expect(spy1(r.state)).toMatchObject({ state: 'wait', location: 'N' });
  });
});

describe('SPY-23 — older saves', () => {
  it('anonymous agents from before named spies are all home at once, their posts closed', () => {
    const k = kernel();
    const s = baseState() as GameState & { spyAgents?: unknown; spyTurned?: unknown };
    s.spyAgents = {
      p1: [
        { until: Number.MAX_SAFE_INTEGER, mission: 1, op: 'recon', planetId: 'E', posted: true },
      ],
    };
    s.spyTurned = { p2: [5 * HOUR] };
    s.intel = {
      p1: [
        { kind: 'planet', target: 'E', until: Number.MAX_SAFE_INTEGER, layer: 2, mission: 1 },
        { kind: 'planet', target: 'F', until: 9 * HOUR },
      ],
    };
    s.scheduled = [
      {
        id: 'evt:old',
        at: HOUR,
        seq: 0,
        type: 'espionage.deepen',
        payload: { spy: 'p1', planetId: 'E', mission: 1 },
      },
    ];
    s.scheduleSeq = 1;
    const r = advance(k, s, 2 * HOUR);
    const after = r.state as GameState & { spyAgents?: unknown; spyTurned?: unknown };
    expect(after.spyAgents).toBeUndefined();
    expect(after.spyTurned).toBeUndefined();
    expect(after.intel).toEqual({ p1: [{ kind: 'planet', target: 'F', until: 9 * HOUR }] });
    expect(spyRoster(after, 'p1').every((x) => x.state === 'rest')).toBe(true);
  });
});
