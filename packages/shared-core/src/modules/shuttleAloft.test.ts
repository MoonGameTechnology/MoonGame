/**
 * ЭСКАДРА В ВОЗДУХЕ (SHU-6.13) — приёмка кирпича.
 *
 * Владелец 2026-10-11: эскадра в воздухе — такой же космический юнит, как флот; выделив её,
 * можно разделить её и сменить ей приказ. Дефолты (сказаны владельцу в треде): радиус новой
 * цели — от базы, как на вылете; второй вылет базы не тратится; перенесённый патруль висит,
 * сколько оставалось; обратная нога может только сменить базу посадки; делёж — как в ангаре,
 * обе половины летят дальше тем же приказом.
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
  type ShuttleStrike,
  type Squadron,
  type UnitStack,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, DomainEvent } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Цель без пушек и зенитки: ответки нет.
    freighter: { faction: 'x', stats: { attack: 0, defense: 0, speed: 10, hp: 1000 } },
    militia: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 1, defense: 1, speed: 0, hp: 10 },
    },
    // Все челноки идут 100 ед/час с радиусом 180 от базы A(0,0).
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
      chaseRadius: 12,
      fuel: 3,
      rearmRounds: 3,
      siegeDamage: 8,
      patrolHours: 3,
      patrolRadius: 60,
    }),
    lander: shuttle({
      attack: 0,
      defense: 2,
      speed: 100,
      hp: 24,
      strikeRange: 180,
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
 * Свой порт A(0,0) и свой порт B(0,−150); чужие миры Z(150,0) и Y(200,0). Y за радиусом
 * базы (200 > 180), хотя эскадре на пути к Z до него всего полсотни.
 */
function world(hangar: Squadron[]): GameState {
  const s = createInitialState({ seed: 'shu613', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, 0, true);
  home.hangar = hangar;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      B: planet('B', 'p1', 0, -150, true),
      Z: planet('Z', 'p2', 150, 0),
      Y: planet('Y', 'p2', 200, 0),
    },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

/** Чужой флот на отдельном ничейном узле в точке `at`. */
function withFleet(s: GameState, id: string, at: { x: number; y: number }): GameState {
  const node = `n:${id}`;
  const fleet: Fleet = {
    id,
    owner: 'p2',
    location: node,
    movement: null,
    units: [{ unit: 'freighter', count: 1 }],
    traits: [],
    battleId: null,
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
const strikeAt = (squadronId: string, target: Record<string, string>): Action =>
  act('shuttle.strike', { planetId: 'A', squadronId, ...target });
const patrolAt = (squadronId: string, at: { x: number; y: number }, hold = false): Action =>
  act('shuttle.patrol', { planetId: 'A', squadronId, at, ...(hold ? { hold: true } : {}) });
const redirect = (strikeId: string, to: Record<string, unknown>, playerId = 'p1'): Action =>
  act('shuttle.redirect', { strikeId, ...to }, playerId);

function apply(s: GameState, a: Action): GameState {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(s: GameState, a: Action): string | null {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  return r.ok ? null : r.code;
}
function run(s: GameState, hours: number): { state: GameState; events: DomainEvent[] } {
  const r = kernel.advanceTo(s, { now: hours * H, data });
  if (!r.ok) throw new Error('advance failed');
  return { state: r.state, events: r.events };
}
const until = (s: GameState, hours: number): GameState => run(s, hours).state;

const only = (s: GameState): ShuttleStrike => {
  expect(s.strikes ?? []).toHaveLength(1);
  return s.strikes![0]!;
};
const machines = (units: readonly UnitStack[] | undefined): number =>
  (units ?? []).reduce((n, st) => n + st.count, 0);
const ashore = (s: GameState, id = 'A'): number =>
  (s.planets[id]?.hangar ?? []).reduce((n, q) => n + machines(q.units), 0);
const hits = (events: DomainEvent[]): string[] =>
  events
    .filter((e) => e.type === 'shuttle.hit')
    .map((e) => (e.payload as { targetId: string }).targetId);
const queued = (s: GameState, type: string, strikeId: string): number =>
  s.scheduled.filter(
    (e) => e.type === type && (e.payload as { strikeId?: string }).strikeId === strikeId,
  ).length;

describe('SHU-6.13 — «Домой» у любого вылета на пути туда', () => {
  it('УДАР ПО МИРУ ВОЗВРАЩАЕТСЯ С ПОЛПУТИ: разворот там, где эскадра сейчас, удара нет', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      0.5,
    );
    const back = apply(s, act('shuttle.recall', { strikeId: only(s).id }));
    expect(only(back).leg).toBe('back');
    expect(only(back).to).toEqual({ x: 50, y: 0 });
    expect(only(back).arrivesAt).toBe(1 * H); // полсотни назад — полчаса
    const r = run(back, 3); // старое прибытие к Z (1,5 ч) — уже не её
    expect(hits(r.events)).toEqual([]);
    expect(r.state.strikes ?? []).toHaveLength(0);
    expect(ashore(r.state)).toBe(2);
    expect(r.state.planets.A?.sortie?.fuel).toBe(2); // вылет один — отзыв его не тратит
  });

  it('ДЕСАНТ ВЕЗЁТ БОЙЦОВ ОБРАТНО В ТРЮМ', () => {
    const lander = sq('sq:l', 'lander', 1, [{ unit: 'militia', count: 1 }]);
    const s = until(apply(world([lander]), strikeAt('sq:l', { targetPlanetId: 'Z' })), 0.5);
    const home = until(apply(s, act('shuttle.recall', { strikeId: only(s).id })), 3);
    expect(home.planets.A?.hangar).toEqual([
      { id: 'sq:l', units: [{ unit: 'lander', count: 1 }], cargo: [{ unit: 'militia', count: 1 }] },
    ]);
    expect(home.planets.Z?.garrison).toEqual([]);
  });

  it('ПОГОНЯ БРОШЕНА: пересчёты прежнего приказа гаснут', () => {
    const s0 = withFleet(world([sq('sq:b', 'bomber', 2)]), 'F', { x: 150, y: 0 });
    const s = until(apply(s0, strikeAt('sq:b', { targetFleetId: 'F' })), 0.5);
    const id = only(s).id;
    const back = apply(s, act('shuttle.recall', { strikeId: id }));
    const r = run(back, 3);
    expect(hits(r.events)).toEqual([]);
    expect(r.state.strikes ?? []).toHaveLength(0);
    expect(queued(r.state, 'shuttle.chase', id)).toBe(0);
  });

  it('ОБРАТНОЙ НОГЕ «ДОМОЙ» НЕ НУЖНО — и чужой вылет не отзывается', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      2,
    );
    expect(only(s).leg).toBe('back');
    expect(code(s, act('shuttle.recall', { strikeId: only(s).id }))).toBe('E_RETURNING');
    expect(code(s, act('shuttle.recall', { strikeId: only(s).id }, 'p2'))).toBe('E_NO_STRIKE');
  });
});

describe('SHU-6.13 — новая цель в воздухе', () => {
  it('С МИРА НА ФЛОТ: эскадра идёт от точки смены, бьёт флот и не трогает прежний мир', () => {
    const s0 = withFleet(world([sq('sq:b', 'bomber', 2)]), 'F', { x: 0, y: 100 });
    const s = until(apply(s0, strikeAt('sq:b', { targetPlanetId: 'Z' })), 0.5);
    const t = apply(s, redirect(only(s).id, { targetFleetId: 'F' }));
    const st = only(t);
    expect(st.target).toEqual({ kind: 'fleet', id: 'F' });
    expect(st.leg).toBe('out');
    expect(st.at).toEqual({ x: 50, y: 0 }); // путь — от точки смены, не от базы
    expect(st.to).toEqual({ x: 0, y: 100 });
    expect(t.planets.A?.sortie?.fuel).toBe(2); // второй вылет не тратится
    const r = run(t, 5);
    expect(hits(r.events)).toEqual(['F']); // прежнее прибытие к Z (1,5 ч) погасло
    expect(r.state.strikes ?? []).toHaveLength(0);
    expect(ashore(r.state)).toBe(2);
  });

  it('С ФЛОТА НА ФЛОТ: погоня одна, а не две цепочки рядом', () => {
    let s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'F', { x: 170, y: 0 });
    s = withFleet(s, 'G', { x: 0, y: 170 });
    s = until(apply(s, strikeAt('sq:b', { targetFleetId: 'F' })), 0.5);
    const id = only(s).id;
    const t = until(apply(s, redirect(id, { targetFleetId: 'G' })), 1.5);
    expect(queued(t, 'shuttle.chase', id)).toBe(1);
    expect(hits(run(t, 6).events)).toEqual(['G']);
  });

  it('РАДИУС — ОТ БАЗЫ: мир рядом с эскадрой, но за кольцом базы не цель', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      1,
    );
    expect(code(s, redirect(only(s).id, { targetPlanetId: 'Y' }))).toBe('E_OUT_OF_RANGE');
  });

  it('ПРАВИЛА ЦЕЛИ ТЕ ЖЕ, ЧТО У ВЫЛЕТА: свой мир без десанта не цель, флот без пушек не бьют', () => {
    const s0 = withFleet(world([sq('sq:b', 'bomber', 2), sq('sq:l', 'lander', 1)]), 'F', {
      x: 0,
      y: 100,
    });
    let s = apply(s0, strikeAt('sq:b', { targetPlanetId: 'Z' }));
    s = apply(s, strikeAt('sq:l', { targetPlanetId: 'Z' }));
    const [bomber, lander] = s.strikes!;
    expect(code(s, redirect(bomber!.id, { targetPlanetId: 'B' }))).toBe('E_NOT_HOSTILE');
    expect(code(s, redirect(lander!.id, { targetFleetId: 'F' }))).toBe('E_INVALID_TARGET');
    expect(code(s, redirect(bomber!.id, {}))).toBe('E_BAD_PAYLOAD'); // цели нет
    expect(code(s, redirect(bomber!.id, { targetPlanetId: 'Z', at: { x: 0, y: 50 } }))).toBe(
      'E_BAD_PAYLOAD',
    ); // две цели сразу
    expect(code(s, redirect(bomber!.id, { targetPlanetId: 'Z' }, 'p2'))).toBe('E_NO_STRIKE');
  });

  it('ВОЗВРАЩАЮЩАЯСЯ ЭСКАДРА НЕ БЬЁТ СНОВА: удар позади, нужна перезарядка', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      2,
    );
    expect(code(s, redirect(only(s).id, { targetPlanetId: 'Z' }))).toBe('E_RETURNING');
  });
});

describe('SHU-6.13 — патруль в воздухе', () => {
  it('УДАР СТАНОВИТСЯ ПАТРУЛЁМ: полный срок и круг эскадры', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      0.5,
    );
    const t = apply(s, redirect(only(s).id, { at: { x: 50, y: 100 } }));
    expect(only(t).target).toEqual({ kind: 'point' });
    expect(only(t).patrol).toEqual({ hours: 3, radius: 60 });
    const hanging = until(t, 2);
    expect(only(hanging).leg).toBe('patrol');
    expect(only(hanging).to).toEqual({ x: 50, y: 100 });
    expect(only(hanging).arrivesAt).toBe(1.5 * H + 3 * H); // долетела за час и висит три
  });

  it('ПЕРЕНЕСЁННЫЙ ПАТРУЛЬ ВИСИТ, СКОЛЬКО ОСТАВАЛОСЬ, и держит удержание', () => {
    const s0 = apply(
      world([sq('sq:i', 'interceptor', 2)]),
      patrolAt('sq:i', { x: 150, y: 0 }, true),
    );
    const s = until(s0, 2.5); // висит с 1,5 ч: прошёл час из четырёх
    expect(only(s).leg).toBe('patrol');
    const t = apply(s, redirect(only(s).id, { at: { x: 50, y: 0 } }));
    expect(only(t).patrol).toEqual({ hours: 3, radius: 60, hold: true });
    const moved = until(t, 3.5); // сто единиц — час пути
    expect(only(moved).leg).toBe('patrol');
    expect(only(moved).arrivesAt).toBe(3.5 * H + 3 * H);
  });

  it('ТИКИ ПРЕЖНЕЙ ТОЧКИ ГАСНУТ: короткий перенос не даёт двух цепочек ударов', () => {
    const s0 = apply(world([sq('sq:i', 'interceptor', 2)]), patrolAt('sq:i', { x: 150, y: 0 }));
    const s = until(s0, 2.1); // тики в 1,75 и 2,0 ч, следующий — в 2,25 ч
    const id = only(s).id;
    // Десять единиц — шесть минут: эскадра встанет в новой точке ДО старого тика.
    const t = until(apply(s, redirect(id, { at: { x: 140, y: 0 } })), 2.3);
    expect(only(t).leg).toBe('patrol');
    expect(queued(t, 'shuttle.patrol.tick', id)).toBe(1);
  });

  it('ПАТРУЛЬ, УШЕДШИЙ НА УДАР, ПЕРЕСТАЁТ БЫТЬ ПАТРУЛЁМ — и не встанет снова сам', () => {
    const s0 = withFleet(
      apply(world([sq('sq:b', 'bomber', 2)]), patrolAt('sq:b', { x: 150, y: 0 }, true)),
      'F',
      { x: 100, y: 0 },
    );
    const s = until(s0, 2);
    const t = apply(s, redirect(only(s).id, { targetFleetId: 'F' }));
    expect(only(t).patrol).toBeUndefined();
    const home = until(t, 8);
    expect(home.strikes ?? []).toHaveLength(0);
    expect(home.planets.A?.hangar?.[0]?.hold).toBeUndefined();
  });

  it('ДЕСАНТ В ПАТРУЛЬ НЕ ВСТАЁТ — тем же отказом, что из ангара', () => {
    const lander = sq('sq:l', 'lander', 1, [{ unit: 'militia', count: 1 }]);
    const s = apply(world([lander]), strikeAt('sq:l', { targetPlanetId: 'Z' }));
    expect(code(s, redirect(only(s).id, { at: { x: 50, y: 50 } }))).toBe('E_CANNOT_PATROL');
  });
});

describe('SHU-6.13 — перелёт из воздуха', () => {
  it('С ПУТИ К ЦЕЛИ НА ДРУГУЮ БАЗУ: садится там, дом помнит', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      0.5,
    );
    const t = apply(s, act('shuttle.relocate', { strikeId: only(s).id, toPlanetId: 'B' }));
    expect(only(t).target).toEqual({ kind: 'base' });
    expect(only(t).base).toEqual({ kind: 'planet', id: 'B' });
    expect(only(t).origin).toEqual({ kind: 'planet', id: 'A' });
    const r = run(t, 4);
    expect(hits(r.events)).toEqual([]);
    expect(ashore(r.state, 'B')).toBe(2);
    expect(ashore(r.state, 'A')).toBe(0);
  });

  it('ВОЗВРАЩАЮЩАЯСЯ ЭСКАДРА МОЖЕТ СЕСТЬ НА ДРУГУЮ БАЗУ, а «туда же» — не приказ', () => {
    const s = until(
      apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' })),
      2,
    );
    const id = only(s).id;
    expect(code(s, act('shuttle.relocate', { strikeId: id, toPlanetId: 'A' }))).toBe(
      'E_BAD_PAYLOAD',
    );
    const t = until(apply(s, act('shuttle.relocate', { strikeId: id, toPlanetId: 'B' })), 6);
    expect(ashore(t, 'B')).toBe(2);
  });

  it('ДВЕ ФОРМЫ ПРИКАЗА СРАЗУ — ОТКАЗ: вылет или эскадра ангара, не оба', () => {
    const s = apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' }));
    expect(
      code(s, act('shuttle.relocate', { strikeId: only(s).id, planetId: 'A', toPlanetId: 'B' })),
    ).toBe('E_BAD_PAYLOAD');
  });
});

describe('SHU-6.13 — делёж в воздухе', () => {
  it('ОБЕ ПОЛОВИНЫ ЛЕТЯТ ДАЛЬШЕ ТЕМ ЖЕ ПРИКАЗОМ, имя у большей', () => {
    const s = until(
      apply(world([sq('sq:i', 'interceptor', 3)]), patrolAt('sq:i', { x: 150, y: 0 })),
      2,
    );
    const before = only(s);
    const t = apply(
      s,
      act('shuttle.split', { strikeId: before.id, units: [{ unit: 'interceptor', count: 1 }] }),
    );
    const [named, other] = t.strikes!;
    expect(named).toMatchObject({ id: before.id, squadronId: 'sq:i', leg: 'patrol' });
    expect(machines(named!.units)).toBe(2);
    expect(other!.squadronId).not.toBe('sq:i');
    expect(other!.id).not.toBe(before.id);
    expect(machines(other!.units)).toBe(1);
    expect(other).toMatchObject({
      leg: 'patrol',
      to: before.to,
      arrivesAt: before.arrivesAt,
      patrol: before.patrol,
      base: before.base,
    });
    expect(queued(t, 'shuttle.patrol.tick', other!.id)).toBe(1); // у половины свои тики
    expect(t.planets.A?.sortie?.fuel).toBe(2); // вылет базы не тратится
    const home = until(t, 9);
    expect(home.strikes ?? []).toHaveLength(0);
    expect(ashore(home)).toBe(3);
    expect(home.planets.A?.hangar).toHaveLength(2);
  });

  it('ДЕСАНТ ДЕЛИТСЯ ПО БОРТАМ: у каждой половины свой боец', () => {
    const lander = sq('sq:l', 'lander', 2, [{ unit: 'militia', count: 2 }]);
    const s = apply(world([lander]), strikeAt('sq:l', { targetPlanetId: 'Z' }));
    const t = apply(
      s,
      act('shuttle.split', { strikeId: only(s).id, units: [{ unit: 'lander', count: 1 }] }),
    );
    expect(t.strikes!.map((st) => st.cargo)).toEqual([
      [{ unit: 'militia', count: 1 }],
      [{ unit: 'militia', count: 1 }],
    ]);
  });

  it('ВСЁ СРАЗУ НЕ ДЕЛИТСЯ, и чужой вылет — как несуществующий', () => {
    const s = apply(world([sq('sq:b', 'bomber', 2)]), strikeAt('sq:b', { targetPlanetId: 'Z' }));
    const all = { strikeId: only(s).id, units: [{ unit: 'bomber', count: 2 }] };
    expect(code(s, act('shuttle.split', all))).toBe('E_BAD_PAYLOAD');
    expect(
      code(s, act('shuttle.split', { ...all, units: [{ unit: 'bomber', count: 1 }] }, 'p2')),
    ).toBe('E_NO_STRIKE');
  });
});
