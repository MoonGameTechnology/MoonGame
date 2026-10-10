/**
 * Геометрия флотов на карте (REFM-238) — прямой тест владельца: где флот стоит и куда
 * целится.
 *
 * Здесь проверено то, что текстом не проверить: позиция идёт по часам картинки, а не по
 * времени мира, вылет летит от живой базы, бой рисуется у воюющего флота, приказ получают
 * только свои флоты, шеврон сидит на орбитальном кольце и крутится дверью только на
 * близком зуме, палец ловит дорогу и развилку, а марш к точке дороги выбирает ближний
 * конец. Каждый тест — свежая загрузка модулей: у камеры, тумана и орбит своё состояние.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createInitialState,
  type Battle,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../../packages/shared-core/src/index';
import type { MapLod } from '../../packages/client/src/mapLod';
import { orbitSeats } from '../../decisions/orbitSeats';
import { isEmplacementFleet } from '../../decisions/emplacement';
import type { ForkMark } from '../../decisions/roadNetwork';
import { data } from './gameData';

// Первая загрузка тянет ядро и данные игры — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  await import('./fleetGeometry');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
});

const planet = (id: string, x: number, links: string[]): Planet => ({
  id,
  owner: null,
  kind: 'planet',
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  links,
});

const player = (id: string): Player =>
  ({ id, name: id, faction: 'azure', status: 'active', resources: {} }) as Player;

const fleet = (id: string, owner: string, patch: Partial<Fleet> = {}): Fleet =>
  ({
    id,
    owner,
    location: 'A',
    movement: null,
    units: [{ unit: 'frigate', count: 1 }],
    traits: [],
    battleId: null,
    ...patch,
  }) as unknown as Fleet;

/** Цепочка A—B—C по оси x, шаг 1000. */
function base(patch: (st: GameState) => void = () => {}): GameState {
  const st = createInitialState({ seed: 'geo', version: { data: '0.1.0', manifest: '1' } });
  const out: GameState = {
    ...st,
    time: 0,
    planets: {
      A: planet('A', 0, ['B']),
      B: planet('B', 1000, ['A', 'C']),
      C: planet('C', 2000, ['B']),
    },
    players: { p1: player('p1'), p2: player('p2') },
    fleets: {},
    battles: {},
  };
  patch(out);
  return out;
}

const lod = (detail: number): MapLod => ({
  scale: 2,
  art: 1,
  detail,
  provinceDetail: 1,
  markerRadius: 3,
});

async function boot(w: GameState = base()) {
  const env = { world: w, now: 0, lod: lod(1), marks: [] as ForkMark[] };
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
    select: () => {},
    closeDiplo: () => {},
    ring: () => {},
  });
  camera.frameMap(Object.values(w.planets).map((p) => p.position));
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => false,
    contacts: () => [],
    sight: () => [],
  });
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => env.now,
    lod: () => env.lod,
    forkMarks: () => env.marks,
    orbits: () => orbitSeats(Object.values(env.world.fleets), (g) => isEmplacementFleet(g, data)),
  });
  return { geo, camera, env };
}

const near = (a: { x: number; y: number } | null, b: { x: number; y: number }) => {
  expect(a).not.toBeNull();
  expect(a!.x).toBeCloseTo(b.x, 6);
  expect(a!.y).toBeCloseTo(b.y, 6);
};

describe('REFM-238 — где флот стоит', () => {
  it('стоянка — у мира, точка дороги — по доле, марш — по часам картинки', async () => {
    const moving = fleet('m', 'p1', {
      location: null,
      movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 2000 } as Fleet['movement'],
    });
    const parked = fleet('e', 'p1', { location: null, edge: { from: 'B', to: 'C', t: 0.25 } });
    const { geo, env } = await boot(base((st) => (st.fleets = { m: moving, e: parked })));
    near(geo.fleetPos(fleet('s', 'p1')), { x: 0, y: 0 });
    near(geo.fleetPos(parked), { x: 1250, y: 0 });
    near(geo.fleetPos(moving), { x: 0, y: 0 });
    env.now = 1000; // время мира стоит на нуле: картинку двигают часы картинки
    near(geo.fleetPos(moving), { x: 500, y: 0 });
  });

  it('точка отсчёта на экране — та же позиция в проекции камеры', async () => {
    const { geo, camera } = await boot();
    near(geo.fleetOriginPx(fleet('s', 'p1', { location: 'B' })), camera.world({ x: 1000, y: 0 }));
  });

  it('вылет летит от живой базы: мир, носитель, а пропавший носитель — база не найдена', async () => {
    // Носитель стоит посреди дороги: база вылета — его точка, а не ближний мир.
    const carrier = fleet('c', 'p1', { location: null, edge: { from: 'A', to: 'B', t: 0.5 } });
    const strike = {
      id: 'st',
      base: { kind: 'planet', id: 'A' },
      to: { x: 1000, y: 500 },
      leg: 'out',
      departedAt: 0,
      arrivesAt: 2000,
    };
    const { geo, env } = await boot(
      base((st) => {
        st.fleets = { c: carrier };
        st.strikes = [strike] as unknown as GameState['strikes'];
      }),
    );
    near(geo.strikeBasePos({ kind: 'planet', id: 'A' }), { x: 0, y: 0 });
    near(geo.strikeBasePos({ kind: 'fleet', id: 'c' }), { x: 500, y: 0 });
    expect(geo.strikeBasePos({ kind: 'fleet', id: 'gone' })).toBeNull();
    env.now = 1000;
    near(geo.strikeWorldPos('st'), { x: 500, y: 250 });
    expect(geo.strikeWorldPos('nope')).toBeNull();
  });

  it('бой рисуется у воюющего флота, а без него — у мира', async () => {
    const fighter = fleet('f', 'p1', {
      location: null,
      battleId: 'b1',
      edge: { from: 'A', to: 'B', t: 0.5 },
    });
    const fight = (id: string) => ({ id, location: 'B', sides: [] }) as unknown as Battle;
    const { geo } = await boot(base((st) => (st.fleets = { f: fighter })));
    near(geo.battleAnchor(fight('b1')), { x: 500, y: 0 });
    near(geo.battleAnchor(fight('b2')), { x: 1000, y: 0 });
  });
});

describe('REFM-238 — флоты под приказ', () => {
  it('приказ получают только свои флоты из выбора', async () => {
    const own = fleet('a', 'p1');
    const foe = fleet('z', 'p2');
    const { geo } = await boot(base((st) => (st.fleets = { a: own, z: foe })));
    const sel = await import('./interaction');
    sel.pickFleets(['a', 'z'], () => true);
    expect(geo.selectedFleetIds()).toEqual(['a']);
    sel.pickFleets(['z'], () => true);
    expect(geo.selectedFleetIds()).toEqual([]);
  });
});

describe('REFM-238 — орбиты', () => {
  const pair = (st: GameState) => (st.fleets = { a: fleet('a', 'p1'), b: fleet('b', 'p1') });
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it('стоящие флоты сидят на кольце мира, разведённые веером', async () => {
    const { geo, camera, env } = await boot(base(pair));
    const A = env.world.planets.A!;
    const r = geo.orbitRingRadius(A);
    const a = geo.fleetAnchor(env.world.fleets.a!)!;
    const b = geo.fleetAnchor(env.world.fleets.b!)!;
    expect(dist(a, camera.world(A.position))).toBeCloseTo(r, 6);
    expect(dist(b, camera.world(A.position))).toBeCloseTo(r, 6);
    expect(dist(a, b)).toBeGreaterThan(1);
  });

  it('кольцо не налезает на соседа: близкий сосед его ужимает', async () => {
    const far = await boot();
    const wide = far.geo.orbitRingRadius(far.env.world.planets.A!);
    vi.resetModules();
    const close = await boot(base((st) => (st.planets.B!.position = { x: 20, y: 0 })));
    expect(close.geo.orbitRingRadius(close.env.world.planets.A!)).toBeLessThan(wide);
  });

  it('кадр крутит орбиты дверью — но только на близком зуме', async () => {
    const { geo, env } = await boot(base(pair));
    const before = geo.fleetAnchor(env.world.fleets.a!)!;
    geo.spinOrbits(5000);
    expect(geo.orbitPhase).toBe(5000);
    const spun = geo.fleetAnchor(env.world.fleets.a!)!;
    expect(dist(before, spun)).toBeGreaterThan(0.01);
    env.lod = lod(0); // орбиты закрыты: шеврон стоит, сколько бы ни шло время
    const still = geo.fleetAnchor(env.world.fleets.a!)!;
    geo.spinOrbits(5000);
    expect(geo.orbitPhase).toBe(10_000); // фаза копится, а не ставится
    near(geo.fleetAnchor(env.world.fleets.a!), still);
  });

  it('флот в пути — в своей точке дороги, носом вдоль неё', async () => {
    const moving = fleet('m', 'p1', {
      location: null,
      movement: { from: 'C', to: 'B', departedAt: 0, arrivesAt: 2000 } as Fleet['movement'],
    });
    const { geo, camera, env } = await boot(base((st) => (st.fleets = { m: moving })));
    env.now = 1000;
    const a = geo.fleetAnchor(moving)!;
    near(a, camera.world({ x: 1500, y: 0 }));
    expect(Math.abs(a.ang)).toBeCloseTo(Math.PI, 6); // C→B — на запад
  });

  it('на изломанной дороге нос смотрит вдоль того колена, где флот сейчас', async () => {
    // Дорога A→B идёт через переход (500, 300): первое колено — вниз-вправо, второе — вверх.
    const roads = (at: string) =>
      ({ trails: [], crossings: { [at]: { x: 500, y: 300 } } }) as unknown as Planet['roads'];
    const bent = fleet('m', 'p1', {
      location: null,
      movement: { from: 'A', to: 'B', departedAt: 0, arrivesAt: 2000 } as Fleet['movement'],
    });
    const { geo, env } = await boot(
      base((st) => {
        st.planets.A!.roads = roads('B');
        st.planets.B!.roads = roads('A');
        st.fleets = { m: bent };
      }),
    );
    env.now = 1500; // три четверти пути — на втором колене
    expect(geo.fleetAnchor(bent)!.ang).toBeCloseTo(Math.atan2(-300, 500), 6);
  });

  it('нос смотрит вдоль дороги и по диагонали — вниз-вправо на экране', async () => {
    const diag = fleet('d', 'p1', {
      location: null,
      movement: { from: 'A', to: 'D', departedAt: 0, arrivesAt: 2000 } as Fleet['movement'],
    });
    const { geo } = await boot(
      base((st) => {
        st.planets.D = planet('D', 1000, ['A']);
        st.planets.D.position = { x: 1000, y: 1000 };
        st.fleets = { d: diag };
      }),
    );
    expect(geo.fleetAnchor(diag)!.ang).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe('REFM-238 — куда целится палец', () => {
  it('палец у дороги ловит её долю, далеко — ничего', async () => {
    const { geo, camera } = await boot();
    const mid = camera.world({ x: 500, y: 0 });
    const hit = geo.nearestLanePoint(mid.x, mid.y + 3)!;
    expect([hit.from, hit.to].sort()).toEqual(['A', 'B']);
    expect(hit.from === 'A' ? hit.t : 1 - hit.t).toBeCloseTo(0.5, 2);
    expect(geo.nearestLanePoint(mid.x, mid.y + 300)).toBeNull();
  });

  it('свободная развилка ловится, занятая крепостью — уже нет', async () => {
    const mark: ForkMark = { province: 'B', trail: 0, at: { x: 1000, y: 0 }, exits: [] };
    const { geo, camera, env } = await boot();
    env.marks = [mark];
    const at = camera.world(mark.at);
    expect(geo.forkMarkAt(at.x, at.y, 10)).toBe(mark);
    expect(geo.forkMarkAt(at.x + 50, at.y, 10)).toBeNull();
    // Площадка без хозяина — это ещё развилка: тап по ней выбирает место, а не крепость.
    env.world = base((st) => {
      st.planets['fork-B-0'] = { ...planet('fork-B-0', 1000, []), fork: {} } as Planet;
    });
    expect(geo.forkFortressAt(at.x, at.y, 10)).toBeNull();
    env.world = base((st) => {
      st.planets['fork-B-0'] = { ...planet('fork-B-0', 1000, []), owner: 'p1', fork: {} } as Planet;
    });
    expect(geo.forkMarkAt(at.x, at.y, 10)).toBeNull();
    expect(geo.forkFortressAt(at.x, at.y, 10)).toBe('fork-B-0');
  });

  it('марш к точке дороги идёт через ближний к флоту конец', async () => {
    const { geo } = await boot();
    const lane = { from: 'A', to: 'B', t: 0.5 };
    expect(geo.laneAim(fleet('a', 'p1'), 'A', lane).endId).toBe('A');
    expect(geo.laneAim(fleet('c', 'p1', { location: 'C' }), 'C', lane).endId).toBe('B');
  });
});

describe('REFM-238 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const GEO = readFileSync(new URL('./fleetGeometry.ts', import.meta.url), 'utf8');
  const PAN = readFileSync(new URL('../panperf.mjs', import.meta.url), 'utf8');
  const init = /initFleetGeometry\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — мир, своё место, часы картинки, детализация, развилки и орбиты кадра', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'now: () => mapNow(),',
      'lod: () => currentMapLod(),',
      'forkMarks: () => roadDrawingOf(s).marks,',
      "orbits: () => perWorld('orbits', () => orbitSeats(Object.values(s.fleets), (g) => isEmplacementFleet(g, data))),",
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('фазу орбит крутит кадр дверью, а робот прокрутки обнуляет её той же дверью', () => {
    expect(MAIN).not.toMatch(/\borbitPhase\s*[-+]?=[^=]/);
    expect(MAIN).toContain(
      'if (saneGap(dt) && spinRuns(NET, speed, !!banner || comicQueue.isBusy())) spinOrbits(dt);',
    );
    expect(PAN).toContain('spinOrbits(-__orbitPhase);');
    expect(PAN).not.toMatch(/\borbitPhase\s*=/);
  });

  it('функции геометрии живут у владельца, и модуль не тянет `main.ts`', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (fleetPos|strikeBasePos|strikeWorldPos|fleetOriginPx|battleAnchor|selectedFleetIds|orbitsLive|orbitRingRadius|orbitAngle|stanceOf|fleetAnchor|nearestLanePoint|forkFortressAt|forkMarkAt|laneAim)\(/,
    );
    expect(GEO).not.toMatch(/from '\.\/main'/);
  });
});
