import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { espionageModule, MISSION_HOURS, SPY_OP_COST } from './espionage';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { spyKnownOwner } from '../state/spyKnowledge';
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context, DomainEvent } from '../action/types';
import type { GameModule } from '../kernel/module';
import { instantSpies, spyMap, unscouted } from '../testkit/spies';

// SPY-24 (owner's report 2026-11-11): a spy order must not tell the player whose a world in
// the fog is. An order is checked against what the player knows — sight or an earlier recon
// by their spy; recon itself goes anywhere, unclaimed worlds included.

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
function planet(id: string, owner: string | null, x: number): Planet {
  return { id, owner, position: { x, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] };
}
/** H — p1's capital; S — p2's world next to it (in sight); B — p2's, N — nobody's, both far
 *  out in the fog. Nobody has reconnoitred anything. */
function fogged(): GameState {
  const s = createInitialState({ seed: 'fog', version: { data: '0.1.0', manifest: '1' } });
  return unscouted(
    spyMap({
      ...s,
      players: { p1: player('p1'), p2: player('p2') },
      planets: {
        H: planet('H', 'p1', 0),
        S: planet('S', 'p2', 50),
        B: planet('B', 'p2', 10_000),
        N: planet('N', null, -10_000),
      },
      capital: { p1: 'H', p2: 'S' },
    }),
  );
}
let seq = 0;
const order = (planetId: string, op: string): Action => ({
  id: `spy:${++seq}`,
  type: 'espionage.spy',
  playerId: 'p1',
  payload: { planetId, op },
  issuedAt: 0,
});
const kernel = (...extra: GameModule[]) => createKernel([espionageModule, instantSpies, ...extra]);
const code = (r: ApplyResult) => (r.ok ? 'ok' : r.code);
const ofType = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type);
function ok(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}

describe('SPY-24 — an order does not give away the owner of a world in the fog', () => {
  it.each(['sabotage', 'theft', 'research', 'delay', 'disrupt', 'counter'])(
    '%s: a held world and an unclaimed one in the fog give the same answer, nothing paid',
    (op) => {
      const k = kernel();
      const s = fogged();
      for (const world of ['B', 'N']) {
        const r = k.applyAction(s, order(world, op), ctx(0));
        expect(code(r)).toBe('E_UNSCOUTED');
      }
    },
  );

  it('recon goes to any world in the fog, held or unclaimed, at the same price', () => {
    const k = kernel();
    const paid = ['B', 'N'].map((world) => {
      const r = ok(k.applyAction(fogged(), order(world, 'recon'), ctx(0)));
      return 5000 - (r.state.players.p1!.resources.credits ?? 0);
    });
    expect(paid).toEqual([SPY_OP_COST.recon, SPY_OP_COST.recon]);
  });

  it('a world in sight takes an order as it is: the held one a deed, the unclaimed one none', () => {
    const k = kernel();
    const s = fogged();
    s.planets.N = planet('N', null, 60); // pulled into H's sight
    expect(code(k.applyAction(s, order('S', 'sabotage'), ctx(0)))).toBe('ok');
    expect(code(k.applyAction(s, order('N', 'sabotage'), ctx(0)))).toBe('E_BAD_TARGET');
  });

  it('recon of a held world, recalled, leaves the owner known: a deed may follow out of sight', () => {
    const k = kernel(sure, unseen);
    const sent = ok(k.applyAction(fogged(), order('B', 'recon'), ctx(0)));
    const posted = k.advanceTo(sent.state, ctx(END));
    if (!posted.ok) throw new Error(posted.code);
    const recall: Action = {
      id: 'recall:1',
      type: 'espionage.recall',
      playerId: 'p1',
      payload: { planetId: 'B', op: 'recon' },
      issuedAt: END,
    };
    const back = ok(k.applyAction(posted.state, recall, ctx(END)));
    expect(back.state.scouted?.p1?.B).toEqual({ owner: 'p2', at: END });
    expect(back.state.intel?.p1 ?? []).toEqual([]); // the window closed with the recall
    expect(code(k.applyAction(back.state, order('B', 'sabotage'), ctx(END)))).toBe('ok');
  });

  it('recon of an unclaimed world: no rolls, a plain look, the spy comes straight home', () => {
    const k = kernel();
    const sent = ok(k.applyAction(fogged(), order('N', 'recon'), ctx(0)));
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.rng).toEqual(sent.state.rng);
    expect(ofType(done.events, 'intel.stolen').map((e) => e.payload)).toEqual([
      { owner: 'p1', spyId: 1, target: null, kind: 'recon', planetId: 'N', until: END + 24 * HOUR },
    ]);
    expect(done.state.scouted?.p1?.N).toEqual({ owner: null, at: END });
    expect(done.state.spies?.p1?.[0]).toMatchObject({ state: 'rest', location: 'H' });
    expect(done.state.spies?.p1?.[0]?.posted).toBeUndefined();
    // Known to be unclaimed: a deed there is refused as on a world in sight.
    expect(code(k.applyAction(done.state, order('N', 'theft'), ctx(END)))).toBe('E_BAD_TARGET');
  });

  it('recon of a world whose owner is out of the game goes the same unguarded way', () => {
    const k = kernel();
    const s = fogged();
    s.players.p2!.status = 'defeated';
    const sent = ok(k.applyAction(s, order('B', 'recon'), ctx(0)));
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(ofType(done.events, 'intel.stolen')[0]?.payload).toMatchObject({ target: 'p2' });
    expect(ofType(done.events, 'espionage.detected')).toEqual([]);
    expect(done.state.rng).toEqual(sent.state.rng);
  });

  it('what the spy found goes stale quietly: the order is taken, the spy meets the truth there', () => {
    const k = kernel();
    const s = { ...fogged(), scouted: { p1: { B: { owner: 'p2', at: 0 } } } };
    s.planets.B = { ...s.planets.B!, owner: null }; // abandoned since, in the fog
    const sent = ok(k.applyAction(s, order('B', 'sabotage'), ctx(0)));
    expect(ofType(sent.events, 'espionage.waiting')).toHaveLength(1);
    expect(sent.state.players.p1!.resources.credits).toBe(5000 - SPY_OP_COST.sabotage);
  });

  it('a spy that got to a world knows whose it is: a move there opens the deeds, no recon needed', () => {
    const k = kernel();
    const moved = ok(k.applyAction(fogged(), order('B', 'relocate'), ctx(0)));
    expect(moved.state.scouted?.p1?.B).toEqual({ owner: 'p2', at: 0 });
    expect(code(k.applyAction(moved.state, order('B', 'sabotage'), ctx(0)))).toBe('ok');
    const stray = ok(k.applyAction(fogged(), order('N', 'relocate'), ctx(0)));
    expect(code(k.applyAction(stray.state, order('N', 'sabotage'), ctx(0)))).toBe('E_BAD_TARGET');
  });

  it('a spy on its way learns whose every world it passes', () => {
    // H — M — B in a line, no other lanes: a spy to B flies over M.
    const s = fogged();
    s.planets = {
      H: { ...s.planets.H!, links: ['M'] },
      M: { ...planet('M', 'p2', 5_000), links: ['H', 'B'] },
      B: { ...s.planets.B!, links: ['M'] },
      S: { ...s.planets.S!, links: [] },
      N: { ...s.planets.N!, links: [] },
    };
    const sent = ok(kernel().applyAction(s, order('B', 'relocate'), ctx(0)));
    expect(Object.keys(sent.state.scouted?.p1 ?? {}).sort()).toEqual(['B', 'M']);
  });

  it('no fog inside a coalition: a member’s world out of sight is known, and no target', () => {
    const k = kernel();
    const s: GameState = {
      ...fogged(),
      coalitions: {
        c1: { id: 'c1', founder: 'p1', members: ['p1', 'p2'], emblem: 'star', description: '' },
      },
    };
    expect(spyKnownOwner(s, 'p1', 'B', new Set())).toEqual({ owner: 'p2' });
    expect(code(k.applyAction(s, order('B', 'recon'), ctx(0)))).toBe('E_BAD_TARGET');
    expect(code(k.applyAction(s, order('B', 'counter'), ctx(0)))).toBe('ok');
  });

  it('the newer of the fog memory and the spy record says whose the world is', () => {
    const s = fogged();
    const none = new Set<string>();
    s.scouted = { p1: { B: { owner: 'p2', at: 10 } } };
    expect(spyKnownOwner(s, 'p1', 'B', none)).toEqual({ owner: 'p2' });
    s.fog = { p1: { B: { owner: null, garrison: [], buildings: [], at: 20 } } };
    expect(spyKnownOwner(s, 'p1', 'B', none)).toEqual({ owner: null });
    s.fog.p1!.B!.at = 5;
    expect(spyKnownOwner(s, 'p1', 'B', none)).toEqual({ owner: 'p2' });
    expect(spyKnownOwner(s, 'p1', 'N', none)).toBeUndefined();
    expect(spyKnownOwner(s, 'p1', 'H', none)).toEqual({ owner: 'p1' });
  });

  it('what the spies found is the spying player’s secret in the projection', () => {
    const s = {
      ...fogged(),
      scouted: { p1: { B: { owner: 'p2', at: 0 } }, p2: { H: { owner: 'p1', at: 0 } } },
    };
    expect(visibleState(s, 'p1', data).scouted).toEqual({ p1: { B: { owner: 'p2', at: 0 } } });
    expect(visibleState({ ...s, scouted: { p2: s.scouted.p2 } }, 'p1', data).scouted).toBeUndefined();
  });
});
