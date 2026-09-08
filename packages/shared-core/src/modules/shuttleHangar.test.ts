/**
 * АНГАР КОСМОПОРТА (SHU-1.1) — челнок живёт не во флоте и не в гарнизоне.
 *
 * Заказ владельца 2026-09-08: челноки базируются В КОСМОПОРТЕ, на орбите не
 * показываются, вылетают и возвращаются только через порт. Отсюда четыре правила, за
 * которыми следят тесты ниже, — и все четыре про ОДНО: у ангара есть хозяин, и это порт.
 *
 * 1. **Нет порта — нет челнока.** Постройка отбивается `E_NO_PORT`. Гейт стоит на
 *    вместимости (`shuttleBay`), а не на отдельном флаге «умеет ангар»: порт, который
 *    вмещает ноль челноков, ничем не отличается от отсутствующего.
 * 2. **Вместимость — это предел, а не украшение.** Заказ сверх свободных мест отбивается
 *    `E_HANGAR_FULL`, и уже стоящие в очереди места ЗАНИМАЮТ: иначе десять заказов по
 *    одному прошли бы там, где один заказ на десять отбивается.
 * 3. **Готовый челнок уходит в ангар, а не в орбитальный флот.** Иначе он немедленно
 *    оказался бы на карте — ровно тем, чем по новой модели быть перестал.
 * 4. **Порт потерян — челноки потеряны.** Разрушен (штурм/бомбардировка) или захвачен
 *    вместе с миром: они физически внутри. Если вместимость упала, но не до нуля,
 *    гибнут лишние — состояние не может держать больше, чем вмещает порт.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { constructionModule } from './construction';
import { autoRallyModule } from './autoRally';
import { shuttleModule } from './shuttle';
import { captureOnArrivalModule } from './captureOnArrival';
import { movementModule } from './movement';
import { createInitialState, type GameState, type Planet, type Player } from '../state/gameState';
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 5, defense: 5, speed: 6, hp: 40 },
      cost: { metal: 10 },
      buildTimeHours: 0,
    },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 14, defense: 3, speed: 14, hp: 10, strikeRange: 180 },
      cost: { metal: 10 },
      buildTimeHours: 0,
    },
    militia: {
      faction: 'x',
      domain: 'ground',
      stats: { attack: 4, defense: 8, speed: 0, hp: 14 },
      cost: { metal: 10 },
      buildTimeHours: 0,
    },
  },
  factions: {},
  buildings: {
    // Космопорт: и верфь кораблей, и дом челноков. Две вместимости — чтобы отличить
    // «нет порта» от «порт мал».
    spaceport: {
      name: 'Spaceport',
      cost: {},
      buildTimeHours: 0,
      hp: 30,
      enablesShipConstruction: true,
      shuttleBay: 2,
    },
    outpost_pad: {
      name: 'Landing Pad',
      cost: {},
      buildTimeHours: 0,
      hp: 10,
      enablesShipConstruction: true,
      shuttleBay: 1,
    },
    barracks: { name: 'Barracks', cost: {}, buildTimeHours: 0, hp: 20, enablesGroundConstruction: true },
  },
  events: {},
});

const kernel = createKernel([
  movementModule,
  constructionModule,
  autoRallyModule,
  captureOnArrivalModule,
  shuttleModule,
]);

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: { metal: 1000 },
});

const planet = (id: string, owner: string | null, buildings: Array<[string, number]>): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
  garrison: [],
  traits: [],
});

function world(buildings: Array<[string, number]> = [['spaceport', 30]]): GameState {
  const s = createInitialState({ seed: 'shu', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: planet('A', 'p1', buildings) },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const build = (unit: string, count = 1, planetId = 'A'): Action => ({
  id: `a:${seq++}`,
  type: 'unit.build',
  playerId: 'p1',
  payload: { planetId, unit, count },
  issuedAt: 0,
});

/** Контекст «сейчас» для состояния: действие в прошлом мира отбивается
 *  `E_TIME_BACKWARDS`, а после достройки мир уже сдвинут. */
const at = (s: GameState): Context => ({ now: s.time, data });

/** Применить действие и вернуть новое состояние (или бросить с кодом отказа). */
function apply(state: GameState, action: Action): GameState {
  const r = kernel.applyAction(state, action, at(state));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

/** Код отказа действия, или null если оно прошло. */
function code(state: GameState, action: Action): string | null {
  const r = kernel.applyAction(state, action, at(state));
  return r.ok ? null : r.code;
}

const hangarOf = (s: GameState, id = 'A'): Array<{ unit: string; count: number }> =>
  (s.planets[id]?.hangar ?? []).map((st) => ({ unit: st.unit, count: st.count }));

/** Заказать и ДОСТРОИТЬ: заказ ставит событие завершения на таймлайн, поэтому мир нужно
 *  сдвинуть — иначе проверялась бы очередь, а не доставка. */
function built(state: GameState, unit: string, count = 1): GameState {
  return advance(apply(state, build(unit, count)), state.time + 3_600_000);
}

/** Продвинуть мир до `now` и вернуть состояние (или бросить с кодом отказа). */
function advance(state: GameState, now: number): GameState {
  const r = kernel.advanceTo(state, { now, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe('ангар космопорта — постройка челнока (правила 1–3)', () => {
  it('НЕТ ПОРТА — НЕТ ЧЕЛНОКА: без вместимости постройка отбивается', () => {
    expect(code(world([['barracks', 20]]), build('interceptor'))).toBe('E_NO_PORT');
  });

  it('порт есть — челнок строится И УХОДИТ В АНГАР, а не в гарнизон и не на орбиту', () => {
    const s = built(world(), 'interceptor');
    expect(hangarOf(s)).toEqual([{ unit: 'interceptor', count: 1 }]);
    expect(s.planets.A?.garrison ?? []).toEqual([]);
    expect(Object.keys(s.fleets)).toEqual([]);
  });

  it('ВМЕСТИМОСТЬ — ПРЕДЕЛ: заказ сверх свободных мест отбивается', () => {
    expect(code(world(), build('interceptor', 3))).toBe('E_HANGAR_FULL');
  });

  it('уже базирующиеся челноки ЗАНИМАЮТ места', () => {
    const s = built(world(), 'interceptor', 2); // ангар полон
    expect(code(s, build('interceptor'))).toBe('E_HANGAR_FULL');
  });

  it('вместимость складывается по ПОРТАМ мира', () => {
    const two = world([
      ['spaceport', 30],
      ['outpost_pad', 10],
    ]);
    expect(code(two, build('interceptor', 3))).toBeNull();
    expect(code(two, build('interceptor', 4))).toBe('E_HANGAR_FULL');
  });

  it('РАЗРУШЕННЫЙ ПОРТ ВМЕСТИМОСТИ НЕ ДАЁТ: hp 0 — это не порт', () => {
    expect(code(world([['spaceport', 0]]), build('interceptor'))).toBe('E_NO_PORT');
  });

  it('обычный корабль по-прежнему поднимается в орбитальный флот (регрессия autoRally)', () => {
    const s = built(world(), 'cruiser');
    expect(hangarOf(s)).toEqual([]);
    const fleets = Object.values(s.fleets);
    expect(fleets).toHaveLength(1);
    expect(fleets[0]?.units).toEqual([{ unit: 'cruiser', count: 1 }]);
  });

  it('наземный юнит по-прежнему встаёт в гарнизон', () => {
    const s = built(world([['barracks', 20]]), 'militia');
    expect(s.planets.A?.garrison).toEqual([{ unit: 'militia', count: 1 }]);
    expect(hangarOf(s)).toEqual([]);
  });
});

describe('ангар космопорта — потеря порта (правило 4)', () => {
  it('ПОРТ РАЗРУШЕН — ЧЕЛНОКИ ПОГИБЛИ ВМЕСТЕ С НИМ', () => {
    const s = built(world(), 'interceptor', 2);
    expect(hangarOf(s)[0]?.count).toBe(2);
    // Порт снесён (штурмом или бомбардировкой — ядро в обоих случаях доводит hp до нуля
    // и убирает здание). Ангару больше не на чем держаться.
    const razed: GameState = {
      ...s,
      planets: { ...s.planets, A: { ...s.planets.A!, buildings: [] } },
    };
    const after = advance(razed, razed.time + 3_600_000);
    expect(hangarOf(after)).toEqual([]);
  });

  it('ВМЕСТИМОСТЬ УПАЛА — ЛИШНИЕ ГИБНУТ, остаток остаётся', () => {
    // Два порта, ангар полон под завязку (2 + 1 = 3 места).
    let s = built(
      world([
        ['spaceport', 30],
        ['outpost_pad', 10],
      ]),
      'interceptor',
      3,
    );
    expect(hangarOf(s)[0]?.count).toBe(3);
    // Сносим большой порт: остаётся вместимость 1 — двое лишних гибнут.
    s = {
      ...s,
      planets: {
        ...s.planets,
        A: { ...s.planets.A!, buildings: [{ type: 'outpost_pad', level: 1, hp: 10 }] },
      },
    };
    const after = advance(s, s.time + 3_600_000);
    expect(hangarOf(after)[0]?.count).toBe(1);
  });

  it('МИР ЗАХВАЧЕН — ЧЕЛНОКИ ПОГИБЛИ, а не достались захватчику', () => {
    // Настоящий путь захвата: чужой флот ПРИЛЕТАЕТ на мир без гарнизона
    // (`captureOnArrival` на событии прибытия), а не подменённый в тесте `owner`.
    const s = built(world(), 'interceptor', 2);
    const staged: GameState = {
      ...s,
      planets: {
        ...s.planets,
        A: { ...s.planets.A!, garrison: [], links: ['B'] },
        B: { ...planet('B', 'p2', []), position: { x: 10, y: 0 }, links: ['A'] },
      },
      fleets: {
        E1: {
          id: 'E1',
          owner: 'p2',
          location: 'B',
          movement: null,
          units: [{ unit: 'cruiser', count: 1 }],
          traits: [],
          battleId: null,
        },
      },
    };
    const moved = apply(staged, {
      id: 'a:move',
      type: 'fleet.move',
      playerId: 'p2',
      payload: { fleetId: 'E1', to: 'A' },
      issuedAt: 0,
    });
    const after = advance(moved, moved.time + 30 * 3_600_000);
    expect(after.planets.A?.owner).toBe('p2'); // захват действительно случился
    expect(hangarOf(after)).toEqual([]);
  });
});

describe('ангар космопорта — туман войны', () => {
  it('СВОЙ ангар виден владельцу', () => {
    const s = built(world(), 'interceptor');
    const view = visibleState(s, 'p1', data);
    expect((view.planets.A?.hangar ?? []).length).toBe(1);
  });

  it('ЧУЖОЙ АНГАР НЕ ВИДЕН: снаружи виден порт, но не то, что в нём стоит', () => {
    const s = built(world(), 'interceptor');
    const view = visibleState(s, 'p2', data);
    expect(view.planets.A?.hangar).toBeUndefined();
  });
});
