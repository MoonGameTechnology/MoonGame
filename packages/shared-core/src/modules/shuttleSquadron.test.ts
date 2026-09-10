/**
 * ЭСКАДРА — соединение челноков (SHU-4.2, заказ владельца 2026-09-10, §0.4
 * `shuttles-roadmap.md`).
 *
 * До этого кирпича ангар был плоским списком стеков, и делить с объединять было нечего:
 * стеки сливаются по юниту и лоадауту, личности у машин нет. Отсюда и невозможность
 * трюма «на стеке» — это стояло прямо в комментарии `ShuttleStrike.cargo`. Эскадра даёт
 * личность соединению, а не машине, и на ней держится всё, что заказал владелец:
 *
 * 1. **Делёж и слияние в пределах базы.** Соединение, которое нельзя пересобрать, —
 *    не соединение, а способ показать список.
 * 2. **Позывной остаётся у БОЛЬШЕЙ половины** (дефолт кирпича). Отделил двойку от
 *    десятки — имя осталось у восьмёрки; отделил восьмёрку — ушло с ней. Иначе имя
 *    следовало бы за тем, на что игрок случайно нажал.
 * 3. **Груз грузится ЗАРАНЕЕ и живёт в состоянии.** Раньше войска брали с базы в момент
 *    вылета, и до вылета трюма не существовало вовсе — игрок не мог собрать десант и
 *    подержать его наготове.
 * 4. **Эскадра ПЕРЕЖИВАЕТ ВЫЛЕТ.** Вернувшись, она снова в ангаре и под тем же id:
 *    личность, пропадающая на час полёта, — не личность.
 * 5. **Место в порту занимает БОРТ, а не соединение.** Иначе делёж создавал бы
 *    вместимость из воздуха.
 * 6. **Топливо остаётся у БАЗЫ** (SHU-1.2, не изменилось): счётчик один на порт, и
 *    эскадры его делят. Своё топливо у каждой означало бы, что делёж удваивает вылеты.
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
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 20, defense: 5, speed: 6, hp: 200 } },
    marine: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 6, defense: 4, speed: 4, hp: 20 } },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 300,
        fuel: 4,
        rearmRounds: 2,
      },
    },
    // Десантный борт: безоружный, зато с трюмом (ROS-1.5).
    lander: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 0,
        defense: 1,
        speed: 60,
        hp: 24,
        strikeRange: 300,
        cargoCapacity: 3,
        fuel: 4,
        rearmRounds: 2,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
  },
  events: {},
});

const HOUR = 3_600_000;
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

function planet(id: string, owner: string | null, x: number, buildings: string[] = []): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
    garrison: [],
    traits: [],
  };
}

const sq = (id: string, units: Array<[string, number]>, cargo?: Array<[string, number]>): Squadron => ({
  id,
  units: units.map(([unit, count]) => ({ unit, count })),
  ...(cargo ? { cargo: cargo.map(([unit, count]) => ({ unit, count })) } : {}),
});

/** Свой мир A(0) с портом и заданными эскадрами; чужой мир B(100) и чужой флот у него. */
function world(hangar: Squadron[], garrison: Array<[string, number]> = []): GameState {
  const s = createInitialState({ seed: 'shu42', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, ['spaceport']);
  home.hangar = hangar;
  home.garrison = garrison.map(([unit, count]) => ({ unit, count }));
  const foe: Fleet = {
    id: 'E1',
    owner: 'p2',
    location: 'B',
    movement: null,
    units: [{ unit: 'cruiser', count: 3 }],
    traits: [],
    battleId: null,
  };
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: home, B: planet('B', 'p2', 100) },
    fleets: { E1: foe },
    heroes: {},
    battles: {},
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

const kernel = createKernel([shuttleModule]);

/** Применить приказ и вернуть состояние; отказ роняет тест с его кодом. */
function apply(state: GameState, action: Action): GameState {
  const r = kernel.applyAction(state, action, at(state));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

/** Код отказа — для проверок, где отказ и есть ожидаемый исход. */
function reject(state: GameState, action: Action): string {
  const r = kernel.applyAction(state, action, at(state));
  return r.ok ? 'ОЖИДАЛСЯ ОТКАЗ, А ПРИКАЗ ПРОШЁЛ' : r.code;
}

const hangarOf = (s: GameState): Squadron[] => s.planets.A?.hangar ?? [];

describe('SHU-4.2 — делёж эскадры', () => {
  it('ДЕЛЁЖ РАЗБИВАЕТ СОЕДИНЕНИЕ, А НЕ МАШИНЫ: 5 бортов → 3 и 2, всего по-прежнему 5', () => {
    const s = apply(
      world([sq('sq:p1:1', [['interceptor', 5]])]),
      act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] }),
    );
    const sizes = hangarOf(s).map((q) => q.units.reduce((n, st) => n + st.count, 0));
    expect(sizes.sort()).toEqual([2, 3]);
    expect(hangarOf(s)).toHaveLength(2);
  });

  it('ПОЗЫВНОЙ ОСТАЁТСЯ У БОЛЬШЕЙ ПОЛОВИНЫ — иначе имя следует за случайным тапом', () => {
    // Отделили двойку от десятки: имя у восьмёрки.
    const small = apply(
      world([sq('sq:p1:1', [['interceptor', 10]])]),
      act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'interceptor', count: 2 }] }),
    );
    const keeper = hangarOf(small).find((q) => q.id === 'sq:p1:1');
    expect(keeper?.units[0]?.count).toBe(8);

    // Отделили восьмёрку: имя УШЛО с ней, у остатка новый id.
    const big = apply(
      world([sq('sq:p1:1', [['interceptor', 10]])]),
      act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'interceptor', count: 8 }] }),
    );
    const named = hangarOf(big).find((q) => q.id === 'sq:p1:1');
    expect(named?.units[0]?.count).toBe(8);
  });

  it('ЭСКАДРУ С ГРУЗОМ ДЕЛИТЬ НЕЛЬЗЯ: делить трюм — правило, которого в модели нет', () => {
    const s = world([sq('sq:p1:1', [['lander', 4]], [['marine', 6]])]);
    expect(reject(s, act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'lander', count: 2 }] }))).toBe(
      'E_HAS_CARGO',
    );
  });

  it('отделить больше, чем есть, нельзя; и всю эскадру целиком — тоже (делить нечего)', () => {
    const s = world([sq('sq:p1:1', [['interceptor', 3]])]);
    expect(reject(s, act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'interceptor', count: 4 }] }))).toBe(
      'E_NOT_ENOUGH',
    );
    expect(reject(s, act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'interceptor', count: 3 }] }))).toBe(
      'E_BAD_PAYLOAD',
    );
  });

  it('неизвестная эскадра — отказ, а не молчание (fail-secure)', () => {
    const s = world([sq('sq:p1:1', [['interceptor', 3]])]);
    expect(reject(s, act('shuttle.split', { planetId: 'A', squadronId: 'нет-такой', units: [{ unit: 'interceptor', count: 1 }] }))).toBe(
      'E_NO_SQUADRON',
    );
  });
});

describe('SHU-4.2 — слияние эскадр', () => {
  it('СЛИЯНИЕ СОБИРАЕТ МАШИНЫ В ОДНО СОЕДИНЕНИЕ, и трюмы складываются', () => {
    const s = apply(
      world([sq('sq:p1:1', [['lander', 2]], [['marine', 5]]), sq('sq:p1:2', [['lander', 3]], [['marine', 4]])]),
      act('shuttle.merge', { planetId: 'A', squadronId: 'sq:p1:2', intoId: 'sq:p1:1' }),
    );
    expect(hangarOf(s)).toHaveLength(1);
    expect(hangarOf(s)[0]?.id).toBe('sq:p1:1');
    expect(hangarOf(s)[0]?.units).toEqual([{ unit: 'lander', count: 5 }]);
    expect(hangarOf(s)[0]?.cargo).toEqual([{ unit: 'marine', count: 9 }]);
  });

  it('РАЗНЫЕ МАШИНЫ УЖИВАЮТСЯ В ОДНОЙ ЭСКАДРЕ: стеки внутри соединения не смешиваются', () => {
    const s = apply(
      world([sq('sq:p1:1', [['interceptor', 2]]), sq('sq:p1:2', [['lander', 1]])]),
      act('shuttle.merge', { planetId: 'A', squadronId: 'sq:p1:2', intoId: 'sq:p1:1' }),
    );
    expect(hangarOf(s)[0]?.units).toEqual([
      { unit: 'interceptor', count: 2 },
      { unit: 'lander', count: 1 },
    ]);
  });

  it('слить эскадру саму с собой нельзя — это не приказ, а опечатка', () => {
    const s = world([sq('sq:p1:1', [['interceptor', 2]])]);
    expect(reject(s, act('shuttle.merge', { planetId: 'A', squadronId: 'sq:p1:1', intoId: 'sq:p1:1' }))).toBe('E_BAD_PAYLOAD');
  });
});

describe('SHU-4.2 — груз грузится ЗАРАНЕЕ', () => {
  it('ВОЙСКА ПОКИДАЮТ ГАРНИЗОН СРАЗУ: трюм — это состояние, а не намерение', () => {
    const s = apply(
      world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]),
      act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 5 }] }),
    );
    expect(hangarOf(s)[0]?.cargo).toEqual([{ unit: 'marine', count: 5 }]);
    // Гарнизон честно обмелел — иначе взвод числился бы в двух местах разом.
    expect(s.planets.A?.garrison).toEqual([{ unit: 'marine', count: 5 }]);
  });

  it('СВЕРХ ВМЕСТИМОСТИ ТРЮМА — ОТКАЗ: 2 борта по 3 места держат шестерых, не семерых', () => {
    const s = world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]);
    expect(reject(s, act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 7 }] }))).toBe(
      'E_NO_CAPACITY',
    );
  });

  it('вместимость считается по ВСЕЙ эскадре, а догрузка знает про уже погруженных', () => {
    let s = apply(
      world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]),
      act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 4 }] }),
    );
    expect(reject(s, act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 3 }] }))).toBe(
      'E_NO_CAPACITY',
    );
    s = apply(s, act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 2 }] }));
    expect(hangarOf(s)[0]?.cargo).toEqual([{ unit: 'marine', count: 6 }]);
  });

  it('БЕЗ ТРЮМА НЕ ГРУЗЯТ: у перехватчика `cargoCapacity` нет вовсе', () => {
    const s = world([sq('sq:p1:1', [['interceptor', 4]])], [['marine', 10]]);
    expect(reject(s, act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 1 }] }))).toBe(
      'E_NO_CAPACITY',
    );
  });

  it('ВЫГРУЗКА ВОЗВРАЩАЕТ В ГАРНИЗОН — приказ без обратного хода запирает войска', () => {
    let s = apply(
      world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]),
      act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 5 }] }),
    );
    s = apply(s, act('shuttle.unloadTroops', { planetId: 'A', squadronId: 'sq:p1:1' }));
    expect(hangarOf(s)[0]?.cargo).toBeUndefined();
    expect(s.planets.A?.garrison).toEqual([{ unit: 'marine', count: 10 }]);
  });

  it('ВЫГРУЗКА БЫВАЕТ ЧАСТИЧНОЙ: ссадить можно И ВЗВОД, а не только весь трюм', () => {
    // Интерфейс (SHU-4.3) считает погрузку и выгрузку ОДНИМ знаковым планом на строку
    // («+2 взять, −1 ссадить»), и «всё или ничего» он выразить не может: кнопка обещала
    // бы игроку то, чего ядро не умеет. Заявка без списка по-прежнему ссаживает всё.
    let s = apply(
      world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]),
      act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 5 }] }),
    );
    s = apply(
      s,
      act('shuttle.unloadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 2 }] }),
    );
    expect(hangarOf(s)[0]?.cargo).toEqual([{ unit: 'marine', count: 3 }]);
    expect(s.planets.A?.garrison).toEqual([{ unit: 'marine', count: 7 }]);
  });

  it('ссадить больше, чем в трюме, нельзя — заявка отбивается целиком', () => {
    const s = apply(
      world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]),
      act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 3 }] }),
    );
    expect(
      reject(s, act('shuttle.unloadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 4 }] })),
    ).toBe('E_NO_ARMY');
    // Состояние не тронуто: fail-secure отбивает ДО первой правки.
    expect(hangarOf(s)[0]?.cargo).toEqual([{ unit: 'marine', count: 3 }]);
  });

  it('нельзя грузить чужую эскадру и войска, которых в гарнизоне нет', () => {
    const s = world([sq('sq:p1:1', [['lander', 2]])], [['marine', 1]]);
    expect(reject(s, act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 2 }] }))).toBe(
      'E_NO_ARMY',
    );
    expect(
      reject(s, act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 1 }] }, 'p2')),
    ).toBe('E_FORBIDDEN');
  });
});

describe('SHU-4.2 — вылет идёт ЭСКАДРОЙ', () => {
  it('УДАР АДРЕСУЕТ СОЕДИНЕНИЕ ПО ID, и ангар пустеет целиком', () => {
    const s = apply(
      world([sq('sq:p1:1', [['interceptor', 4]])]),
      act('shuttle.strike', { planetId: 'A', squadronId: 'sq:p1:1', targetFleetId: 'E1' }),
    );
    expect(hangarOf(s)).toHaveLength(0);
    expect(s.strikes).toHaveLength(1);
    expect(s.strikes?.[0]?.units).toEqual([{ unit: 'interceptor', count: 4 }]);
  });

  it('неизвестная эскадра не летит', () => {
    const s = world([sq('sq:p1:1', [['interceptor', 4]])]);
    expect(reject(s, act('shuttle.strike', { planetId: 'A', squadronId: 'нет-такой', targetFleetId: 'E1' }))).toBe('E_NO_SQUADRON');
  });

  it('ЭСКАДРА ПЕРЕЖИВАЕТ ВЫЛЕТ: вернулась — снова в ангаре и ПОД ТЕМ ЖЕ ИМЕНЕМ', () => {
    const launched = apply(
      world([sq('sq:p1:1', [['interceptor', 4]])]),
      act('shuttle.strike', { planetId: 'A', squadronId: 'sq:p1:1', targetFleetId: 'E1' }),
    );
    const done = kernel.advanceTo(launched, { now: launched.time + 6 * HOUR, data });
    if (!done.ok) throw new Error(done.code);
    const back = done.state.planets.A?.hangar ?? [];
    expect(back).toHaveLength(1);
    expect(back[0]?.id).toBe('sq:p1:1');
    expect(back[0]?.units[0]?.count).toBeGreaterThan(0);
  });

  it('ГРУЗ ЕДЕТ ИЗ ТРЮМА, а не собирается на лету: вылет несёт то, что погрузили', () => {
    let s = apply(
      world([sq('sq:p1:1', [['lander', 2]])], [['marine', 10]]),
      act('shuttle.loadTroops', { planetId: 'A', squadronId: 'sq:p1:1', troops: [{ unit: 'marine', count: 5 }] }),
    );
    s = apply(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:p1:1', targetPlanetId: 'B' }));
    expect(s.strikes?.[0]?.cargo).toEqual([{ unit: 'marine', count: 5 }]);
  });

  it('БЕЗОРУЖНАЯ ЭСКАДРА НЕ БЬЁТ ПО КОРАБЛЯМ (ROS-1.5): признак — `attack`, а не имя', () => {
    const s = world([sq('sq:p1:1', [['lander', 2]])]);
    expect(reject(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:p1:1', targetFleetId: 'E1' }))).toBe('E_INVALID_TARGET');
  });
});

describe('SHU-4.2 — порт, поднявший ВСЁ, не остаётся сухим навсегда', () => {
  // Найденная ловушка, ставшая обычной именно из-за эскадры. Топливо и перезарядка
  // базы читались у машин, СТОЯЩИХ в ангаре; пустой ангар давал maxFuel 0, а тик
  // перезарядки «заправляет» базу ровно на эту величину — в ноль. Порт, поднявший всё,
  // что у него было, больше не выпускал НИКОГДА. Раньше в это упирались редко (летала
  // часть машин), теперь эскадра уходит целиком, и редкое стало обычным.
  it('ВСЯ ЭСКАДРА В ВОЗДУХЕ — порт всё равно перезаряжается и снова выпускает', () => {
    let s: GameState = world([sq('sq:p1:1', [['interceptor', 2]])]);
    s = apply(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:p1:1', targetFleetId: 'E1' }));
    expect(s.planets.A?.hangar ?? []).toHaveLength(0); // ангар пуст: машины летят
    const done = kernel.advanceTo(s, { now: s.time + 8 * HOUR, data });
    if (!done.ok) throw new Error(done.code);
    expect(done.state.planets.A?.sortie?.fuel).toBeGreaterThan(0);
    const again = kernel.applyAction(
      done.state,
      act('shuttle.strike', { planetId: 'A', squadronId: 'sq:p1:1', targetFleetId: 'E1' }),
      at(done.state),
    );
    expect(again.ok, again.ok ? '' : again.code).toBe(true);
  });
});

describe('SHU-4.2 — место в порту занимает БОРТ, а не соединение', () => {
  it('ДЕЛЁЖ НЕ СОЗДАЁТ ВМЕСТИМОСТЬ ИЗ ВОЗДУХА: 12 машин в порту на 12 мест, как ни дели', () => {
    const s = apply(
      world([sq('sq:p1:1', [['interceptor', 12]])]),
      act('shuttle.split', { planetId: 'A', squadronId: 'sq:p1:1', units: [{ unit: 'interceptor', count: 5 }] }),
    );
    const machines = hangarOf(s).reduce((n, q) => n + q.units.reduce((m, st) => m + st.count, 0), 0);
    expect(machines).toBe(12);
    // Тик не должен ничего срезать: вместимость порта ровно 12.
    const ticked = kernel.advanceTo(s, { now: s.time + HOUR, data });
    if (!ticked.ok) throw new Error(ticked.code);
    const after = (ticked.state.planets.A?.hangar ?? []).reduce(
      (n, q) => n + q.units.reduce((m, st) => m + st.count, 0),
      0,
    );
    expect(after).toBe(12);
  });
});
