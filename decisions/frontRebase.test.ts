/**
 * ПЕРЕЛЁТ К ФРОНТУ (SHU-6.8) — куда бот перебазирует ударную эскадру.
 *
 * Приёмка кирпича меряется прогоном `selfplay` (строка «фаза 6»); здесь — правила решения
 * по одному и сторож в конце: выбранную базу принимает настоящий `shuttle.relocate`.
 */
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  createKernel,
  fleetPositionAt,
  parseGameData,
  shuttleModule,
  type Fleet,
  type GameData,
  type GameState,
  type Planet,
  type Squadron,
  type StrikeBase,
} from '../packages/shared-core/src/index';
import { frontRebase, FRONT_STEP } from './frontRebase';
import type { XY } from './relocateTargets';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Корабль с трюмом на 4 места.
    carrier: {
      faction: 'x',
      stats: { attack: 0, defense: 9, speed: 30, hp: 40, cargoCapacity: 4 },
    },
    // Радиус удара 150 — перелёт 300, шаг к фронту 75.
    striker: shuttle({ attack: 20, defense: 4, speed: 100, hp: 16, strikeRange: 150, fuel: 2 }),
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

const kernel = createKernel([shuttleModule]);

const planet = (id: string, owner: string | null, x: number, port = false): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: port ? [{ type: 'spaceport', level: 1, hp: 30 }] : [],
  garrison: [],
  traits: [],
});

const ship = (id: string, location: string, over: Partial<Fleet> = {}): Fleet => ({
  id,
  owner: 'p1',
  location,
  movement: null,
  units: [{ unit: 'carrier', count: 1 }],
  traits: [],
  battleId: null,
  ...over,
});

const WING: Squadron = { id: 'sq:s', units: [{ unit: 'striker', count: 2 }] };
const HOME: StrikeBase = { kind: 'planet', id: 'A' };
/** Фронт — чужой мир X(700). */
const FRONT: XY[] = [{ x: 700, y: 0 }];

/**
 * Прямая y = 0. Свой порт A(0) — дом эскадры. Свой порт B(200) и свой корабль F у мира без
 * порта D(280) — в дальности перелёта (300); свой порт C(500) — за ней. Чужой мир X(700).
 */
function world(): GameState {
  const s = createInitialState({ seed: 'shu68', version: { data: '0.1.0', manifest: '1' } });
  const A = planet('A', 'p1', 0, true);
  A.hangar = [WING];
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      A,
      B: planet('B', 'p1', 200, true),
      C: planet('C', 'p1', 500, true),
      D: planet('D', 'p1', 280),
      X: planet('X', 'p2', 700),
    },
    fleets: { F: ship('F', 'D') },
    heroes: {},
    battles: {},
  };
}

const posIn =
  (s: GameState) =>
  (b: StrikeBase): XY | null => {
    if (b.kind === 'planet') return s.planets[b.id]?.position ?? null;
    const f = s.fleets[b.id];
    return f ? fleetPositionAt(s, f, s.time) : null;
  };

const rebase = (
  s: GameState,
  opts: { from?: StrikeBase; squadron?: Squadron; targets?: XY[]; front?: XY[] } = {},
) =>
  frontRebase(s, {
    me: 'p1',
    from: opts.from ?? HOME,
    squadron: opts.squadron ?? WING,
    data,
    pos: posIn(s),
    targets: opts.targets ?? [],
    front: opts.front ?? FRONT,
  });

const where = (r: ReturnType<typeof rebase>): string | null =>
  r ? `${r.base.kind}:${r.base.id}` : null;

describe('SHU-6.8 — куда бот перебазирует ударную эскадру', () => {
  it('БЛИЖАЙШАЯ К ФРОНТУ СВОЯ БАЗА: корабль у D(280) ближе к X, чем порт B(200)', () => {
    expect(where(rebase(world()))).toBe('fleet:F');
  });

  it('КОРАБЛЬ БЕЗ МЕСТА НЕ БАЗА — тогда порт B; порт C за дальностью перелёта не предлагается', () => {
    const s = world();
    s.fleets.F = ship('F', 'D', { hangar: [{ id: 'sq:f', units: [{ unit: 'striker', count: 4 }] }] });
    expect(where(rebase(s))).toBe('planet:B');
  });

  it('ЕСТЬ ПО КОМУ БИТЬ ОТСЮДА — эскадра остаётся; граница радиуса включена', () => {
    expect(rebase(world(), { targets: [{ x: 150, y: 0 }] })).toBeNull();
    expect(where(rebase(world(), { targets: [{ x: 151, y: 0 }] }))).toBe('fleet:F');
  });

  it('НЕТ ФРОНТА — перелетать незачем', () => {
    expect(rebase(world(), { front: [] })).toBeNull();
  });

  it('ШАГ К ФРОНТУ НЕ МЕНЬШЕ ПОЛОВИНЫ РАДИУСА УДАРА — короче шага перелёта нет', () => {
    const s = world();
    delete s.fleets.F;
    s.planets.B = planet('B', 'p1', FRONT_STEP * 150, true); // ровно 75 — ещё шаг
    expect(where(rebase(s))).toBe('planet:B');
    s.planets.B = planet('B', 'p1', FRONT_STEP * 150 - 1, true);
    expect(rebase(s)).toBeNull();
  });

  it('С КОРАБЛЯ — НА ПОРТ: корабль ушёл в тыл, эскадра перелетает на порт у фронта', () => {
    const s = world();
    s.planets.A!.hangar = [];
    s.fleets.F = ship('F', 'D', { hangar: [WING] });
    s.planets.P = planet('P', 'p1', 560, true); // 280 от корабля, 140 до X
    expect(where(rebase(s, { from: { kind: 'fleet', id: 'F' } }))).toBe('planet:P');
  });

  it('ПОЗИЦИЯ БАЗЫ ЖИВАЯ: идущий корабль уже у фронта — эскадре на нём перелетать незачем', () => {
    const s = world();
    s.planets.A!.hangar = [];
    s.fleets.F = ship('F', 'D', { hangar: [WING] });
    const live = (b: StrikeBase): XY | null =>
      b.kind === 'fleet' && b.id === 'F' ? { x: 620, y: 0 } : posIn(s)(b);
    const r = frontRebase(s, {
      me: 'p1',
      from: { kind: 'fleet', id: 'F' },
      squadron: WING,
      data,
      pos: live,
      targets: FRONT, // чужой мир X теперь в радиусе удара
      front: FRONT,
    });
    expect(r).toBeNull();
  });

  it('ЭСКАДРА НЕ ЛЕТАЕТ ИЛИ БАЗЫ НЕТ — решения нет', () => {
    expect(rebase(world(), { squadron: { id: 'sq:z', units: [] } })).toBeNull();
    expect(rebase(world(), { from: { kind: 'fleet', id: 'GONE' } })).toBeNull();
  });
});

describe('SHU-6.8 — сторож: выбранную базу принимает ядро', () => {
  const relocate = (s: GameState, from: StrikeBase, to: StrikeBase) =>
    kernel.applyAction(
      s,
      {
        id: 'a:1',
        type: 'shuttle.relocate',
        playerId: 'p1',
        payload: {
          ...(from.kind === 'planet' ? { planetId: from.id } : { fleetId: from.id }),
          squadronId: WING.id,
          ...(to.kind === 'planet' ? { toPlanetId: to.id } : { toFleetId: to.id }),
        },
        issuedAt: 0,
      },
      { now: s.time, data },
    );

  it('с порта на корабль и с корабля на порт', () => {
    const s = world();
    const toShip = rebase(s)!;
    expect(relocate(s, HOME, toShip.base).ok).toBe(true);

    const t = world();
    t.planets.A!.hangar = [];
    t.fleets.F = ship('F', 'D', { hangar: [WING] });
    t.planets.P = planet('P', 'p1', 560, true);
    const from: StrikeBase = { kind: 'fleet', id: 'F' };
    const toPort = rebase(t, { from })!;
    expect(relocate(t, from, toPort.base).ok).toBe(true);
  });
});
