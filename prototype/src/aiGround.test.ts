// AI-BAL-3: наземная армия и десант у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется и почему. В батче на 300 матчей все четыре наземных юнита
// показывались «мёртвым контентом», а наземных боёв не было ни одного — и причина
// оказалась не в эвристике, а в ГЕЙТЕ: наземное производство открывает казарма
// (`enablesGroundConstruction`), стартовый мир её не получает, поэтому каждый заказ
// пехоты ядро отбивало кодом `E_NO_GROUND_FACILITY`. Отказ тихий — харнес просто
// пропускает неудачное действие, — и в отчёте это читалось как «бот не хочет пехоту».
// Второй половиной той же дыры был штурм: приказ `fleet.assault` бот не отдавал НИКОГДА
// (в сети штурм ведёт драйвер `serverAutoAssaultActions`, а он ходит только по флотам с
// игроцким флагом `order.auto`), поэтому гарнизонный мир был для бота непроходим.
//
// Тесты ниже пиннят цепочку целиком: казарма → войска → погрузка → штурм, плюс границу
// профиля (игровой бот ничего этого не делает) и якорь дома, на котором цепочка стоит.
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
/** Заказы построек данного типа — с планетой, на которой их разместили. */
const built = (actions: Action[], building: string): string[] =>
  only(actions, 'building.construct')
    .map((a) => a.payload as { planetId: string; building: string })
    .filter((p) => p.building === building)
    .map((p) => p.planetId);
const unitOrders = (actions: Action[]): Array<{ planetId: string; unit: string; count: number }> =>
  only(actions, 'unit.build').map((a) => a.payload as { planetId: string; unit: string; count: number });
const loads = (actions: Action[]): Array<{ unit: string; count: number }> =>
  only(actions, 'army.load').map((a) => a.payload as { fleetId: string; unit: string; count: number });

const GROUND = ['militia', 'heavy_infantry', 'special_forces', 'tank'];

/** Домашний мир места (тот, где стоит космопорт). */
const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => b.type === 'spaceport'),
  )!.id;

/** Кладёт мир `patch` в состояние, сохраняя остальные. */
function withPlanet(s: GameState, id: string, patch: Partial<GameState['planets'][string]>): GameState {
  return { ...s, planets: { ...s.planets, [id]: { ...s.planets[id]!, ...patch } } };
}

/** Флот-фикстура на орбите мира: ровно те поля, которые читает `aiOrders`. */
function fleetAt(
  id: string,
  location: string,
  units: Array<{ unit: string; count: number }>,
  landing: Array<{ unit: string; count: number }> = [],
): GameState['fleets'][string] {
  return {
    id,
    owner: 'p2',
    location,
    units,
    landing,
    traits: [],
    movement: null,
    orbit: 'near',
  };
}

describe('AI-BAL-3 — наземная армия и десант (тест-профиль)', () => {
  it('строит КАЗАРМУ: без неё ядро отбивает любой наземный заказ', () => {
    const s = game2();
    expect(built(aiOrders(s, 'p2', 'expand', 'test'), 'barracks')).toContain(homeOf(s, 'p2'));
  });

  it('с казармой заказывает наземные войска дома', () => {
    const s = game2();
    const home = homeOf(s, 'p2');
    const withYard = withPlanet(s, home, {
      buildings: [...s.planets[home]!.buildings, { type: 'barracks', level: 1, hp: 25 }],
      garrison: [],
    });
    const ground = unitOrders(aiOrders(withYard, 'p2', 'expand', 'test')).filter((o) =>
      GROUND.includes(o.unit),
    );
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.every((o) => o.planetId === home)).toBe(true);
  });

  it('пустой дом получает ОБОРОНИТЕЛЬНЫЙ род войск, а не ударный', () => {
    // Гарнизон держит тот, у кого выше defense: тяжёлая пехота (20) против танка (14).
    const s = game2();
    const home = homeOf(s, 'p2');
    const withYard = withPlanet(s, home, {
      buildings: [...s.planets[home]!.buildings, { type: 'barracks', level: 1, hp: 25 }],
      garrison: [],
    });
    const ground = unitOrders(aiOrders(withYard, 'p2', 'expand', 'test')).filter((o) =>
      GROUND.includes(o.unit),
    );
    expect(ground[0]!.unit).toBe('heavy_infantry');
  });

  it('ИГРОВОЙ бот в мирное время не строит ни казарму, ни пехоту', () => {
    const s = game2();
    const orders = aiOrders(s, 'p2', 'expand');
    expect(built(orders, 'barracks')).toHaveLength(0);
    expect(unitOrders(orders).filter((o) => GROUND.includes(o.unit))).toHaveLength(0);
    expect(loads(orders)).toHaveLength(0);
  });

  it('десант грузится по вместимости трюма, но домашняя стража остаётся', () => {
    const s = game2();
    const home = homeOf(s, 'p2');
    // 7 наземных дома, домашняя стража — 3 ⇒ увезти можно ровно 4, и трюм крейсера (5)
    // это позволяет. Порядок погрузки — от ударного к дешёвому.
    const staged = withPlanet(s, home, {
      garrison: [
        { unit: 'militia', count: 6 },
        { unit: 'heavy_infantry', count: 1 },
      ],
    });
    // Флоты подменяются ЦЕЛИКОМ: стартовый флот стоит дома, а два флота на одном узле
    // бот сперва сливает в один и в этот тик их не трогает (`skipMove`) — погрузка
    // случилась бы только следующим тиком, и тест мерил бы слияние, а не погрузку.
    const withFleet: GameState = {
      ...staged,
      fleets: { 'f:test': fleetAt('f:test', home, [{ unit: 'cruiser', count: 1 }]) },
    };
    const lifted = loads(aiOrders(withFleet, 'p2', 'expand', 'test'));
    expect(lifted.reduce((n, l) => n + l.count, 0)).toBe(4);
    expect(lifted[0]!.unit).toBe('heavy_infantry'); // тяжёлое вперёд
  });

  it('трюм не переполняется: маленький корпус увозит ровно свою вместимость', () => {
    const s = game2();
    const home = homeOf(s, 'p2');
    const staged = withPlanet(s, home, { garrison: [{ unit: 'militia', count: 9 }] });
    const withFleet: GameState = {
      ...staged,
      // scout: cargoCapacity 1
      fleets: { 'f:small': fleetAt('f:small', home, [{ unit: 'scout', count: 1 }]) },
    };
    expect(loads(aiOrders(withFleet, 'p2', 'expand', 'test')).reduce((n, l) => n + l.count, 0)).toBe(1);
  });

  it('ШТУРМУЕТ гарнизонный вражеский мир — но только имея десант в трюме', () => {
    const s = game2();
    const target = homeOf(s, 'p1'); // чужой мир с живым гарнизоном
    const atWar: GameState = { ...s, diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' } };
    const fleet = (landing: Array<{ unit: string; count: number }>): GameState => ({
      ...atWar,
      fleets: { 'f:strike': fleetAt('f:strike', target, [{ unit: 'cruiser', count: 2 }], landing) },
    });
    const withTroops = only(aiOrders(fleet([{ unit: 'militia', count: 2 }]), 'p2', 'expand', 'test'), 'fleet.assault');
    expect(withTroops).toHaveLength(1);
    expect((withTroops[0]!.payload as { fleetId: string }).fleetId).toBe('f:strike');
    expect(only(aiOrders(fleet([]), 'p2', 'expand', 'test'), 'fleet.assault')).toHaveLength(0);
  });

  it('ИГРОВОЙ бот штурма не отдаёт — второй фазой захвата ведает драйвер игрока', () => {
    const s = game2();
    const target = homeOf(s, 'p1');
    const staged: GameState = {
      ...s,
      diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
      fleets: {
        'f:strike': fleetAt('f:strike', target, [{ unit: 'cruiser', count: 2 }], [
          { unit: 'militia', count: 2 },
        ]),
      },
    };
    expect(only(aiOrders(staged, 'p2', 'expand'), 'fleet.assault')).toHaveLength(0);
  });
});

// Якорь «дома» — общий для ОБОИХ профилей: это не эвристика, а починка бага.
describe('AI-BAL-3 — дом бота стоит на ВЕРФИ, а не на первом застроенном мире', () => {
  /** Кладёт застроенный призовой мир ПЕРВЫМ ключом — так же, как в живом матче он
   *  оказывается раньше домашнего при обходе `Object.values(state.planets)`. */
  function prizeFirst(s: GameState, seat: string): GameState {
    const prize = Object.values(s.planets).find((p) => p.owner === null && p.kind === 'planet')!;
    const owned = { ...prize, owner: seat, buildings: [{ type: 'mine', level: 1, hp: 20 }] };
    return {
      ...s,
      planets: Object.fromEntries([
        [prize.id, owned],
        ...Object.entries(s.planets).filter(([id]) => id !== prize.id),
      ]) as GameState['planets'],
    };
  }

  it('корабли заказываются на мире с космопортом (иначе — E_NO_SHIPYARD весь матч)', () => {
    // Раньше `base` был «первый owned-мир с постройками»: одна шахта на призовом мире
    // переносила дом туда, и ЛЮБОЙ заказ корабля отбивался ядром — флот переставал
    // пополняться. Проверяем игровой профиль: починка общая.
    const s = prizeFirst(game2(), 'p2');
    const home = homeOf(s, 'p2');
    const ships = unitOrders(aiOrders(s, 'p2', 'expand')).filter((o) => !GROUND.includes(o.unit));
    expect(ships.length).toBeGreaterThan(0);
    expect(ships.every((o) => o.planetId === home)).toBe(true);
  });
});
