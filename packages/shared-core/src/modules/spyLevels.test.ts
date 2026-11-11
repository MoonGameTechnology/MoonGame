import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { espionageModule, MISSION_HOURS } from './espionage';
import { diplomacyModule } from './diplomacy';
import { spyLevelsModule } from './spyLevels';
import { seedRng } from '../rng/rng';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';
import type { GameModule } from '../kernel/module';
import { instantSpies, spyMap } from '../testkit/spies';

// Spy experience and levels (owner's resolution 2026-11-10).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const END = MISSION_HOURS * HOUR;
const ctx = (now = 0): Context => ({ now, data });

/** Pins a pipeline to `value` — placed AFTER `spy-levels`, so it overrides the level bonus. */
const pin = (hook: string, value: number): GameModule => ({
  id: `pin:${hook}:${value}`,
  version: '1.0.0',
  setup(api) {
    api.hook<number>(hook, () => value);
  },
});
/** Records what a pipeline hands on, after `spy-levels` bent it. */
function probe(hook: string) {
  const seen: number[] = [];
  const mod: GameModule = {
    id: `probe:${hook}`,
    version: '1.0.0',
    setup(api) {
      api.hook<number>(hook, (v) => (seen.push(v), v));
    },
  };
  return { seen, mod };
}

function player(id: string): Player {
  return { id, name: id, faction: '', status: 'active', resources: { credits: 5000 } };
}
function planet(id: string, owner: string | null, x = 0): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function baseState(): GameState {
  const s = createInitialState({ seed: 'levels', version: { data: '0.1.0', manifest: '1' } });
  return spyMap({
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: { A: planet('A', 'p1'), B: planet('B', 'p2', 10_000), C: planet('C', 'p3', 20_000) },
  });
}
let seq = 0;
const spy = (playerId: string, planetId: string, op: string): Action => ({
  id: `s:${++seq}`,
  type: 'espionage.spy',
  playerId,
  payload: { planetId, op },
  issuedAt: 0,
});
const ofType = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type);

function kernel(extra: GameModule[] = []) {
  return createKernel([diplomacyModule, espionageModule, spyLevelsModule, instantSpies, ...extra]);
}
function play(
  k: ReturnType<typeof kernel>,
  s: GameState,
  actions: Action[],
  at: number,
  to: number,
) {
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
const xpOf = (s: GameState, owner: string, id = 1) =>
  s.spies?.[owner]?.find((x) => x.id === id)?.xp;

describe('spy experience — deeds', () => {
  it('a successful theft, sabotage or disruption is worth 1 point and level 1', () => {
    for (const op of ['theft', 'sabotage', 'disrupt', 'delay', 'research']) {
      const k = kernel([pin('espionage.chance', 1), pin('espionage.detect', 0)]);
      const { state, events } = play(k, baseState(), [spy('p1', 'B', op)], 0, END);
      expect(xpOf(state, 'p1')).toBe(1);
      expect(ofType(events, 'espionage.levelUp').map((e) => e.payload)).toEqual([
        { owner: 'p1', spyId: 1, level: 1 },
      ]);
    }
  });

  it('a failure gives nothing, and a spy killed on its deed takes nothing home', () => {
    // The core never lets the odds fall below 5%: look at the seeds whose roll failed.
    let failures = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const k = kernel([pin('espionage.chance', 0), pin('espionage.detect', 0)]);
      const failed = play(
        k,
        { ...baseState(), rng: seedRng(seed) },
        [spy('p1', 'B', 'theft')],
        0,
        END,
      );
      if (ofType(failed.events, 'espionage.failed').length === 0) continue;
      failures++;
      expect(xpOf(failed.state, 'p1')).toBeUndefined();
    }
    expect(failures).toBeGreaterThan(0);
    const killed = play(
      kernel([pin('espionage.chance', 1), pin('espionage.detect', 1), pin('espionage.kill', 1)]),
      baseState(),
      [spy('p1', 'B', 'theft')],
      0,
      END,
    );
    expect(xpOf(killed.state, 'p1')).toBeUndefined();
  });
});

describe('spy experience — recon', () => {
  it('0.25 for every full day on post; an unfinished day earns nothing', () => {
    const k = kernel([pin('espionage.chance', 1), pin('espionage.detect', 0)]);
    const posted = play(k, baseState(), [spy('p1', 'B', 'recon')], 0, END + 24 * HOUR - 1);
    expect(xpOf(posted.state, 'p1')).toBeUndefined();
    const day = k.advanceTo(posted.state, ctx(END + 24 * HOUR));
    if (!day.ok) throw new Error(day.code);
    expect(xpOf(day.state, 'p1')).toBe(0.25);
    const three = k.advanceTo(day.state, ctx(END + 72 * HOUR));
    if (!three.ok) throw new Error(three.code);
    expect(xpOf(three.state, 'p1')).toBe(0.75);
  });

  it('a spy caught before the day is out keeps what it earned and gets no more', () => {
    const k = kernel([pin('espionage.chance', 1), pin('espionage.detect', 0)]);
    const day = play(k, baseState(), [spy('p1', 'B', 'recon')], 0, END + 30 * HOUR);
    expect(xpOf(day.state, 'p1')).toBe(0.25);
    // From now on every check exposes it (but leaves it alive): the next deepen, at 36h.
    const caught = createKernel([
      diplomacyModule,
      espionageModule,
      spyLevelsModule,
      instantSpies,
      pin('espionage.detect', 1),
      pin('espionage.kill', 0),
    ]);
    const after = caught.advanceTo(day.state, ctx(END + 96 * HOUR));
    if (!after.ok) throw new Error(after.code);
    expect(xpOf(after.state, 'p1')).toBe(0.25);
  });
});

describe('spy experience — counter-intelligence', () => {
  /** p2's and its ally p3's guards stand on B (p2's guard with `veteran` points); p1 steals there. */
  function guarded(veteran: number) {
    const s = baseState();
    setStance(s, 'p2', 'p3', 'alliance');
    const k = kernel();
    const posted = play(k, s, [spy('p2', 'B', 'counter'), spy('p3', 'B', 'counter')], 0, END);
    const st = posted.state;
    st.spies!.p2![0]!.xp = veteran;
    return st;
  }
  const raid = (mods: GameModule[], s: GameState) =>
    play(
      kernel([pin('espionage.chance', 1), pin('espionage.detect', 1), ...mods]),
      s,
      [spy('p1', 'B', 'theft')],
      END,
      2 * END,
    );

  it('a kill (1 point) is split: the veteran 0.75, the recruit 0.25 — allies count too', () => {
    const { state } = raid([pin('espionage.kill', 1)], guarded(5));
    expect(xpOf(state, 'p2')).toBe(5.75);
    expect(xpOf(state, 'p3')).toBe(0.25);
  });

  it('a catch (0.5) goes all to the veteran', () => {
    const { state } = raid([pin('espionage.kill', 0)], guarded(5));
    expect(xpOf(state, 'p2')).toBe(5.5);
    expect(xpOf(state, 'p3')).toBeUndefined();
  });

  it('a turn is worth 1.25: 1 and 0.25', () => {
    const { state } = raid([pin('espionage.kill', 1), pin('espionage.turn', 1)], guarded(5));
    expect(xpOf(state, 'p2')).toBe(6);
    expect(xpOf(state, 'p3')).toBe(0.25);
  });

  it('a catch with no guard on the world gives nobody experience', () => {
    const { state, events } = raid([pin('espionage.kill', 1)], baseState());
    expect(ofType(events, 'espionage.xp')).toEqual([]);
    expect(state.spies?.p2).toBeUndefined();
  });
});

describe('spy level bonuses', () => {
  /** p1's spy 1 with `xp` points. */
  function seasoned(xp: number): GameState {
    const k = kernel([pin('espionage.chance', 1), pin('espionage.detect', 0)]);
    const s = play(k, baseState(), [spy('p1', 'B', 'theft')], 0, END).state; // spy 1 exists, home
    s.spies!.p1![0]!.xp = xp;
    return s;
  }

  it('each level adds 5% to success and takes 5% off detection', () => {
    const chance = probe('espionage.chance');
    const detect = probe('espionage.detect');
    const mods = [chance.mod, detect.mod, pin('espionage.chance', 1)];
    play(kernel(mods), seasoned(7), [spy('p1', 'B', 'theft')], END, 2 * END);
    play(kernel(mods), seasoned(0), [spy('p1', 'B', 'theft')], END, 2 * END);
    expect(chance.seen[0]! - chance.seen[1]!).toBeCloseTo(0.15);
    expect(detect.seen[1]! - detect.seen[0]!).toBeCloseTo(0.15);
  });

  it('each level adds 10% to quality and to speed', () => {
    const quality = probe('espionage.quality');
    play(
      kernel([pin('espionage.chance', 1), quality.mod]),
      seasoned(3),
      [spy('p1', 'B', 'theft')],
      END,
      2 * END,
    );
    expect(quality.seen[0]).toBeCloseTo(1.2);
    // Without `instantSpies`, so the journey asks the real speed pipeline.
    const speed = probe('espionage.speed');
    const k = createKernel([diplomacyModule, espionageModule, spyLevelsModule, speed.mod]);
    const r = k.applyAction(seasoned(1), spy('p1', 'B', 'theft'), ctx(END));
    if (!r.ok) throw new Error(r.code);
    expect(speed.seen[0]).toBeCloseTo(1.1);
  });
});
