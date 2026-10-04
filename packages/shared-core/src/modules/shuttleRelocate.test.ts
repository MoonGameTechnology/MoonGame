/**
 * ПЕРЕБАЗИРОВАНИЕ И ПОСАДКА БЕЗ БАЗЫ (SHU-6.4) — приёмка кирпича.
 *
 * Резолюция владельца 2026-10-04 (`shuttles-roadmap.md` §0.7, по образцу Conflict of
 * Nations): эскадра перелетает на другую СВОЮ базу в двух радиусах удара — на мир с портом
 * или ангаром крепости либо на корабль со свободным трюмом, в том числе идущий. Место в
 * трюме корабля бронируется на взлёте. Новая база не приняла — эскадра возвращается домой;
 * дома тоже нет — садится на ближайшую свою базу в дальности перелёта, иначе гибнет. Тем же
 * правилом садится любой вылет, чья база пропала, пока он был в воздухе.
 *
 * База — обе её формы (уточнение владельца: «учти наши базы, в виде трюмов»): и откуда
 * летят, и куда садятся.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type Squadron,
  type UnitStack,
} from '../state/gameState';
import { fleetHoldFree, squadronFerryRange } from '../state/shuttle';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, DomainEvent } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Носитель: трюм на 4 места — база, которая ходит.
    carrier: {
      faction: 'x',
      stats: { attack: 0, defense: 9, speed: 30, hp: 40, cargoCapacity: 4 },
    },
    // Зональное ПВО корабля: бьёт вылеты в своём радиусе.
    picket: { faction: 'x', stats: { attack: 0, defense: 5, speed: 10, hp: 100, pointDefense: 2 } },
    militia: { faction: 'x', domain: 'ground', stats: { attack: 1, defense: 1, speed: 0, hp: 10 } },
    // Все челноки идут 100 ед/час. Радиус удара 180 — перелёт 360.
    interceptor: shuttle({
      attack: 4,
      defense: 3,
      speed: 100,
      hp: 10,
      strikeRange: 180,
      fuel: 3,
      rearmRounds: 2,
      shuttleDamage: 22,
      patrolHours: 4,
      patrolRadius: 60,
    }),
    bomber: shuttle({
      attack: 20,
      defense: 4,
      speed: 100,
      hp: 16,
      strikeRange: 180,
      fuel: 2,
      rearmRounds: 3,
      siegeDamage: 8,
    }),
    // Десантный челнок: короткая рука (120) — перелёт 240.
    lander: shuttle({
      attack: 0,
      defense: 2,
      speed: 100,
      hp: 24,
      strikeRange: 120,
      fuel: 2,
      rearmRounds: 2,
    }),
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

const kernel = createKernel([shuttleModule]);
const H = MS_PER_HOUR;

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

const planet = (id: string, owner: string | null, x: number, y: number, port = false): Planet => ({
  id,
  owner,
  position: { x, y },
  resources: {},
  buildings: port ? [{ type: 'spaceport', level: 1, hp: 30 }] : [],
  garrison: [],
  traits: [],
});

const sq = (id: string, unit: string, count: number, cargo?: UnitStack[]): Squadron => ({
  id,
  units: [{ unit, count }],
  ...(cargo ? { cargo } : {}),
});

/**
 * Свои порты A(0,0) — с заданным ангаром, — B(300,0) в дальности перелёта и C(1000,0) вне
 * её; чужой мир Z(300,100) — цель удара.
 */
function world(hangar: Squadron[]): GameState {
  const s = createInitialState({ seed: 'shu64', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, 0, true);
  home.hangar = hangar;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      B: planet('B', 'p1', 300, 0, true),
      C: planet('C', 'p1', 1000, 0, true),
      Z: planet('Z', 'p2', 300, 100),
    },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

/** Поставить корабль на отдельный ничейный узел в точке `at` (или пустить его в путь). */
function withShip(
  s: GameState,
  id: string,
  at: { x: number; y: number },
  over: Partial<Fleet> = {},
): GameState {
  const node = `n:${id}`;
  const fleet: Fleet = {
    id,
    owner: 'p1',
    location: node,
    movement: null,
    units: [{ unit: 'carrier', count: 1 }],
    traits: [],
    battleId: null,
    ...over,
  };
  return {
    ...s,
    planets: { ...s.planets, [node]: planet(node, null, at.x, at.y) },
    fleets: { ...s.fleets, [id]: fleet },
  };
}

let seq = 0;
const act = (type: string, payload: Record<string, unknown>, playerId = 'p1'): Action => ({
  id: `a:${seq++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const relocate = (
  squadronId: string,
  to: Record<string, string>,
  from: Record<string, string> = { planetId: 'A' },
): Action => act('shuttle.relocate', { ...from, squadronId, ...to });

function apply(s: GameState, a: Action): GameState {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(s: GameState, a: Action): string | null {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  return r.ok ? null : r.code;
}
/** Довести мир до `hours` часов от начала партии — вместе с событиями этого отрезка. */
function run(s: GameState, hours: number): { state: GameState; events: DomainEvent[] } {
  const r = kernel.advanceTo(s, { now: hours * H, data });
  if (!r.ok) throw new Error('advance failed');
  return { state: r.state, events: r.events };
}
const until = (s: GameState, hours: number): GameState => run(s, hours).state;

const machines = (units: readonly UnitStack[] | undefined): number =>
  (units ?? []).reduce((n, st) => n + st.count, 0);
const docked = (host: { hangar?: Squadron[] } | undefined): number =>
  (host?.hangar ?? []).reduce((n, q) => n + machines(q.units), 0);
const payloads = (events: DomainEvent[], type: string): Array<Record<string, unknown>> =>
  events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const flight = (s: GameState) => (s.strikes ?? [])[0];
/** Убрать флот из состояния — так его уносит гибель в бою. */
const sink = (s: GameState, id: string): GameState => {
  const { [id]: _gone, ...rest } = s.fleets;
  return { ...s, fleets: rest };
};
/** Сменить хозяина мира — так его забирает захват. */
const lose = (s: GameState, id: string): GameState => ({
  ...s,
  planets: { ...s.planets, [id]: { ...s.planets[id]!, owner: 'p2', hangar: [] } },
});

describe('SHU-6.4 — приказ перелёта', () => {
  it('С ПОРТА НА ПОРТ: эскадра покидает ангар, база тратит вылет, на месте она под своим именем', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), relocate('sq:i', { toPlanetId: 'B' }));
    expect(docked(s.planets.A)).toBe(0);
    const st = flight(s);
    expect(st?.target).toEqual({ kind: 'base' });
    expect(st?.base).toEqual({ kind: 'planet', id: 'B' });
    expect(st?.origin).toEqual({ kind: 'planet', id: 'A' });
    expect(st?.leg).toBe('back');
    expect(st?.arrivesAt).toBe(3 * H); // 300 единиц на 100 в час
    expect(s.planets.A?.sortie?.fuel).toBe(2); // из трёх — один, как у удара

    const { state, events } = run(s, 3);
    expect(state.strikes ?? []).toHaveLength(0);
    expect(state.planets.B?.hangar?.map((q) => q.id)).toEqual(['sq:i']);
    expect(docked(state.planets.B)).toBe(2);
    expect(payloads(events, 'shuttle.landed')).toEqual([
      expect.objectContaining({ baseId: 'B', baseKind: 'planet', owner: 'p1' }),
    ]);
  });

  it('ДАЛЬНОСТЬ — ДВА РАДИУСА УДАРА: граница включительно, дальше отказ', () => {
    expect(squadronFerryRange(sq('x', 'interceptor', 1), data)).toBe(360);
    let s = world([sq('sq:i', 'interceptor', 2)]);
    s = {
      ...s,
      planets: {
        ...s.planets,
        B: planet('B', 'p1', 360, 0, true),
        D: planet('D', 'p1', 361, 0, true),
      },
    };
    expect(code(s, relocate('sq:i', { toPlanetId: 'D' }))).toBe('E_OUT_OF_RANGE');
    expect(code(s, relocate('sq:i', { toPlanetId: 'C' }))).toBe('E_OUT_OF_RANGE');
    expect(code(s, relocate('sq:i', { toPlanetId: 'B' }))).toBeNull();
  });

  it('ДАЛЬНОСТЬ ЭСКАДРЫ — ПО САМОЙ КОРОТКОЙ РУКЕ: с челноком в составе перелёт короче', () => {
    const mixed: Squadron = {
      id: 'sq:m',
      units: [
        { unit: 'interceptor', count: 1 },
        { unit: 'lander', count: 1 },
      ],
    };
    // До B 300, а у челнока перелёт 240.
    expect(code(world([mixed]), relocate('sq:m', { toPlanetId: 'B' }))).toBe('E_OUT_OF_RANGE');
  });

  it('КУДА НЕЛЬЗЯ: свой мир без порта, чужой мир, чужой или несуществующий корабль, своя же база', () => {
    let s = world([sq('sq:i', 'interceptor', 2)]);
    s = {
      ...s,
      planets: {
        ...s.planets,
        BARE: planet('BARE', 'p1', 100, 0),
        FOE: planet('FOE', 'p2', 100, 50, true),
      },
    };
    s = withShip(s, 'THEIRS', { x: 100, y: 0 }, { owner: 'p2' });
    s = withShip(s, 'PK', { x: 100, y: 20 }, { units: [{ unit: 'picket', count: 1 }] });
    expect(code(s, relocate('sq:i', { toPlanetId: 'BARE' }))).toBe('E_NO_PORT');
    // Свой корабль без трюма — не база, как свой мир без порта.
    expect(code(s, relocate('sq:i', { toFleetId: 'PK' }))).toBe('E_NO_PORT');
    expect(code(s, relocate('sq:i', { toPlanetId: 'FOE' }))).toBe('E_FORBIDDEN');
    expect(code(s, relocate('sq:i', { toPlanetId: 'NOPE' }))).toBe('E_NO_PLANET');
    // Чужой и несуществующий корабль — один ответ: туман не выдаётся перебором id (A06).
    expect(code(s, relocate('sq:i', { toFleetId: 'THEIRS' }))).toBe('E_NO_FLEET');
    expect(code(s, relocate('sq:i', { toFleetId: 'NOPE' }))).toBe('E_NO_FLEET');
    expect(code(s, relocate('sq:i', { toPlanetId: 'A' }))).toBe('E_BAD_PAYLOAD');
    expect(code(s, relocate('sq:i', {}))).toBe('E_BAD_PAYLOAD');
    expect(code(s, relocate('sq:i', { toPlanetId: 'B', toFleetId: 'THEIRS' }))).toBe(
      'E_BAD_PAYLOAD',
    );
  });

  it('КОРАБЛЬ БЕЗ МЕСТА НЕ ПРИНИМАЕТ, А МЕСТО ДЕРЖИТСЯ С ВЗЛЁТА', () => {
    let s = withShip(world([sq('sq:a', 'interceptor', 3), sq('sq:b', 'interceptor', 2)]), 'CV', {
      x: 200,
      y: 0,
    });
    s = apply(s, relocate('sq:a', { toFleetId: 'CV' }));
    // Три места из четырёх заняты, хотя эскадра ещё в воздухе.
    expect(fleetHoldFree(s, s.fleets.CV!, data)).toBe(1);
    expect(code(s, relocate('sq:b', { toFleetId: 'CV' }))).toBe('E_NO_CAPACITY');
  });

  it('НА ИДУЩИЙ КОРАБЛЬ И С НЕГО НА ДРУГОЙ ПОРТ', () => {
    // Корабль идёт N1(200,0) → N2(200,500) за 10 ч, 50 ед/час. К моменту посадки (2 ч) он
    // в (200,100): эскадра садится на его живую позицию, а не туда, где он был на взлёте.
    let s = world([sq('sq:i', 'interceptor', 2)]);
    s = {
      ...s,
      planets: { ...s.planets, N1: planet('N1', null, 200, 0), N2: planet('N2', null, 200, 500) },
    };
    s = withShip(
      s,
      'CV',
      { x: 0, y: 0 },
      {
        location: null,
        movement: { from: 'N1', to: 'N2', departedAt: 0, arrivesAt: 10 * H },
      },
    );
    s = apply(s, relocate('sq:i', { toFleetId: 'CV' }));
    expect(flight(s)?.base).toEqual({ kind: 'fleet', id: 'CV' });
    expect(flight(s)?.arrivesAt).toBe(2 * H);

    s = until(s, 2);
    expect(s.strikes ?? []).toHaveLength(0);
    expect(s.fleets.CV?.hangar?.map((q) => q.id)).toEqual(['sq:i']);

    // С идущего корабля — на порт B(300,0): √(100² + 100²) ≈ 141 единица.
    s = apply(s, relocate('sq:i', { toPlanetId: 'B' }, { fleetId: 'CV' }));
    expect(s.fleets.CV?.hangar ?? []).toHaveLength(0);
    expect(s.fleets.CV?.sortie?.fuel).toBe(2); // тратит вылет корабля, а не порта
    expect((flight(s)!.arrivesAt - flight(s)!.departedAt) / H).toBeCloseTo(Math.SQRT2, 3);
    s = until(s, 3.5);
    expect(s.planets.B?.hangar?.map((q) => q.id)).toEqual(['sq:i']);
  });

  it('ДЕСАНТНЫЙ ЧЕЛНОК ПЕРЕЛЕТАЕТ ВМЕСТЕ С БОЙЦОМ', () => {
    let s = withShip(world([sq('sq:l', 'lander', 1, [{ unit: 'militia', count: 1 }])]), 'CV', {
      x: 200,
      y: 0,
    });
    s = until(apply(s, relocate('sq:l', { toFleetId: 'CV' })), 2);
    expect(s.fleets.CV?.hangar).toEqual([
      { id: 'sq:l', units: [{ unit: 'lander', count: 1 }], cargo: [{ unit: 'militia', count: 1 }] },
    ]);
  });

  it('ПЕРЕЛЁТ НЕ ОТЗЫВАЕТСЯ: у него нет патруля', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), relocate('sq:i', { toPlanetId: 'B' }));
    expect(code(s, act('shuttle.recall', { strikeId: flight(s)!.id }))).toBe('E_NOT_PATROLLING');
  });
});

describe('SHU-6.4 — новая база не приняла', () => {
  it('КОРАБЛЬ-ЦЕЛЬ ПОГИБ — ЭСКАДРА ДОЛЕТАЕТ ДО ЕГО ТОЧКИ И ВОЗВРАЩАЕТСЯ ДОМОЙ', () => {
    let s = withShip(world([sq('sq:i', 'interceptor', 2)]), 'CV', { x: 200, y: 0 });
    s = sink(until(apply(s, relocate('sq:i', { toFleetId: 'CV' })), 1), 'CV');
    const turned = run(s, 2);
    const st = flight(turned.state);
    expect(st?.base).toEqual({ kind: 'planet', id: 'A' });
    expect(st?.origin).toBeUndefined(); // вторая неудача поведёт уже к ближайшей базе
    expect(st?.to).toEqual({ x: 200, y: 0 }); // там, где корабль видели в последний раз
    expect(payloads(turned.events, 'shuttle.diverted')).toEqual([
      expect.objectContaining({
        owner: 'p1',
        fromId: 'CV',
        fromKind: 'fleet',
        baseId: 'A',
        baseKind: 'planet',
      }),
    ]);
    const home = until(turned.state, 4);
    expect(home.strikes ?? []).toHaveLength(0);
    expect(docked(home.planets.A)).toBe(2);
  });

  it('МЕСТА НЕ СТАЛО — ТОЖЕ ДОМОЙ, А НЕ ПОСАДКА ЧАСТЬЮ', () => {
    // Два носителя — восемь мест, два заняты своей эскадрой. Пока перелёт в воздухе, один
    // носитель сбит: мест четыре, свободно два, а летят три машины.
    let s = withShip(
      world([sq('sq:i', 'interceptor', 3)]),
      'CV',
      { x: 200, y: 0 },
      {
        units: [{ unit: 'carrier', count: 2 }],
        hangar: [sq('sq:own', 'interceptor', 2)],
      },
    );
    s = until(apply(s, relocate('sq:i', { toFleetId: 'CV' })), 1);
    s = {
      ...s,
      fleets: { ...s.fleets, CV: { ...s.fleets.CV!, units: [{ unit: 'carrier', count: 1 }] } },
    };
    s = until(s, 2);
    expect(docked(s.fleets.CV)).toBe(2); // своё на борту, чужого не прибавилось
    expect(flight(s)?.base).toEqual({ kind: 'planet', id: 'A' });
    expect(docked(until(s, 4).planets.A)).toBe(3); // долетели все три
  });

  it('ДОМА ТОЖЕ НЕТ — БЛИЖАЙШАЯ СВОЯ БАЗА В ДАЛЬНОСТИ ПЕРЕЛЁТА', () => {
    let s = withShip(world([sq('sq:i', 'interceptor', 2)]), 'CV', { x: 200, y: 0 });
    // Свой мир без порта ближе B, но сесть там негде.
    s = { ...s, planets: { ...s.planets, BARE: planet('BARE', 'p1', 250, 0) } };
    s = until(apply(s, relocate('sq:i', { toFleetId: 'CV' })), 1);
    s = lose(sink(s, 'CV'), 'A');
    const { state, events } = run(s, 2);
    expect(flight(state)?.base).toEqual({ kind: 'planet', id: 'B' });
    expect(payloads(events, 'shuttle.diverted')[0]).toMatchObject({ baseId: 'B', fromId: 'CV' });
    expect(docked(until(state, 3).planets.B)).toBe(2); // от (200,0) до B — час
  });

  it('НЕКУДА — ГИБЕЛЬ: вылет снят, потеря объявлена', () => {
    let s = withShip(world([sq('sq:i', 'interceptor', 2)]), 'CV', { x: 200, y: 0 });
    s = until(apply(s, relocate('sq:i', { toFleetId: 'CV' })), 1);
    s = lose(lose(sink(s, 'CV'), 'A'), 'B');
    const { state, events } = run(s, 2);
    expect(state.strikes ?? []).toHaveLength(0);
    expect(payloads(events, 'shuttle.lost')).toEqual([
      expect.objectContaining({ owner: 'p1', baseId: 'CV', baseKind: 'fleet', count: 2 }),
    ]);
  });
});

describe('SHU-6.4 — база пропала, пока эскадра в воздухе', () => {
  it('УДАР, ЧЕЙ КОРАБЛЬ ПОГИБ, САДИТСЯ НА БЛИЖАЙШИЙ СВОЙ ПОРТ', () => {
    // Корабль у D(200,0) бьёт мир Z(300,100) и гибнет. Удар состоялся, домой некуда — от Z
    // до B 100 единиц, до A ≈ 316: эскадра садится на B.
    let s = withShip(world([]), 'CV', { x: 200, y: 0 }, { hangar: [sq('sq:b', 'bomber', 2)] });
    s = apply(s, act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:b', targetPlanetId: 'Z' }));
    s = sink(s, 'CV');
    const hit = run(s, 1.5);
    expect(payloads(hit.events, 'shuttle.hit')).toHaveLength(1);
    expect(payloads(hit.events, 'shuttle.diverted')).toEqual([
      expect.objectContaining({ fromId: 'CV', fromKind: 'fleet', baseId: 'B', baseKind: 'planet' }),
    ]);
    const landed = until(hit.state, 3);
    expect(landed.strikes ?? []).toHaveLength(0);
    expect(landed.planets.B?.hangar?.map((q) => q.id)).toEqual(['sq:b']);
  });

  it('БЛИЖАЙШЕЙ БАЗОЙ БЫВАЕТ И СВОЙ КОРАБЛЬ С МЕСТОМ — ОНО ДЕРЖИТСЯ С ПОВОРОТА', () => {
    // Второй носитель CV2(300,60) ближе к Z(300,100), чем порт B: 40 против 100.
    let s = withShip(world([]), 'CV', { x: 200, y: 0 }, { hangar: [sq('sq:b', 'bomber', 2)] });
    s = withShip(s, 'CV2', { x: 300, y: 60 });
    s = sink(
      apply(s, act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:b', targetPlanetId: 'Z' })),
      'CV',
    );
    const turned = until(s, 1.5);
    expect(flight(turned)?.base).toEqual({ kind: 'fleet', id: 'CV2' });
    expect(fleetHoldFree(turned, turned.fleets.CV2!, data)).toBe(2); // два места из четырёх уже за ней
    expect(until(turned, 2).fleets.CV2?.hangar?.map((q) => q.id)).toEqual(['sq:b']);
  });

  it('ПАТРУЛЬ С ПОГИБШЕГО КОРАБЛЯ ДОСИЖИВАЕТ СРОК И САДИТСЯ НА ПОРТ', () => {
    // Точка (200,150): до B 180, до A 250 — ближе B.
    let s = withShip(world([]), 'CV', { x: 200, y: 0 }, { hangar: [sq('sq:i', 'interceptor', 2)] });
    s = sink(
      apply(
        s,
        act('shuttle.patrol', { fleetId: 'CV', squadronId: 'sq:i', at: { x: 200, y: 150 } }),
      ),
      'CV',
    );
    expect(flight(until(s, 5.4))?.leg).toBe('patrol'); // висит, как висел бы с живого корабля
    const turned = until(s, 5.6);
    expect(flight(turned)?.base).toEqual({ kind: 'planet', id: 'B' });
    expect(flight(turned)?.target).toEqual({ kind: 'base' }); // патруль кончился
    expect(flight(turned)?.patrol).toBeUndefined();
    expect(docked(until(turned, 7.5).planets.B)).toBe(2);
  });

  it('КОРАБЛЬ ПОГИБ НА ОБРАТНОЙ НОГЕ — ЭСКАДРА ДОЛЕТАЕТ ДО ЕГО ТОЧКИ И ИЩЕТ, ГДЕ СЕСТЬ', () => {
    // Удар с D(200,0) по Z(300,100): туда и обратно по √2 часа. Корабль гибнет на обратной
    // ноге; эскадра доходит до (200,0), где его видели, и уходит на B — ещё час.
    let s = withShip(world([]), 'CV', { x: 200, y: 0 }, { hangar: [sq('sq:b', 'bomber', 2)] });
    s = apply(s, act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:b', targetPlanetId: 'Z' }));
    s = until(s, 2);
    expect(flight(s)?.leg).toBe('back');
    expect(flight(s)?.baseAt).toEqual({ x: 200, y: 0 });
    s = sink(s, 'CV');
    const lost = until(s, 2 * Math.SQRT2 + 0.01);
    expect(flight(lost)?.base).toEqual({ kind: 'planet', id: 'B' });
    expect(flight(lost)?.to).toEqual({ x: 200, y: 0 });
    expect(docked(until(lost, 4).planets.B)).toBe(2);
  });

  it('ПОРТ СНЕСЛИ — ЭСКАДРА САДИТСЯ НА СОСЕДНИЙ', () => {
    // Удар с A по Z(300,100) — за ≈ 316 единиц, вне радиуса; бьём ближе: мир Y(150,0).
    let s = world([sq('sq:b', 'bomber', 2)]);
    s = { ...s, planets: { ...s.planets, Y: planet('Y', 'p2', 150, 0) } };
    s = apply(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:b', targetPlanetId: 'Y' }));
    const a = s.planets.A!;
    s = {
      ...s,
      planets: { ...s.planets, A: { ...a, buildings: [{ type: 'spaceport', level: 1, hp: 0 }] } },
    };
    const turned = until(s, 1.6);
    expect(flight(turned)?.base).toEqual({ kind: 'planet', id: 'B' });
    expect(docked(until(turned, 3).planets.B)).toBe(2);
  });

  it('НАРЕЗКА ВРЕМЕНИ ИСХОД НЕ МЕНЯЕТ', () => {
    let s = withShip(world([sq('sq:i', 'interceptor', 2)]), 'CV', { x: 200, y: 0 });
    s = sink(until(apply(s, relocate('sq:i', { toFleetId: 'CV' })), 1), 'CV');
    const whole = until(s, 5);
    let sliced = s;
    for (let h = 1.25; h <= 5; h += 0.25) sliced = until(sliced, h);
    expect(sliced.planets.A?.hangar).toEqual(whole.planets.A?.hangar);
    expect(sliced.strikes ?? []).toEqual(whole.strikes ?? []);
  });
});

describe('SHU-6.4 — опустевшая база не сохнет навсегда', () => {
  it('ПЕРЕЗАРЯДКА НА ПУСТОЙ БАЗЕ СНИМАЕТ СЧЁТЧИК: вернувшаяся эскадра снова взлетает', () => {
    let s = world([sq('sq:i', 'interceptor', 2)]);
    s = {
      ...s,
      planets: { ...s.planets, A: { ...s.planets.A!, sortie: { fuel: 1, rearming: 0 } } },
    };
    s = apply(s, relocate('sq:i', { toPlanetId: 'B' }));
    expect(s.planets.A?.sortie).toEqual({ fuel: 0, rearming: 2 });
    s = until(s, 3);
    // Перезарядка кончилась, когда заправлять было нечего: счётчик снят, а не «полон нулём».
    expect(s.planets.A?.sortie).toBeUndefined();
    s = until(apply(s, relocate('sq:i', { toPlanetId: 'A' }, { planetId: 'B' })), 6);
    expect(docked(s.planets.A)).toBe(2);
    expect(
      code(s, act('shuttle.patrol', { planetId: 'A', squadronId: 'sq:i', at: { x: 100, y: 0 } })),
    ).toBeNull();
  });
});

describe('SHU-6.4 — перелёт в небе', () => {
  it('ПЕРЕЛЁТ ВИДЕН ОБОРОНЕ: зональное ПВО бьёт его по трассе', () => {
    let s = world([sq('sq:i', 'interceptor', 2)]);
    s = withShip(
      s,
      'PK',
      { x: 150, y: 30 },
      { owner: 'p2', units: [{ unit: 'picket', count: 1 }] },
    );
    s = apply(s, relocate('sq:i', { toPlanetId: 'B' }));
    const id = flight(s)!.id;
    const { events } = run(s, 2);
    expect(payloads(events, 'pd.fired').some((p) => p.strikeId === id)).toBe(true);
  });
});
