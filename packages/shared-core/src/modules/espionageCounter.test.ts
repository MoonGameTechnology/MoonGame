import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { COUNTER_POSTED, espionageModule, MISSION_HOURS } from './espionage';
import { diplomacyModule } from './diplomacy';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { getStance, setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

// SPY-11: the counter-intelligence agent and war on exposure.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: { cruiser: { faction: 'x', stats: { attack: 4, defense: 4, speed: 6, hp: 20 } } },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const END = MISSION_HOURS * HOUR;
const ctx = (now = 0): Context => ({ now, data });

const pin = (id: string, hook: string, value: number): GameModule => ({
  id,
  version: '1.0.0',
  setup(api) {
    api.hook<number>(hook, () => value);
  },
});
/** Records the base detect / kill odds the pipelines receive. */
function probe() {
  const seen = { detect: [] as number[], kill: [] as number[] };
  const mod: GameModule = {
    id: 'probe',
    version: '1.0.0',
    setup(api) {
      api.hook<number>('espionage.detect', (base) => (seen.detect.push(base), base));
      api.hook<number>('espionage.kill', (base) => (seen.kill.push(base), base));
    },
  };
  return { seen, mod };
}

function player(id: string): Player {
  return { id, name: id, faction: '', status: 'active', resources: { credits: 5000 } };
}
function planet(id: string, owner: string | null, x = 0): Planet {
  return { id, owner, position: { x, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] };
}
function baseState(): GameState {
  const s = createInitialState({ seed: 'counter', version: { data: '0.1.0', manifest: '1' } });
  const out: GameState = {
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: { A: planet('A', 'p1'), B: planet('B', 'p2', 10_000), N: planet('N', null, 20_000) },
  };
  return out;
}
let seq = 0;
function spy(playerId: string, planetId: string, op: string): Action {
  return { id: `s:${++seq}`, type: 'espionage.spy', playerId, payload: { planetId, op }, issuedAt: 0 };
}
function recall(playerId: string, planetId: string): Action {
  return { id: `r:${++seq}`, type: 'espionage.recall', playerId, payload: { planetId }, issuedAt: 0 };
}
const ofType = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type);

function kernel(extra: GameModule[] = []) {
  return createKernel([diplomacyModule, espionageModule, ...extra]);
}
/** Apply `actions` at `at`, then run the clock to `to`. */
function play(k: ReturnType<typeof kernel>, s: GameState, actions: Action[], at: number, to: number) {
  let st = s;
  const events: DomainEvent[] = [];
  for (const a of actions) {
    const r = k.applyAction(st, a, ctx(at));
    if (!r.ok) throw new Error(`${a.type}: ${r.code}`);
    st = r.state;
    events.push(...r.events);
  }
  const done = k.advanceTo(st, ctx(to));
  if (!done.ok) throw new Error(done.code);
  return { state: done.state, events: [...events, ...done.events] };
}

describe('SPY-11 — posting a counter-intelligence agent', () => {
  it('guards your own world: posted after 12h and stays until recalled', () => {
    const k = kernel();
    const { state, events } = play(k, baseState(), [spy('p1', 'A', 'counter')], 0, END + 5 * 24 * HOUR);
    expect(ofType(events, 'espionage.posted').map((e) => e.payload)).toEqual([{ owner: 'p1', planetId: 'A' }]);
    expect(state.spyAgents?.p1).toEqual([
      { until: COUNTER_POSTED, mission: 1, op: 'counter', planetId: 'A', posted: true },
    ]);
    const back = k.applyAction(state, recall('p1', 'A'), ctx(END + 5 * 24 * HOUR));
    if (!back.ok) throw new Error(back.code);
    expect(back.state.spyAgents?.p1).toEqual([{ until: END + 5 * 24 * HOUR + 6 * HOUR }]);
  });

  it('an unowned world cannot be guarded; one guard per world', () => {
    const k = kernel();
    expect((k.applyAction(baseState(), spy('p1', 'N', 'counter'), ctx(0)) as { code?: string }).code).toBe(
      'E_BAD_TARGET',
    );
    const once = k.applyAction(baseState(), spy('p1', 'A', 'counter'), ctx(0));
    if (!once.ok) throw new Error(once.code);
    expect((k.applyAction(once.state, spy('p1', 'A', 'counter'), ctx(0)) as { code?: string }).code).toBe(
      'E_BAD_TARGET',
    );
  });

  it('recalled on the way, it never takes the post', () => {
    const k = kernel();
    const { state, events } = play(k, baseState(), [spy('p1', 'A', 'counter'), recall('p1', 'A')], 0, END);
    expect(ofType(events, 'espionage.posted')).toEqual([]);
    expect(state.spyAgents?.p1).toBeUndefined(); // back home after 6h, swept by housekeeping
  });

  it('recall with nothing to recall is refused', () => {
    const r = kernel().applyAction(baseState(), recall('p1', 'A'), ctx(0));
    expect(r.ok ? null : r.code).toBe('E_BAD_TARGET');
  });
});

describe('SPY-11 — the guard against aggressive missions', () => {
  const posted = (s: GameState, owner: string, planetId: string): GameState => ({
    ...s,
    spyAgents: { [owner]: [{ until: COUNTER_POSTED, mission: 1, op: 'counter', planetId, posted: true }] },
  });
  const never = [pin('d0', 'espionage.chance', 0)];

  it('adds +0.2 detect / +0.15 kill against a foreign spy', () => {
    const { seen, mod } = probe();
    play(kernel([...never, mod]), posted(baseState(), 'p2', 'B'), [spy('p1', 'B', 'recon')], 0, END);
    expect(seen.detect[0]).toBeCloseTo(0.5 + 0.2);
    expect(seen.kill[0]).toBeCloseTo(0.5 + 0.15);
  });

  it('a third party guarding the world counts too — but not against its own ally', () => {
    const third = posted(baseState(), 'p3', 'B');
    const a = probe();
    play(kernel([...never, a.mod]), third, [spy('p1', 'B', 'recon')], 0, END);
    expect(a.seen.detect[0]).toBeCloseTo(0.7);
    const allied = posted(baseState(), 'p3', 'B');
    setStance(allied, 'p1', 'p3', 'alliance');
    const b = probe();
    play(kernel([...never, b.mod]), allied, [spy('p1', 'B', 'recon')], 0, END);
    expect(b.seen.detect[0]).toBeCloseTo(0.5);
  });
});

describe('SPY-11 — war on exposure', () => {
  const caught = [pin('miss', 'espionage.chance', 0), pin('seen', 'espionage.detect', 1), pin('live', 'espionage.kill', 0)];

  it('a detected spy declares war between the world owner and its owner — an alliance breaks', () => {
    const s = baseState();
    setStance(s, 'p1', 'p2', 'alliance');
    const { state, events } = play(kernel(caught), s, [spy('p1', 'B', 'sabotage')], 0, END);
    expect(getStance(state, 'p1', 'p2')).toBe('war');
    expect(ofType(events, 'diplomacy.changed').map((e) => e.payload)).toContainEqual({
      a: 'p2',
      b: 'p1',
      stance: 'war',
      from: 'alliance',
      cause: 'espionage',
    });
  });

  it('an unnoticed spy changes nothing', () => {
    const s = baseState();
    setStance(s, 'p1', 'p2', 'pact');
    const quiet = [pin('miss', 'espionage.chance', 0), pin('unseen', 'espionage.detect', 0)];
    const { state } = play(kernel(quiet), s, [spy('p1', 'B', 'theft')], 0, END);
    expect(getStance(state, 'p1', 'p2')).toBe('pact');
  });

  it('without the diplomacy module exposure stays a report, not a crash', () => {
    const k = createKernel([espionageModule, ...caught]);
    const sent = k.applyAction(baseState(), spy('p1', 'B', 'recon'), ctx(0));
    if (!sent.ok) throw new Error(sent.code);
    const done = k.advanceTo(sent.state, ctx(END));
    expect(done.ok).toBe(true);
  });
});

describe('SPY-11 — guard against guard', () => {
  /** p1 and p2 both guard world `w`; the sweep of each hunts the other when at war. */
  const bothPosted = (w: string): GameState => ({
    ...baseState(),
    spyAgents: {
      p1: [{ until: COUNTER_POSTED, mission: 1, op: 'counter', planetId: w, posted: true }],
      p2: [{ until: COUNTER_POSTED, mission: 1, op: 'counter', planetId: w, posted: true }],
    },
  });
  /** Kick off p1's sweep by posting a fresh p1 guard through the kernel. */
  function sweeps(s: GameState, days: number) {
    const k = kernel();
    const start: GameState = { ...s, spyAgents: { p2: s.spyAgents!.p2! } };
    return play(k, start, [spy('p1', 'B', 'counter')], 0, END + days * 24 * HOUR);
  }

  it('at war, a guard sooner or later catches the enemy guard — and no war is declared anew', () => {
    const s = bothPosted('B');
    setStance(s, 'p1', 'p2', 'war');
    const { state, events } = sweeps(s, 30);
    const hit = ofType(events, 'espionage.counter.caught');
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]!.payload).toMatchObject({ owner: 'p1', planetId: 'B', spy: 'p2' });
    expect(ofType(events, 'espionage.counter.lost')[0]!.payload).toMatchObject({ owner: 'p2', planetId: 'B' });
    expect((state.spyAgents?.p2 ?? []).some((a) => a.posted)).toBe(false);
    expect(ofType(events, 'diplomacy.changed')).toEqual([]);
  });

  it('at peace, guards on the same world leave each other alone', () => {
    const s = bothPosted('B');
    setStance(s, 'p1', 'p2', 'peace');
    const { events } = sweeps(s, 30);
    expect(ofType(events, 'espionage.counter.caught')).toEqual([]);
  });
});
