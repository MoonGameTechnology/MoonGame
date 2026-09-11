/**
 * ДЕСАНТНЫЙ ЧЕЛНОК (ROS-1.5, заказ владельца 2026-09-09, п. 10).
 *
 * Безоружная машина с маленьким трюмом: по кораблям не бьёт вовсе, а при ударе по миру
 * ГИБНЕТ и высаживает то, что везла. Отсюда правила:
 *
 * 1. **Корабль ей не цель.** Вылет, которому нечем бить по корпусам, отбивается
 *    `E_INVALID_TARGET` — не «долетел и ничего не сделал», а отказ на приказе.
 * 2. **Груз берётся с базы при вылете**, а не хранится в ангаре: у машин в ангаре нет
 *    своей личности (стеки сливаются), и трюм на стеке запретил бы им сливаться.
 *    Ограничен `cargoCapacity` вылета; чего нет в гарнизоне — не взлетит.
 * 3. **Одноразовость.** Домой машины не возвращаются: они высадились вместе с грузом.
 * 4. **Пустой чужой мир берётся сразу**, десант становится его гарнизоном.
 * 5. **Обороняемый чужой мир — ПЛАЦДАРМ** (решение владельца 2026-09-09): десант встаёт
 *    на землю четвёртой стороной боя и сам начинает наземный бой, без единого корабля
 *    рядом. Выиграл — стал гарнизоном и взял мир; проиграл — исчез вместе с боем.
 * 6. **Свой и союзный мир — подкрепление:** груз уходит в гарнизон, боя нет.
 * 7. **Зональное ПВО режет груз.** Сбитая машина уносит свою долю трюма: высаживается
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
    // Десантный челнок: ноль урона, трюм на три единицы (§0.2).
    landing_shuttle: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 0,
        defense: 2,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
        cargoCapacity: 3,
      },
    },
    // Вооружённый челнок — сторож на то, что запрет бить корабли идёт от ОРУЖИЯ.
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 20, defense: 4, speed: 100, hp: 16, strikeRange: 180, fuel: 4, rearmRounds: 2 },
    },
    militia: { faction: 'x', domain: 'ground', stats: { attack: 4, defense: 4, speed: 4, hp: 20, cargoSize: 1 } },
    guard: { faction: 'x', domain: 'ground', stats: { attack: 30, defense: 30, speed: 4, hp: 200, cargoSize: 1 } },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
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
    ...(over.hangar === undefined
      ? {}
      : {
          hangar: ['sq:a', 'sq:b'].map((id) => ({
            id,
            units: [{ unit: 'landing_shuttle', count: Math.floor(over.hangar! / 2) }],
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
 * Десантный вылет ПОСЛЕДОВАТЕЛЬНОСТЬЮ (SHU-4.2): груз теперь кладут в трюм ЗАРАНЕЕ, а
 * не заявляют в приказе на удар. Хелпер собирает её целиком — (слияние) → погрузка →
 * удар, — чтобы тесты говорили про исход высадки, а не про механику трёх приказов.
 * `count: 4` значит «всеми машинами», то есть сперва свести оба звена в одно.
 */
const drop = (
  over: {
    squadronId?: string;
    count?: number;
    troops?: Array<{ unit: string; count: number }>;
    targetPlanetId?: string;
    targetFleetId?: string;
  } = {},
): Action[] => {
  const {
    squadronId = 'sq:a',
    count = 2,
    troops = [{ unit: 'militia', count: 4 }],
    ...target
  } = over;
  const out: Action[] = [];
  if (count === 4) out.push(order('shuttle.merge', { planetId: 'A', squadronId: 'sq:b', intoId: squadronId }));
  if (troops.length > 0) out.push(order('shuttle.loadTroops', { planetId: 'A', squadronId, troops }));
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
    expect(code(s, drop({ targetFleetId: 'E1', troops: [] }))).toBe('E_INVALID_TARGET');
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
    expect(code(s, drop({ troops: [], targetFleetId: 'E1' }))).toBeNull();
  });

  it('трюм не резиновый: больше `cargoCapacity` вылета не увезти', () => {
    // Две машины по 3 = 6 мест; седьмая единица не влезает.
    expect(code(world(), drop({ troops: [{ unit: 'militia', count: 7 }] }))).toBe('E_NO_CAPACITY');
    expect(code(world(), drop({ troops: [{ unit: 'militia', count: 6 }] }))).toBeNull();
  });

  it('чего нет в гарнизоне — не взлетит, и КОРАБЛЬ грузом не бывает', () => {
    expect(code(world(), drop({ troops: [{ unit: 'guard', count: 1 }] }))).toBe('E_NO_ARMY');
    expect(code(world(), drop({ troops: [{ unit: 'cruiser', count: 1 }] }))).toBe('E_NOT_GROUND');
  });

  it('груз уходит из гарнизона СРАЗУ на вылете — вторая посылка тем же взводом не пройдёт', () => {
    const s = apply(world(), drop({ troops: [{ unit: 'militia', count: 4 }] }));
    expect(count(s.planets.A?.garrison, 'militia')).toBe(4);
    // Второе звено ещё в порту — но взвода на него уже не хватит: первый улетел с грузом.
    expect(code(s, drop({ squadronId: 'sq:b', troops: [{ unit: 'militia', count: 5 }] }))).toBe(
      'E_NO_ARMY',
    );
  });
});

describe('ROS-1.5 — высадка (правила 3–6)', () => {
  it('ПУСТОЙ ЧУЖОЙ МИР БЕРЁТСЯ СРАЗУ: десант становится гарнизоном, боя нет', () => {
    const { state, events } = advance(apply(world(), drop()), 2);
    expect(state.planets.B?.owner).toBe('p1');
    expect(count(state.planets.B?.garrison, 'militia')).toBe(4);
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
    expect(state.planets.B?.beachhead?.owner).toBe('p1');
    expect(count(state.planets.B?.beachhead?.units, 'militia')).toBe(4);
    const battle = Object.values(state.battles)[0];
    expect(battle?.phase).toBe('ground');
    expect(battle && attackerOf(battle)?.ref).toEqual({ kind: 'beachhead', planetId: 'B' });
    expect(state.planets.B?.owner).toBe('p2'); // мир ещё не взят — за него дерутся
  });

  it('ПЛАЦДАРМ ВЫИГРАЛ — мир его, выжившие стали гарнизоном, поля не осталось', () => {
    const s = world({ target: { garrison: [['militia', 1]] } });
    const { state } = advance(apply(s, drop()), 40);
    expect(state.planets.B?.owner).toBe('p1');
    expect(state.planets.B?.beachhead).toBeUndefined();
    expect(count(state.planets.B?.garrison, 'militia')).toBeGreaterThan(0);
    expect(Object.keys(state.battles)).toEqual([]);
  });

  it('ПЛАЦДАРМ ПРОИГРАЛ — мир остался хозяину, вечных чужих войск на земле не завелось', () => {
    const s = world({ target: { garrison: [['guard', 3]] } });
    const { state } = advance(apply(s, drop()), 40);
    expect(state.planets.B?.owner).toBe('p2');
    expect(state.planets.B?.beachhead).toBeUndefined();
    expect(Object.keys(state.battles)).toEqual([]);
  });

  it('СВОЙ МИР — ПОДКРЕПЛЕНИЕ: груз уходит в гарнизон, боя и плацдарма нет', () => {
    const s = world({ target: { owner: 'p1', garrison: [['militia', 1]] } });
    const { state } = advance(apply(s, drop()), 2);
    expect(count(state.planets.B?.garrison, 'militia')).toBe(5);
    expect(state.planets.B?.beachhead).toBeUndefined();
    expect(Object.keys(state.battles)).toEqual([]);
  });
});

describe('ROS-1.5 — зональное ПВО режет груз (правило 7)', () => {
  it('СБИТАЯ МАШИНА УНОСИТ СВОЮ ДОЛЮ ТРЮМА: высаживается то, что довезли', () => {
    // Батарея даёт 20 при корпусе челнока 10 — сбиты обе машины из двух, груз пропал.
    const s = world({ target: { buildings: ['zonal_aa'] } });
    const { state } = advance(apply(s, drop()), 2);
    expect(state.planets.B?.owner).toBe('p2');
    expect(state.planets.B?.beachhead).toBeUndefined();
  });

  it('уцелевшая половина довозит свою половину груза', () => {
    // Четыре машины (трюм 12) везут 6 бойцов; батарея сбивает двух → остаётся 6 мест,
    // и все шестеро доезжают. Сбей она больше — доехало бы по вместимости.
    const s = world({ target: { buildings: ['zonal_aa'] } });
    const { state } = advance(
      apply(s, drop({ count: 4, troops: [{ unit: 'militia', count: 6 }] })),
      2,
    );
    expect(state.planets.B?.owner).toBe('p1');
    expect(count(state.planets.B?.garrison, 'militia')).toBe(6);
  });
});
