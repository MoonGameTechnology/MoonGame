import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { espionageModule } from './espionage';
import { capitalModule } from './capital';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { spyTurnBack, spyWay, spyWayAt, SPY_SPEED } from '../state/spyTravel';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { scoutedAll } from '../testkit/spies';

// SPM-1: a spy's journey keeps its way — the worlds it passes and when — so the owner's map
// shows the lanes it really flies, and a spy called off retraces them.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });

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
/** H (p1's capital) — N (nobody's) — E (p2's, at war) — F (p2's capital), 640 apart. */
function baseState(): GameState {
  const s = createInitialState({ seed: 'way', version: { data: '0.1.0', manifest: '1' } });
  const out: GameState = {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      H: planet('H', 'p1', 0, ['N']),
      N: planet('N', null, 640, ['H', 'E']),
      E: planet('E', 'p2', 1280, ['N', 'F']),
      F: planet('F', 'p2', 1920, ['E']),
    },
    capital: { p1: 'H', p2: 'F' },
  };
  return { ...out, scouted: scoutedAll(out) };
}
/** H → N: 320 at home + 320 over N at ¾; N → E: 320 at ¾ + 320 at war at ½. */
const H_N = Math.round(((320 + 320 / 0.75) / SPY_SPEED) * HOUR);
const H_E = Math.round(((320 + 320 / 0.75 + 320 / 0.75 + 320 / 0.5) / SPY_SPEED) * HOUR);

let seq = 0;
const act = (type: string, payload: unknown): Action => ({
  id: `${type}:${++seq}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
function ok(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
const kernel = () => createKernel([capitalModule, espionageModule]);
const spy1 = (s: GameState) => s.spies?.p1?.find((x) => x.id === 1);

describe('SPM-1 — the way of a journey', () => {
  it('times each world by the territory-weighted length flown to it', () => {
    const way = spyWay(baseState(), 'p1', 'H', 'E', 1000, 1000 + H_E);
    expect(way.map((p) => p.at)).toEqual(['H', 'N', 'E']);
    expect(way[0]!.t).toBe(1000);
    expect(Math.abs(way[1]!.t - (1000 + H_N))).toBeLessThanOrEqual(1);
    expect(way[2]!.t).toBe(1000 + H_E);
  });

  it('a journey of no lanes is the one world; no route is a straight line', () => {
    expect(spyWay(baseState(), 'p1', 'H', 'H', 5, 9)).toEqual([{ at: 'H', t: 9 }]);
    const s = baseState();
    s.planets.F!.links = [];
    s.planets.E!.links = ['N'];
    expect(spyWay(s, 'p1', 'H', 'F', 0, 10)).toEqual([
      { at: 'H', t: 0 },
      { at: 'F', t: 10 },
    ]);
  });

  it('where on its way the spy is: the lane and the share of it flown', () => {
    const way = [
      { at: 'H', t: 0 },
      { at: 'N', t: 100 },
      { at: 'E', t: 300 },
    ];
    expect(spyWayAt(way, -5)).toEqual({ a: 'H', b: 'H', f: 0 });
    expect(spyWayAt(way, 50)).toEqual({ a: 'H', b: 'N', f: 0.5 });
    expect(spyWayAt(way, 200)).toEqual({ a: 'N', b: 'E', f: 0.5 });
    expect(spyWayAt(way, 300)).toEqual({ a: 'E', b: 'E', f: 0 });
    expect(spyWayAt(undefined, 0)).toBeNull();
  });

  it('turning back retraces the lanes from the very point where it turned', () => {
    const way = [
      { at: 'H', t: 0 },
      { at: 'N', t: 100 },
      { at: 'E', t: 300 },
    ];
    const back = spyTurnBack(way, 200)!;
    expect(back).toEqual([
      { at: 'E', t: 100 },
      { at: 'N', t: 300 },
      { at: 'H', t: 400 },
    ]);
    // at the turn it stands where it was flying out: halfway between N and E
    expect(spyWayAt(back, 200)).toEqual({ a: 'E', b: 'N', f: 0.5 });
    expect(spyTurnBack(way, 300)).toBeUndefined(); // already there
    expect(spyTurnBack(undefined, 10)).toBeUndefined();
  });
});

describe('SPM-1 — the espionage module keeps the way', () => {
  it('a spy sent out carries its way, and drops it on arrival', () => {
    const k = kernel();
    const sent = ok(
      k.applyAction(
        baseState(),
        act('espionage.spy', { planetId: 'E', op: 'relocate', spyId: 1 }),
        ctx(0),
      ),
    );
    const way = spy1(sent.state)!.way!;
    expect(way.map((p) => p.at)).toEqual(['H', 'N', 'E']);
    expect(way[2]!.t).toBe(spy1(sent.state)!.arrivesAt);
    const there = k.advanceTo(sent.state, ctx(H_E));
    if (!there.ok) throw new Error(there.code);
    expect(spy1(there.state)!.state).toBe('wait');
    expect(spy1(there.state)!.way).toBeUndefined();
  });

  it('a spy called off on its way turns back along its lanes, then home', () => {
    const k = kernel();
    const sent = ok(
      k.applyAction(
        baseState(),
        act('espionage.spy', { planetId: 'E', op: 'relocate', spyId: 1 }),
        ctx(0),
      ),
    );
    const at = H_N + 1000; // past N, on the lane to E
    const off = ok(k.applyAction(sent.state, act('espionage.cancel', { spyId: 1 }), ctx(at)));
    const spy = spy1(off.state)!;
    expect(spy.state).toBe('return');
    expect(spy.way!.map((p) => p.at)).toEqual(['E', 'N', 'H']);
    expect(spy.way![spy.way!.length - 1]!.t).toBe(spy.arrivesAt);
    const now = spyWayAt(spy.way, at)!;
    expect([now.a, now.b]).toEqual(['E', 'N']);
    const home = k.advanceTo(off.state, ctx(spy.arrivesAt!));
    if (!home.ok) throw new Error(home.code);
    expect(spy1(home.state)).toMatchObject({ state: 'rest', location: 'H' });
    expect(spy1(home.state)!.way).toBeUndefined();
  });
});
