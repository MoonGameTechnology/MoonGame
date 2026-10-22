import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { espionageModule, MISSION_HOURS, THEFT_CAP } from './espionage';
import { constructionModule } from './construction';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

// SPY-9: sabotage and resource theft. Both resolve at the end of the 12h mission like
// recon; the success / detect / kill rolls are pinned by hooks so each test reads one
// outcome. The building damage itself goes through construction's `building.damage`.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal', 'food'],
  units: { cruiser: { faction: 'x', stats: { attack: 4, defense: 4, speed: 6, hp: 20 } } },
  factions: {},
  buildings: {
    mine: { name: 'Mine', cost: {}, hp: 100 },
    farm: { name: 'Farm', cost: {}, hp: 200 },
    beacon: { name: 'Beacon', cost: {} }, // no modelled HP — sabotage can't touch it
  },
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
const dud = pin('dud', 'espionage.chance', 0);
const unseen = pin('unseen', 'espionage.detect', 0);
const seen = pin('seen', 'espionage.detect', 1);
const spared = pin('spared', 'espionage.kill', 0);

function player(id: string, resources: Record<string, number>): Player {
  return { id, name: id, faction: '', status: 'active', resources };
}
function planet(id: string, owner: string | null, buildings: Planet['buildings'], x = 0): Planet {
  return { id, owner, position: { x, y: 0 }, resources: {}, buildings, garrison: [], traits: [] };
}
const b = (type: string, hp: number, uid: string) => ({ uid, type, level: 1, hp });

function baseState(over: Partial<GameState> = {}): GameState {
  const s = createInitialState({ seed: 'ops', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: {
      p1: player('p1', { credits: 500 }),
      p2: player('p2', { credits: 10_000, metal: 300, food: 0 }),
    },
    planets: {
      B: planet('B', 'p2', [b('mine', 100, 'm1'), b('farm', 200, 'f1'), b('mine', 100, 'm2'), b('beacon', 0, 'x1')]),
      H: planet('H', 'p1', [], -10_000),
    },
    ...over,
  };
}
function spy(op: string, planetId = 'B'): Action {
  return { id: `s:${op}`, type: 'espionage.spy', playerId: 'p1', payload: { planetId, op }, issuedAt: 0 };
}
function run(op: string, pins: GameModule[], s: GameState = baseState()) {
  const k = createKernel([constructionModule, espionageModule, ...pins]);
  const sent = k.applyAction(s, spy(op), ctx(0));
  if (!sent.ok) throw new Error(sent.code);
  const done = k.advanceTo(sent.state, ctx(END));
  if (!done.ok) throw new Error(done.code);
  return { state: done.state, events: done.events };
}
const ofType = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type);

describe('SPY-9 — sabotage', () => {
  it('hits every damageable building (fewer than 3) for 10–20% of max HP and tells the spy', () => {
    const { state, events } = run('sabotage', [sure, unseen, spared]);
    const after = state.planets.B!.buildings;
    const hp = Object.fromEntries(after.map((x) => [x.uid, x.hp]));
    // Three damageable buildings, the roll asks for 3–5 → all three are hit.
    for (const [uid, max] of [['m1', 100], ['f1', 200], ['m2', 100]] as const) {
      expect(max - hp[uid]!).toBeGreaterThanOrEqual(Math.round(max * 0.1));
      expect(max - hp[uid]!).toBeLessThanOrEqual(Math.round(max * 0.2));
    }
    expect(hp.x1).toBe(0); // the HP-less beacon is untouched
    const [done] = ofType(events, 'espionage.succeeded');
    expect(done!.payload).toMatchObject({ owner: 'p1', target: 'p2', kind: 'sabotage', planetId: 'B' });
    expect((done!.payload as { hits: unknown[] }).hits).toHaveLength(3);
    expect(ofType(events, 'espionage.detected')).toHaveLength(0);
  });

  it('a worn-down building is destroyed: removed and announced', () => {
    const worn = baseState();
    worn.planets.B!.buildings[0]!.hp = 5; // m1 at 5/100 — any 10% hit finishes it
    const { state, events } = run('sabotage', [sure, unseen, spared], worn);
    expect(state.planets.B!.buildings.map((x) => x.uid)).not.toContain('m1');
    expect(ofType(events, 'building.destroyed').map((e) => e.payload)).toContainEqual({
      planetId: 'B',
      building: 'mine',
      owner: 'p2',
    });
    const hits = (ofType(events, 'espionage.succeeded')[0]!.payload as { hits: { destroyed: boolean }[] }).hits;
    expect(hits.filter((x) => x.destroyed)).toHaveLength(1);
  });

  it('never hits more than 5 buildings', () => {
    const many = baseState();
    many.planets.B!.buildings = Array.from({ length: 9 }, (_, i) => b('mine', 100, `m${i}`));
    const { state } = run('sabotage', [sure, unseen, spared], many);
    const hit = state.planets.B!.buildings.filter((x) => x.hp < 100).length;
    expect(hit).toBeGreaterThanOrEqual(3);
    expect(hit).toBeLessThanOrEqual(5);
  });

  it('a failed sabotage breaks nothing', () => {
    const { state, events } = run('sabotage', [dud, unseen, spared]);
    expect(state.planets.B!.buildings).toEqual(baseState().planets.B!.buildings);
    expect(ofType(events, 'espionage.failed')).toHaveLength(1);
  });

  it('without the construction module sabotage degrades to "nothing broke", not a crash', () => {
    const k = createKernel([espionageModule, sure, unseen, spared]);
    const sent = k.applyAction(baseState(), spy('sabotage'), ctx(0));
    if (!sent.ok) throw new Error(sent.code);
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.planets.B!.buildings).toEqual(baseState().planets.B!.buildings);
    expect((ofType(done.events, 'espionage.succeeded')[0]!.payload as { hits: unknown[] }).hits).toEqual([]);
  });

  it('the agent comes home after the deed (6h), not after a 24h window', () => {
    const { state } = run('sabotage', [sure, unseen, spared]);
    expect(state.spyAgents?.p1).toEqual([{ until: END + 6 * HOUR }]);
    expect(state.intel?.p1 ?? []).toEqual([]);
  });
});

describe('SPY-9 — resource theft', () => {
  it('moves 5–15% of one held resource from the owner to the spy', () => {
    const { state, events } = run('theft', [sure, unseen, spared]);
    const loot = (ofType(events, 'espionage.succeeded')[0]!.payload as {
      loot: { resource: string; amount: number };
    }).loot;
    expect(['credits', 'metal']).toContain(loot.resource); // food is at 0 — nothing to take
    const stock = loot.resource === 'credits' ? 10_000 : 300;
    expect(loot.amount).toBeGreaterThanOrEqual(Math.floor(stock * 0.05));
    expect(loot.amount).toBeLessThanOrEqual(Math.min(THEFT_CAP, Math.floor(stock * 0.15)));
    expect(state.players.p2!.resources[loot.resource]).toBe(stock - loot.amount);
    const before = loot.resource === 'credits' ? 500 - 150 : 0; // the fee is paid in credits
    expect(state.players.p1!.resources[loot.resource]).toBe(before + loot.amount);
  });

  it('one theft carries at most 500', () => {
    const rich = baseState();
    rich.players.p2!.resources = { credits: 1_000_000 };
    const { events } = run('theft', [sure, unseen, spared], rich);
    const loot = (ofType(events, 'espionage.succeeded')[0]!.payload as { loot: { amount: number } }).loot;
    expect(loot.amount).toBe(THEFT_CAP);
  });

  it('an empty treasury yields a success with nothing taken', () => {
    const poor = baseState();
    poor.players.p2!.resources = { credits: 0.5 };
    const { state, events } = run('theft', [sure, unseen, spared], poor);
    expect((ofType(events, 'espionage.succeeded')[0]!.payload as { loot: unknown }).loot).toBeNull();
    expect(state.players.p2!.resources.credits).toBe(0.5);
  });

  it('a noticed theft is reported to the victim without the thief', () => {
    const { events } = run('theft', [sure, seen, spared]);
    expect(ofType(events, 'espionage.detected').map((e) => e.payload)).toEqual([
      { owner: 'p2', kind: 'theft', planetId: 'B' },
    ]);
  });
});
