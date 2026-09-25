/**
 * ПОГОНЯ ЗА ДВИЖУЩЕЙСЯ ЦЕЛЬЮ (SHU-4.4) — приёмка кирпича.
 *
 * До него удар по флоту, идущему МЕЖДУ УЗЛАМИ, не уходил вовсе: модуль челноков держал
 * свою копию «где сейчас флот», и она, в отличие от ядровой `fleetPositionAt`, не знала
 * про `Fleet.movement`. Приказ отбивался `E_NO_TARGET_POSITION` — то есть ровно то, чего
 * игрок ждёт от челноков, было невозможно.
 *
 * Модель владельца (§0.4 роадмапа): у цели небольшой радиус, эскадра регулярно
 * пересчитывает её координаты и правит курс к центру радиуса; попадание засчитывается,
 * когда на очередном пересчёте эскадра оказалась ВНУТРИ радиуса. Не дошла, а центр
 * радиуса вышел за дальность вылета — атака отменяется сама.
 *
 * 1. **По идущему флоту удар УХОДИТ и ПОПАДАЕТ.** Приёмочный критерий кирпича.
 * 2. **Быстрый флот ОТРЫВАЕТСЯ** — поводок от базы рвётся, эскадра возвращается пустой.
 *    Это и есть контригра, ради которой поводок выбран вместо чистого самонаведения.
 * 3. **Исход не зависит от того, как хост нарезал время.** Ночь офлайна одним куском и
 *    та же ночь по часам обязаны дать одно и то же состояние — иначе реплей разъедется
 *    с партией (инвариант #1).
 * 4. **След живой.** `at` ползёт за целью, `to` держит нынешний прицел — по ним видят
 *    вылет и карта, и зональное ПВО, и перехват.
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
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      // Скорость 100 ед/час, поводок 180 от базы, радиус захвата 20.
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        chaseRadius: 20,
        fuel: 3,
        rearmRounds: 2,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

const kernel = createKernel([shuttleModule]);
const ctx = (s: GameState): Context => ({ now: s.time, data });

const planet = (id: string, owner: string | null, x: number, y = 0): Planet => ({
  id,
  owner,
  position: { x, y },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});

/**
 * Мир: свой порт A(0,0) с эскадрой и чужой крейсер, ИДУЩИЙ по линии B(100,0) → `dest`.
 * `hours` — сколько игровых часов занимает весь перегон, то есть насколько быстра цель.
 * Уводя `dest` вбок, а не прочь от базы, цель можно держать В ПОВОДКЕ сколь угодно
 * долго — это нужно, чтобы наблюдать погоню в середине, а не только её исход.
 */
function world(hours: number, dest = { x: 500, y: 0 }): GameState {
  const s = createInitialState({ seed: 'shu44', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0);
  home.buildings = [{ type: 'spaceport', level: 1, hp: 30 }];
  home.hangar = [{ id: 'sq:hunt', units: [{ unit: 'interceptor', count: 2 }] }];
  const runner: Fleet = {
    id: 'E1',
    owner: 'p2',
    location: null,
    movement: { from: 'B', to: 'D', departedAt: 0, arrivesAt: hours * MS_PER_HOUR },
    units: [{ unit: 'cruiser', count: 1 }],
    traits: [],
    battleId: null,
  };
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} } as Player,
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} } as Player,
    },
    planets: { A: home, B: planet('B', 'p2', 100), D: planet('D', 'p2', dest.x, dest.y) },
    fleets: { E1: runner },
    heroes: {},
    battles: {},
  };
}

const order: Action = {
  id: 'a1',
  issuedAt: 0,
  type: 'shuttle.strike',
  playerId: 'p1',
  payload: { planetId: 'A', squadronId: 'sq:hunt', targetFleetId: 'E1' },
};

function apply(s: GameState, a: Action): GameState {
  const r = kernel.applyAction(s, a, ctx(s));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

function code(s: GameState, a: Action): string | null {
  const r = kernel.applyAction(s, a, ctx(s));
  return r.ok ? null : r.code;
}

/** Продвинуть мир на `hours` часов ОДНИМ куском. */
function advance(s: GameState, hours: number): GameState {
  const r = kernel.advanceTo(s, { now: s.time + hours * MS_PER_HOUR, data });
  if (!r.ok) throw new Error('advance failed');
  return r.state;
}

/** Тот же срок, но НАРЕЗАННЫЙ на куски по `slice` часов — как разбудил бы хост. */
function advanceSliced(s: GameState, hours: number, slice: number): GameState {
  let out = s;
  for (let done = 0; done < hours; done += slice) {
    out = advance(out, Math.min(slice, hours - done));
  }
  return out;
}

const hullOf = (s: GameState, id: string): number | undefined => s.fleets[id]?.units[0]?.hp;

describe('SHU-4.4 — удар по движущейся цели', () => {
  it('ПРИКАЗ ПО ИДУЩЕМУ ФЛОТУ ПРИНИМАЕТСЯ — до кирпича здесь был E_NO_TARGET_POSITION', () => {
    expect(code(world(40), order)).toBeNull();
  });

  it('ПРИЁМКА: медленную цель эскадра ДОГОНЯЕТ и бьёт', () => {
    // 400 единиц за 40 часов = 10 ед/час: эскадра на 100 ед/час сокращает разрыв.
    const after = advance(apply(world(40), order), 6);
    expect(hullOf(after, 'E1')).toBeLessThan(100);
  });

  it('ПОВОДОК: быстрая цель ОТРЫВАЕТСЯ — эскадра возвращается пустой, а не бьёт', () => {
    // 400 единиц за 2 часа = 200 ед/час: вдвое быстрее эскадры, и уже через час
    // центр радиуса уходит за 180 от базы.
    const after = advance(apply(world(2), order), 8);
    expect(hullOf(after, 'E1')).toBeUndefined(); // цел
    expect(after.strikes ?? []).toHaveLength(0); // вернулась
    expect(after.planets.A?.hangar?.[0]?.units[0]?.count).toBe(2); // и села в свой ангар
  });

  it('ЦЕЛЬ ИСЧЕЗЛА — ЭСКАДРА ДОМОЙ, а не гонится за пустым id до конца матча', () => {
    const s = apply(world(40), order);
    const gone: GameState = { ...s, fleets: {} };
    const after = advance(gone, 8);
    expect(after.strikes ?? []).toHaveLength(0);
    expect(after.planets.A?.hangar?.[0]?.units[0]?.count).toBe(2);
  });

  it('НАРЕЗКА ВРЕМЕНИ НЕ МЕНЯЕТ ИСХОД: ночь одним куском = та же ночь по часам', () => {
    const s = apply(world(40), order);
    const whole = advance(s, 6);
    const sliced = advanceSliced(s, 6, 1);
    expect(hullOf(sliced, 'E1')).toBe(hullOf(whole, 'E1'));
    expect(sliced.strikes ?? []).toEqual(whole.strikes ?? []);
  });

  it('ПЕРЕСЧЁТ ИНТЕГРИРУЕТ ОТРЕЗОК: цель не уходит от удара тем, что её долго не смотрели', () => {
    // Тот же мир, но проверяется именно грубая нарезка: один кусок в 6 часов обязан
    // дать попадание, а не «посмотрели в конец — цель уже далеко».
    const after = advance(apply(world(40), order), 6);
    expect(hullOf(after, 'E1')).toBeLessThan(100);
  });

  it('СЛЕД ЖИВОЙ: якорь ползёт за целью, `to` держит НЫНЕШНИЙ прицел', () => {
    // Цель уходит ВБОК (B(100,0) → D(100,4000)) на 90 ед/час: от базы она почти не
    // удаляется, поводок держит, и погоня длится дольше одного пересчёта.
    const away = world(4000 / 90, { x: 100, y: 4000 });
    const launched = apply(away, order);
    expect((launched.strikes ?? [])[0]?.at).toEqual({ x: 0, y: 0 }); // якорь — база
    expect((launched.strikes ?? [])[0]?.to).toEqual({ x: 100, y: 0 }); // прицел — где цель

    const st = (advance(launched, 1).strikes ?? [])[0];
    expect(st?.leg).toBe('out'); // ещё догоняет
    expect(st?.at?.y).toBeGreaterThan(0); // якорь уехал за целью
    expect(st?.to.y).toBeGreaterThan(0); // и прицел — ЖИВАЯ точка, а не снимок B
  });

  it('РАЗВЕРНУВШИСЬ, ЭСКАДРА ТЕРЯЕТ ЖИВОЙ СЛЕД: у обратной ноги снова есть расписание', () => {
    const s = advance(apply(world(2), order), 1);
    const st = (s.strikes ?? [])[0];
    expect(st?.leg).toBe('back');
    expect(st?.at).toBeUndefined();
  });

  it('УДАР ПО МИРУ ПОГОНЕЙ НЕ СТАЛ: мир не двигается, и живого следа у такого вылета нет', () => {
    const s = apply(world(40), {
      ...order,
      id: 'a2',
      payload: { planetId: 'A', squadronId: 'sq:hunt', targetPlanetId: 'B' },
    });
    expect((s.strikes ?? [])[0]?.at).toBeUndefined();
  });
});

describe('PVR-6.20 — павший от удара челноков засчитывается хозяину вылета', () => {
  it('`unit.died` несёт `killedBy` владельца эскадры', () => {
    const s = apply(world(40), order);
    s.fleets.E1!.units = [{ unit: 'cruiser', count: 2, hp: 101 }]; // второй корпус — на 1 hp
    const r = kernel.advanceTo(s, { now: s.time + 6 * MS_PER_HOUR, data });
    if (!r.ok) throw new Error('advance failed');
    const deaths = r.events.filter((e) => e.type === 'unit.died').map((e) => e.payload);
    expect(deaths).toEqual([expect.objectContaining({ owner: 'p2', killedBy: 'p1' })]);
  });
});
