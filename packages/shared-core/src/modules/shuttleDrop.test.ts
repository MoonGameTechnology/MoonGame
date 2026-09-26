/**
 * ДЕСАНТНЫЙ ЧЕЛНОК (ROS-1.5, заказ владельца 2026-09-09, п. 10; с SHU-5.2 — челнок с
 * бойцом внутри, резолюция владельца 2026-09-26).
 *
 * Безоружная машина, которая несёт ровно ОДНОГО наземного бойца: по кораблям не бьёт
 * вовсе, а при ударе по миру становится этим бойцом. Отсюда правила:
 *
 * 1. **Корабль ей не цель.** Вылет, которому нечем бить по корпусам, отбивается
 *    `E_INVALID_TARGET` — не «долетел и ничего не сделал», а отказ на приказе.
 * 2. **Боец выбирается при постройке** (`unit.build { troop }`): цена — челнок плюс
 *    боец, условия постройки бойца (его здание на этом мире) проверяются тем же
 *    правилом, что у заказа самого бойца. Грузить в челнок нечего и нечем.
 * 3. **Одноразовость.** Домой машины не возвращаются: они высадились вместе с грузом.
 * 4. **Пустой чужой мир берётся сразу**, десант становится его гарнизоном.
 * 5. **Обороняемый чужой мир — ПЛАЦДАРМ** (решение владельца 2026-09-09): десант встаёт
 *    на землю четвёртой стороной боя и сам начинает наземный бой, без единого корабля
 *    рядом. Выиграл — стал гарнизоном и взял мир; проиграл — исчез вместе с боем.
 * 6. **Свой и союзный мир — подкрепление:** груз уходит в гарнизон, боя нет.
 * 7. **Зональное ПВО режет груз.** Сбитая машина уносит своего бойца: высаживается
 *    ровно то, что довезли уцелевшие.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { attackerOf } from '../state/battle';
import { shuttleModule } from './shuttle';
import { combatModule } from './combat';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 20, defense: 5, speed: 6, hp: 200 } },
    // Десантный челнок: ноль урона, один боец внутри (SHU-5.2).
    landing_shuttle: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle', 'lander'],
      cost: { metal: 70 },
      buildTimeHours: 2,
      stats: {
        attack: 0,
        defense: 2,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
      },
    },
    // Вооружённый челнок — сторож на то, что запрет бить корабли идёт от ОРУЖИЯ.
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 20, defense: 4, speed: 100, hp: 16, strikeRange: 180, fuel: 4, rearmRounds: 2 },
    },
    militia: {
      faction: 'x',
      domain: 'ground',
      kind: 'infantry',
      cost: { metal: 30 },
      buildTimeHours: 1,
      stats: { attack: 4, defense: 4, speed: 4, hp: 20, cargoSize: 1 },
    },
    guard: { faction: 'x', domain: 'ground', stats: { attack: 30, defense: 30, speed: 4, hp: 200, cargoSize: 1 } },
    tank: {
      faction: 'x',
      domain: 'ground',
      kind: 'vehicle',
      cost: { metal: 120 },
      buildTimeHours: 4,
      stats: { attack: 20, defense: 12, speed: 4, hp: 46, cargoSize: 2 },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
    barracks: { name: 'Barracks', cost: {}, buildTimeHours: 0, hp: 20, enablesInfantryConstruction: true },
    factory: { name: 'Factory', cost: {}, buildTimeHours: 0, hp: 20, enablesVehicleConstruction: true },
    zonal_aa: { name: 'Area Defense Battery', cost: {}, buildTimeHours: 0, hp: 22, pointDefense: 20 },
  },
  events: {},
});

const HOUR = 3_600_000;
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });
const kernel = createKernel([constructionModule, combatModule, shuttleModule]);

function planet(
  id: string,
  owner: string | null,
  x: number,
  over: { buildings?: string[]; garrison?: Array<[string, number]>; hangar?: number } = {},
): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: (over.buildings ?? []).map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
    garrison: (over.garrison ?? []).map(([unit, count]) => ({ unit, count })),
    traits: [],
    // SHU-4.2: ангар — эскадры. Держим ДВА звена по половине, чтобы тесты могли послать
    // и часть машин (одно звено), и все (слияние + вылет), не гадая о выданных id.
    // SHU-5.2: у каждого челнока внутри свой боец — ополченец.
    ...(over.hangar === undefined
      ? {}
      : {
          hangar: ['sq:a', 'sq:b'].map((id) => ({
            id,
            units: [{ unit: 'landing_shuttle', count: Math.floor(over.hangar! / 2) }],
            cargo: [{ unit: 'militia', count: Math.floor(over.hangar! / 2) }],
          })),
        }),
  };
}

/** Мир: свой порт A(0) с десантными челноками и гарнизоном, цель B(100). */
function world(over: { target?: Partial<Parameters<typeof planet>[3]> & { owner?: string | null } } = {}): GameState {
  const s = createInitialState({ seed: 'ros15', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, {
    buildings: ['spaceport'],
    garrison: [['militia', 8]],
    hangar: 4,
  });
  const t = over.target ?? {};
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      B: planet('B', t.owner === undefined ? 'p2' : t.owner, 100, {
        buildings: t.buildings ?? [],
        garrison: t.garrison ?? [],
      }),
    },
    fleets: { E1: fleetOf('E1', 'p2', 'C') },
    heroes: {},
    battles: {},
  };
}

function fleetOf(id: string, owner: string, location: string): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: [{ unit: 'cruiser', count: 1 }],
    traits: [],
    battleId: null,
  };
}

let seq = 0;
const order = (type: string, payload: Record<string, unknown>): Action => ({
  id: `a:${seq++}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});

/**
 * Десантный вылет: бойцы уже внутри челноков (SHU-5.2), поэтому это (слияние) → удар.
 * `count: 4` значит «всеми машинами», то есть сперва свести оба звена в одно.
 */
const drop = (
  over: {
    squadronId?: string;
    count?: number;
    targetPlanetId?: string;
    targetFleetId?: string;
  } = {},
): Action[] => {
  const { squadronId = 'sq:a', count = 2, ...target } = over;
  const out: Action[] = [];
  if (count === 4) out.push(order('shuttle.merge', { planetId: 'A', squadronId: 'sq:b', intoId: squadronId }));
  out.push(
    order('shuttle.strike', {
      planetId: 'A',
      squadronId,
      ...(target.targetFleetId || target.targetPlanetId ? target : { targetPlanetId: 'B' }),
    }),
  );
  return out;
};

function apply(state: GameState, actions: Action | Action[]): GameState {
  let s = state;
  for (const action of Array.isArray(actions) ? actions : [actions]) {
    const r = kernel.applyAction(s, action, at(s));
    if (!r.ok) throw new Error(r.code);
    s = r.state;
  }
  return s;
}
/** Код ПЕРВОГО отказа в последовательности — там же, где раньше отбивался один приказ. */
function code(state: GameState, actions: Action | Action[]): string | null {
  let s = state;
  for (const action of Array.isArray(actions) ? actions : [actions]) {
    const r = kernel.applyAction(s, action, at(s));
    if (!r.ok) return r.code;
    s = r.state;
  }
  return null;
}
function advance(state: GameState, hours: number): { state: GameState; events: DomainEvent[] } {
  const r = kernel.advanceTo(state, { now: state.time + hours * HOUR, data });
  if (!r.ok) throw new Error(r.code);
  return { state: r.state, events: r.events };
}
const count = (stacks: readonly { unit: string; count: number }[] | undefined, unit: string): number =>
  (stacks ?? []).filter((s) => s.unit === unit).reduce((n, s) => n + s.count, 0);

describe('ROS-1.5 — приказ: кого и с чем можно послать (правила 1–2)', () => {
  it('ПО КОРАБЛЯМ ДЕСАНТНЫЙ ЧЕЛНОК НЕ БЬЁТ ВОВСЕ — отказ на приказе, а не пустой полёт', () => {
    const s = { ...world(), fleets: { E1: fleetOf('E1', 'p2', 'B') } };
    expect(code(s, drop({ targetFleetId: 'E1' }))).toBe('E_INVALID_TARGET');
  });

  it('запрет идёт от ОРУЖИЯ, а не от имени юнита: вооружённый челнок по кораблю бьёт', () => {
    const s0 = world();
    const s = {
      ...s0,
      planets: {
        ...s0.planets,
        A: { ...s0.planets.A!, hangar: [{ id: 'sq:a', units: [{ unit: 'bomber', count: 2 }] }] },
      },
      fleets: { E1: fleetOf('E1', 'p2', 'B') },
    };
    expect(code(s, drop({ targetFleetId: 'E1' }))).toBeNull();
  });
});

describe('ROS-1.5 — высадка (правила 3–6)', () => {
  it('ПУСТОЙ ЧУЖОЙ МИР БЕРЁТСЯ СРАЗУ: десант становится гарнизоном, боя нет', () => {
    const { state, events } = advance(apply(world(), drop()), 2);
    expect(state.planets.B?.owner).toBe('p1');
    expect(count(state.planets.B?.garrison, 'militia')).toBe(2); // два челнока — два бойца
    expect(Object.keys(state.battles)).toEqual([]);
    expect(events.some((e) => e.type === 'planet.captured')).toBe(true);
  });

  it('ЧЕЛНОКИ ОДНОРАЗОВЫЕ: домой не возвращаются и в состоянии не остаются', () => {
    const { state } = advance(apply(world(), drop()), 4);
    // Ангар — эскадры, поэтому машины считаются по всем звеньям (SHU-4.2).
    const left = (state.planets.A?.hangar ?? []).flatMap((q) => q.units);
    expect(count(left, 'landing_shuttle')).toBe(2); // взлетели двое из четырёх
    expect(state.strikes ?? []).toEqual([]);
  });

  it('ОБОРОНЯЕМЫЙ ЧУЖОЙ МИР — ПЛАЦДАРМ: наземный бой начинается БЕЗ единого корабля', () => {
    const s = world({ target: { garrison: [['militia', 2]] } });
    const { state } = advance(apply(s, drop()), 2);
    expect(state.planets.B?.beachheads?.map((b) => b.owner)).toEqual(['p1']);
    expect(count(state.planets.B?.beachheads?.[0]?.units, 'militia')).toBe(2);
    const battle = Object.values(state.battles)[0];
    expect(battle?.phase).toBe('ground');
    expect(battle && attackerOf(battle)?.ref).toEqual({
      kind: 'beachhead',
      planetId: 'B',
      owner: 'p1',
    });
    expect(state.planets.B?.owner).toBe('p2'); // мир ещё не взят — за него дерутся
  });

  it('ПЛАЦДАРМ ВЫИГРАЛ — мир его, выжившие стали гарнизоном, поля не осталось', () => {
    const s = world({ target: { garrison: [['militia', 1]] } });
    const { state } = advance(apply(s, drop()), 40);
    expect(state.planets.B?.owner).toBe('p1');
    expect(state.planets.B?.beachheads).toBeUndefined();
    expect(count(state.planets.B?.garrison, 'militia')).toBeGreaterThan(0);
    expect(Object.keys(state.battles)).toEqual([]);
  });

  it('ПЛАЦДАРМ ПРОИГРАЛ — мир остался хозяину, вечных чужих войск на земле не завелось', () => {
    const s = world({ target: { garrison: [['guard', 3]] } });
    const { state } = advance(apply(s, drop()), 40);
    expect(state.planets.B?.owner).toBe('p2');
    expect(state.planets.B?.beachheads).toBeUndefined();
    expect(Object.keys(state.battles)).toEqual([]);
  });

  it('СВОЙ МИР — ПОДКРЕПЛЕНИЕ: груз уходит в гарнизон, боя и плацдарма нет', () => {
    const s = world({ target: { owner: 'p1', garrison: [['militia', 1]] } });
    const { state } = advance(apply(s, drop()), 2);
    expect(count(state.planets.B?.garrison, 'militia')).toBe(3);
    expect(state.planets.B?.beachheads).toBeUndefined();
    expect(Object.keys(state.battles)).toEqual([]);
  });
});

describe('ROS-1.5 — зональное ПВО режет груз (правило 7)', () => {
  it('СБИТАЯ МАШИНА УНОСИТ СВОЮ ДОЛЮ ТРЮМА: высаживается то, что довезли', () => {
    // Батарея даёт 20 при корпусе челнока 10 — сбиты обе машины из двух, груз пропал.
    const s = world({ target: { buildings: ['zonal_aa'] } });
    const { state } = advance(apply(s, drop()), 2);
    expect(state.planets.B?.owner).toBe('p2');
    expect(state.planets.B?.beachheads).toBeUndefined();
  });

  it('уцелевшая половина довозит своих бойцов — по одному на борт', () => {
    // Четыре машины везут четырёх бойцов; батарея сбивает двух → доезжают двое.
    const s = world({ target: { buildings: ['zonal_aa'] } });
    const { state } = advance(apply(s, drop({ count: 4 })), 2);
    expect(state.planets.B?.owner).toBe('p1');
    expect(count(state.planets.B?.garrison, 'militia')).toBe(2);
  });
});

describe('SHU-5.2 — челнок строится с бойцом внутри', () => {
  const build = (troop: string | undefined, count = 1): Action =>
    order('unit.build', {
      planetId: 'A',
      unit: 'landing_shuttle',
      count,
      ...(troop !== undefined ? { troop } : {}),
    });
  /** Свой порт с казармами и без завода; денег с запасом. */
  const yard = (buildings: string[] = ['spaceport', 'barracks']): GameState => {
    const s = world();
    s.planets.A = { ...s.planets.A!, hangar: [], buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })) };
    s.players.p1 = { ...s.players.p1!, resources: { metal: 10_000 } };
    return s;
  };
  const hangarOf = (s: GameState) => s.planets.A?.hangar ?? [];

  it('ГОТОВНОСТЬ: челнок с танком без завода не заказывается — условие постройки танка', () => {
    expect(code(yard(), build('tank'))).toBe('E_NO_FACTORY');
    expect(code(yard(['spaceport', 'factory']), build('tank'))).toBeNull();
  });

  it('боец обязателен и только наземный; у обычного шаттла бойца нет', () => {
    expect(code(yard(), build(undefined))).toBe('E_BAD_PAYLOAD');
    expect(code(yard(), build('cruiser'))).toBe('E_NOT_GROUND');
    expect(code(yard(), build('ghost'))).toBe('E_UNKNOWN_UNIT');
    expect(
      code(yard(), order('unit.build', { planetId: 'A', unit: 'bomber', troop: 'militia' })),
    ).toBe('E_BAD_PAYLOAD');
  });

  it('цена — челнок плюс боец, срок — дольший из двух; готовый встаёт в ангар с бойцом', () => {
    const s = apply(yard(['spaceport', 'factory']), build('tank', 2));
    expect(s.players.p1?.resources.metal).toBe(10_000 - 2 * (70 + 120));
    expect(advance(s, 3).state.planets.A?.hangar ?? []).toEqual([]); // танк строится 4 ч
    const done = advance(s, 4).state;
    expect(hangarOf(done)).toEqual([
      expect.objectContaining({
        units: [{ unit: 'landing_shuttle', count: 2 }],
        cargo: [{ unit: 'tank', count: 2 }],
      }),
    ]);
  });

  it('челноки с разными бойцами встают в разные эскадры, с одинаковыми — в одну', () => {
    let s = apply(yard(['spaceport', 'barracks', 'factory']), build('tank'));
    s = apply(s, build('militia'));
    s = apply(s, build('tank'));
    s = advance(s, 20).state;
    expect(hangarOf(s).map((q) => q.cargo)).toEqual([
      [{ unit: 'tank', count: 2 }],
      [{ unit: 'militia', count: 1 }],
    ]);
  });

  it('ГОТОВНОСТЬ: дошедший до пустого чужого мира челнок становится танком-гарнизоном', () => {
    let s = advance(apply(yard(['spaceport', 'factory']), build('tank')), 4).state;
    const id = hangarOf(s)[0]!.id;
    s = apply(s, order('shuttle.strike', { planetId: 'A', squadronId: id, targetPlanetId: 'B' }));
    const { state } = advance(s, 2);
    expect(state.planets.B?.owner).toBe('p1');
    expect(state.planets.B?.garrison).toEqual([{ unit: 'tank', count: 1 }]);
  });

  it('ГОТОВНОСТЬ: на своём мире челнок становится танком в гарнизоне', () => {
    let s = advance(apply(yard(['spaceport', 'factory']), build('tank')), 4).state;
    s.planets.B = { ...s.planets.B!, owner: 'p1', garrison: [{ unit: 'militia', count: 1 }] };
    const id = hangarOf(s)[0]!.id;
    s = apply(s, order('shuttle.strike', { planetId: 'A', squadronId: id, targetPlanetId: 'B' }));
    const { state } = advance(s, 2);
    expect(count(state.planets.B?.garrison, 'tank')).toBe(1);
    expect(state.planets.B?.beachheads).toBeUndefined();
  });

  it('однородная эскадра делится — бойцы расходятся по бортам', () => {
    const s = apply(
      world(),
      order('shuttle.split', { planetId: 'A', squadronId: 'sq:a', units: [{ unit: 'landing_shuttle', count: 1 }] }),
    );
    expect((s.planets.A?.hangar ?? []).map((q) => q.cargo)).toEqual([
      [{ unit: 'militia', count: 1 }],
      [{ unit: 'militia', count: 1 }],
      [{ unit: 'militia', count: 2 }],
    ]);
  });
});
