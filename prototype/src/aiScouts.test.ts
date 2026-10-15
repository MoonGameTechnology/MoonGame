// Разведчики на войне — пачкой (`WAR_SCOUT_BATCH` в `ai.ts`).
//
// Что здесь закрепляется. На войне бот добавлял в постройку одного разведчика за ход:
// это бегун, который берёт пустую провинцию прилётом. На дуэли duel-1 такие бегуны и
// решают партию: в 200 очных партиях бот с пачкой из четырёх выиграл 93% у бота с одним
// разведчиком за ход. Пачку берёт только обычное место в полную силу; простой ход слабого
// бота и оборона наместника заказывают по одному, как раньше.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { GameState } from '../../packages/shared-core/src/index';
import { atWeakTurn } from './weakTurnFixture';

/** Две стороны на войне, у p2 богатая казна: заказ не упирается в металл. */
function atWar(): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
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

const scoutOrders = (orders: ReturnType<typeof aiOrders>): number[] =>
  orders
    .filter((a) => a.type === 'unit.build')
    .map((a) => a.payload as { unit: string; count?: number })
    .filter((p) => p.unit === 'scout')
    .map((p) => p.count ?? 1);

describe('разведчики на войне — пачкой', () => {
  it('сильный бот заказывает четырёх за ход', () => {
    expect(scoutOrders(aiOrders(atWar(), 'p2', 'expand', 'strong'))).toEqual([4]);
  });

  it('слабый бот в полную силу заказывает четырёх, простым ходом — одного', () => {
    expect(scoutOrders(aiOrders(atWeakTurn(atWar(), 'full'), 'p2', 'expand'))).toEqual([4]);
    expect(scoutOrders(aiOrders(atWeakTurn(atWar(), 'simple'), 'p2', 'expand'))).toEqual([1]);
  });

  it('оборона наместника заказывает одного: её флот стоит дома', () => {
    expect(scoutOrders(aiOrders(atWar(), 'p2', 'defend', 'strong'))).toEqual([1]);
  });
});
