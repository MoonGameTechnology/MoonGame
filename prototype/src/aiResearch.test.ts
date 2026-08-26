// AI-BAL-1: ТЕСТ-бот исследует технологии (профиль `test`, AI-BAL-1.1).
//
// Игровой бот этого не делает и делать не должен — за границу отвечает `aiProfile.test.ts`.
// Здесь проверяется САМА эвристика, поэтому все вызовы идут с лабораторным профилем.
//
// До этой правки `aiOrders` не заказывал НИ ОДНОГО исследования: батч self-play на 300
// матчей давал 0 из 25 технологий, то есть вся ветка эффектов (добыча / скорость / урон
// и гейты контента) не участвовала в измерении баланса вовсе. Тесты ниже пиннят не
// «оптимальный билд», а три свойства, без которых измерение снова станет ложным:
// заказ вообще есть, он не спамит отказами и он детерминирован.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, data, START_CANDIDATES } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const research = (actions: Action[]): Action[] =>
  actions.filter((a) => a.type === 'technology.research');

/** Идентификатор технологии из заказа — payload типизирован по месту, как в соседних тестах. */
const techOf = (a: Action): string => (a.payload as { technology: string }).technology;

describe('aiOrders — исследование технологий (AI-BAL-1)', () => {
  it('заказывает исследование на старте матча', () => {
    const s = game2();
    const orders = research(aiOrders(s, 'p2', 'expand', 'test'));
    expect(orders.length).toBeGreaterThan(0);
    expect(data.technologies[techOf(orders[0]!)]).toBeDefined();
  });

  it('за тик заказывает не больше одного — слоты освобождает ядро, а не бот', () => {
    // Иначе на первом же тике бот выложил бы весь доступный список и получил
    // E_RESEARCH_SLOTS_FULL на всё, кроме первых двух: reject-спам в лог матча.
    const s = game2();
    expect(research(aiOrders(s, 'p2', 'expand', 'test'))).toHaveLength(1);
  });

  it('не заказывает то, что уже исследуется или исследовано', () => {
    const s = game2();
    const first = techOf(research(aiOrders(s, 'p2', 'expand', 'test'))[0]!);
    const withActive: GameState = {
      ...s,
      players: {
        ...s.players,
        p2: {
          ...s.players.p2!,
          technologies: { completed: [], active: [{ technology: first, startedAt: 0, completesAt: 9e9 }] },
        },
      },
    };
    expect(research(aiOrders(withActive, 'p2', 'expand', 'test')).map(techOf)).not.toContain(first);

    const withDone: GameState = {
      ...s,
      players: {
        ...s.players,
        p2: { ...s.players.p2!, technologies: { completed: [first], active: [] } },
      },
    };
    expect(research(aiOrders(withDone, 'p2', 'expand', 'test')).map(techOf)).not.toContain(first);
  });

  it('молчит, когда оба базовых слота заняты', () => {
    const s = game2();
    const busy: GameState = {
      ...s,
      players: {
        ...s.players,
        p2: {
          ...s.players.p2!,
          technologies: {
            completed: [],
            active: [
              { technology: 'meta_industry', startedAt: 0, completesAt: 9e9 },
              { technology: 'meta_drill_speed', startedAt: 0, completesAt: 9e9 },
            ],
          },
        },
      },
    };
    expect(research(aiOrders(busy, 'p2', 'expand', 'test'))).toHaveLength(0);
  });

  it('пустая казна → берёт только бесплатное (6 мета-техов), платное не трогает', () => {
    // Не «молчит»: часть дерева (`meta_drill_*`, `meta_industry*`) стоит `{}` — это
    // мета-прокачка командира, она доступна и без казны, и ядро её примет. Свойство,
    // которое обязано держаться, — заказ ВСЕГДА по карману, а не «заказа нет».
    const s = game2();
    const broke: GameState = {
      ...s,
      players: { ...s.players, p2: { ...s.players.p2!, resources: {} } },
    };
    for (const order of research(aiOrders(broke, 'p2', 'expand', 'test'))) {
      const cost = data.technologies[techOf(order)]?.cost ?? {};
      expect(Object.values(cost).reduce((n, v) => n + v, 0)).toBe(0);
    }
  });

  it('платное берёт только с запасом на строительство', () => {
    // Запас (+60 сверх цены) не даёт боту вложить последнее в науку и встать без
    // экономики: self-play M4 уже ловил бота, который «оптимизировал» себя в ноль.
    const s = game2();
    const paid = Object.entries(data.technologies).find(
      ([, d]) => Object.values(d.cost ?? {}).reduce((n, v) => n + v, 0) > 0,
    );
    expect(paid).toBeDefined();
    const [, def] = paid!;
    const exact: GameState = {
      ...s,
      players: {
        ...s.players,
        p2: { ...s.players.p2!, resources: { ...(def.cost ?? {}) } }, // ровно цена, без запаса
      },
    };
    for (const order of research(aiOrders(exact, 'p2', 'expand', 'test'))) {
      const cost = data.technologies[techOf(order)]?.cost ?? {};
      expect(Object.values(cost).reduce((n, v) => n + v, 0)).toBe(0); // только бесплатное
    }
  });

  it('выбор ДЕТЕРМИНИРОВАН — иначе один сид разыграется по-разному (инвариант #1)', () => {
    const a = techOf(research(aiOrders(game2(), 'p2', 'expand', 'test'))[0]!);
    const b = techOf(research(aiOrders(game2(), 'p2', 'expand', 'test'))[0]!);
    expect(a).toBe(b);
  });

  it('оборонительная поза «Хранителя» тоже исследует — вахта не значит застой', () => {
    const s = game2();
    expect(research(aiOrders(s, 'p2', 'defend', 'test')).length).toBeGreaterThan(0);
  });
});
