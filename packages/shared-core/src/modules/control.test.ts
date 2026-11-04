import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { economyModule } from './economy';
import { constructionModule } from './construction';
import {
  controlModule,
  controlledPlanets,
  uncontrolledPlanets,
  CONTROL_LIMIT,
  UNCONTROLLED_OUTPUT,
} from './control';
import { createInitialState, type GameState, type Planet } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 1 },
      buildTimeHours: 1,
    },
  },
  factions: {},
  buildings: {
    mine: { name: 'Mine', produces: { metal: 10 }, cost: { metal: 1 }, buildTimeHours: 1 },
    shipyard: { name: 'Shipyard', hp: 20, enablesShipConstruction: true },
  },
  sectorKinds: {
    planet: { orbit: true },
    asteroid: { orbit: false, allowedBuildings: ['mine'] },
  },
  modes: {
    waves: { name: 'Waves', pve: { waves: 1, npcFaction: 'x', waveIntervalHours: 1 } },
  },
  events: {},
});
const HOUR = 3_600_000;
const ctx = (now: number, modeId?: string): Context => ({
  now,
  data,
  ...(modeId ? { config: { timeScale: 1, modeId } } : {}),
});

function okAdvance(r: AdvanceResult): AdvanceResult & { ok: true } {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
const unitOrder = (planetId: string): Action => ({
  id: `s:p1:${planetId}`,
  type: 'unit.build',
  playerId: 'p1',
  payload: { planetId, unit: 'cruiser' },
  issuedAt: 0,
});

interface Node {
  id: string;
  at: [number, number];
  owner?: string | null;
  kind?: string;
}

/** A map of `nodes` joined by `lanes`; every node carries a mine and a shipyard. */
function world(nodes: Node[], lanes: Array<[string, string]>, capital = 'C'): GameState {
  const s = createInitialState({ seed: 'ctl', version: { data: '0.1.0', manifest: '1' } });
  const planets: Record<string, Planet> = {};
  for (const n of nodes) {
    planets[n.id] = {
      id: n.id,
      owner: n.owner === undefined ? 'p1' : n.owner,
      position: { x: n.at[0], y: n.at[1] },
      links: [],
      resources: {},
      buildings: [
        { type: 'mine', level: 1, hp: 0 },
        ...(n.kind === 'asteroid' ? [] : [{ type: 'shipyard', level: 1, hp: 20 }]),
      ],
      garrison: [],
      traits: [],
      ...(n.kind ? { kind: n.kind } : {}),
    };
  }
  for (const [a, b] of lanes) {
    planets[a]!.links!.push(b);
    planets[b]!.links!.push(a);
  }
  const player = (id: string) => ({
    id,
    name: id,
    faction: 'x',
    status: 'active' as const,
    resources: { metal: 100 },
  });
  return { ...s, players: { p1: player('p1'), p2: player('p2') }, planets, capital: { p1: capital } };
}

/** C — a1 — … — a6 along one lane: hop distance = index, seven planets for a limit of 5. */
function chain(extra: Node[] = [], lanes: Array<[string, string]> = []): GameState {
  const ids = ['C', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const nodes = ids.map((id, i) => ({ id, at: [i * 10, 0] as [number, number] }));
  const chainLanes = ids.slice(1).map((id, i) => [ids[i]!, id] as [string, string]);
  return world([...nodes, ...extra], [...chainLanes, ...lanes]);
}

const sorted = (set: ReadonlySet<string> | null): string[] => [...(set ?? [])].sort();

describe('which planets are under control', () => {
  it('a player at the limit controls every planet', () => {
    const s = chain();
    delete s.planets.a5;
    delete s.planets.a6;
    expect(sorted(controlledPlanets(s, data, 'p1', CONTROL_LIMIT))).toEqual(['C', 'a1', 'a2', 'a3', 'a4']);
    expect(sorted(uncontrolledPlanets(s, data, 'p1', undefined))).toEqual([]);
  });

  it('past the limit, the planets nearest to the capital by jumps are controlled', () => {
    const s = chain();
    expect(sorted(uncontrolledPlanets(s, data, 'p1', undefined))).toEqual(['a5', 'a6']);
  });

  it('counts jumps, not straight-line distance', () => {
    // `far` is far away but one jump from the capital; `near` sits next to it on the map
    // but is reached only past a6.
    const s = chain(
      [
        { id: 'far', at: [5000, 0] },
        { id: 'near', at: [1, 1] },
      ],
      [
        ['C', 'far'],
        ['a6', 'near'],
      ],
    );
    expect(sorted(controlledPlanets(s, data, 'p1', CONTROL_LIMIT))).toEqual(['C', 'a1', 'a2', 'a3', 'far']);
  });

  it('breaks a tie on jumps by straight-line distance, then by id', () => {
    const s = world(
      [
        { id: 'C', at: [0, 0] },
        { id: 'b1', at: [9, 0] },
        { id: 'b2', at: [4, 0] },
        { id: 'b3', at: [0, 4] },
      ],
      [
        ['C', 'b1'],
        ['C', 'b2'],
        ['C', 'b3'],
      ],
    );
    expect(sorted(controlledPlanets(s, data, 'p1', 2))).toEqual(['C', 'b2']);
    expect(sorted(controlledPlanets(s, data, 'p1', 3))).toEqual(['C', 'b2', 'b3']);
  });

  it('walks through foreign and neutral worlds, and counts only planets', () => {
    // The asteroid in the middle is p1's, but it is not a planet: it neither takes a place
    // under the limit nor stops the count.
    const s = chain([{ id: 'rock', at: [5, 5], kind: 'asteroid' }], [['C', 'rock']]);
    s.planets.a1!.owner = 'p2';
    s.planets.a2!.owner = null;
    expect(sorted(controlledPlanets(s, data, 'p1', CONTROL_LIMIT))).toEqual(['C', 'a3', 'a4', 'a5', 'a6']);
  });

  it("does not count a hero's temporary corridor as a lane", () => {
    const s = chain();
    s.planets.C!.links!.push('a6');
    s.planets.a6!.links!.push('C');
    s.tempLanes = [{ id: 'l1', from: 'C', to: 'a6', owner: 'p1', addedLink: true } as never];
    expect(sorted(uncontrolledPlanets(s, data, 'p1', undefined))).toEqual(['a5', 'a6']);
  });

  it('planets cut off from the capital fill the rest of the limit by straight-line distance', () => {
    const s = world(
      [
        { id: 'C', at: [0, 0] },
        { id: 'a1', at: [10, 0] },
        { id: 'i1', at: [5, 5] },
        { id: 'i2', at: [100, 100] },
        { id: 'i3', at: [50, 50] },
        { id: 'i4', at: [70, 70] },
      ],
      [['C', 'a1']],
    );
    expect(sorted(uncontrolledPlanets(s, data, 'p1', undefined))).toEqual(['i2']);
  });

  it('moves with the capital', () => {
    const s = chain();
    s.capital = { p1: 'a6' };
    expect(sorted(uncontrolledPlanets(s, data, 'p1', undefined))).toEqual(['C', 'a1']);
  });

  it('does not bind a seat without a capital, nor a PvE match', () => {
    const s = chain();
    delete s.capital;
    expect(controlledPlanets(s, data, 'p1', CONTROL_LIMIT)).toBeNull();
    expect(sorted(uncontrolledPlanets(s, data, 'p1', undefined))).toEqual([]);
    const pve = chain();
    expect(sorted(uncontrolledPlanets(pve, data, 'p1', 'waves'))).toEqual([]);
    pve.pve = { waveNumber: 0, totalWaves: 1, npcPlayerId: 'p2' };
    expect(sorted(uncontrolledPlanets(pve, data, 'p1', undefined))).toEqual([]);
  });

  it('a walk asked about one planet gives the answer of the whole walk', () => {
    // A small seeded generator: random lanes, owners and positions, many layouts.
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 40; round += 1) {
      const nodes: Node[] = [];
      for (let i = 0; i < 30; i += 1) {
        nodes.push({
          id: `n${i}`,
          at: [Math.floor(rnd() * 100), Math.floor(rnd() * 100)],
          owner: rnd() < 0.5 ? 'p1' : rnd() < 0.5 ? 'p2' : null,
          ...(rnd() < 0.2 ? { kind: 'asteroid' } : {}),
        });
      }
      nodes[0]!.owner = 'p1';
      delete nodes[0]!.kind;
      const lanes: Array<[string, string]> = [];
      for (let i = 1; i < 30; i += 1)
        if (rnd() < 0.9) lanes.push([`n${Math.floor(rnd() * i)}`, `n${i}`]);
      const s = world(nodes, lanes, 'n0');
      const limit = 1 + Math.floor(rnd() * 8);
      const whole = controlledPlanets(s, data, 'p1', limit)!;
      for (const p of Object.values(s.planets)) {
        if (p.owner !== 'p1' || p.kind === 'asteroid') continue;
        expect(controlledPlanets(s, data, 'p1', limit, p.id)!.has(p.id), `${round}:${p.id}`).toBe(
          whole.has(p.id),
        );
      }
    }
  });

  it('a walk asked about one planet reads only the worlds around the capital', () => {
    const nodes: Node[] = [];
    const lanes: Array<[string, string]> = [];
    for (let i = 0; i < 200; i += 1) {
      nodes.push({ id: i === 0 ? 'C' : `n${i}`, at: [i, 0], owner: i < 8 ? 'p1' : 'p2' });
      if (i > 0) lanes.push([i === 1 ? 'C' : `n${i - 1}`, `n${i}`]);
    }
    const s = world(nodes, lanes);
    const read = new Set<string>();
    const planets = new Proxy(s.planets, {
      get(target, id) {
        if (typeof id === 'string') read.add(id);
        return Reflect.get(target, id);
      },
    });
    const watched = { ...s, planets };
    expect(controlledPlanets(watched, data, 'p1', CONTROL_LIMIT, 'n7')!.has('n7')).toBe(false);
    expect(read.size).toBeLessThan(10);
  });
});

describe('control module', () => {
  it('a planet beyond the limit yields half its output, civic tax included', () => {
    const kernel = createKernel([economyModule, controlModule]);
    const r = okAdvance(kernel.advanceTo(chain(), ctx(HOUR)));
    // Five planets at 10 metal an hour, two beyond the limit at half.
    expect(r.state.players.p1!.resources.metal).toBeCloseTo(100 + 5 * 10 + 2 * 10 * UNCONTROLLED_OUTPUT);
  });

  it('leaves non-planets, other owners and seats within the limit untouched', () => {
    const kernel = createKernel([economyModule, controlModule]);
    const s = chain([{ id: 'rock', at: [5, 5], kind: 'asteroid' }], [['C', 'rock']]);
    s.planets.x1 = { ...s.planets.a1!, id: 'x1', owner: 'p2', links: [] };
    const r = okAdvance(kernel.advanceTo(s, ctx(HOUR)));
    expect(r.state.players.p1!.resources.metal).toBeCloseTo(100 + 6 * 10 + 2 * 10 * UNCONTROLLED_OUTPUT);
    expect(r.state.players.p2!.resources.metal).toBeCloseTo(100 + 10);
  });

  it('is inert in a PvE mode', () => {
    const kernel = createKernel([economyModule, controlModule]);
    const r = okAdvance(kernel.advanceTo(chain(), ctx(HOUR, 'waves')));
    expect(r.state.players.p1!.resources.metal).toBeCloseTo(100 + 7 * 10);
  });

  it('refuses units on a planet beyond the limit, and lets buildings through', () => {
    const kernel = createKernel([constructionModule, controlModule]);
    const order = (planetId: string, type = 'unit.build'): Action => ({
      id: `s:p1:${type}`,
      type,
      playerId: 'p1',
      payload: type === 'unit.build' ? { planetId, unit: 'cruiser' } : { planetId, building: 'mine' },
      issuedAt: 0,
    });
    const s = chain();
    for (const p of Object.values(s.planets)) p.buildings = p.buildings.filter((b) => b.type !== 'mine');
    const refused = kernel.applyAction(s, order('a5'), ctx(0)) as ApplyResult & { ok: false };
    expect(refused).toMatchObject({ ok: false, code: 'E_NOT_CONTROLLED' });
    expect(kernel.applyAction(s, order('a4'), ctx(0)).ok).toBe(true);
    expect(kernel.applyAction(s, order('C'), ctx(0)).ok).toBe(true);
    expect(kernel.applyAction(s, order('a5', 'building.construct'), ctx(0)).ok).toBe(true);
    // No limit without a capital, and none in PvE.
    expect(kernel.applyAction(s, order('a5'), ctx(0, 'waves')).ok).toBe(true);
    const free = chain();
    delete free.capital;
    expect(kernel.applyAction(free, order('a5'), ctx(0)).ok).toBe(true);
  });

  it('drops a queued unit order once its planet falls beyond the limit', () => {
    const kernel = createKernel([constructionModule, controlModule]);
    const s = chain();
    delete s.planets.a5;
    delete s.planets.a6;
    s.planets.a4!.links = ['a3'];
    const build = unitOrder('a4');
    let st = okApply(kernel.applyAction(s, build, ctx(0))).state;
    st = okApply(kernel.applyAction(st, build, ctx(0))).state; // the lane is busy: it waits
    expect(st.planets.a4!.buildQueue).toHaveLength(1);
    // A sixth planet next to the capital pushes a4 beyond the limit.
    st = structuredClone(st);
    st.planets.n = { ...structuredClone(st.planets.a1!), id: 'n', links: ['C'] };
    st.planets.C!.links!.push('n');
    const r = okAdvance(kernel.advanceTo(st, ctx(2 * HOUR)));
    expect(r.events.map((e) => e.type)).toContain('construction.queue.dropped');
    expect(r.state.planets.a4!.buildQueue).toBeUndefined();
    expect(r.state.players.p1!.resources.metal).toBe(99); // only the first cruiser was paid
  });

  it('takes its limit from the `control.limit` hook', () => {
    const plusTwo: GameModule = {
      id: 'plus-two',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('control.limit', (n) => n + 2);
      },
    };
    const kernel = createKernel([economyModule, constructionModule, controlModule, plusTwo]);
    const r = okAdvance(kernel.advanceTo(chain(), ctx(HOUR)));
    expect(r.state.players.p1!.resources.metal).toBeCloseTo(100 + 7 * 10);
    const build = unitOrder('a6');
    expect(kernel.applyAction(chain(), build, ctx(0)).ok).toBe(true);
  });
});
