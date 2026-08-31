// AI-BAL-7: тактический репертуар ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. Из боевого репертуара ядра бот звал только `fleet.engage` и
// `fleet.assault`. Три приказа не звал НИКОГДА, и каждый уносил из измерения свой пласт:
//   • `fleet.retreat` — любой бой шёл до полного уничтожения одной из сторон. Размен
//     всегда полный, «потрёпанный флот» как состояние не существовал, а пошлина за выход
//     (40% ТЕКУЩЕГО корпуса) и скоростная фора беглеца не работали ни разу;
//   • `fleet.bombard` — осада не игралась вовсе, притом что флот, которому нечем взять
//     мир, и так стоял на его орбите: целеуказание каждый тик выдавало ему ближайшую
//     чужую цель — ту, под которой он стоит, — и `fleet.move` возвращался
//     `E_SAME_LOCATION`. Платил он при этом полную цену: ПВО бьёт по всему враждебному в
//     near-орбите независимо от того, бомбит гость или молчит;
//   • `fleet.split` — обратной операции к слиянию у бота не было, поэтому вся тактика
//     сводилась к одному кулаку: сколько бы кораблей ни было, они ходили одной стопкой.
//
// Четвёртый приказ из формулировки кирпича, `fleet.barrage`, боту не нужен — и это не
// пропуск, а вывод, устаревший в самом кирпиче: с AI-BAL-4 артиллерия стреляет САМА
// (`artilleryModule` каждым пролётом времени заставляет свободный стоящий флот с
// `artillery`-корпусом обстрелять ближайшего врага в радиусе; режим по умолчанию —
// `standard`, то есть «по войне»). `fleet.barrage` — это ФОКУС огня поверх авто-выбора,
// и лучшего критерия, чем «ближайший», у бота нет: приказ ничего не добавил бы к
// покрытию механики, зато был бы правилом ради метрики.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, Battle, Fleet, GameState } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const payloads = <T>(actions: Action[], type: string): T[] =>
  only(actions, type).map((a) => a.payload as T);

/** Домашний мир места (тот, где стоит космопорт). */
const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => b.type === 'spaceport'),
  )!.id;

function fleetAt(
  id: string,
  owner: string,
  location: string,
  units: Array<{ unit: string; count: number }>,
  extra: Partial<Fleet> = {},
): Fleet {
  return {
    id,
    owner,
    location,
    units,
    landing: [],
    traits: [],
    movement: null,
    orbit: 'near',
    ...extra,
  };
}

/** Война между местами — без неё цель «чужой мир» вообще не рассматривается. */
const atWar = (s: GameState): GameState => ({
  ...s,
  diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' },
});

/**
 * Идущий ОРБИТАЛЬНЫЙ бой между флотом p2 (`f:ours`) и флотом p1 (`f:foe`) над узлом
 * `at`. `weAttack` задаёт РОЛЬ нашего флота: в прогнозе роли решают всё — атакующий бьёт
 * `attack`, стоящая сторона отвечает `defense`, так что перепутать их значило бы
 * прогнозировать другой бой.
 */
function battleState(
  s: GameState,
  at: string,
  ours: Array<{ unit: string; count: number }>,
  foe: Array<{ unit: string; count: number }>,
  weAttack = true,
): GameState {
  const battle: Battle = {
    id: 'battle:1',
    location: at,
    phase: 'orbital',
    attacker: {
      ref: { kind: 'fleet', fleetId: weAttack ? 'f:ours' : 'f:foe' },
      owner: weAttack ? 'p2' : 'p1',
    },
    defender: {
      ref: { kind: 'fleet', fleetId: weAttack ? 'f:foe' : 'f:ours' },
      owner: weAttack ? 'p1' : 'p2',
    },
    round: 2,
  };
  return {
    ...atWar(s),
    battles: { 'battle:1': battle },
    fleets: {
      'f:ours': fleetAt('f:ours', 'p2', at, ours, { battleId: 'battle:1' }),
      'f:foe': fleetAt('f:foe', 'p1', at, foe, { battleId: 'battle:1' }),
    },
  };
}

/** Заведомо проигранный бой: один разведчик против пяти крейсеров. */
const HOPELESS = [{ unit: 'scout', count: 1 }];
const OVERWHELMING = [{ unit: 'cruiser', count: 5 }];

describe('AI-BAL-7 — флот умеет проиграть бой (`fleet.retreat`)', () => {
  it('из проигранного боя выходит И уходит с узла в тот же тик', () => {
    // Уход обязателен вместе с отступлением: `fleet.retreat` только распускает бой и
    // оставляет флот на месте рядом с освобождённым противником. Беглец, оставшийся
    // стоять, был бы втянут заново и платил бы пошлину каждые два часа — та же «драка
    // до нуля», только медленнее.
    const s = game2();
    const staged = battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING);
    const orders = aiOrders(staged, 'p2', 'expand', 'test');
    const retreat = payloads<{ fleetId: string }>(orders, 'fleet.retreat');
    expect(retreat).toHaveLength(1);
    expect(retreat[0]!.fleetId).toBe('f:ours');
    const away = payloads<{ fleetId: string; to: string }>(orders, 'fleet.move').find(
      (p) => p.fleetId === 'f:ours',
    );
    expect(away).toBeDefined();
    expect(staged.planets[away!.to]?.owner).toBe('p2'); // бежит к СВОЕМУ миру
  });

  it('порядок приказов: сперва выход из боя, потом курс', () => {
    // `fleet.move` отбивается кодом `E_FLEET_BUSY`, пока флот в бою, так что обратный
    // порядок тихо выродился бы в «отступил и остался стоять».
    const s = game2();
    const orders = aiOrders(
      battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING),
      'p2',
      'expand',
      'test',
    );
    const ourMove = orders.findIndex(
      (a) => a.type === 'fleet.move' && (a.payload as { fleetId: string }).fleetId === 'f:ours',
    );
    expect(orders.findIndex((a) => a.type === 'fleet.retreat')).toBeLessThan(ourMove);
  });

  it('ВЫИГРАННЫЙ бой держит, даже дорогой ценой', () => {
    // Размен, который заканчивается взятым узлом, — это плата за узел, а не убыток.
    const s = game2();
    const staged = battleState(s, homeOf(s, 'p1'), OVERWHELMING, HOPELESS);
    expect(only(aiOrders(staged, 'p2', 'expand', 'test'), 'fleet.retreat')).toHaveLength(0);
  });

  it('роль в бою учитывается: тот же состав ОБОРОНЯЯСЬ решается иначе', () => {
    // Прогноз считает роли (атака против обороны), поэтому одна и та же пара составов
    // может быть проигранной для нападающего и выигранной для стоящего — и наоборот.
    const s = game2();
    const asAttacker = battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING, true);
    const asDefender = battleState(s, homeOf(s, 'p1'), OVERWHELMING, HOPELESS, false);
    expect(only(aiOrders(asAttacker, 'p2', 'expand', 'test'), 'fleet.retreat')).toHaveLength(1);
    expect(only(aiOrders(asDefender, 'p2', 'expand', 'test'), 'fleet.retreat')).toHaveLength(0);
  });

  it('НАЗЕМНЫЙ бой не бросает — ядро десант из боя не выпускает', () => {
    // `fleet.retreat` отбивает сошедший на грунт десант кодом `E_CANNOT_RETREAT`, так
    // что приказ был бы чистым отказом; проверяем, что бот его не отдаёт.
    const s = game2();
    const at = homeOf(s, 'p1');
    const ground: Battle = {
      id: 'battle:g',
      location: at,
      phase: 'ground',
      attacker: { ref: { kind: 'landing', fleetId: 'f:ours' }, owner: 'p2' },
      defender: { ref: { kind: 'garrison', planetId: at }, owner: 'p1' },
      round: 2,
    };
    const staged: GameState = {
      ...atWar(s),
      battles: { 'battle:g': ground },
      fleets: {
        'f:ours': fleetAt('f:ours', 'p2', at, HOPELESS, {
          battleId: 'battle:g',
          landing: [{ unit: 'militia', count: 1 }],
        }),
      },
    };
    expect(only(aiOrders(staged, 'p2', 'expand', 'test'), 'fleet.retreat')).toHaveLength(0);
  });

  it('ИГРОВОЙ бот не отступает — весь репертуар AI-BAL достаётся лаборатории', () => {
    const s = game2();
    const staged = battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING);
    expect(only(aiOrders(staged, 'p2', 'expand'), 'fleet.retreat')).toHaveLength(0);
  });
});

describe('AI-BAL-7 — осада (`fleet.bombard`)', () => {
  /** Наш флот на орбите чужого мира с живым гарнизоном и пустым трюмом: взять нечем. */
  function siegeState(s: GameState, extra: Partial<Fleet> = {}): GameState {
    const target = homeOf(s, 'p1');
    return {
      ...atWar(s),
      fleets: {
        'f:siege': fleetAt('f:siege', 'p2', target, [{ unit: 'cruiser', count: 2 }], extra),
      },
    };
  }

  it('над вражеским миром, который нечем взять, ОТКРЫВАЕТ огонь по постройкам', () => {
    const s = game2();
    const orders = aiOrders(siegeState(s), 'p2', 'expand', 'test');
    const bombard = payloads<{ fleetId: string; on: boolean }>(orders, 'fleet.bombard');
    expect(bombard).toEqual([{ fleetId: 'f:siege', on: true }]);
  });

  it('уже бомбящий флот приказ НЕ повторяет и с орбиты не снимается', () => {
    // Повтор был бы бессмысленным действием каждые два часа до конца матча, а курс с
    // осаждаемого узла — возвратом к `E_SAME_LOCATION`, от которого осада и уводит.
    const s = game2();
    const orders = aiOrders(siegeState(s, { bombarding: true }), 'p2', 'expand', 'test');
    expect(only(orders, 'fleet.bombard')).toHaveLength(0);
    expect(
      payloads<{ fleetId: string }>(orders, 'fleet.move').filter((p) => p.fleetId === 'f:siege'),
    ).toHaveLength(0);
  });

  it('мир, который МОЖНО взять, берётся, а не осаждается', () => {
    // Осада не должна подменять собой захват: с десантом в трюме мир штурмуют.
    const s = game2();
    const orders = aiOrders(
      siegeState(s, { landing: [{ unit: 'militia', count: 2 }] }),
      'p2',
      'expand',
      'test',
    );
    expect(only(orders, 'fleet.assault')).toHaveLength(1);
    expect(only(orders, 'fleet.bombard')).toHaveLength(0);
  });

  it('ПУСТОЙ гарнизон занимается без десанта — `captureOnArrival` тут уже не сработает', () => {
    // Мир пустеет уже ПОД флотом (гарнизон добит), а захват прилётом судит по прилёту,
    // которого давно не было. Без этой ветки мир не берёт никто, и осада встала бы на
    // место бесплатного захвата.
    const s = game2();
    const target = homeOf(s, 'p1');
    const staged: GameState = {
      ...siegeState(s),
      planets: { ...s.planets, [target]: { ...s.planets[target]!, garrison: [] } },
    };
    expect(only(aiOrders(staged, 'p2', 'expand', 'test'), 'fleet.assault')).toHaveLength(1);
    expect(only(aiOrders(staged, 'p2', 'expand', 'test'), 'fleet.bombard')).toHaveLength(0);
  });

  it('ИГРОВОЙ бот не осаждает', () => {
    expect(only(aiOrders(siegeState(game2()), 'p2', 'expand'), 'fleet.bombard')).toHaveLength(0);
  });
});

describe('AI-BAL-7 — кулак делится (`fleet.split`)', () => {
  /** Крупная ударная группа, стоящая на СВОЁМ мире и готовая отчалить. */
  function fistState(s: GameState, ships: number): GameState {
    const home = homeOf(s, 'p2');
    return {
      ...atWar(s),
      fleets: { 'f:fist': fleetAt('f:fist', 'p2', home, [{ unit: 'cruiser', count: ships }]) },
    };
  }

  it('крупный кулак отчаливает ПОЛОВИНОЙ, вторая остаётся дома', () => {
    const s = game2();
    const orders = aiOrders(fistState(s, 8), 'p2', 'expand', 'test');
    const split = payloads<{ fleetId: string; take: Array<{ unit: string; count: number }> }>(
      orders,
      'fleet.split',
    );
    expect(split).toHaveLength(1);
    expect(split[0]!.fleetId).toBe('f:fist');
    expect(split[0]!.take).toEqual([{ unit: 'cruiser', count: 4 }]);
    // Смысл деления даёт только отплытие: останься исходный флот рядом, слияние
    // следующего тика собрало бы обе половины обратно.
    expect(
      payloads<{ fleetId: string }>(orders, 'fleet.move').some((p) => p.fleetId === 'f:fist'),
    ).toBe(true);
  });

  it('порядок приказов: сперва раскол, потом курс', () => {
    // `fleet.split` требует стоящий флот (`E_IN_TRANSIT`), так что после курса он был бы
    // отбит ядром.
    const orders = aiOrders(fistState(game2(), 8), 'p2', 'expand', 'test');
    const split = orders.findIndex((a) => a.type === 'fleet.split');
    expect(split).toBeGreaterThanOrEqual(0);
    expect(split).toBeLessThan(orders.findIndex((a) => a.type === 'fleet.move'));
  });

  it('малая группа не делится — это вернуло бы рой одиночек', () => {
    expect(only(aiOrders(fistState(game2(), 4), 'p2', 'expand', 'test'), 'fleet.split')).toHaveLength(
      0,
    );
  });

  it('флагман героя не отделяется — ядро такой раскол отбивает', () => {
    // Сущность героя привязана к ИСХОДНОМУ флоту по `fleetId`; ядро отвечает
    // `E_HERO_UNIT`, и приказ с героем в списке пропал бы ЦЕЛИКОМ, вместе с крейсерами.
    const s = game2();
    const home = homeOf(s, 'p2');
    const staged: GameState = {
      ...atWar(s),
      fleets: {
        'f:fist': fleetAt('f:fist', 'p2', home, [
          { unit: 'cruiser', count: 8 },
          { unit: 'hero', count: 2 },
        ]),
      },
    };
    const take = payloads<{ take: Array<{ unit: string }> }>(
      aiOrders(staged, 'p2', 'expand', 'test'),
      'fleet.split',
    )[0]!.take;
    expect(take.some((t) => t.unit === 'hero')).toBe(false);
  });

  it('ИГРОВОЙ бот кулак не делит', () => {
    expect(only(aiOrders(fistState(game2(), 8), 'p2', 'expand'), 'fleet.split')).toHaveLength(0);
  });
});

describe('AI-BAL-7 — инвариант #1 цел', () => {
  it('решение — чистая функция состояния: повтор даёт тот же набор приказов', () => {
    const s = game2();
    const staged = battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING);
    const shape = (st: GameState): string =>
      JSON.stringify(aiOrders(st, 'p2', 'expand', 'test').map((a) => [a.type, a.payload]));
    expect(shape(staged)).toBe(shape(staged));
  });

  it('поток ядра не двигается — прогноз боя его не трогает', () => {
    // `previewBattle` работает на глубоких клонах и кубика не бросает; сдвиг `state.rng`
    // снаружи ядра рассинхронизировал бы бои и сломал реплей матча.
    const s = game2();
    const staged = battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING);
    const before = JSON.stringify(staged.rng);
    aiOrders(staged, 'p2', 'expand', 'test');
    expect(JSON.stringify(staged.rng)).toBe(before);
  });

  it('прогноз не мутирует состав флотов', () => {
    const s = game2();
    const staged = battleState(s, homeOf(s, 'p1'), HOPELESS, OVERWHELMING);
    const before = JSON.stringify(staged.fleets);
    aiOrders(staged, 'p2', 'expand', 'test');
    expect(JSON.stringify(staged.fleets)).toBe(before);
  });
});
