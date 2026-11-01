import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { espionageModule, MISSION_HOURS, SPY_OP_COST, THEFT_CAP } from './espionage';
import { constructionModule } from './construction';
import { technologyModule } from './technology';
import { economyModule } from './economy';
import { visibleState } from '../state/visibility';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';
import type { GameModule } from '../kernel/module';

// SPY-9/10: sabotage, resource theft and research theft. Both resolve at the end of the 12h mission like
// recon; the success / detect / kill rolls are pinned by hooks so each test reads one
// outcome. The building damage itself goes through construction's `building.damage`.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal', 'food'],
  units: { cruiser: { faction: 'x', stats: { attack: 4, defense: 4, speed: 6, hp: 20 } } },
  factions: {},
  buildings: {
    mine: { name: 'Mine', cost: {}, hp: 100, produces: { metal: 10 } },
    farm: { name: 'Farm', cost: {}, hp: 200 },
    beacon: { name: 'Beacon', cost: {} }, // no modelled HP — sabotage can't touch it
  },
  events: {},
  technologies: {
    optics: { name: 'Optics', cost: { metal: 1 }, researchTimeHours: 1 },
    lasers: { name: 'Lasers', cost: { metal: 1 }, researchTimeHours: 1, requires: ['optics'] },
    armor: { name: 'Armor', cost: { metal: 1 }, researchTimeHours: 1 },
  },
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
  const k = createKernel([constructionModule, technologyModule, espionageModule, ...pins]);
  const sent = k.applyAction(s, spy(op), ctx(0));
  if (!sent.ok) throw new Error(sent.code);
  const done = k.advanceTo(sent.state, ctx(END));
  if (!done.ok) throw new Error(done.code);
  return { state: done.state, events: done.events };
}
const ofType = (events: DomainEvent[], type: string) => events.filter((e) => e.type === type);

describe('SPY-12 — each operation has its own price', () => {
  const k = createKernel([constructionModule, technologyModule, espionageModule]);

  it('guarding is the cheapest, stealing research the dearest', () => {
    expect(SPY_OP_COST).toEqual({
      counter: 50,
      recon: 150,
      sabotage: 300,
      delay: 300,
      disrupt: 300,
      theft: 300,
      research: 400,
    });
    for (const op of ['counter', 'recon', 'sabotage', 'delay', 'disrupt', 'theft', 'research'] as const) {
      const r = k.applyAction(baseState(), spy(op), ctx(0));
      if (!r.ok) throw new Error(`${op}: ${r.code}`);
      expect(r.state.players.p1!.resources.credits).toBe(500 - SPY_OP_COST[op]);
    }
  });

  it('a treasury short of THIS operation refuses it, free of charge, while a cheaper one passes', () => {
    const poor = baseState();
    poor.players.p1!.resources.credits = 299;
    const dear = k.applyAction(poor, spy('theft'), ctx(0));
    expect(dear.ok ? null : dear.code).toBe('E_INSUFFICIENT');
    const cheap = k.applyAction(poor, spy('recon'), ctx(0));
    expect(cheap.ok && cheap.state.players.p1!.resources.credits).toBe(299 - SPY_OP_COST.recon);
  });

  it('the espionage.cost hook still bends the base price', () => {
    const half: GameModule = {
      id: 'half',
      version: '1.0.0',
      setup(api) {
        api.hook<Record<string, number>>('espionage.cost', (fee) => ({ credits: (fee.credits ?? 0) / 2 }));
      },
    };
    const r = createKernel([espionageModule, half]).applyAction(baseState(), spy('research'), ctx(0));
    expect(r.ok && r.state.players.p1!.resources.credits).toBe(500 - SPY_OP_COST.research / 2);
  });
});

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

describe('SPY-14 — queue sabotage', () => {
  /** p2's mine on B finishes at `at` (seq 900), a farm on another world at 15h. */
  const building = (at: number): GameState => {
    const s = baseState();
    const order = (seq: number, when: number, planetId: string, b: string) => ({
      id: `evt:${seq}`,
      at: when,
      seq,
      type: 'construction.complete',
      payload: { kind: 'building', planetId, playerId: 'p2', building: b, seq },
    });
    s.scheduled = [order(900, at, 'B', 'mine'), order(901, 15 * HOUR, 'H', 'farm')];
    return s;
  };
  const delayed = (events: DomainEvent[]) =>
    (ofType(events, 'espionage.succeeded')[0]!.payload as { delayed: unknown }).delayed;

  it('pushes the world\'s first order back by 6–12 h and keeps its seq', () => {
    const { state, events } = run('delay', [sure, unseen, spared], building(20 * HOUR));
    const d = delayed(events) as { kind: string; building: string; hours: number };
    expect(d).toMatchObject({ kind: 'building', building: 'mine' });
    expect(d.hours).toBeGreaterThanOrEqual(6);
    expect(d.hours).toBeLessThanOrEqual(12);
    const mine = state.scheduled.find((e) => e.seq === 900)!;
    expect(mine.at).toBe(20 * HOUR + d.hours * HOUR);
    // Another world's order is untouched, and the queue stays (at, seq)-sorted.
    expect(state.scheduled.find((e) => e.seq === 901)!.at).toBe(15 * HOUR);
    const ats = state.scheduled.map((e) => e.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
  });

  it('the delayed order completes at its new time, not the old one', () => {
    const k = createKernel([constructionModule, technologyModule, espionageModule, sure, unseen, spared]);
    const sent = k.applyAction(building(20 * HOUR), spy('delay'), ctx(0));
    if (!sent.ok) throw new Error(sent.code);
    const mid = k.advanceTo(sent.state, ctx(END));
    if (!mid.ok) throw new Error(mid.code);
    const hours = (delayed(mid.events) as { hours: number }).hours;
    const before = k.advanceTo(mid.state, ctx(20 * HOUR + hours * HOUR - 1));
    if (!before.ok) throw new Error(before.code);
    expect(before.state.scheduled.some((e) => e.seq === 900)).toBe(true); // the old 20h passed
    const after = k.advanceTo(before.state, ctx(20 * HOUR + hours * HOUR));
    if (!after.ok) throw new Error(after.code);
    expect(after.state.scheduled.some((e) => e.seq === 900)).toBe(false);
  });

  it('an idle world is a success with nothing delayed', () => {
    const { events } = run('delay', [sure, unseen, spared]);
    expect(delayed(events)).toBeNull();
  });

  it('without the construction module the delay is a no-op, not a crash', () => {
    const k = createKernel([espionageModule, sure, unseen, spared]);
    const sent = k.applyAction(building(20 * HOUR), spy('delay'), ctx(0));
    if (!sent.ok) throw new Error(sent.code);
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(delayed(done.events)).toBeNull();
    expect(done.state.scheduled.find((e) => e.seq === 900)!.at).toBe(20 * HOUR);
  });
});

describe('SPY-15 — economic sabotage', () => {
  const k = createKernel([economyModule, constructionModule, technologyModule, espionageModule, sure, unseen]);
  /** p2's metal over [from, to] of a world disrupted at the end of a mission sent at 0. */
  function metalOver(from: number, to: number, s = baseState()): number {
    const sent = k.applyAction(s, spy('disrupt'), ctx(0));
    if (!sent.ok) throw new Error(sent.code);
    const a = k.advanceTo(sent.state, ctx(from));
    if (!a.ok) throw new Error(a.code);
    const b2 = k.advanceTo(a.state, ctx(to));
    if (!b2.ok) throw new Error(b2.code);
    return b2.state.players.p2!.resources.metal! - a.state.players.p2!.resources.metal!;
  }
  /** The same span without any sabotage — the world's full output. */
  function plainOver(from: number, to: number): number {
    const a = k.advanceTo(baseState(), ctx(from));
    if (!a.ok) throw new Error(a.code);
    const b2 = k.advanceTo(a.state, ctx(to));
    if (!b2.ok) throw new Error(b2.code);
    return b2.state.players.p2!.resources.metal! - a.state.players.p2!.resources.metal!;
  }

  it('the world produces 75% for 24 h, then its full output again', () => {
    const full = plainOver(END, END + 24 * HOUR);
    expect(full).toBeGreaterThan(0);
    expect(metalOver(END, END + 24 * HOUR)).toBeCloseTo(full * 0.75, 6);
    expect(metalOver(END + 24 * HOUR, END + 48 * HOUR)).toBeCloseTo(plainOver(END + 24 * HOUR, END + 48 * HOUR), 6);
  });

  it('the success reports the end, and the cut leaves the treasury itself alone', () => {
    const sent = k.applyAction(baseState(), spy('disrupt'), ctx(0));
    if (!sent.ok) throw new Error(sent.code);
    const done = k.advanceTo(sent.state, ctx(END));
    if (!done.ok) throw new Error(done.code);
    expect(done.state.planets.B!.disruptedUntil).toBe(END + 24 * HOUR);
    expect(done.events.find((e) => e.type === 'espionage.succeeded')?.payload).toMatchObject({
      kind: 'disrupt',
      disrupted: END + 24 * HOUR,
    });
    expect(done.state.players.p2!.resources.credits).toBe(10_000);
  });

  it('a repeat extends the term but never cuts below 75%', () => {
    const s = baseState();
    s.planets.B!.disruptedUntil = END + 6 * HOUR; // an earlier sabotage still running
    s.scheduled.push({ id: 'evt:old', at: END + 6 * HOUR, seq: 0, type: 'espionage.disrupt.end', payload: { planetId: 'B' } });
    const full = plainOver(END, END + 24 * HOUR);
    expect(metalOver(END, END + 24 * HOUR, s)).toBeCloseTo(full * 0.75, 6);
  });

  it('only the world owner sees the term', () => {
    const s = baseState();
    s.planets.B!.disruptedUntil = 9 * HOUR;
    expect(visibleState(s, 'p2', data).planets.B?.disruptedUntil).toBe(9 * HOUR);
    expect(visibleState(s, 'p1', data).planets.B).not.toHaveProperty('disruptedUntil');
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
    const before = loot.resource === 'credits' ? 500 - SPY_OP_COST.theft : 0; // the fee is paid in credits
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

describe('SPY-10 — research theft', () => {
  const lab = (completed: string[], active: string[] = []) => ({
    completed,
    active: active.map((technology) => ({ technology, startedAt: 0, completesAt: 99 * HOUR })),
  });
  const withTech = (spyTech: ReturnType<typeof lab>, victim: string[]): GameState => {
    const s = baseState();
    s.players.p1!.technologies = spyTech;
    s.players.p2!.technologies = lab(victim);
    return s;
  };
  const stolen = (events: DomainEvent[]) =>
    (ofType(events, 'espionage.succeeded')[0]!.payload as { tech: string | null }).tech;

  it('takes a technology the spy has not started before one in its lab, prerequisites ignored', () => {
    // p1 researches `armor`; `lasers` (needs optics, which p1 lacks) is the only fresh one.
    const { state, events } = run('research', [sure, unseen, spared], withTech(lab([], ['armor']), ['lasers', 'armor']));
    expect(stolen(events)).toBe('lasers');
    expect(state.players.p1!.technologies!.completed).toContain('lasers');
    expect(ofType(events, 'technology.researched').map((e) => e.payload)).toContainEqual({
      playerId: 'p1',
      technology: 'lasers',
    });
  });

  it('only lab work left — finishes it and frees the slot', () => {
    const { state, events } = run('research', [sure, unseen, spared], withTech(lab(['optics'], ['armor']), ['optics', 'armor']));
    expect(stolen(events)).toBe('armor');
    expect(state.players.p1!.technologies!.completed).toContain('armor');
    expect(state.players.p1!.technologies!.active ?? []).toEqual([]);
  });

  it('the victim knows nothing new — the civilisation lags behind (tech: null)', () => {
    const { state, events } = run('research', [sure, unseen, spared], withTech(lab(['optics', 'armor']), ['optics']));
    expect(stolen(events)).toBeNull();
    expect(state.players.p1!.technologies!.completed).toEqual(['optics', 'armor']);
  });

  it('the agent comes home after the theft', () => {
    const { state } = run('research', [sure, unseen, spared], withTech(lab([]), ['armor']));
    expect(state.spyAgents?.p1).toEqual([{ until: END + 6 * HOUR }]);
  });
});
