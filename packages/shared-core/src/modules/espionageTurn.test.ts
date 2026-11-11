import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { instantSpies, spyMap } from '../testkit/spies';
import { BASE_SPY_AGENTS, espionageModule, MISSION_HOURS, TURNED_HOURS } from './espionage';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context, DomainEvent as GameEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

/** SPY-18 — a bureau of level 3 turns the agent it would kill: the spy loses it as if it
 *  died, the catcher holds one agent over its network for a day. */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits'],
  units: { cruiser: { faction: 'x', stats: { attack: 4, defense: 4, speed: 6, hp: 20 } } },
  factions: {},
  buildings: {
    counterintel: {
      name: 'Counter-Intelligence Bureau',
      cost: {},
      buildTimeHours: 1,
      hp: 16,
      spyDetectBonus: 0.15,
      spyKillBonus: 0.1,
      upgrades: [
        { cost: {}, buildTimeHours: 1, hp: 24, spyDetectBonus: 0.25, spyKillBonus: 0.2 },
        {
          cost: {},
          buildTimeHours: 1,
          hp: 32,
          spyDetectBonus: 0.35,
          spyKillBonus: 0.3,
          spyTurnChance: 0.3,
        },
      ],
    },
  },
  events: {},
});
const HOUR = 3_600_000;
const END = MISSION_HOURS * HOUR;
const ctx = (now: number): Context => ({ now, data });

const pin = (id: string, name: string, fn: () => number): GameModule => ({
  id,
  version: '1.0.0',
  setup(api) {
    api.hook<number>(name, () => fn());
  },
});
const sureFail = pin('fail', 'espionage.chance', () => 0);
const alwaysDetect = pin('detect', 'espionage.detect', () => 1);
const alwaysKill = pin('kill', 'espionage.kill', () => 1);
const alwaysTurn = pin('turn', 'espionage.turn', () => 1);
/** The base roll of the bureau, left alone: what the data gives is what the core uses. */
const seenTurn: number[] = [];
const watchTurn: GameModule = {
  id: 'watch-turn',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.turn', (cur) => {
      seenTurn.push(cur);
      return 1;
    });
  },
};

function player(id: string): Player {
  return { id, name: id, faction: '', status: 'active', resources: { credits: 10_000 } };
}
function planet(id: string, owner: string | null, x: number, bureau = 0): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: bureau ? [{ type: 'counterintel', level: bureau, hp: 32 }] : [],
    garrison: [],
    traits: [],
  };
}
function baseState(bureau: number): GameState {
  const s = createInitialState({ seed: 'turn', version: { data: '0.1.0', manifest: '1' } });
  return spyMap({
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      B: planet('B', 'p2', 0, bureau),
      P: planet('P', 'p2', 500),
      Q: planet('Q', 'p2', 900),
      R: planet('R', 'p2', 1300),
      H: planet('H', 'p1', -10_000),
      J: planet('J', 'p1', -12_000),
      K: planet('K', 'p1', -14_000),
      L: planet('L', 'p1', -16_000),
    },
  });
}
const act = (
  playerId: string,
  type: string,
  payload: unknown,
  id = `${type}:${playerId}`,
): Action => ({
  id,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
const ofType = (events: GameEvent[], type: string) => events.filter((e) => e.type === type);

/** p1 sends a theft onto B at 0; the world runs to the mission's end. */
function caught(bureau: number, modules: GameModule[]) {
  const k = createKernel([
    espionageModule,
    instantSpies,
    sureFail,
    alwaysDetect,
    alwaysKill,
    ...modules,
  ]);
  const sent = okApply(
    k.applyAction(
      baseState(bureau),
      act('p1', 'espionage.spy', { planetId: 'B', op: 'theft' }),
      ctx(0),
    ),
  );
  const r = k.advanceTo(sent.state, ctx(END));
  if (!r.ok) throw new Error(r.code);
  return { k, state: r.state, events: r.events };
}

/** How many missions `playerId` can still send at `now` onto their rival's worlds. */
function sendable(
  k: ReturnType<typeof createKernel>,
  state: GameState,
  playerId: string,
  worlds: string[],
  now: number,
) {
  let s = state;
  let sent = 0;
  for (const w of worlds) {
    const r = k.applyAction(
      s,
      act(playerId, 'espionage.spy', { planetId: w, op: 'recon' }, `spy:${w}:${now}`),
      ctx(now),
    );
    if (!r.ok) break;
    s = r.state;
    sent++;
  }
  return sent;
}

describe('SPY-18 — a level-3 bureau turns the agent it would kill', () => {
  it('turned: the agent asks the catcher to take it in, the spy gets a replacement in 24 h', () => {
    const { k, state, events } = caught(3, [alwaysTurn]);
    expect(state.spyOffers?.p2).toEqual([
      {
        id: 1,
        from: 'p1',
        planetId: 'B',
        kind: 'theft',
        at: END,
        until: END + TURNED_HOURS * HOUR,
      },
    ]);
    expect(ofType(events, 'espionage.defector').map((e) => e.payload)).toEqual([
      {
        owner: 'p2',
        offerId: 1,
        from: 'p1',
        planetId: 'B',
        kind: 'theft',
        until: END + TURNED_HOURS * HOUR,
      },
    ]);
    // The spy loses it like a dead agent; the victim learns it was turned and by whom.
    expect(ofType(events, 'espionage.failed')[0]!.payload).toMatchObject({
      agentLost: true,
      agentTurned: true,
    });
    expect(ofType(events, 'espionage.detected')[0]!.payload).toMatchObject({
      killed: true,
      turned: true,
      spy: 'p1',
    });
    // Not ours until we say so: the network is still three.
    expect(sendable(k, state, 'p2', ['H', 'J', 'K', 'L'], END)).toBe(BASE_SPY_AGENTS);
    // The spy: two free agents at once, the third back only after the recruit time.
    const later = k.advanceTo(state, ctx(END + TURNED_HOURS * HOUR));
    if (!later.ok) throw new Error(later.code);
    expect(sendable(k, state, 'p1', ['P', 'Q', 'R'], END)).toBe(BASE_SPY_AGENTS - 1);
    expect(sendable(k, later.state, 'p1', ['P', 'Q', 'R'], END + TURNED_HOURS * HOUR)).toBe(
      BASE_SPY_AGENTS,
    );
  });

  it('the base chance is the bureau data: 0.3 at level 3, nothing below it', () => {
    seenTurn.length = 0;
    caught(3, [watchTurn]);
    expect(seenTurn).toEqual([0.3]);
    for (const level of [0, 1, 2]) {
      const { state, events } = caught(level, []);
      expect(state.spies?.p2).toBeUndefined(); // the victim gained nobody
      expect(ofType(events, 'espionage.detected')[0]!.payload).not.toHaveProperty('turned');
      expect(ofType(events, 'espionage.failed')[0]!.payload).toMatchObject({ agentLost: true });
    }
  });

  it("a turned agent is the catcher's secret: no one else sees it in the projection", () => {
    const { state } = caught(3, [alwaysTurn]);
    expect(visibleState(state, 'p2', data).spyOffers?.p2).toHaveLength(1);
    expect(visibleState(state, 'p1', data).spyOffers).toBeUndefined();
  });
});

describe("a defector waits for the answer (owner's resolution 2026-11-11)", () => {
  const at = (h: number) => END + h * HOUR;
  const answer = (k: ReturnType<typeof createKernel>, st: GameState, verb: string, offerId = 1) =>
    k.applyAction(st, act('p2', `espionage.defector.${verb}`, { offerId }), ctx(END));

  it('taken in: one of ours for good, on top of the network, with its experience', () => {
    const k0 = caught(3, [alwaysTurn]);
    const veteran = structuredClone(k0.state);
    veteran.spyOffers!.p2![0]!.xp = 3;
    const r = okApply(answer(k0.k, veteran, 'accept'));
    expect(r.state.spyOffers).toBeUndefined();
    expect(r.state.spies?.p2?.find((s) => s.id === 4)).toEqual({
      id: 4,
      gen: 1,
      state: 'rest',
      location: 'B',
      defector: 'p1',
      xp: 3,
    });
    expect(ofType(r.events, 'espionage.defector.joined').map((e) => e.payload)).toEqual([
      { owner: 'p2', offerId: 1, from: 'p1', spyId: 4 },
    ]);
    expect(sendable(k0.k, r.state, 'p2', ['H', 'J', 'K', 'L'], END)).toBe(BASE_SPY_AGENTS + 1);
    // Still ours long after the old day of service.
    const later = k0.k.advanceTo(r.state, ctx(at(10 * TURNED_HOURS)));
    if (!later.ok) throw new Error(later.code);
    expect(later.state.spies?.p2).toHaveLength(BASE_SPY_AGENTS + 1);
  });

  it('a defector lost is not replaced: its place goes with it', () => {
    const k0 = caught(3, [alwaysTurn]);
    const r = okApply(answer(k0.k, k0.state, 'accept'));
    // p2 sends it on a theft onto p1's world, where the same pins kill it.
    const sent = okApply(
      k0.k.applyAction(
        r.state,
        act('p2', 'espionage.spy', { planetId: 'H', op: 'theft', spyId: 4 }),
        ctx(END),
      ),
    );
    const done = k0.k.advanceTo(sent.state, ctx(at(10 * MISSION_HOURS)));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.spies?.p2?.some((s) => s.id === 4)).toBe(false);
    expect(done.state.spies?.p2).toHaveLength(BASE_SPY_AGENTS);
  });

  it('turned down: it flees, the network stays three, its old master has it dead all the same', () => {
    const k0 = caught(3, [alwaysTurn]);
    const r = okApply(answer(k0.k, k0.state, 'refuse'));
    expect(r.state.spyOffers).toBeUndefined();
    expect(r.state.spies?.p2?.some((s) => s.defector !== undefined) ?? false).toBe(false);
    expect(ofType(r.events, 'espionage.defector.fled').map((e) => e.payload)).toEqual([
      { owner: 'p2', offerId: 1, from: 'p1' },
    ]);
    expect(r.state.spies?.p1).toEqual(k0.state.spies?.p1);
  });

  it('left unanswered, it flees when the day is up', () => {
    const k0 = caught(3, [alwaysTurn]);
    const before = k0.k.advanceTo(k0.state, ctx(at(TURNED_HOURS) - 1));
    if (!before.ok) throw new Error(before.code);
    expect(before.state.spyOffers?.p2).toHaveLength(1);
    const after = k0.k.advanceTo(k0.state, ctx(at(TURNED_HOURS)));
    if (!after.ok) throw new Error(after.code);
    expect(after.state.spyOffers).toBeUndefined();
    expect(ofType(after.events, 'espionage.defector.fled').map((e) => e.payload)).toEqual([
      { owner: 'p2', offerId: 1, from: 'p1', expired: true },
    ]);
    expect(
      k0.k.applyAction(
        after.state,
        act('p2', 'espionage.defector.accept', { offerId: 1 }),
        ctx(at(TURNED_HOURS)),
      ),
    ).toMatchObject({ ok: false, code: 'E_BAD_TARGET' });
  });

  it('only the catcher answers, and only an open offer', () => {
    const k0 = caught(3, [alwaysTurn]);
    const cases: [string, string, unknown, string][] = [
      ['p1', 'accept', { offerId: 1 }, 'E_BAD_TARGET'], // not p1's offer
      ['p2', 'accept', { offerId: 2 }, 'E_BAD_TARGET'], // nobody
      ['p2', 'refuse', { offerId: 'x' }, 'E_BAD_PAYLOAD'],
      ['p2', 'accept', {}, 'E_BAD_PAYLOAD'],
    ];
    for (const [who, verb, payload, code] of cases) {
      const r = k0.k.applyAction(
        k0.state,
        act(who, `espionage.defector.${verb}`, payload),
        ctx(END),
      );
      expect(r.ok ? 'ok' : r.code, JSON.stringify([who, verb, payload])).toBe(code);
    }
  });
});
