// AI-BAL-2: оборона и удержание миров у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. В базовой линии мертвы были `fort`, `hospital`, `orbital_aa`, а
// миры переходили из рук в руки по 113 раз за матч — и почти все переходы шли ПРИЛЁТОМ:
// `captureOnArrival` не смотрит ни на здания, ни на их оборонный бонус, только на
// `garrison.some(count > 0)`. Поэтому «удержание» здесь — это ДВА разных механизма, и
// тесты держат оба порознь:
//   • гарнизон на занятом мире (флот оставляет одного бойца) — он и запрещает прилёт;
//   • оборонительные здания — они делают ШТУРМ дорогим (`defenseBonus` через хук
//     `combat.damage`, `healRate` между штурмами, `aaDamage` по флоту на орбите).
//
// Оборона строится только НА ВОЙНЕ. Это не вкус: в мирное время та же цепочка укорачивала
// матч (4.7 → 3.6 дня) и вдвое срезала флот — у зданий есть `scoreValue`, поэтому бот
// начинал выигрывать гонку ОЧКОВ постройками вместо того, чтобы воевать.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const builtTypes = (actions: Action[]): string[] =>
  only(actions, 'building.construct').map((a) => (a.payload as { building: string }).building);
const unloads = (actions: Action[]): Array<{ unit: string; count: number }> =>
  only(actions, 'army.unload').map((a) => a.payload as { fleetId: string; unit: string; count: number });

const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => b.type === 'spaceport'),
  )!.id;

/** Состояние в состоянии войны + богатая казна: оборона должна быть ПО КАРМАНУ, иначе
 *  тест мерил бы бедность бота, а не его правило. */
function atWar(s: GameState): GameState {
  return {
    ...s,
    diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: { credits: 4000, metal: 6000, food: 500, energy: 500, microelectronics: 200 },
      },
    },
  };
}

describe('AI-BAL-2 — оборонительные здания (тест-профиль)', () => {
  it('на войне ставит ФОРТ на призовом мире', () => {
    expect(builtTypes(aiOrders(atWar(game2()), 'p2', 'expand', 'test'))).toContain('fort');
  });

  it('в мирное время оборону не строит — иначе выигрывает гонку очков вместо войны', () => {
    const rich: GameState = {
      ...game2(),
      players: {
        ...game2().players,
        p2: {
          ...game2().players.p2!,
          resources: { credits: 4000, metal: 6000, food: 500, energy: 500, microelectronics: 200 },
        },
      },
    };
    const types = builtTypes(aiOrders(rich, 'p2', 'expand', 'test'));
    for (const b of ['fort', 'hospital', 'orbital_aa']) expect(types).not.toContain(b);
  });

  it('цепочка идёт по порядку: форт стоит → заказывается госпиталь', () => {
    const s = atWar(game2());
    const home = homeOf(s, 'p2');
    const withFort: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [home]: {
          ...s.planets[home]!,
          buildings: [...s.planets[home]!.buildings, { type: 'fort', level: 1, hp: 40 }],
        },
      },
    };
    const types = builtTypes(aiOrders(withFort, 'p2', 'expand', 'test'));
    expect(types).toContain('hospital');
    expect(types).not.toContain('fort'); // дважды одно и то же не заказывается
  });

  it('ИГРОВОЙ бот обороны не строит даже на войне', () => {
    const types = builtTypes(aiOrders(atWar(game2()), 'p2', 'expand'));
    for (const b of ['fort', 'hospital', 'orbital_aa']) expect(types).not.toContain(b);
  });
});

describe('AI-BAL-2 — гарнизон на занятом мире', () => {
  /** Свой мир БЕЗ гарнизона + флот на нём с десантом в трюме. */
  function heldEmpty(s: GameState, landingCount: number): GameState {
    const spare = Object.values(s.planets).find((p) => p.owner === null && p.kind === 'planet')!;
    return {
      ...s,
      planets: { ...s.planets, [spare.id]: { ...spare, owner: 'p2', garrison: [] } },
      fleets: {
        'f:hold': {
          id: 'f:hold',
          owner: 'p2',
          location: spare.id,
          units: [{ unit: 'cruiser', count: 1 }],
          landing: landingCount > 0 ? [{ unit: 'militia', count: landingCount }] : [],
          traits: [],
          movement: null,
          orbit: 'near',
        } as GameState['fleets'][string],
      },
    };
  }

  it('оставляет ОДНОГО бойца — мир без войск берётся прилётом, со взводом надо штурмовать', () => {
    const dropped = unloads(aiOrders(heldEmpty(game2(), 4), 'p2', 'expand', 'test'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.count).toBe(1); // не весь десант: остальное нужно самому флоту
  });

  it('не разгружается там, где гарнизон уже есть', () => {
    const s = heldEmpty(game2(), 4);
    const held = Object.values(s.planets).find((p) => p.owner === 'p2' && p.garrison.length === 0)!;
    const garrisoned: GameState = {
      ...s,
      planets: {
        ...s.planets,
        [held.id]: { ...held, garrison: [{ unit: 'militia', count: 1 }] },
      },
    };
    expect(unloads(aiOrders(garrisoned, 'p2', 'expand', 'test'))).toHaveLength(0);
  });

  it('пустой трюм — нечего оставлять, приказа нет', () => {
    expect(unloads(aiOrders(heldEmpty(game2(), 0), 'p2', 'expand', 'test'))).toHaveLength(0);
  });

  it('ИГРОВОЙ бот гарнизоны не расставляет', () => {
    expect(unloads(aiOrders(heldEmpty(game2(), 4), 'p2', 'expand'))).toHaveLength(0);
  });
});
