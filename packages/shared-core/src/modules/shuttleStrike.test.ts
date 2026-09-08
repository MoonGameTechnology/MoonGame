/**
 * УДАР ЧЕЛНОКОВ (SHU-1.2) — «вылетел, ударил, сразу домой».
 *
 * Заказ владельца 2026-09-08: челноки бьют НАПРЯМУЮ от своего узла до цели, минуя линии
 * между узлами, в бой не вступают и возвращаются туда, откуда вылетели. Отсюда правила:
 *
 * 1. **Вылет только из живого порта.** Нет порта — `E_NO_PORT`; порт повреждён более чем
 *    на 30% — `E_PORT_DAMAGED`. Порог именно на ВЫЛЕТ: возврату он не мешает, иначе
 *    челнок повис бы в пустоте, а такой сущности в модели нет.
 * 2. **Дальше радиуса не бьют.** `strikeRange` считается от узла базирования, а не от
 *    самой машины: у челнока нет своей позиции, пока он в порту.
 * 3. **Удар односторонний.** Цель получает урон, боя не начинается (`battleId` не
 *    появляется), ответного огня нет — та же семантика, что у артиллерийского standoff.
 * 4. **Возврат в ТОТ ЖЕ порт.** Стеки уходят из ангара на время полёта и возвращаются в
 *    него же; порта не стало, пока летели — челноки гибнут вместе с ним.
 * 5. **Топливо тратится на вылет, перезарядка идёт в порту.** Кончилось — `E_NO_FUEL`
 *    до конца перезарядки. Счётчик принадлежит ПОРТУ: челноки в ангаре — стеки без своей
 *    личности, топливо на стеке запретило бы им сливаться.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      // speed 100 map units/hour, радиус 180 — до B (100) достаёт, до C (300) нет.
      stats: { attack: 12, defense: 3, speed: 100, hp: 10, strikeRange: 180, fuel: 2, rearmRounds: 2 },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
    mine: { name: 'Mine', cost: {}, buildTimeHours: 0, hp: 20 },
  },
  events: {},
});

const kernel = createKernel([constructionModule, shuttleModule]);
const at = (s: GameState): Context => ({ now: s.time, data });

const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

const planet = (
  id: string,
  owner: string | null,
  x: number,
  buildings: Array<[string, number]> = [],
): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
  garrison: [],
  traits: [],
});

const fleet = (id: string, owner: string, location: string, hp?: number): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: [{ unit: 'cruiser', count: 1, ...(hp === undefined ? {} : { hp }) }],
  traits: [],
  battleId: null,
});

/** Мир: свой порт A(0) с челноками, чужой флот у B(100) — в радиусе, и C(300) — вне его. */
function world(over: { portHp?: number; hangar?: number } = {}): GameState {
  const s = createInitialState({ seed: 'shu2', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, [['spaceport', over.portHp ?? 30]]);
  home.hangar = [{ unit: 'interceptor', count: over.hangar ?? 2 }];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      B: planet('B', 'p2', 100, [['mine', 20]]),
      C: planet('C', 'p2', 300, [['mine', 20]]),
    },
    fleets: { E1: fleet('E1', 'p2', 'B'), FAR: fleet('FAR', 'p2', 'C') },
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const strike = (
  target: { targetFleetId: string } | { targetPlanetId: string },
  count = 1,
  planetId = 'A',
): Action => ({
  id: `a:${seq++}`,
  type: 'shuttle.strike',
  playerId: 'p1',
  payload: { planetId, unit: 'interceptor', count, ...target },
  issuedAt: 0,
});

function apply(state: GameState, action: Action): GameState {
  const r = kernel.applyAction(state, action, at(state));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(state: GameState, action: Action): string | null {
  const r = kernel.applyAction(state, action, at(state));
  return r.ok ? null : r.code;
}
function advance(state: GameState, hours: number): GameState {
  const r = kernel.advanceTo(state, { now: state.time + hours * 3_600_000, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const hangar = (s: GameState, id = 'A'): number =>
  (s.planets[id]?.hangar ?? []).reduce((n, st) => n + st.count, 0);
const hullOf = (s: GameState, id: string): number | undefined => s.fleets[id]?.units[0]?.hp;

describe('удар челноков — вылет (правила 1–2, 5)', () => {
  it('нет порта — вылет отбивается', () => {
    const s = world();
    s.planets.A!.buildings = [];
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBe('E_NO_PORT');
  });

  it('ПОРТ ПОВРЕЖДЁН БОЛЬШЕ ЧЕМ НА 30% — ВЫЛЕТА НЕТ', () => {
    // 30 hp максимум: 20 — это потеря 33%, порт уже не выпускает.
    expect(code(world({ portHp: 20 }), strike({ targetFleetId: 'E1' }))).toBe('E_PORT_DAMAGED');
    // 21 hp — потеря 30%, ровно на границе: порог «БОЛЕЕ чем на 30%» её пропускает.
    expect(code(world({ portHp: 21 }), strike({ targetFleetId: 'E1' }))).toBeNull();
  });

  it('челноков в ангаре меньше, чем послали — отказ', () => {
    expect(code(world({ hangar: 1 }), strike({ targetFleetId: 'E1' }, 2))).toBe('E_NOT_ENOUGH');
  });

  it('ДАЛЬШЕ РАДИУСА НЕ БЬЮТ: цель за strikeRange от узла базирования', () => {
    expect(code(world(), strike({ targetFleetId: 'FAR' }))).toBe('E_OUT_OF_RANGE');
  });

  it('по своим не бьют', () => {
    const s = world();
    s.fleets.E1!.owner = 'p1';
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBe('E_NOT_HOSTILE');
  });

  it('вылет ЗАБИРАЕТ челноки из ангара и ставит удар в полёт', () => {
    const s = apply(world(), strike({ targetFleetId: 'E1' }, 2));
    expect(hangar(s)).toBe(0);
    expect(s.strikes).toHaveLength(1);
    expect(s.strikes?.[0]?.leg).toBe('out');
  });

  it('ТОПЛИВО ТРАТИТСЯ НА ВЫЛЕТ, а кончившись — запирает порт до перезарядки', () => {
    let s = world({ hangar: 4 });
    s = apply(s, strike({ targetFleetId: 'E1' })); // fuel 2 → 1
    s = apply(s, strike({ targetFleetId: 'E1' })); // fuel 1 → 0, порт на перезарядке
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBe('E_NO_FUEL');
  });
});

describe('удар челноков — попадание и возврат (правила 3–4)', () => {
  it('УДАР ОДНОСТОРОННИЙ: цель получает урон, боя не начинается', () => {
    const s = apply(world(), strike({ targetFleetId: 'E1' }, 2));
    const after = advance(s, 2); // 100 ед. пути на скорости 100 = час туда
    expect(hullOf(after, 'E1')).toBeLessThan(100);
    expect(after.fleets.E1?.battleId ?? null).toBeNull();
    expect(Object.keys(after.battles)).toEqual([]);
  });

  it('по МИРУ бьют здания (как бомбардировка), а не гарнизон', () => {
    const s = apply(world(), strike({ targetPlanetId: 'B' }, 2));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp ?? 0).toBeLessThan(20);
  });

  it('ЧЕЛНОКИ ВОЗВРАЩАЮТСЯ В ТОТ ЖЕ ПОРТ', () => {
    const s = apply(world(), strike({ targetFleetId: 'E1' }, 2));
    const after = advance(s, 4); // час туда + час обратно, с запасом
    expect(hangar(after)).toBe(2);
    expect(after.strikes ?? []).toHaveLength(0);
  });

  it('ПОРТА НЕ СТАЛО, ПОКА ЛЕТЕЛИ — челноки гибнут вместе с ним', () => {
    let s = apply(world(), strike({ targetFleetId: 'E1' }, 2));
    s = { ...s, planets: { ...s.planets, A: { ...s.planets.A!, buildings: [] } } };
    const after = advance(s, 4);
    expect(hangar(after)).toBe(0);
    expect(after.strikes ?? []).toHaveLength(0);
  });

  it('ПЕРЕЗАРЯДКА ИДЁТ В ПОРТУ: отстоявшись, он снова выпускает', () => {
    let s = world({ hangar: 4 });
    s = apply(s, strike({ targetFleetId: 'E1' }));
    s = apply(s, strike({ targetFleetId: 'E1' })); // топливо кончилось
    s = advance(s, 4); // вернулись + отстояли перезарядку (rearmRounds 2 часа)
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBeNull();
  });
});
