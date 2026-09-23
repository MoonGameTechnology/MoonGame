import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { combatModule } from './combat';
import { interceptModule } from './intercept';
import { captureOnArrivalModule } from './captureOnArrival';
import {
  createInitialState,
  type Fleet,
  type FleetEdge,
  type GameState,
  type Planet,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import type { Action, AdvanceResult, ApplyResult, Context, DomainEvent } from '../action/types';
import { fleetPositionAt } from '../state/fleetPosition';
import { deriveRoads, forkAt, forkTAtEnd, forkTAtStart, snapToFork } from '../state/roads';
import { readFileSync, readdirSync } from 'node:fs';
import { loadGameData } from '../data/loadGameData';
import { parseMatchMap } from '../data/mapSchema';
import { matchMapEdges } from '../state/buildFromMap';
import { mosaicBorderSegments } from '../state/mosaic';
import { trunkOccupancies } from '../util/combat';

/**
 * ROADS-3 — засада на развилке и встречи на общем стволе (`docs/roads-roadmap.md` §0.2:
 * «ловят на развилке»).
 *
 * Та же ручная карта, что у ROADS-2: B в начале координат, A и C с востока на ОДНОЙ тропе
 * B с развилкой F, D с запада на своей тропе.
 *
 *            A (200,−150)
 *           /
 *   D —— B(0,0) — F(60,0)
 *           \
 *            C (200,150)
 *
 * Ствол тропы — B→F, 60 единиц: его делят дороги B→A и B→C. Ветки F→(100,∓75) — по 85,
 * дальше до A и C — по 125. Дорога A→B = 125 + 85 + 60 = 270, развилка на ней — на 210.
 * Разведчик летит 10 единиц в час.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    scout: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 6 } },
    // Живучий: бой с ним идёт сотню раундов — хватает, чтобы успел подлететь третий.
    hulk: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 100 } },
  },
  factions: {},
  buildings: {},
  events: {},
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });
const kernel = createKernel([
  movementModule,
  combatModule,
  interceptModule,
  captureOnArrivalModule,
]);

function planet(id: string, x: number, y: number, links: string[]): Planet {
  return {
    id,
    owner: null,
    position: { x, y },
    links,
    resources: { metal: 0 },
    buildings: [],
    garrison: [],
    traits: [],
  };
}

function world(roads = true): GameState {
  const s = createInitialState({ seed: 'ambush', version: { data: '0.1.0', manifest: '1' } });
  const A = planet('A', 200, -150, ['B']);
  const B = planet('B', 0, 0, ['A', 'C', 'D']);
  const C = planet('C', 200, 150, ['B']);
  const D = planet('D', -300, 0, ['B']);
  if (roads) {
    const xab = { x: 100, y: -75 };
    const xcb = { x: 100, y: 75 };
    const xdb = { x: -150, y: 0 };
    A.roads = { crossings: { B: xab }, trails: [{ exits: ['B'], fork: null }] };
    C.roads = { crossings: { B: xcb }, trails: [{ exits: ['B'], fork: null }] };
    D.roads = { crossings: { B: xdb }, trails: [{ exits: ['B'], fork: null }] };
    B.roads = {
      crossings: { A: xab, C: xcb, D: xdb },
      trails: [
        { exits: ['A', 'C'], fork: { x: 60, y: 0 } },
        { exits: ['D'], fork: null },
      ],
    };
  }
  const state: GameState = { ...s, planets: { A, B, C, D }, fleets: {} };
  setStance(state, 'p1', 'p2', 'war');
  return state;
}

/** A fleet at a world, or parked at a point on a lane. */
function put(
  state: GameState,
  id: string,
  owner: string,
  at: string | FleetEdge,
  unit = 'scout',
): void {
  state.fleets[id] = {
    id,
    owner,
    location: typeof at === 'string' ? at : null,
    ...(typeof at === 'string' ? {} : { edge: at }),
    movement: null,
    units: [{ unit, count: 1 }],
    traits: [],
  } as Fleet;
}

/** The fork of B's eastern trail, as a point on the road B→A. */
const atFork = (s: GameState): FleetEdge => ({ from: 'B', to: 'A', t: forkTAtStart(s, 'B', 'A') });

function ok(r: ApplyResult | AdvanceResult) {
  if (!r.ok) throw new Error(`failed: ${r.code}`);
  return r;
}
let seq = 0;
function order(
  state: GameState,
  fleetId: string,
  owner: string,
  target: string | FleetEdge,
  at: number,
): { state: GameState; events: DomainEvent[] } {
  const action: Action = {
    id: `s:${owner}:${++seq}`,
    type: 'fleet.move',
    playerId: owner,
    payload: typeof target === 'string' ? { fleetId, to: target } : { fleetId, toEdge: target },
    issuedAt: at,
  };
  const r = ok(kernel.applyAction(state, action, ctx(at)));
  return { state: r.state, events: r.events };
}
function until(
  state: GameState,
  hours: number,
  before: DomainEvent[] = [],
): { state: GameState; events: DomainEvent[] } {
  const r = ok(kernel.advanceTo(state, ctx(hours * HOUR)));
  return { state: r.state, events: [...before, ...r.events] };
}
const started = (events: DomainEvent[]) =>
  events.filter((e) => e.type === 'battle.started').map((e) => e.payload as { location: string });

describe('ROADS-3 — засада на развилке', () => {
  it.each([
    ['A', 'C'],
    ['C', 'A'],
  ])(
    'флот на развилке ловит проходящего мимо планеты: %s→%s встаёт на развилке через 21 час',
    (from, to) => {
      const s = world();
      put(s, 'g1', 'p2', atFork(s));
      put(s, 'f1', 'p1', from);
      const moved = order(s, 'f1', 'p1', to, 0);
      const early = until(moved.state, 20.9, moved.events);
      expect(started(early.events)).toHaveLength(0);
      const r = until(moved.state, 21, moved.events);
      expect(started(r.events)).toEqual([expect.objectContaining({ location: 'B' })]);
      // Встречу назначил детектор СТВОЛА: перехват на полосе к этому мигу уже устарел —
      // на развилке проходящий переходит на следующую дорогу раньше, чем тот срабатывает.
      expect(r.events.some((e) => e.type === 'fleet.meet')).toBe(true);
      // Проходящий остановлен НА развилке, а не довезён до цели.
      const f1 = r.state.fleets.f1!;
      expect(f1.location).toBeNull();
      expect(f1.battleId).toBeDefined();
      const p = fleetPositionAt(r.state, f1, 21 * HOUR)!;
      expect(p.x).toBeCloseTo(60, 9);
      expect(p.y).toBeCloseTo(0, 9);
    },
  );

  it('ловит и того, кто идёт этой тропой к самой планете — с соседней ветки', () => {
    const s = world();
    put(s, 'g1', 'p2', atFork(s)); // стоит на дороге B→A
    put(s, 'f1', 'p1', 'C'); // идёт C→B: другая дорога, общий ствол
    const moved = order(s, 'f1', 'p1', 'B', 0);
    const r = until(moved.state, 21, moved.events);
    expect(started(r.events)).toEqual([expect.objectContaining({ location: 'B' })]);
    expect(r.state.fleets.f1!.location).toBeNull(); // до мира не долетел
  });

  it('и того, кто выходит от планеты на эту тропу', () => {
    const s = world();
    put(s, 'g1', 'p2', atFork(s));
    put(s, 'f1', 'p1', 'B');
    const moved = order(s, 'f1', 'p1', 'C', 0);
    const r = until(moved.state, 6, moved.events); // ствол — 60 единиц
    expect(started(r.events)).toEqual([expect.objectContaining({ location: 'B' })]);
  });

  it('другую тропу развилка не сторожит: D→B и B→D проходят мимо засады', () => {
    const s = world();
    put(s, 'g1', 'p2', atFork(s));
    put(s, 'f1', 'p1', 'D');
    const inbound = order(s, 'f1', 'p1', 'B', 0);
    const arrived = until(inbound.state, 30, inbound.events); // 150 + 150
    expect(started(arrived.events)).toHaveLength(0);
    expect(arrived.state.fleets.f1!.location).toBe('B');
    const outbound = order(arrived.state, 'f1', 'p1', 'D', 30 * HOUR);
    const back = until(outbound.state, 60, outbound.events);
    expect(started(back.events)).toHaveLength(0);
    expect(back.state.fleets.f1!.location).toBe('D');
  });

  it('не враг — не засада: без войны проходящий летит дальше', () => {
    const s = world();
    setStance(s, 'p1', 'p2', 'peace');
    put(s, 'g1', 'p2', atFork(s));
    put(s, 'f1', 'p1', 'A');
    const moved = order(s, 'f1', 'p1', 'C', 0);
    const r = until(moved.state, 42, moved.events);
    expect(started(r.events)).toHaveLength(0);
    expect(r.state.fleets.f1!.location).toBe('C');
  });
});

describe('ROADS-3 — встреча на общем стволе', () => {
  it('идущие навстречу по стволу с разных дорог сходятся посреди него', () => {
    // f1 идёт A→B: развилку проходит на 21-м часу, к миру приходит на 27-м. g1 выходит из
    // B на C на 24-м часу. Встреча, когда 10·(T−24) = 60 − 10·(T−21): T = 25.5 ч, в 15
    // единицах от мира.
    const s = world();
    put(s, 'f1', 'p1', 'A');
    put(s, 'g1', 'p2', 'B');
    const a = order(s, 'f1', 'p1', 'B', 0);
    const mid = until(a.state, 24, a.events);
    const b = order(mid.state, 'g1', 'p2', 'C', 24 * HOUR);
    const r = until(b.state, 25.5, [...mid.events, ...b.events]);
    expect(started(r.events)).toEqual([expect.objectContaining({ location: 'B' })]);
    for (const id of ['f1', 'g1']) {
      const p = fleetPositionAt(r.state, r.state.fleets[id]!, 25.5 * HOUR)!;
      expect(p.x).toBeCloseTo(15, 6);
      expect(p.y).toBeCloseTo(0, 6);
    }
  });

  it('на одной полосе встречу назначает детектор полосы — и только он, без дубля', () => {
    const s = world();
    put(s, 'g1', 'p2', atFork(s)); // стоит на дороге B→A
    put(s, 'f1', 'p1', 'A'); // идёт по ней же к миру B
    const moved = order(s, 'f1', 'p1', 'B', 0);
    const kinds = moved.state.scheduled.map((e) => e.type);
    expect(kinds.filter((k) => k === 'fleet.intercept')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'fleet.meet')).toHaveLength(0);
  });

  it('без сети дорог те же двое не встречаются — полосы разные, как и было', () => {
    const s = world(false);
    put(s, 'f1', 'p1', 'A');
    put(s, 'g1', 'p2', 'B');
    const a = order(s, 'f1', 'p1', 'B', 0);
    const mid = until(a.state, 24, a.events);
    const b = order(mid.state, 'g1', 'p2', 'C', 24 * HOUR);
    const r = until(b.state, 26, [...mid.events, ...b.events]);
    expect(r.events.some((e) => e.type === 'fleet.meet')).toBe(false);
    expect(started(r.events)).toHaveLength(0);
  });

  it('без модуля боя назначенная встреча тихо гаснет: ни боя, ни мёртвых событий', () => {
    const bare = createKernel([movementModule, interceptModule]);
    const s = world();
    put(s, 'g1', 'p2', atFork(s));
    put(s, 'f1', 'p1', 'C');
    const a = ok(
      bare.applyAction(
        s,
        {
          id: 's:p1:x',
          type: 'fleet.move',
          playerId: 'p1',
          payload: { fleetId: 'f1', to: 'B' },
          issuedAt: 0,
        },
        ctx(0),
      ),
    );
    expect(a.state.scheduled.some((e) => e.type === 'fleet.meet')).toBe(true);
    const r = bare.advanceTo(a.state, ctx(27 * HOUR)); // 125 + 85 + 60
    if (!r.ok) throw new Error(r.code);
    expect(Object.keys(r.state.battles)).toHaveLength(0);
    expect(r.failures).toHaveLength(0);
    expect(r.state.fleets.f1!.location).toBe('B');
  });
});

describe('ROADS-3 — встать на развилку', () => {
  it('приказ встать рядом с развилкой ставит флот НА неё', () => {
    const s = world();
    const fork = forkTAtEnd(s, 'A', 'B'); // 210 / 270
    // Окно — четверть более короткого из кусков, что сходятся в развилке: ствол 60 → 15 ед.
    expect(snapToFork(s, 'A', 'B', fork - 14 / 270)).toBe(fork);
    expect(snapToFork(s, 'A', 'B', fork + 14 / 270)).toBe(fork);
    expect(snapToFork(s, 'A', 'B', fork - 16 / 270)).toBe(fork - 16 / 270);
    put(s, 'f1', 'p1', 'A');
    const moved = order(s, 'f1', 'p1', { from: 'A', to: 'B', t: fork - 10 / 270 }, 0);
    const r = until(moved.state, 21, moved.events);
    expect(r.state.fleets.f1!.edge).toEqual({ from: 'A', to: 'B', t: fork });
  });

  it('вставший на развилке берёт пустую провинцию — «остановился в ней»', () => {
    const s = world();
    put(s, 'f1', 'p1', 'A');
    const moved = order(s, 'f1', 'p1', { from: 'A', to: 'B', t: forkTAtEnd(s, 'A', 'B') }, 0);
    const r = until(moved.state, 21, moved.events);
    expect(r.state.planets.B!.owner).toBe('p1');
    expect(r.events.find((e) => e.type === 'planet.captured')!.payload).toMatchObject({
      planetId: 'B',
      owner: 'p1',
      via: 'stop',
    });
  });

  it('…но не когда в провинции стоит чужой флот — даже на другой её дороге', () => {
    const s = world();
    put(s, 'f1', 'p1', 'A');
    put(s, 'g2', 'p2', { from: 'B', to: 'D', t: 0.3 }); // своя тропа B, 90 ед. от мира
    const moved = order(s, 'f1', 'p1', { from: 'A', to: 'B', t: forkTAtEnd(s, 'A', 'B') }, 0);
    const r = until(moved.state, 21, moved.events);
    expect(r.state.fleets.f1!.edge).not.toBeNull();
    expect(started(r.events)).toHaveLength(0); // разные тропы — не встречаются
    expect(r.state.planets.B!.owner).toBeNull();
  });

  it('с развилки уходят прямо по нужной ветке, а не через планету и обратно', () => {
    // По ветке F→C: 85 + 125 = 210 → 21 час. Через мир было бы 60 + 60 + 210 = 330.
    const s = world();
    put(s, 'g1', 'p1', atFork(s));
    const moved = order(s, 'g1', 'p1', 'C', 0);
    const r = until(moved.state, 21, moved.events);
    expect(r.state.fleets.g1!.location).toBe('C');
    expect(r.events.some((e) => e.type === 'fleet.transit')).toBe(false);
  });

  it('встать на ту же развилку с соседней дороги — это «уже здесь»', () => {
    const s = world();
    put(s, 'g1', 'p1', atFork(s));
    const action: Action = {
      id: 's:p1:same',
      type: 'fleet.move',
      playerId: 'p1',
      payload: {
        fleetId: 'g1',
        toEdge: { from: 'C', to: 'B', t: forkTAtEnd(s, 'C', 'B') - 5 / 270 },
      },
      issuedAt: 0,
    };
    const r = kernel.applyAction(s, action, ctx(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_SAME_LOCATION');
  });
});

describe('ROADS-3 — бой на дороге не у планеты', () => {
  it('прибывший к планете не втягивает стоящих там в бой на развилке', () => {
    // g1 (p2) в засаде ловит f1 на 21-м часу; бой долгий (hulk — сотня раундов). k1 (p1)
    // стоит у планеты B, m1 (p1) прилетает к ней с запада на 30-м часу. Оба — враги g1, но
    // бой идёт на развилке, а не у мира: их в него не зовут (решение владельца §0.2).
    const s = world();
    put(s, 'g1', 'p2', atFork(s), 'hulk');
    put(s, 'f1', 'p1', 'A', 'hulk');
    put(s, 'k1', 'p1', 'B', 'hulk');
    put(s, 'm1', 'p1', 'D', 'hulk');
    const a = order(s, 'f1', 'p1', 'C', 0);
    const b = order(a.state, 'm1', 'p1', 'B', 0);
    const r = until(b.state, 31, [...a.events, ...b.events]);
    const battles = Object.values(r.state.battles);
    expect(battles).toHaveLength(1);
    expect(battles[0]!.sides).toHaveLength(2);
    expect(r.state.fleets.m1!.location).toBe('B');
    expect(r.state.fleets.m1!.battleId ?? null).toBeNull();
    expect(r.state.fleets.k1!.battleId ?? null).toBeNull();
    expect(r.events.some((e) => e.type === 'battle.joined')).toBe(false);
  });

  it('бой на полосе числится за провинцией по переходу через границу, а не по середине', () => {
    // Переход A|B — на 125 из 270 (0.463). Встреча на 129.6 (0.48) — уже в B, хотя до
    // середины дороги ещё не дошли: старое правило «≤ 0.5 → A» записало бы её за A.
    const s = world();
    put(s, 'g1', 'p2', { from: 'A', to: 'B', t: 0.48 });
    put(s, 'f1', 'p1', 'A');
    const moved = order(s, 'f1', 'p1', 'B', 0);
    const r = until(moved.state, 12.96, moved.events);
    expect(started(r.events)).toEqual([expect.objectContaining({ location: 'B' })]);
  });
});

describe('ROADS-3 — развилка на каждой отгружаемой карте', () => {
  const shipped = loadGameData((name) =>
    JSON.parse(readFileSync(new URL(`../../../../data/${name}`, import.meta.url), 'utf8')),
  );
  const mapsDir = new URL('../../../../data/maps/', import.meta.url);
  /** Worlds, lanes and roads of a shipped map — without seating players, so AvA maps load. */
  function stateOf(file: string): GameState {
    const map = parseMatchMap(JSON.parse(readFileSync(new URL(file, mapsDir), 'utf8')));
    const edges = matchMapEdges(map, shipped);
    const ids = Object.keys(map.sectors).sort();
    const roads = deriveRoads({
      sectors: Object.fromEntries(
        ids.map((id) => [id, { ...map.sectors[id]!.position, terrain: map.sectors[id]!.terrain }]),
      ),
      lanes: edges.paths,
      borders: edges.derived
        ? mosaicBorderSegments(
            ids.map((id) => ({ id, ...map.sectors[id]!.position, size: map.sectors[id]!.size })),
          )
        : [],
      corridorsOf: (t) => (t ? shipped.sectors[t]?.corridors : undefined),
    });
    const s = createInitialState({ seed: file, version: { data: '0', manifest: '1' } });
    for (const id of ids) {
      const links = edges.paths.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
      const p = planet(id, map.sectors[id]!.position.x, map.sectors[id]!.position.y, links);
      if (roads[id]) p.roads = roads[id];
      s.planets[id] = p;
    }
    return s;
  }

  it('стоящий на развилке «с дальнего конца» дороги стоит на ней: округление её не сдвигает', () => {
    let mirrored = 0;
    let off = 0;
    for (const file of readdirSync(mapsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      const s = stateOf(file);
      for (const p of Object.values(s.planets)) {
        (p.roads?.trails ?? []).forEach((trail, i) => {
          if (!trail.fork) return;
          for (const x of trail.exits) {
            const tf = forkTAtStart(s, p.id, x);
            expect(snapToFork(s, p.id, x, tf)).toBe(tf); // прилипание не сдвигает саму развилку
            // Та же точка, записанная с другого конца дороги: 1 − t.
            const far = 1 - tf;
            mirrored += 1;
            if (far !== forkTAtEnd(s, x, p.id)) off += 1;
            expect(forkAt(s, x, p.id, far)?.province).toBe(p.id);
            const f: Fleet = {
              id: 'w',
              owner: 'p1',
              location: null,
              edge: { from: x, to: p.id, t: far },
              movement: null,
              units: [{ unit: 'scout', count: 1 }],
              traits: [],
            };
            const occ = trunkOccupancies(s, f).find((o) => o.key === `${p.id}#${i}`);
            expect(occ?.s0).toBeCloseTo(1, 9);
          }
        });
      }
    }
    // Проверка чего-то стоит, только если расхождение в последнем знаке на картах ЕСТЬ.
    expect(mirrored).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });
});
