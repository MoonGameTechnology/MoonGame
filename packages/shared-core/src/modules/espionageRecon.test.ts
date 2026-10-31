import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { COUNTER_POSTED, espionageModule, MISSION_HOURS, RECON_LAYERS } from './espionage';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { visibleState } from '../state/visibility';
import { offerKey } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context, DomainEvent as GameEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

/** SPY-13 — recon that accumulates: the agent stays on post and digs a layer deeper
 *  every 12 h, re-rolling exposure at every step. */
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
const STEP = 12 * HOUR;
const ctx = (now: number): Context => ({ now, data });

const pin = (id: string, name: string, fn: (now: number) => number): GameModule => ({
  id,
  version: '1.0.0',
  setup(api) {
    api.hook<number>(name, (_cur, _args, h) => fn(h.ctx.now));
  },
});
const sureShot = pin('sure', 'espionage.chance', () => 1);
const neverDetect = pin('never-detect', 'espionage.detect', () => 0);
/** Clean arrival, exposure at the first step on post. */
const caughtOnPost = pin('caught-on-post', 'espionage.detect', (now) => (now > END ? 1 : 0));
const neverKill = pin('never-kill', 'espionage.kill', () => 0);
const alwaysKill = pin('always-kill', 'espionage.kill', () => 1);

function player(id: string): Player {
  return { id, name: id, faction: '', status: 'active', resources: { credits: 10_000 } };
}
function planet(id: string, owner: string | null, x: number): Planet {
  return { id, owner, position: { x, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] };
}
function baseState(): GameState {
  const s = createInitialState({ seed: 'recon', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: { B: planet('B', 'p2', 0), C: planet('C', 'p3', 10_000), H: planet('H', 'p1', -10_000) },
  };
}
const act = (playerId: string, type: string, payload: unknown): Action => ({
  id: `${type}:${playerId}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function errCode(r: ApplyResult): string {
  if (r.ok) throw new Error('expected a rejection');
  return r.code;
}
const ofType = (events: GameEvent[], type: string) => events.filter((e) => e.type === type);

/** A recon agent sent at 0 onto B, the world clock run to `to`. */
function posted(modules: GameModule[], to: number, s = baseState()) {
  const k = createKernel([espionageModule, sureShot, ...modules]);
  const sent = okApply(k.applyAction(s, act('p1', 'espionage.spy', { planetId: 'B', op: 'recon' }), ctx(0)));
  const r = k.advanceTo(sent.state, ctx(to));
  if (!r.ok) throw new Error(r.code);
  return { k, state: r.state, events: r.events };
}
const layerOf = (s: GameState) => s.intel?.p1?.find((g) => g.target === 'B')?.layer;

describe('SPY-13 — recon accumulates layers while the agent stays on post', () => {
  it('layer N opens only after (N−1)×12 h on post, and stops at the last one', () => {
    expect(layerOf(posted([neverDetect], END + STEP - 1).state)).toBe(1);
    const second = posted([neverDetect], END + STEP);
    expect(layerOf(second.state)).toBe(2);
    expect(ofType(second.events, 'intel.deepened')).toEqual([
      { type: 'intel.deepened', payload: { owner: 'p1', target: 'p2', planetId: 'B', layer: 2 } },
    ]);
    expect(layerOf(posted([neverDetect], END + 3 * STEP - 1).state)).toBe(3);
    const last = posted([neverDetect], END + 5 * STEP);
    expect(layerOf(last.state)).toBe(RECON_LAYERS);
    expect(ofType(last.events, 'intel.deepened')).toHaveLength(RECON_LAYERS - 1);
    // past the last layer the agent keeps the watch — and its risk
    expect(last.state.spyAgents?.p1?.[0]).toMatchObject({ posted: true, op: 'recon' });
    expect(last.state.scheduled.some((e) => e.type === 'espionage.deepen')).toBe(true);
  });

  it('exposure on post closes every layer, sends the agent home and tells the victim (not who)', () => {
    const r = posted([caughtOnPost, neverKill], END + STEP);
    expect(r.state.intel).toBeUndefined();
    expect(r.state.spyAgents?.p1).toEqual([{ until: END + STEP + 6 * HOUR }]);
    expect(ofType(r.events, 'intel.lost')).toEqual([
      { type: 'intel.lost', payload: { owner: 'p1', target: 'p2', planetId: 'B' } },
    ]);
    expect(ofType(r.events, 'espionage.detected')).toEqual([
      { type: 'espionage.detected', payload: { owner: 'p2', kind: 'recon', planetId: 'B' } },
    ]);
    expect(r.state.scheduled.some((e) => e.type === 'espionage.deepen')).toBe(false);
  });

  it('a killed agent on post is lost for a day', () => {
    const r = posted([caughtOnPost, alwaysKill], END + STEP);
    expect(r.state.intel).toBeUndefined();
    expect(r.state.spyAgents?.p1).toEqual([{ until: END + STEP + 24 * HOUR, lost: true }]);
    expect(ofType(r.events, 'intel.lost')[0]?.payload).toMatchObject({ agentLost: true });
    expect(ofType(r.events, 'espionage.detected')[0]?.payload).toMatchObject({ killed: true });
  });

  it('a recall closes every layer; the next step finds nobody on post', () => {
    const { k, state } = posted([neverDetect], END + 2 * STEP);
    const at = END + 2 * STEP;
    const r = okApply(k.applyAction(state, act('p1', 'espionage.recall', { planetId: 'B', op: 'recon' }), ctx(at)));
    expect(r.state.intel).toBeUndefined();
    expect(r.state.spyAgents?.p1).toEqual([{ until: at + 6 * HOUR }]);
    expect(r.events).toEqual([
      { type: 'espionage.recalled', payload: { owner: 'p1', planetId: 'B', kind: 'recon' } },
    ]);
    const later = k.advanceTo(r.state, ctx(at + STEP));
    if (!later.ok) throw new Error(later.code);
    expect(ofType(later.events, 'intel.deepened')).toEqual([]);
  });

  it('fail-secure: no recall of a recon agent still on its way, nor of one by the counter path', () => {
    const k = createKernel([espionageModule, sureShot, neverDetect]);
    const sent = okApply(k.applyAction(baseState(), act('p1', 'espionage.spy', { planetId: 'B', op: 'recon' }), ctx(0)));
    expect(errCode(k.applyAction(sent.state, act('p1', 'espionage.recall', { planetId: 'B', op: 'recon' }), ctx(1)))).toBe(
      'E_BAD_TARGET',
    );
    const { state } = posted([neverDetect], END + 1);
    expect(errCode(k.applyAction(state, act('p1', 'espionage.recall', { planetId: 'B' }), ctx(END + 1)))).toBe(
      'E_BAD_TARGET',
    );
    expect(errCode(k.applyAction(state, act('p1', 'espionage.recall', { planetId: 'B', op: 'theft' }), ctx(END + 1)))).toBe(
      'E_BAD_PAYLOAD',
    );
  });

  it('one recon agent per world', () => {
    const { k, state } = posted([neverDetect], END + 1);
    expect(errCode(k.applyAction(state, act('p1', 'espionage.spy', { planetId: 'B', op: 'recon' }), ctx(END + 1)))).toBe(
      'E_BAD_TARGET',
    );
  });

  it('the world no longer hostile at a step: the agent comes home, nothing stays open', () => {
    const { k, state } = posted([neverDetect], END + 1);
    state.planets.B!.owner = 'p1'; // the spy took it
    const r = k.advanceTo(state, ctx(END + STEP));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.intel).toBeUndefined();
    expect(ofType(r.events, 'espionage.aborted')).toEqual([
      { type: 'espionage.aborted', payload: { owner: 'p1', planetId: 'B', kind: 'recon' } },
    ]);
  });

  it('a posted recon agent is no counter-intelligence guard for its owner', () => {
    const { state } = posted([neverDetect], END + 1);
    const seen: number[] = [];
    const probe: GameModule = {
      id: 'probe',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('espionage.detect', (cur) => {
          seen.push(cur);
          return 0;
        });
      },
    };
    // p3 spies on B, where p1 (no ally of p3) has a recon agent posted
    const k = createKernel([espionageModule, sureShot, probe]);
    const sent = okApply(k.applyAction(state, act('p3', 'espionage.spy', { planetId: 'B', op: 'theft' }), ctx(END + 1)));
    const r = k.advanceTo(sent.state, ctx(2 * END + 1));
    if (!r.ok) throw new Error(r.code);
    expect(seen).toContain(0.25); // the bare base for a success, no guard bonus
  });
});

describe('SPY-13 — the projection opens each layer to the spy alone', () => {
  function spied(layer: number): GameState {
    const s = baseState();
    s.players.p2!.resources = { credits: 777 };
    s.players.p2!.technologies = { completed: ['optics'], active: [] };
    s.planets.B!.buildQueue = [{ id: 7, kind: 'unit', playerId: 'p2', unit: 'cruiser', count: 2 }];
    s.scheduled = [{ id: 'evt:1', at: 5 * HOUR, seq: 1, type: 'construction.complete', payload: { playerId: 'p2', planetId: 'B', kind: 'unit', unit: 'cruiser', count: 1 } }];
    s.diplomacyOffers = { [offerKey('p2', 'p3')]: 'peace' };
    s.intel = { p1: [{ kind: 'planet', target: 'B', until: COUNTER_POSTED, layer, mission: 1 }] };
    return s;
  }

  it('layer 1: the world only', () => {
    const v = visibleState(spied(1), 'p1', data);
    expect(v.players.p2?.resources).toEqual({});
    expect(v.players.p2?.technologies).toBeUndefined();
    expect(v.planets.B?.buildQueue).toBeUndefined();
    expect(v.scheduled).toEqual([]);
  });

  it('layer 2: the owner treasury', () => {
    const v = visibleState(spied(2), 'p1', data);
    expect(v.players.p2?.resources).toEqual({ credits: 777 });
    expect(v.planets.B?.buildQueue).toBeUndefined();
  });

  it('layer 3: the world queue, the order under way and the owner research', () => {
    const v = visibleState(spied(3), 'p1', data);
    expect(v.planets.B?.buildQueue).toHaveLength(1);
    expect(v.scheduled.map((e) => e.type)).toEqual(['construction.complete']);
    expect(v.players.p2?.technologies?.completed).toEqual(['optics']);
    expect(v.diplomacyOffers).toBeUndefined();
  });

  it('layer 4: the owner pending offers', () => {
    expect(Object.keys(visibleState(spied(4), 'p1', data).diplomacyOffers ?? {})).toEqual([offerKey('p2', 'p3')]);
  });

  it('a bystander sees none of it, even at the deepest layer', () => {
    const v = visibleState(spied(4), 'p3', data);
    expect(v.players.p2?.resources).toEqual({});
    expect(v.players.p2?.technologies).toBeUndefined();
    expect(v.planets.B?.buildQueue).toBeUndefined();
    expect(v.scheduled).toEqual([]);
    expect(JSON.stringify(v)).not.toContain('intel');
  });
});
