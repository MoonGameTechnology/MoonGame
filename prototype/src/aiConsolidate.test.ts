// AI-BAL-13 — доктрина консолидации против правила «один герой на флот».
//
// Бот сливает свои простаивающие флоты в одной точке в самый крупный: без этого остатки
// боёв копятся в сотни флотов по одному кораблю и душат симуляцию. Доктрина считала
// слияние ВСЕГДА успешным — метила флот `skipMove` сразу после `out.push(mergeFleet(...))`,
// не глядя на исход. После HERO-10 ядро отбивает слияние ДВУХ геройских флотов кодом
// `E_TWO_HEROES`, и два таких флота в одной точке вставали НАВСЕГДА: приказ каждый тик
// отбивается, ход погашен обоим. Замер при CONV-12b: боёв 12370 → 119, наземных 7073 → 0.
//
// Правило HERO-10 при этом верное («каждый герой ведёт свой флот, как в HoMM») — чинить
// надо бота. Здесь пиннится ЗЕРКАЛО гейта ядра, ровно как в `aiHero.test.ts`: бот не
// сыплет заведомо отбиваемыми приказами и не гасит ход флоту, чьё слияние не состоялось.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, Fleet, GameState } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const orders = (s: GameState): Action[] => aiOrders(s, 'p2', 'expand', 'strong');
const merges = (s: GameState): Array<{ from: string; into: string }> =>
  orders(s)
    .filter((a) => a.type === 'fleet.merge')
    .map((a) => a.payload as { from: string; into: string });
/** Двигается ли флот в этот тик — то есть НЕ погашен ли ему ход. */
const moves = (s: GameState, fleetId: string): boolean =>
  orders(s).some(
    (a) =>
      (a.payload as { fleetId?: string; fleetIds?: string[] }).fleetId === fleetId ||
      ((a.payload as { fleetIds?: string[] }).fleetIds ?? []).includes(fleetId),
  );

/** Копия стартового флота места под новым id — там же, где стоит оригинал. */
function twin(s: GameState, id: string, units: Fleet['units']): GameState {
  const base = s.fleets['p2-1']!;
  return { ...s, fleets: { ...s.fleets, [id]: { ...base, id, units } } };
}

/** Посадить спящего героя места во флот `fleetId` — получаем ВТОРОЙ геройский флот. */
function seatHero(s: GameState, fleetId: string): GameState {
  const sleeping = Object.values(s.heroes ?? {}).find((h) => h.owner === 'p2' && h.alive !== true)!;
  return {
    ...s,
    heroes: { ...s.heroes, [sleeping.id]: { ...sleeping, alive: true, fleetId } },
  };
}

const SHIPS: Fleet['units'] = [{ unit: 'cruiser', count: 1 }];
const HERO_SHIPS: Fleet['units'] = [
  { unit: 'hero', count: 1 },
  { unit: 'cruiser', count: 1 },
];

describe('AI-BAL-13 — бот знает правило «один герой на флот»', () => {
  it('ДВА ГЕРОЙСКИХ ФЛОТА НЕ СЛИВАЮТСЯ: ядро ответило бы `E_TWO_HEROES`', () => {
    const s = seatHero(twin(game2(), 'p2-hero2', HERO_SHIPS), 'p2-hero2');
    expect(merges(s)).toEqual([]);
  });

  it('И ОБА ПРОДОЛЖАЮТ ХОДИТЬ — это и есть та самая вечная стоянка', () => {
    // Приёмка кирпича. До него ход гасился обоим КАЖДЫЙ тик: слияние отбивалось, а
    // `skipMove` ставился всё равно — и боевая часть игры останавливалась.
    const s = seatHero(twin(game2(), 'p2-hero2', HERO_SHIPS), 'p2-hero2');
    expect(moves(s, 'p2-1')).toBe(true);
    expect(moves(s, 'p2-hero2')).toBe(true);
  });

  it('БЕЗГЕРОЙСКИЙ К ГЕРОЮ — МОЖНО: это обычное усиление, герой в итоге один', () => {
    const s = twin(game2(), 'p2-plain', SHIPS);
    expect(merges(s)).toEqual([{ from: 'p2-plain', into: 'p2-1' }]);
  });

  it('ДОКТРИНА ЖИВА: два безгеройских остатка по-прежнему сливаются в крупный', () => {
    // Ради чего консолидация и заводилась — сотни флотов по одному кораблю душат симуляцию.
    let s = twin(game2(), 'p2-a', SHIPS);
    s = twin(s, 'p2-b', SHIPS);
    const got = merges(s);
    expect(got).toHaveLength(2);
    expect(got.every((m) => m.into === 'p2-1')).toBe(true);
    expect(new Set(got.map((m) => m.from))).toEqual(new Set(['p2-a', 'p2-b']));
  });

  it('ЯКОРЬ БЕЗ ГЕРОЯ ПРИНИМАЕТ ТОЛЬКО ОДНОГО: второй уже был бы `E_TWO_HEROES`', () => {
    // Порядок важен: приказы применяются ПОДРЯД, и первый же влившийся герой делает
    // якорь геройским. Проверка «по состоянию на начало тика» пропустила бы второе
    // слияние — и оно отбилось бы при живом `skipMove`, то есть вернуло бы ту же
    // вечную стоянку, только на один флот.
    let s = twin(game2(), 'p2-big', SHIPS.concat([{ unit: 'cruiser', count: 9 }]));
    s = twin(s, 'p2-hero2', HERO_SHIPS);
    s = seatHero(s, 'p2-hero2');
    const got = merges(s);
    // Флотов три: безгеройский якорь и ДВА геройских. Влиться может ровно один из них —
    // после него якорь геройский, и второе слияние было бы отказом.
    expect(got).toHaveLength(1);
    expect(got[0]!.into).toBe('p2-big');
    expect(['p2-1', 'p2-hero2']).toContain(got[0]!.from);
    const stayed = got[0]!.from === 'p2-1' ? 'p2-hero2' : 'p2-1';
    expect(moves(s, stayed)).toBe(true); // а второй ходит, а не стоит
  });

  it('ГЕРОЙ РЯДОМ НЕ ОТМЕНЯЕТ СЛИЯНИЕ ОСТАЛЬНЫХ: встаёт только лишний герой', () => {
    // Смешанная точка: якорь с героем, второй герой и два остатка. Остатки обязаны
    // собраться в якорь, а второй геройский флот — уйти своим ходом, а не стоять.
    let s = twin(game2(), 'p2-hero2', HERO_SHIPS);
    s = seatHero(s, 'p2-hero2');
    s = twin(s, 'p2-a', SHIPS);
    s = twin(s, 'p2-b', SHIPS);
    const got = merges(s);
    expect(new Set(got.map((m) => m.from))).toEqual(new Set(['p2-a', 'p2-b']));
    expect(got.every((m) => m.into === 'p2-1')).toBe(true);
    expect(moves(s, 'p2-hero2')).toBe(true);
  });
});
