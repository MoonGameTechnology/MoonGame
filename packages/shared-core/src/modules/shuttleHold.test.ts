/**
 * «ДЕРЖАТЬ ПАТРУЛЬ» (SHU-6.6) — приёмка кирпича.
 *
 * Резолюция владельца 2026-10-04 (`shuttles-roadmap.md` §0.7): патруль заменяет дежурный
 * вылет. Флаг удержания у патруля — после возврата и перезарядки эскадра встаёт снова
 * сама: у мира — в ту же точку, у корабля — над его живой позицией. Поднимает её событие
 * ядра, а не драйвер хоста, поэтому всё ниже проверяется голым `advanceTo` — так мир
 * живёт, пока игрок офлайн.
 *
 * База — обе формы (уточнение владельца «учти наши базы, в виде трюмов»): мир с портом и
 * корабль с трюмом, в том числе идущий.
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
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, DomainEvent } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    freighter: { faction: 'x', stats: { attack: 0, defense: 0, speed: 10, hp: 100 } },
    // Носитель: трюм на 4 места — база, которая ходит.
    carrier: { faction: 'x', stats: { attack: 0, defense: 9, speed: 100, hp: 40, cargoCapacity: 4 } },
    // От A(0,0) до точки (150,0) — полтора часа; 4 ч в круге — дома через 7 ч. Запаса
    // вылетов три: удерживаемый патруль встаёт снова в минуту посадки.
    interceptor: shuttle({
      attack: 4,
      defense: 3,
      speed: 100,
      hp: 10,
      strikeRange: 180,
      fuel: 3,
      rearmRounds: 2,
      patrolHours: 4,
      patrolRadius: 60,
    }),
    // Один вылет и десять часов перезарядки, 2 ч в круге: дома через 5 ч, а встать снова
    // может только в 10 ч — удержанию есть чего ждать.
    sentry: shuttle({
      attack: 4,
      defense: 3,
      speed: 100,
      hp: 10,
      strikeRange: 180,
      fuel: 1,
      rearmRounds: 10,
      patrolHours: 2,
      patrolRadius: 60,
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

const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

const planet = (id: string, owner: string | null, x: number, y: number, port = false): Planet => ({
  id,
  owner,
  position: { x, y },
  resources: {},
  buildings: port ? [{ type: 'spaceport', level: 1, hp: 30 }] : [],
  garrison: [],
  traits: [],
});

const sq = (id: string, unit: string, count: number): Squadron => ({ id, units: [{ unit, count }] });

/** Свой порт A(0,0) с заданным ангаром и чужой порт Z — больше ничего. */
function world(hangar: Squadron[]): GameState {
  const s = createInitialState({ seed: 'shu66', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, 0, true);
  home.hangar = hangar;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: { A: home, Z: planet('Z', 'p2', 0, 900, true) },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

/** Свой носитель с ангаром: стоит на узле HOME(0,0) — или идёт HOME → FAR(3000,0) по 100
 *  ед/час, если `moving`. */
function withCarrier(hangar: Squadron[], moving = false): GameState {
  const s = world([]);
  const cv: Fleet = {
    id: 'CV',
    owner: 'p1',
    location: moving ? null : 'HOME',
    movement: moving ? { from: 'HOME', to: 'FAR', departedAt: 0, arrivesAt: 30 * H } : null,
    units: [{ unit: 'carrier', count: 1 }],
    traits: [],
    battleId: null,
    hangar,
  };
  return {
    ...s,
    planets: { ...s.planets, HOME: planet('HOME', 'p1', 0, 0), FAR: planet('FAR', 'p1', 3000, 0) },
    fleets: { CV: cv },
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
/** Патруль с удержанием («Держать патруль» в приказе). */
const held = (
  squadronId: string,
  at: { x: number; y: number } = P,
  base: Record<string, string> = { planetId: 'A' },
): Action => act('shuttle.patrol', { ...base, squadronId, at, hold: true });
const holdStrike = (strikeId: string, on: boolean, playerId = 'p1'): Action =>
  act('shuttle.hold', { strikeId, on }, playerId);

function apply(s: GameState, a: Action): GameState {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(s: GameState, a: Action): string | null {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  return r.ok ? null : r.code;
}
/** Довести мир до `hours` часов от начала партии ОДНИМ вызовом — как живёт мир, пока
 *  игрок офлайн. */
function run(s: GameState, hours: number): { state: GameState; events: DomainEvent[] } {
  const r = kernel.advanceTo(s, { now: hours * H, data });
  if (!r.ok) throw new Error('advance failed');
  return { state: r.state, events: r.events };
}
const until = (s: GameState, hours: number): GameState => run(s, hours).state;

const payloads = (events: DomainEvent[], type: string): Array<Record<string, unknown>> =>
  events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const patrolOf = (s: GameState) => (s.strikes ?? []).find((st) => st.target.kind === 'point');
const hangarOf = (s: GameState, id = 'A') => s.planets[id]?.hangar ?? s.fleets[id]?.hangar ?? [];
const resumes = (s: GameState) =>
  s.scheduled.filter((e) => e.type === 'shuttle.patrol.resume').map((e) => e.at / H);

describe('SHU-6.6 — приказ «Держать патруль»', () => {
  it('ФЛАГ В ПРИКАЗЕ: патруль уходит с удержанием', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), held('sq:i'));
    expect(patrolOf(s)?.patrol).toEqual({ hours: 4, radius: 60, hold: true });
    expect(code(world([sq('sq:i', 'interceptor', 2)]), act('shuttle.patrol', {
      planetId: 'A',
      squadronId: 'sq:i',
      at: P,
      hold: 'yes',
    }))).toBe('E_BAD_PAYLOAD');
  });

  it('ВКЛЮЧИТЬ И СНЯТЬ У ПАТРУЛЯ В ВОЗДУХЕ — и в пути к точке, и в круге', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), act('shuttle.patrol', {
      planetId: 'A',
      squadronId: 'sq:i',
      at: P,
    }));
    const id = patrolOf(s)!.id;
    const on = apply(s, holdStrike(id, true));
    expect(patrolOf(on)?.patrol?.hold).toBe(true);
    const off = apply(on, holdStrike(id, false));
    expect(patrolOf(off)?.patrol).toEqual({ hours: 4, radius: 60 });
    // В круге — то же самое.
    const circling = until(s, 2);
    expect(patrolOf(circling)?.leg).toBe('patrol');
    expect(patrolOf(apply(circling, holdStrike(id, true)))?.patrol?.hold).toBe(true);
  });

  it('ПОВЕРНУВШИЙ ДОМОЙ ВКЛЮЧИТЬ НЕЛЬЗЯ, СНЯТЬ — МОЖНО; чужой вылет — как несуществующий', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), held('sq:i'));
    const id = patrolOf(s)!.id;
    const back = until(s, 6);
    expect(patrolOf(back)?.leg).toBe('back');
    expect(code(back, holdStrike(id, true))).toBe('E_NOT_PATROLLING');
    expect(patrolOf(apply(back, holdStrike(id, false)))?.patrol?.hold).toBeUndefined();
    expect(code(s, holdStrike(id, true, 'p2'))).toBe('E_NO_STRIKE');
    expect(code(s, holdStrike('strike:nope', true))).toBe('E_NO_STRIKE');
    expect(code(s, act('shuttle.hold', { strikeId: id }))).toBe('E_BAD_PAYLOAD'); // без `on`
    expect(code(s, act('shuttle.hold', { strikeId: id, squadronId: 'sq:i', on: false }))).toBe(
      'E_BAD_PAYLOAD',
    );
  });

  it('УДАР — НЕ ПАТРУЛЬ: держать нечего', () => {
    let s = world([sq('sq:i', 'interceptor', 2)]);
    s = { ...s, planets: { ...s.planets, B: planet('B', 'p2', 100, 0) } };
    s = apply(s, act('shuttle.strike', { planetId: 'A', squadronId: 'sq:i', targetPlanetId: 'B' }));
    expect(code(s, holdStrike(s.strikes![0]!.id, true))).toBe('E_NOT_PATROLLING');
  });

  it('ОТЗЫВ СНИМАЕТ УДЕРЖАНИЕ: вернувшийся по отзыву патруль сам не встаёт', () => {
    const s = until(apply(world([sq('sq:i', 'interceptor', 2)]), held('sq:i')), 3);
    const recalled = apply(s, act('shuttle.recall', { strikeId: patrolOf(s)!.id }));
    expect(patrolOf(recalled)?.patrol?.hold).toBeUndefined();
    const later = until(recalled, 12);
    expect(later.strikes ?? []).toHaveLength(0);
    expect(hangarOf(later)).toEqual([sq('sq:i', 'interceptor', 2)]);
  });
});

describe('SHU-6.6 — приёмка: удерживаемый патруль сам встаёт снова, пока игрок офлайн', () => {
  it('ЕСТЬ ВЫЛЕТ — СНОВА В ВОЗДУХЕ В МИНУТУ ПОСАДКИ, в ту же точку', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), held('sq:i'));
    const { state, events } = run(s, 7);
    expect(payloads(events, 'shuttle.landed')).toHaveLength(1);
    const again = patrolOf(state);
    expect(again?.squadronId).toBe('sq:i');
    expect(again?.departedAt).toBe(7 * H);
    expect(again?.leg).toBe('out');
    expect(again?.to).toEqual(P);
    expect(again?.patrol).toEqual({ hours: 4, radius: 60, hold: true });
    expect(hangarOf(state)).toEqual([]);
    expect(state.planets.A?.sortie?.fuel).toBe(1); // второй вылет из трёх
  });

  it('НЕТ ВЫЛЕТА — ЖДЁТ РОВНО КОНЦА ПЕРЕЗАРЯДКИ и встаёт без единого приказа', () => {
    // Вылет в 0 ч сжёг единственное топливо: перезарядка 10 ч, до 10 ч. Точка в 125 ед —
    // дома эскадра в 4,5 ч, посреди часа: полчаса перезарядки сверх целых часов уже
    // отстояно (`carry`), и срок подъёма обязан их учесть, а не сдвинуться на 10,5 ч.
    const Q = { x: 125, y: 0 };
    const s = apply(world([sq('sq:s', 'sentry', 2)]), held('sq:s', Q));
    const waiting = until(s, 9.99);
    expect(waiting.strikes ?? []).toHaveLength(0);
    expect(hangarOf(waiting)).toEqual([{ ...sq('sq:s', 'sentry', 2), hold: { at: Q } }]);
    expect(resumes(waiting)).toEqual([10]);

    const { state, events } = run(s, 10); // один вызов: игрок не заходил ни разу
    expect(patrolOf(state)?.departedAt).toBe(10 * H);
    expect(patrolOf(state)?.to).toEqual(Q);
    expect(hangarOf(state)).toEqual([]);
    expect(payloads(events, 'shuttle.launched')).toHaveLength(1);
    // И так сутки подряд: встаёт в 10, 20 и 30 ч.
    expect(payloads(run(s, 30).events, 'shuttle.launched')).toHaveLength(3);
  });

  it('КОРАБЛЬ ДЕРЖИТ ПАТРУЛЬ НАД СОБОЙ: новый круг встаёт над его живой позицией', () => {
    // Носитель идёт на восток по 100 ед/час. Патруль из (0,0) к (0,150): 1,5 ч туда, 4 ч в
    // круге, обратно к носителю в (550,0) — √(550² + 150²) ≈ 570 ед, ≈ 5,7 ч. Сел около
    // 11,2 ч — и встал снова над тем местом, где носитель сейчас.
    const s = apply(
      withCarrier([sq('sq:cv', 'interceptor', 2)], true),
      held('sq:cv', { x: 0, y: 150 }, { fleetId: 'CV' }),
    );
    const landsAt = 5.5 + Math.hypot(550, 150) / 100;
    const before = until(s, landsAt - 0.01);
    expect(patrolOf(before)?.leg).toBe('back');
    const after = until(s, landsAt + 0.01);
    const again = patrolOf(after)!;
    expect(again.departedAt / H).toBeCloseTo(landsAt, 6);
    expect(again.base).toEqual({ kind: 'fleet', id: 'CV' });
    expect(again.to.x).toBeCloseTo(landsAt * 100, 3);
    expect(again.to.y).toBe(0);
    expect(again.patrol?.hold).toBe(true);
  });

  it('КОРАБЛЬ В БОЮ НЕ ВЫПУСКАЕТ — удержание пробует раз в час, а не снимается', () => {
    const s = apply(withCarrier([sq('sq:cv', 'interceptor', 2)]), held('sq:cv', { x: 0, y: 150 }, {
      fleetId: 'CV',
    }));
    const fighting = until(s, 6.9);
    fighting.fleets.CV!.battleId = 'b1';
    const landed = until(fighting, 7);
    expect(landed.strikes ?? []).toHaveLength(0);
    expect(hangarOf(landed, 'CV')).toEqual([{ ...sq('sq:cv', 'interceptor', 2), hold: {} }]);
    expect(resumes(landed)).toEqual([8]);
    // Бой всё ещё идёт в 8 ч — следующая попытка в 9 ч; кончился в 8,5 — встаёт в 9 ч.
    const still = until(landed, 8.5);
    expect(still.strikes ?? []).toHaveLength(0);
    expect(resumes(still)).toEqual([9]);
    still.fleets.CV!.battleId = null;
    expect(patrolOf(until(still, 9))?.departedAt).toBe(9 * H);
  });

  it('ПОДБИТЫЙ ПОРТ НЕ ВЫПУСКАЕТ — удержание ждёт ремонта по часу', () => {
    const s = apply(world([sq('sq:i', 'interceptor', 2)]), held('sq:i'));
    const hit = until(s, 6.9);
    hit.planets.A!.buildings[0]!.hp = 10; // треть корпуса — ниже порога вылета 70%
    const landed = until(hit, 7); // садиться подбитому порту можно: порог — на вылет
    expect(hangarOf(landed)[0]?.hold).toEqual({ at: P });
    expect(resumes(landed)).toEqual([8]);
    const repaired = until(landed, 8.2);
    repaired.planets.A!.buildings[0]!.hp = 30;
    expect(patrolOf(until(repaired, 9))?.departedAt).toBe(9 * H);
  });

  it('ПОМЕХА, КОТОРАЯ САМА НЕ ПРОЙДЁТ, СНИМАЕТ УДЕРЖАНИЕ ГРОМКО, а не будит мир вечно', () => {
    // Точка удержания за радиусом эскадры (180): ждать бессмысленно.
    const s = world([{ ...sq('sq:i', 'interceptor', 2), hold: { at: { x: 500, y: 0 } } }]);
    s.scheduled = [
      { id: 'evt:hold', at: H, type: 'shuttle.patrol.resume', payload: { owner: 'p1', squadronId: 'sq:i' }, seq: 0 },
    ];
    s.scheduleSeq = 1;
    const { state, events } = run(s, 1);
    expect(state.strikes ?? []).toHaveLength(0);
    expect(hangarOf(state)).toEqual([sq('sq:i', 'interceptor', 2)]);
    expect(resumes(state)).toEqual([]);
    expect(payloads(events, 'shuttle.hold.ended')).toEqual([
      { owner: 'p1', baseId: 'A', baseKind: 'planet', squadronId: 'sq:i', code: 'E_OUT_OF_RANGE' },
    ]);
  });

  it('НАРЕЗКА ВРЕМЕНИ НЕ МЕНЯЕТ ИСХОД: срок подъёма назначает расписание, а не хост', () => {
    const s = apply(world([sq('sq:s', 'sentry', 2)]), held('sq:s'));
    const whole = until(s, 26);
    let sliced = s;
    for (let t = 0.1; t <= 26.0001; t += 0.1) sliced = until(sliced, Math.round(t * 10) / 10);
    expect(sliced.strikes ?? []).toEqual(whole.strikes ?? []);
    expect(sliced.planets.A?.hangar).toEqual(whole.planets.A?.hangar);
    expect(sliced.planets.A?.sortie).toEqual(whole.planets.A?.sortie);
    // Третий круг (с 20 ч) отлетал и сел в 25 ч; следующий подъём — в 30 ч, при любой нарезке.
    expect(resumes(whole)).toEqual([30]);
    expect(resumes(sliced)).toEqual([30]);
  });

  it('ПОДЪЁМ — СОБЫТИЕ ХОЗЯИНА: в тумане сопернику срок не виден', () => {
    const waiting = until(apply(world([sq('sq:s', 'sentry', 2)]), held('sq:s')), 6);
    const own = visibleState(waiting, 'p1', data).scheduled.map((e) => e.type);
    const rival = visibleState(waiting, 'p2', data).scheduled.map((e) => e.type);
    expect(own).toContain('shuttle.patrol.resume');
    expect(rival).not.toContain('shuttle.patrol.resume');
  });
});

describe('SHU-6.6 — что снимает удержание у эскадры дома', () => {
  /** Эскадра дома с удержанием, ждёт перезарядки до 10 ч (вылет был в 0 ч, села в 5 ч). */
  const waiting = (hangar: Squadron[] = [sq('sq:s', 'sentry', 2)]): GameState =>
    until(apply(world(hangar), held('sq:s')), 6);

  it('СНЯТЬ ДОМА — и в 10 ч эскадра остаётся в ангаре', () => {
    const off = apply(waiting(), act('shuttle.hold', { planetId: 'A', squadronId: 'sq:s', on: false }));
    expect(hangarOf(off)).toEqual([sq('sq:s', 'sentry', 2)]);
    expect(until(off, 12).strikes ?? []).toHaveLength(0);
  });

  it('ДОМА ВКЛЮЧИТЬ НЕЛЬЗЯ: точку берут у патруля — для этого есть сам приказ патруля', () => {
    const s = world([sq('sq:s', 'sentry', 2)]);
    const home = (payload: Record<string, unknown>, playerId = 'p1') =>
      code(s, act('shuttle.hold', payload, playerId));
    expect(home({ planetId: 'A', squadronId: 'sq:s', on: true })).toBe('E_NOT_PATROLLING');
    expect(home({ planetId: 'A', fleetId: 'CV', squadronId: 'sq:s', on: false })).toBe('E_BAD_PAYLOAD');
    expect(home({ squadronId: 'sq:s', on: false })).toBe('E_BAD_PAYLOAD');
    expect(home({ planetId: 'A', on: false })).toBe('E_BAD_PAYLOAD');
    expect(home({ planetId: 'A', squadronId: 'sq:none', on: false })).toBe('E_NO_SQUADRON');
    expect(home({ planetId: 'NOPE', squadronId: 'sq:s', on: false })).toBe('E_NO_PLANET');
    expect(home({ planetId: 'A', squadronId: 'sq:s', on: false }, 'p2')).toBe('E_FORBIDDEN');
    // Корабль: чужой и несуществующий — один ответ (A06).
    const cv = withCarrier([{ ...sq('sq:cv', 'interceptor', 1), hold: {} }]);
    expect(code(cv, act('shuttle.hold', { fleetId: 'CV', squadronId: 'sq:cv', on: false }, 'p2'))).toBe(
      'E_NO_FLEET',
    );
    expect(code(cv, act('shuttle.hold', { fleetId: 'NOPE', squadronId: 'sq:cv', on: false }))).toBe(
      'E_NO_FLEET',
    );
  });

  it('СНЯТЬ МОЖНО И С КОРАБЛЯ В БОЮ: стоячий приказ снимается в любую минуту', () => {
    const cv = withCarrier([{ ...sq('sq:cv', 'interceptor', 1), hold: {} }]);
    cv.fleets.CV!.battleId = 'b1';
    const off = apply(cv, act('shuttle.hold', { fleetId: 'CV', squadronId: 'sq:cv', on: false }));
    expect(hangarOf(off, 'CV')).toEqual([sq('sq:cv', 'interceptor', 1)]);
  });

  it('ПЕРЕГРУЗКА НА КОРАБЛЬ СНИМАЕТ: над новой базой точки нет', () => {
    let s = waiting();
    s = {
      ...s,
      fleets: {
        CV: {
          id: 'CV',
          owner: 'p1',
          location: 'A',
          movement: null,
          units: [{ unit: 'carrier', count: 1 }],
          traits: [],
          battleId: null,
        },
      },
    };
    const loaded = apply(s, act('shuttle.load', { fleetId: 'CV', squadronId: 'sq:s' }));
    expect(hangarOf(loaded, 'CV')).toEqual([sq('sq:s', 'sentry', 2)]);
    expect(until(loaded, 12).strikes ?? []).toHaveLength(0);
  });

  it('ДЕЛЁЖ И СЛИЯНИЕ ЭСКАДР СНИМАЮТ: состав, который держал круг, больше не висит', () => {
    const split = apply(waiting(), act('shuttle.split', {
      planetId: 'A',
      squadronId: 'sq:s',
      units: [{ unit: 'sentry', count: 1 }],
    }));
    expect(hangarOf(split).map((q) => q.hold)).toEqual([undefined, undefined]);
    const pair = waiting([sq('sq:s', 'sentry', 2), sq('sq:t', 'sentry', 1)]);
    const merged = apply(pair, act('shuttle.merge', { planetId: 'A', squadronId: 'sq:t', intoId: 'sq:s' }));
    expect(hangarOf(merged)).toEqual([sq('sq:s', 'sentry', 3)]);
    expect(until(merged, 12).strikes ?? []).toHaveLength(0);
  });

  it('СЛИЯНИЕ ФЛОТОВ НЕ ТЕРЯЕТ УДЕРЖАНИЕ: трюм уехал в другой флот — патруль встаёт оттуда', () => {
    // Флот CV держит патруль и ждёт перезарядки; его сплавили в CV2 (`fuseFleets` переносит
    // трюм как есть). Событие подъёма назначено старой базе — эскадру ищут по id.
    const s = apply(
      withCarrier([sq('sq:cv', 'sentry', 2)]),
      held('sq:cv', { x: 0, y: 150 }, { fleetId: 'CV' }),
    );
    const home = until(s, 6);
    const cv = home.fleets.CV!;
    const fused: GameState = {
      ...home,
      fleets: {
        CV2: { ...cv, id: 'CV2', hangar: cv.hangar, sortie: undefined },
      },
    };
    const again = patrolOf(until(fused, 10))!;
    expect(again.departedAt).toBe(10 * H);
    expect(again.base).toEqual({ kind: 'fleet', id: 'CV2' });
    expect(again.patrol?.hold).toBe(true);
  });
});
