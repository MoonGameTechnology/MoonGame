/**
 * ЧУЖОЙ ПАТРУЛЬ В ОБЗОРЕ (SHU-6.10) — обратная сторона обзора патруля (SHU-6.7).
 *
 * Рекомендация карточки владельцу 2026-10-04 («видно в обзоре», как самолёты в Conflict of
 * Nations): висящий чужой патруль виден кругом и составом, когда его точка в обзоре
 * зрителя или в его круге стоит флот зрителя. Летящий к точке и домой скрыт, как любой
 * чужой вылет, а база, эскадра, удержание и срок висения не видны никогда.
 *
 * Карта: мир p1 «A» в (0,0) с обзором 120 (общий по умолчанию); чужие точки — Q1 (100,0)
 * в этом обзоре и Q2 (400,0) вне его; обзор флота — 40, круг патруля — 60.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from '../modules/shuttle';
import { parseGameData, type GameData } from '../data/schemas';
import { pairKey } from './diplomacy';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type ShuttleStrike,
} from './gameState';
import { patrolsSeenBy, visibleState } from './visibility';
import type { Action } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    scout: { faction: 'x', stats: { attack: 2, defense: 2, speed: 6, hp: 40 } },
    missile: {
      faction: 'x',
      traits: ['immobile', 'issued', 'missile'],
      stats: { attack: 0, defense: 0, speed: 0, hp: 12 },
    },
    interceptor: {
      faction: 'x',
      traits: ['shuttle'],
      stats: {
        attack: 4,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 400,
        fuel: 3,
        rearmRounds: 2,
        shuttleDamage: 22,
        patrolHours: 4,
        patrolRadius: 60,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

const H = MS_PER_HOUR;
const Q1 = { x: 100, y: 0 };
const Q2 = { x: 400, y: 0 };

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

const planet = (id: string, owner: string | null, x: number, y: number): Planet => ({
  id,
  owner,
  position: { x, y },
  links: [],
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});

/** Флот p1 у мира `at` — разведчик, обзор флота 40. */
const scoutAt = (at: string): Fleet => ({
  id: 'eye',
  owner: 'p1',
  location: at,
  movement: null,
  units: [{ unit: 'scout', count: 1 }],
  traits: [],
  battleId: null,
});

/** Висящий патруль над `to`, собран руками: туман читает только состояние. Всё, что
 *  наблюдатель видеть не должен, заполнено — иначе проверка «не утекло» была бы пустой. */
const patrolOf = (
  to: { x: number; y: number },
  over: Partial<ShuttleStrike> = {},
): ShuttleStrike => ({
  id: 'strike:7',
  owner: 'p2',
  base: { kind: 'fleet', id: 'carrier' },
  squadronId: 'sq:p2:1',
  units: [{ unit: 'interceptor', count: 2, modules: ['afterburner'], hp: 15 }],
  target: { kind: 'point' },
  to: { ...to },
  departedAt: 3 * H,
  arrivesAt: 7 * H,
  leg: 'patrol',
  patrol: { hours: 4, radius: 60, hold: true },
  damage: 4,
  ...over,
});

function world(strikes: ShuttleStrike[], extra: Partial<GameState> = {}): GameState {
  const s = createInitialState({ seed: 'shu610', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: {
      A: planet('A', 'p1', 0, 0),
      // Пустые узлы для флота p1: в 50, ровно в 60 и в 70 от Q2.
      N50: planet('N50', null, 400, 50),
      N60: planet('N60', null, 400, 60),
      N70: planet('N70', null, 400, 70),
      B: planet('B', 'p3', 900, 900),
    },
    fleets: {},
    heroes: {},
    battles: {},
    ...(strikes.length > 0 ? { strikes } : {}),
    ...extra,
  };
}

const SEEN_AT_Q1 = { owner: 'p2', at: Q1, radius: 60, units: [{ unit: 'interceptor', count: 2 }] };

describe('SHU-6.10 — кого из чужих патрулей видит зритель', () => {
  it('ВИСЯЩИЙ В ОБЗОРЕ виден кругом и составом — без базы, эскадры, удержания и срока', () => {
    expect(patrolsSeenBy(world([patrolOf(Q1)]), 'p1', data)).toStrictEqual([SEEN_AT_Q1]);
  });

  it('ВНЕ ОБЗОРА не виден', () => {
    expect(patrolsSeenBy(world([patrolOf(Q2)]), 'p1', data)).toEqual([]);
  });

  it('ЛЕТЯЩИЙ К ТОЧКЕ И ДОМОЙ не виден даже в обзоре: налёт остаётся внезапным', () => {
    for (const leg of ['out', 'back'] as const) {
      expect(patrolsSeenBy(world([patrolOf(Q1, { leg })]), 'p1', data)).toEqual([]);
    }
  });

  it('ФЛОТ В КРУГЕ ПАТРУЛЯ его видит, хотя точка дальше обзора флота; граница включительна', () => {
    const at = (node: string) =>
      patrolsSeenBy(world([patrolOf(Q2)], { fleets: { eye: scoutAt(node) } }), 'p1', data);
    // До точки 50: обзор флота (40) её не берёт, а круг патруля (60) флот накрывает.
    expect(at('N50')).toStrictEqual([{ ...SEEN_AT_Q1, at: Q2 }]);
    expect(at('N60')).toHaveLength(1);
    expect(at('N70')).toEqual([]); // и круг не достаёт, и обзор
  });

  it('РАКЕТА в круге патруля его не выдаёт: она не глаз (SM-3.7b)', () => {
    // Ракета p1 сейчас в (380, 0): в 20 от точки Q2, глубоко в круге, вне обзора мира A.
    const missile: Fleet = {
      id: 'fleet:missile:0:1',
      owner: 'p1',
      location: null,
      movement: null,
      flight: { from: { x: 380, y: 0 }, to: { x: 420, y: 0 }, departedAt: 0, arrivesAt: 2 * H },
      units: [{ unit: 'missile', count: 1 }],
      traits: [],
      battleId: null,
    };
    const s = world([patrolOf(Q2)], { fleets: { [missile.id]: missile } });
    expect(patrolsSeenBy(s, 'p1', data)).toEqual([]);
  });

  it('СВОЙ — в `strikes`, а не здесь; СОЮЗНЫЙ виден союзнику, но не врагу', () => {
    expect(patrolsSeenBy(world([patrolOf(Q1, { owner: 'p1' })]), 'p1', data)).toEqual([]);
    // Патруль союзника p3 далеко от миров p1: его круг — в блоке зрения p1, и точка в нём.
    const allied = world([patrolOf(Q2, { owner: 'p3' })], {
      diplomacy: { [pairKey('p1', 'p3')]: 'alliance' },
    });
    expect(patrolsSeenBy(allied, 'p1', data)).toStrictEqual([{ ...SEEN_AT_Q1, owner: 'p3', at: Q2 }]);
    expect(patrolsSeenBy(allied, 'p2', data)).toEqual([]);
  });

  it('ПРОЕКЦИЯ: зритель получает `seenPatrols`, чужой вылет в `strikes` не попадает', () => {
    const s = world([patrolOf(Q1)]);
    const mine = visibleState(s, 'p1', data);
    expect(mine.seenPatrols).toStrictEqual([SEEN_AT_Q1]);
    expect(mine.strikes).toBeUndefined();
    // Хозяин видит свой патруль целиком в `strikes`, а `seenPatrols` у него нет.
    const owner = visibleState(s, 'p2', data);
    expect(owner.strikes?.map((st) => st.id)).toEqual(['strike:7']);
    expect(owner.seenPatrols).toBeUndefined();
    // Ничего не видно — поля нет вовсе.
    expect(visibleState(world([patrolOf(Q2)]), 'p1', data).seenPatrols).toBeUndefined();
  });
});

describe('SHU-6.10 — приёмка через ядро', () => {
  const kernel = createKernel([shuttleModule]);
  const act = (payload: Record<string, unknown>): Action => ({
    id: 'a:1',
    type: 'shuttle.patrol',
    playerId: 'p2',
    payload,
    issuedAt: 0,
  });
  const run = (s: GameState, hours: number): GameState => {
    const r = kernel.advanceTo(s, { now: hours * H, data });
    if (!r.ok) throw new Error('advance failed');
    return r.state;
  };

  it('чужой патруль появляется над точкой и пропадает, когда повернул домой', () => {
    // Порт p2 в 200 от Q1: два часа лёта при скорости 100, четыре часа висения.
    const port = planet('P', 'p2', 300, 0);
    port.buildings = [{ type: 'spaceport', level: 1, hp: 30 }];
    port.hangar = [{ id: 'sq:p2:1', units: [{ unit: 'interceptor', count: 2 }] }];
    const start = world([], {
      planets: { ...world([]).planets, P: port },
      diplomacy: { [pairKey('p1', 'p2')]: 'peace' },
    });
    const r = kernel.applyAction(start, act({ planetId: 'P', squadronId: 'sq:p2:1', at: Q1 }), {
      now: 0,
      data,
    });
    if (!r.ok) throw new Error(r.code);

    const flying = run(r.state, 1);
    expect(flying.strikes?.[0]?.leg).toBe('out');
    expect(visibleState(flying, 'p1', data).seenPatrols).toBeUndefined();

    const hanging = run(flying, 3);
    expect(hanging.strikes?.[0]?.leg).toBe('patrol');
    expect(visibleState(hanging, 'p1', data).seenPatrols).toStrictEqual([SEEN_AT_Q1]);

    const home = run(hanging, 7);
    expect(home.strikes?.[0]?.leg).toBe('back');
    expect(visibleState(home, 'p1', data).seenPatrols).toBeUndefined();
  });
});
