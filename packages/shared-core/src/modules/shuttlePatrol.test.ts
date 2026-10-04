/**
 * ПАТРУЛЬ В ТОЧКЕ (SHU-6.2) — приёмка кирпича.
 *
 * Резолюция владельца 2026-10-04 (`shuttles-roadmap.md` §0.7, по образцу Conflict of
 * Nations): эскадра летит к точке как на удар, висит над ней `patrolHours` и каждые 15
 * минут бьёт ОДНУ ближайшую враждебную цель в круге `patrolRadius` — флот, стоящий или
 * идущий мимо, или чужой вылет. За час патруль бьёт ровно как один удар, и цель огрызается
 * той же долей. Время вышло — домой; `shuttle.recall` возвращает раньше.
 *
 * База — обе её формы (уточнение владельца: «учти наши базы, в виде трюмов»): мир с портом
 * и любой корабль с трюмом, в том числе идущий. Домой патруль летит на ЖИВУЮ позицию
 * корабля, а не туда, где тот стоял на взлёте.
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
import { pairKey } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, DomainEvent } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Цель без пушек и зенитки: ответки нет, и урон патруля виден чистым числом.
    freighter: { faction: 'x', stats: { attack: 0, defense: 0, speed: 10, hp: 100 } },
    // Цель с пушками: огрызается долей своего огня (ROS-2.2) — 40 × 5% = 2 за удар.
    cruiser: { faction: 'x', stats: { attack: 40, defense: 5, speed: 10, hp: 100 } },
    // Огрызается так, что патруль не переживает третьего тика.
    dreadnought: { faction: 'x', stats: { attack: 1000, defense: 5, speed: 10, hp: 10000 } },
    // Зональное ПВО корабля: бьёт вылеты в радиусе 120 (`PD_RANGE`).
    picket: { faction: 'x', stats: { attack: 0, defense: 5, speed: 10, hp: 100, pointDefense: 2 } },
    // Носитель: трюм на 4 места — база челноков, которая ходит.
    carrier: {
      faction: 'x',
      stats: { attack: 0, defense: 9, speed: 30, hp: 40, cargoCapacity: 4 },
    },
    mine: { faction: 'x', traits: ['mine'], stats: { attack: 0, defense: 0, speed: 0, hp: 50 } },
    infantry: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 1, defense: 1, speed: 0, hp: 10 },
    },
    // Все челноки идут 100 ед/час с радиусом 180: от A(0,0) до точки (150,0) — полтора часа.
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
    // Чистый охотник за машинами: по кораблям ему бить нечем.
    hunter: shuttle({
      attack: 0,
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
      fuel: 2,
      rearmRounds: 3,
      siegeDamage: 8,
      patrolHours: 3,
      patrolRadius: 60,
    }),
    // Десантный челнок: патрульных чисел у него нет вовсе.
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
/** Точка патруля: от порта A(0,0) ровно полтора часа лёта. */
const P = { x: 150, y: 0 };

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

const sq = (id: string, unit: string, count: number): Squadron => ({
  id,
  units: [{ unit, count }],
});

/** Свой порт A(0,0) с заданным ангаром — и больше ничего. */
function world(hangar: Squadron[]): GameState {
  const s = createInitialState({ seed: 'shu62', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, 0, true);
  home.hangar = hangar;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: home },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

/** Поставить флот на отдельный ничейный узел в точке `at`. */
function withFleet(
  s: GameState,
  id: string,
  unit: string,
  at: { x: number; y: number },
  owner = 'p2',
): GameState {
  const node = `n:${id}`;
  const fleet: Fleet = {
    id,
    owner,
    location: node,
    movement: null,
    units: [{ unit, count: 1 }],
    traits: [],
    battleId: null,
  };
  return {
    ...s,
    planets: { ...s.planets, [node]: planet(node, null, at.x, at.y) },
    fleets: { ...s.fleets, [id]: fleet },
  };
}

/**
 * Чужой порт Z(150,160) с двумя ударными и свой мир B(150,−20): удар Z → B идёт прямо
 * через точку патруля (вертикально по x = 150), и его цель — в самом круге.
 */
function withRaid(s: GameState): GameState {
  const z = planet('Z', 'p2', 150, 160, true);
  z.hangar = [sq('sq:z', 'bomber', 2)];
  return { ...s, planets: { ...s.planets, Z: z, B: planet('B', 'p1', 150, -20) } };
}

let seq = 0;
const act = (type: string, payload: Record<string, unknown>, playerId = 'p1'): Action => ({
  id: `a:${seq++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const patrol = (
  squadronId: string,
  at: unknown = P,
  base: Record<string, string> = { planetId: 'A' },
): Action => act('shuttle.patrol', { ...base, squadronId, at });
const recall = (strikeId: string, playerId = 'p1'): Action =>
  act('shuttle.recall', { strikeId }, playerId);
const raid = (): Action =>
  act('shuttle.strike', { planetId: 'Z', squadronId: 'sq:z', targetPlanetId: 'B' }, 'p2');

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

const hullOf = (s: GameState, id: string): number | undefined => s.fleets[id]?.units[0]?.hp;
const machines = (units: readonly UnitStack[] | undefined): number =>
  (units ?? []).reduce((n, st) => n + st.count, 0);
const ashore = (s: GameState, id = 'A'): number =>
  (s.planets[id]?.hangar ?? []).reduce((n, q) => n + machines(q.units), 0);
const payloads = (events: DomainEvent[], type: string): Array<Record<string, unknown>> =>
  events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const patrolOf = (s: GameState) => (s.strikes ?? []).find((st) => st.target.kind === 'point');

describe('SHU-6.2 — приказ патруля', () => {
  it('ПАТРУЛЬ УХОДИТ С МИРА: эскадра покидает ангар, база тратит один вылет', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), patrol('sq:i'));
    expect(ashore(s)).toBe(0);
    const st = patrolOf(s);
    expect(st?.to).toEqual(P);
    expect(st?.leg).toBe('out');
    expect(st?.patrol).toEqual({ hours: 4, radius: 60 });
    expect(st?.arrivesAt).toBe(1.5 * H);
    expect(s.planets.A?.sortie?.fuel).toBe(2); // из трёх — один, как у удара
  });

  it('ЧАСЫ И КРУГ — ПО СЛАБОМУ ЗВЕНУ: перехватчик с ударным висят три часа, а не четыре', () => {
    const mixed: Squadron = {
      id: 'sq:m',
      units: [
        { unit: 'interceptor', count: 1 },
        { unit: 'bomber', count: 1 },
      ],
    };
    expect(patrolOf(apply(world([mixed]), patrol('sq:m')))?.patrol).toEqual({
      hours: 3,
      radius: 60,
    });
  });

  it('ДЕСАНТНЫЙ ЧЕЛНОК НЕ ПАТРУЛИРУЕТ — ни сам, ни в составе эскадры', () => {
    expect(code(world([sq('sq:l', 'lander', 1)]), patrol('sq:l'))).toBe('E_CANNOT_PATROL');
    const mixed: Squadron = {
      id: 'sq:m',
      units: [
        { unit: 'interceptor', count: 2 },
        { unit: 'lander', count: 1 },
      ],
    };
    expect(code(world([mixed]), patrol('sq:m'))).toBe('E_CANNOT_PATROL');
  });

  it('ГРУЗ В ПАТРУЛЬ НЕ БЕРУТ: обратная нога сажает только машины, и боец бы пропал', () => {
    const loaded: Squadron = {
      ...sq('sq:i', 'interceptor', 2),
      cargo: [{ unit: 'infantry', count: 1 }],
    };
    expect(code(world([loaded]), patrol('sq:i'))).toBe('E_HAS_CARGO');
  });

  it('ТОЧКА — В РАДИУСЕ УДАРА ОТ БАЗЫ: круг у базы обещает ровно то, куда патруль долетит', () => {
    const s = world([sq('sq:i', 'interceptor', 2)]);
    expect(code(s, patrol('sq:i', { x: 180, y: 0 }))).toBeNull(); // граница включительна
    expect(code(s, patrol('sq:i', { x: 181, y: 0 }))).toBe('E_OUT_OF_RANGE');
  });

  it('БЕЗ ТОЧКИ ИЛИ С NaN ПРИКАЗ ОТБИВАЕТСЯ, а не летит в никуда', () => {
    const s = world([sq('sq:i', 'interceptor', 2)]);
    expect(code(s, act('shuttle.patrol', { planetId: 'A', squadronId: 'sq:i' }))).toBe(
      'E_BAD_PAYLOAD',
    );
    expect(code(s, patrol('sq:i', { x: Number.NaN, y: 0 }))).toBe('E_BAD_PAYLOAD');
  });

  it('БЕЗ ТОПЛИВА БАЗЫ ПАТРУЛЬ НЕ ВЗЛЕТАЕТ — запас вылетов тот же, что у удара', () => {
    const s = world([sq('sq:i', 'interceptor', 2)]);
    s.planets.A!.sortie = { fuel: 0, rearming: 2 };
    expect(code(s, patrol('sq:i'))).toBe('E_NO_FUEL');
  });
});

describe('SHU-6.2 — приёмка кирпича', () => {
  it('ПЕРЕХВАТЧИК В ПАТРУЛЕ БЬЁТ ЧУЖОЙ УДАР, ПРОХОДЯЩИЙ ЧЕРЕЗ КРУГ', () => {
    // Патруль в точке с 1,5 ч. Налёт уходит в 0,9 ч и дошёл бы до B в 2,7 ч; в круге он с
    // 2 ч, и три тика по 11 (2 × 22 × ¼) сбивают оба корпуса по 16 раньше цели.
    let s = apply(withRaid(world([sq('sq:i', 'interceptor', 2)])), patrol('sq:i'));
    const patrolId = patrolOf(s)!.id;
    s = apply(until(s, 0.9), raid());
    const { state, events } = run(s, 3);

    const shots = payloads(events, 'shuttle.intercepted');
    expect(shots.length).toBeGreaterThan(0);
    expect(
      shots.every((p) => p.patrolId === patrolId && p.owner === 'p1' && p.targetOwner === 'p2'),
    ).toBe(true);
    expect(shots.reduce((n, p) => n + (p.downed as number), 0)).toBe(2);
    expect(payloads(events, 'shuttle.hit').filter((p) => p.targetId === 'B')).toHaveLength(0);
    expect(state.strikes?.map((st) => st.id)).toEqual([patrolId]); // налёта больше нет
    expect(machines(patrolOf(state)?.units)).toBe(2); // и вылет не огрызается
  });

  it('…а без патруля тот же налёт доходит до цели — сбил его именно патруль', () => {
    const s = apply(until(withRaid(world([])), 0.9), raid());
    expect(
      payloads(run(s, 3).events, 'shuttle.hit').filter((p) => p.targetId === 'B'),
    ).toHaveLength(1);
  });

  it('СТРАЙКЕР В ПАТРУЛЕ БЬЁТ ФЛОТ, ИДУЩИЙ МИМО ПО ЛИНИИ', () => {
    const s = passingConvoy();
    const { state, events } = run(apply(s, patrol('sq:b')), 6);
    // В круге конвой с 0,8 по 3,2 ч; патруль висит с 1,5 ч. Тики 1,75 … 3,0 — шесть
    // ударов по 10 (2 × 20 × ¼), дальше конвой ушёл из круга и больше не задет.
    expect(payloads(events, 'shuttle.hit').filter((p) => p.targetId === 'E1')).toHaveLength(6);
    expect(hullOf(state, 'E1')).toBe(40);
  });

  it('ЧЕРЕЗ patrolHours ЭСКАДРА СНОВА В АНГАРЕ БАЗЫ', () => {
    // 1,5 ч туда, 4 ч в круге, 1,5 ч обратно: дома в 7 ч.
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), patrol('sq:i'));
    const inCircle = until(s, 5.4);
    expect(patrolOf(inCircle)?.leg).toBe('patrol');
    const late = until(s, 6.9);
    expect(patrolOf(late)?.leg).toBe('back');
    expect(ashore(late)).toBe(0);
    const { state, events } = run(late, 7);
    expect(ashore(state)).toBe(2);
    expect(state.strikes ?? []).toHaveLength(0);
    expect(payloads(events, 'shuttle.landed')).toHaveLength(1);
  });

  it('ПАТРУЛЬ С ИДУЩЕГО КОРАБЛЯ ВОЗВРАЩАЕТСЯ НА ЕГО ЖИВУЮ ПОЗИЦИЮ', () => {
    // Носитель идёт HOME(0,0) → FAR(1000,0) за 10 ч. Патруль взлетает в 0 ч к (0,150): туда
    // 1,5 ч, в круге 4 ч. Конец патруля — 5,5 ч, носитель уже в (550,0): обратно √(550² +
    // 150²) ≈ 570 единиц, а не 150 до точки взлёта.
    const base = createInitialState({ seed: 'shu62cv', version: { data: '0.1.0', manifest: '1' } });
    const cv: Fleet = {
      id: 'CV',
      owner: 'p1',
      location: null,
      movement: { from: 'HOME', to: 'FAR', departedAt: 0, arrivesAt: 10 * H },
      units: [{ unit: 'carrier', count: 1 }],
      traits: [],
      battleId: null,
      hangar: [sq('sq:cv', 'interceptor', 2)],
    };
    let s: GameState = {
      ...base,
      players: { p1: player('p1'), p2: player('p2') },
      planets: { HOME: planet('HOME', 'p1', 0, 0), FAR: planet('FAR', 'p1', 1000, 0) },
      fleets: { CV: cv },
      heroes: {},
      battles: {},
    };
    s = apply(s, patrol('sq:cv', { x: 0, y: 150 }, { fleetId: 'CV' }));
    expect(patrolOf(s)?.at).toEqual({ x: 0, y: 0 }); // путь к точке — от места взлёта
    expect(s.fleets.CV?.hangar ?? []).toHaveLength(0);

    const back = patrolOf(until(s, 5.6));
    expect(back?.leg).toBe('back');
    expect((back!.arrivesAt - back!.departedAt) / H).toBeCloseTo(Math.hypot(550, 150) / 100, 3);
    // С неподвижной базы эскадра была бы дома в 7 ч — здесь она ещё в пути.
    expect(until(s, 7.1).fleets.CV?.hangar ?? []).toHaveLength(0);
    const home = until(s, 11.3);
    expect(home.strikes ?? []).toHaveLength(0);
    expect(machines(home.fleets.CV?.hangar?.[0]?.units)).toBe(2);
  });
});

/** Свой порт с двумя ударными и чужой транспорт, идущий M1(150,100) → M2(150,−100) за
 *  4 часа (50 ед/час): поперёк круга патруля, ровно через его точку. */
function passingConvoy(): GameState {
  const s = world([sq('sq:b', 'bomber', 2)]);
  const convoy: Fleet = {
    id: 'E1',
    owner: 'p2',
    location: null,
    movement: { from: 'M1', to: 'M2', departedAt: 0, arrivesAt: 4 * H },
    units: [{ unit: 'freighter', count: 1 }],
    traits: [],
    battleId: null,
  };
  return {
    ...s,
    planets: { ...s.planets, M1: planet('M1', null, 150, 100), M2: planet('M2', null, 150, -100) },
    fleets: { E1: convoy },
  };
}

describe('SHU-6.2 — тик патруля', () => {
  it('ОДНА ЦЕЛЬ ЗА ТИК — БЛИЖАЙШАЯ К ТОЧКЕ', () => {
    let s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'E1', 'freighter', { x: 150, y: 10 });
    s = withFleet(s, 'E2', 'freighter', { x: 150, y: 40 });
    const after = until(apply(s, patrol('sq:b')), 1.75); // первый тик
    expect(hullOf(after, 'E1')).toBe(90);
    expect(hullOf(after, 'E2')).toBeUndefined(); // цел
  });

  it('ЗА ЧАС ПАТРУЛЬ БЬЁТ РОВНО КАК ОДИН УДАР, тик — четверть удара', () => {
    const s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'E1', 'freighter', P);
    const struck = until(
      apply(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:b', targetFleetId: 'E1' })),
      3,
    );
    const blow = 100 - hullOf(struck, 'E1')!;
    expect(blow).toBeGreaterThan(0);

    const patrolled = apply(s, patrol('sq:b'));
    expect(100 - hullOf(until(patrolled, 1.75), 'E1')!).toBeCloseTo(blow / 4);
    expect(100 - hullOf(until(patrolled, 2.5), 'E1')!).toBeCloseTo(blow); // четыре тика
  });

  it('ЦЕЛЬ ОГРЫЗАЕТСЯ ТОЙ ЖЕ ДОЛЕЙ: тик патруля — четверть ответки на удар', () => {
    const s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'E1', 'cruiser', P);
    // Удар ловит цель около 1,4 ч и в 2 ч ещё летит домой с ответкой на корпусах.
    const struck = (until(
      apply(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:b', targetFleetId: 'E1' })),
      2,
    ).strikes ?? [])[0];
    expect(struck?.leg).toBe('back');
    expect(struck?.damage).toBeCloseTo(2); // 40 × 5%

    const patrolled = patrolOf(until(apply(s, patrol('sq:b')), 1.75));
    expect(patrolled?.damage).toBeCloseTo(struck!.damage! / 4);
  });

  it('БЕЗОРУЖНАЯ ПОЛОВИНА НЕ ВЫБИРАЕТ ЦЕЛЬ: охотник за машинами не ныряет под корабль ради нуля урона', () => {
    // В самой точке стоит чужой транспорт — он ближе любого налёта. Перехватчик (есть
    // пушки) бьёт его и пропускает налёт; охотник (пушек нет) транспорт не выбирает и
    // сбивает налёт.
    const scene = (unit: string): ReturnType<typeof run> => {
      let s = withFleet(withRaid(world([sq('sq:p', unit, 2)])), 'E1', 'freighter', P);
      s = apply(s, patrol('sq:p'));
      return run(apply(until(s, 0.9), raid()), 3);
    };
    const gunner = scene('interceptor');
    expect(hullOf(gunner.state, 'E1')).toBeLessThan(100);
    expect(payloads(gunner.events, 'shuttle.hit').filter((p) => p.targetId === 'B')).toHaveLength(
      1,
    );

    const hunter = scene('hunter');
    expect(hullOf(hunter.state, 'E1')).toBeUndefined();
    expect(payloads(hunter.events, 'shuttle.hit').filter((p) => p.targetId === 'B')).toHaveLength(
      0,
    );
    expect(
      payloads(hunter.events, 'shuttle.intercepted').reduce((n, p) => n + (p.downed as number), 0),
    ).toBe(2);
  });

  it('НЕ ВРАГ — НЕ ЦЕЛЬ: с миром патруль висит над чужим флотом и не стреляет', () => {
    const s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'E1', 'freighter', P);
    s.diplomacy = { [pairKey('p1', 'p2')]: 'peace' };
    const { state, events } = run(apply(s, patrol('sq:b')), 5);
    expect(hullOf(state, 'E1')).toBeUndefined();
    expect(payloads(events, 'shuttle.hit')).toHaveLength(0);
  });

  it('НЕВИДИМАЯ МИНА — НЕ ЦЕЛЬ, как и для удара; своим флотом рядом её видно — и бьют', () => {
    const s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'MN', 'mine', P);
    expect(hullOf(until(apply(s, patrol('sq:b')), 2.5), 'MN')).toBeUndefined();

    const spotted = withFleet(s, 'SPOT', 'freighter', { x: 150, y: 20 }, 'p1'); // в 20 от мины
    expect(hullOf(until(apply(spotted, patrol('sq:b')), 1.75), 'MN')).toBe(40);
  });

  it('ВИСЯЩИЙ ПАТРУЛЬ ВИДИТ ОБОРОНА: зональное ПВО корабля бьёт его над точкой', () => {
    let s = until(apply(world([sq('sq:b', 'bomber', 2)]), patrol('sq:b')), 1.6);
    const patrolId = patrolOf(s)!.id;
    expect(patrolOf(s)?.leg).toBe('patrol');
    s = withFleet(s, 'PK', 'picket', { x: 150, y: 30 });
    const shots = payloads(run(s, 2).events, 'pd.fired');
    expect(shots.some((p) => p.strikeId === patrolId && p.fleetId === 'PK')).toBe(true);
  });

  it('…и перехватчики чужой базы поднимаются на него, как на любой вылет', () => {
    let s = until(apply(world([sq('sq:b', 'bomber', 2)]), patrol('sq:b')), 1.6);
    const patrolId = patrolOf(s)!.id;
    const r = planet('R', 'p2', 150, 100, true);
    r.hangar = [sq('sq:r', 'interceptor', 1)];
    s = { ...s, planets: { ...s.planets, R: r } };
    const shots = payloads(run(s, 2).events, 'shuttle.intercepted');
    expect(shots.some((p) => p.strikeId === patrolId && p.owner === 'p2')).toBe(true);
  });

  it('СБИТЫЙ ОТВЕТКОЙ ПАТРУЛЬ ИСЧЕЗАЕТ: домой лететь некому, в ангар никто не садится', () => {
    // Ответка 1000 × 5% × ¼ = 12,5 за тик: два корпуса по 16 гибнут на третьем тике.
    const s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'E1', 'dreadnought', P);
    const { state, events } = run(apply(s, patrol('sq:b')), 10);
    expect(state.strikes ?? []).toHaveLength(0);
    expect(ashore(state)).toBe(0);
    expect(payloads(events, 'shuttle.landed')).toHaveLength(0);
    expect(payloads(events, 'shuttle.repelled').reduce((n, p) => n + (p.downed as number), 0)).toBe(
      2,
    );
  });

  it('НАРЕЗКА ВРЕМЕНИ НЕ МЕНЯЕТ ИСХОД: тик — своё событие, а не опрос хоста', () => {
    const s = apply(passingConvoy(), patrol('sq:b'));
    const whole = until(s, 6);
    let sliced = s;
    for (let t = 0.1; t <= 6.0001; t += 0.1) sliced = until(sliced, Math.round(t * 10) / 10);
    expect(sliced.fleets).toEqual(whole.fleets);
    expect(sliced.strikes ?? []).toEqual(whole.strikes ?? []);
    expect(sliced.planets.A?.hangar).toEqual(whole.planets.A?.hangar);
  });
});

describe('SHU-6.2 — отзыв патруля', () => {
  it('ИЗ КРУГА: разворот над точкой, тики больше не бьют, эскадра дома через полтора часа', () => {
    const s = withFleet(world([sq('sq:b', 'bomber', 2)]), 'E1', 'freighter', { x: 150, y: 30 });
    let t = until(apply(s, patrol('sq:b')), 2); // тики 1,75 и 2,0 — по 10
    expect(hullOf(t, 'E1')).toBe(80);
    t = apply(t, recall(patrolOf(t)!.id));
    const st = patrolOf(t);
    expect(st?.leg).toBe('back');
    expect(st?.to).toEqual(P);
    expect(st?.arrivesAt).toBe(3.5 * H);
    const after = until(t, 5);
    expect(hullOf(after, 'E1')).toBe(80);
    expect(ashore(after)).toBe(2);
  });

  it('С ПУТИ: разворот там, где эскадра сейчас, а устаревшее прибытие к точке её не сажает', () => {
    // Туда 1,5 ч; отзыв в 1 ч — эскадра в (100,0), обратно 1 ч, дома в 2 ч. Старое
    // событие прибытия к точке (1,5 ч) приходит раньше нового срока и молчит.
    const s = until(apply(world([sq('sq:i', 'interceptor', 2)]), patrol('sq:i')), 1);
    const t = apply(s, recall(patrolOf(s)!.id));
    expect(patrolOf(t)?.to).toEqual({ x: 100, y: 0 });
    const mid = until(t, 1.6);
    expect(patrolOf(mid)?.leg).toBe('back');
    expect(ashore(mid)).toBe(0);
    expect(ashore(until(t, 2))).toBe(2);
  });

  it('С ПУТИ РАНО: эскадра дома раньше старого срока, и тот срок не заводит патруль из ниоткуда', () => {
    const s = until(apply(world([sq('sq:i', 'interceptor', 2)]), patrol('sq:i')), 0.5);
    const t = apply(s, recall(patrolOf(s)!.id));
    expect(ashore(until(t, 1))).toBe(2);
    const later = until(t, 3);
    expect(later.strikes ?? []).toHaveLength(0);
    expect(ashore(later)).toBe(2);
  });

  it('ОТОЗВАТЬ МОЖНО ТОЛЬКО СВОЙ ПАТРУЛЬ, и только пока он не летит домой', () => {
    const s = withFleet(
      world([sq('sq:i', 'interceptor', 2), sq('sq:b', 'bomber', 2)]),
      'E1',
      'freighter',
      {
        x: 100,
        y: 0,
      },
    );
    const flying = apply(
      apply(s, patrol('sq:i')),
      act('shuttle.strike', { planetId: 'A', squadronId: 'sq:b', targetFleetId: 'E1' }),
    );
    const patrolId = patrolOf(flying)!.id;
    const strikeId = (flying.strikes ?? []).find((st) => st.target.kind === 'fleet')!.id;

    expect(code(flying, recall(strikeId))).toBe('E_NOT_PATROLLING'); // удар — не патруль
    expect(code(flying, recall(patrolId, 'p2'))).toBe('E_NO_STRIKE'); // чужой — как несуществующий
    expect(code(flying, recall('strike:nope'))).toBe('E_NO_STRIKE');
    const home = apply(flying, recall(patrolId));
    expect(code(home, recall(patrolId))).toBe('E_NOT_PATROLLING'); // уже летит домой
  });
});
