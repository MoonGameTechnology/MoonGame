// AI-BAL-5: seeded разброс решений тест-бота — прибор начинает давать статистику.
//
// Что здесь закрепляется. До этой правки батч на 300 матчей был НЕ 300 наблюдениями, а
// 4 конфигурациями (слот × фракция) по 75 повторов: семьи сидов `base` и `alt` совпадали
// до последней цифры, и любой процент в отчёте был бинарным признаком — правка либо
// переключала исход целиком, либо не меняла ничего. Разброс терялся не в карте и не в
// ядре, а в самой `aiOrders`: строго ближайшая цель, фиксированный порог войны, обход
// миров в порядке раскладки объекта.
//
// Лечение — ТРИ точки разброса, питающиеся от `state.rng` (поток ядра, разведённый по
// сидам ещё `seedRng` на старте). Поток только ЧИТАЕТСЯ: мутировать его снаружи ядра
// нельзя, иначе сдвинутся бои и сломается реплей.
//
// Почему тесты смотрят на СЕРЕДИНУ партии, а не на первый тик: на старте ни одна из трёх
// точек не активна (второй сопоставимой цели ещё нет, отставания нет, своих миров кроме
// базы нет), поэтому первые часы у всех сидов совпадают ЗАКОННО — расхождение копится
// дальше. Тест на стартовом состоянии проверял бы не разброс, а его отсутствие.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';

const SEEDS = ['sp-0', 'sp-1', 'sp-2', 'sp-3', 'alt-0', 'alt-1', 'alt-2', 'alt-3'];

function game(seed: string): GameState {
  return newGame({
    seed,
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

/**
 * Состояние середины партии: у места есть свои миры и казна — все три точки живы.
 *
 * Отдельно забирается БЛИЖАЙШАЯ к дому провинция. Иначе у флота нет второй сопоставимой
 * цели: со старта ближайшая лежит в 50 единицах, а следующая в 147 — почти втрое дальше,
 * и правило «вторая цель не дальше 2×» законно её не берёт. Стоит забрать первую, и
 * следующие две оказываются равны (147/147) — ровно та развилка, которую шум и разводит.
 */
function midgame(seed: string): GameState {
  const s = game(seed);
  const home = Object.values(s.planets).find(
    (p) => p.owner === 'p2' && p.buildings.some((b) => b.type === 'spaceport'),
  )!;
  const dist = (p: { position: { x: number; y: number } }): number =>
    Math.hypot(p.position.x - home.position.x, p.position.y - home.position.y);
  const nearest = Object.values(s.planets)
    .filter((p) => p.owner === null)
    .sort((a, b) => dist(a) - dist(b))[0]!;
  const spare = Object.values(s.planets)
    .filter((p) => p.owner === null && p.kind === 'planet')
    .slice(0, 4)
    .concat(nearest);
  const planets = { ...s.planets };
  for (const p of spare) planets[p.id] = { ...p, owner: 'p2', buildings: [], garrison: [] };
  return {
    ...s,
    time: 3 * 24 * 3_600_000,
    planets: { ...planets, [home.id]: home },
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: { credits: 4000, metal: 6000, food: 500, energy: 500, microelectronics: 200 },
      },
    },
  };
}

const first = (actions: Action[], type: string): Action | undefined =>
  actions.find((a) => a.type === type);
/** Где бот заложил ШАХТУ — точка входа в обход своих миров.
 *  Смотреть на первую стройку вообще нельзя: экономическая цепочка идёт раньше и всегда
 *  строит на базе, так что она одинакова у всех сидов ЗАКОННО. */
const firstBuildAt = (s: GameState, profile: 'basic' | 'test'): string | undefined =>
  (aiOrders(s, 'p2', 'expand', profile)
    .filter((a) => a.type === 'building.construct')
    .map((a) => a.payload as { planetId: string; building: string })
    .find((x) => x.building === 'mine'))?.planetId;
/** Куда пошёл флот — точка выбора цели. */
const moveTarget = (s: GameState, profile: 'basic' | 'test'): string | undefined =>
  (first(aiOrders(s, 'p2', 'expand', profile), 'fleet.move')?.payload as
    | { to: string }
    | undefined)?.to;

describe('AI-BAL-5 — разброс есть', () => {
  it('точка входа в обход миров различается по сидам', () => {
    // Блоки развития выписывают ОДНУ стройку за тик и выходят по `break`, поэтому решает
    // первый подходящий мир — раньше он был один и тот же во всех матчах.
    const picks = new Set(SEEDS.map((seed) => firstBuildAt(midgame(seed), 'test')));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('цель флота различается по сидам', () => {
    const targets = new Set(SEEDS.map((seed) => moveTarget(midgame(seed), 'test')));
    expect(targets.size).toBeGreaterThan(1);
  });
});

describe('BAL-1 — равные цели разводит шум, а не порядок объекта', () => {
  it('при РАВНОМ расстоянии тест-бот не всегда берёт первую цель в переборе', () => {
    // Карта-«колесо» симметрична, поэтому равенство расстояний стало обычным делом, а
    // скрытый тай-брейк «кто первый в `Object.values(state.planets)`» превратился в фору
    // сектору 0: при идентичных по метрикам стартах он брал 70% побед. Проверяем, что
    // среди РАВНЫХ целей выбор зависит от сида — иначе перекос вернётся молча.
    const s = midgame('sp-0');
    const home = Object.values(s.planets).find(
      (p) => p.owner === 'p2' && p.buildings.some((b) => b.type === 'spaceport'),
    )!;
    // Две одинаково удалённые цели по разные стороны от дома: расстояния равны точно.
    const equidistant: GameState = {
      ...s,
      planets: {
        ...s.planets,
        FAR_A: { ...home, id: 'FAR_A', owner: null, kind: 'planet', buildings: [], garrison: [],
          position: { x: home.position.x + 300, y: home.position.y } },
        FAR_B: { ...home, id: 'FAR_B', owner: null, kind: 'planet', buildings: [], garrison: [],
          position: { x: home.position.x - 300, y: home.position.y } },
      },
    };
    const picks = new Set(
      SEEDS.map((seed) => {
        const st = { ...equidistant, rng: game(seed).rng };
        return moveTarget(st, 'test');
      }),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('AI-BAL-5 — детерминизм цел (инвариант #1)', () => {
  it('один сид разыгрывается ОДИНАКОВО, сколько ни повторяй', () => {
    const shape = (s: GameState): string =>
      JSON.stringify(aiOrders(s, 'p2', 'expand', 'test').map((a) => [a.type, a.payload]));
    expect(shape(midgame('sp-7'))).toBe(shape(midgame('sp-7')));
  });

  it('шум не трогает поток ядра — `state.rng` после решения тот же', () => {
    // `aiOrders` читает четыре слова состояния PRNG, но не двигает их: сдвиг снаружи
    // ядра рассинхронизировал бы бои и сломал реплей матча.
    const s = midgame('sp-3');
    const before = JSON.stringify(s.rng);
    aiOrders(s, 'p2', 'expand', 'test');
    expect(JSON.stringify(s.rng)).toBe(before);
  });

  it('ИГРОВОЙ бот разброса не получил — его решения от сида не зависят', () => {
    // Правило блока AI-BAL: всё новое достаётся только тест-профилю. Живой игрок
    // встречает прежнего предсказуемого соперника.
    expect(new Set(SEEDS.map((seed) => firstBuildAt(midgame(seed), 'basic'))).size).toBe(1);
    expect(new Set(SEEDS.map((seed) => moveTarget(midgame(seed), 'basic'))).size).toBe(1);
  });
});
