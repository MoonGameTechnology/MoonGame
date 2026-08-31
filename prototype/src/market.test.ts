import { describe, it, expect } from 'vitest';
import { newGame, order, marketList, marketTake, marketCancel, declareWar, aiOrders } from './game';
import type { GameState, MarketOrder } from '../../packages/shared-core/src/index';

// САМ МОДУЛЬ рынка живёт в ядре и там же проверяется (CONV-9 снял копию прототипа):
// двусторонняя книга, эскроу, комиссия 15%, белый список товаров, цена ≥ 1 и капабилити
// эмбарго покрыты `packages/shared-core/src/modules/market.test.ts`.
//
// Здесь остаётся то, чего в ядре нет и быть не может: рынок В СБОРКЕ ПРОТОТИПА —
// живое эмбарго ботов (правило принадлежит `botDiplomacyModule`, который и предоставляет
// капабилити `market.embargo`) и бот, выставляющий излишки. Ядро об этих правилах не
// знает и знать не должно: без провайдера оно деградирует до «эмбарго нет».

const lots = (s: GameState): MarketOrder[] => (s.market ?? []) as MarketOrder[];

function rich(): GameState {
  const s = newGame(); // default setup = p1 (human) + p2 (AI)
  for (const id of ['p1', 'p2']) {
    s.players[id]!.resources.credits = 1000;
    s.players[id]!.resources.metal = 1000;
  }
  return s;
}
const ok = (r: { state: GameState; error?: string }): GameState => {
  if (r.error) throw new Error(r.error);
  return r.state;
};

describe('рынок в сборке прототипа — эмбарго через капабилити', () => {
  it('поссорившемуся игроку бот не даёт забрать свой лот', () => {
    let s = rich();
    s = ok(order(s, declareWar('p1', 'p2'), 0)); // расположение p2 к p1 падает ниже линии эмбарго
    s = ok(order(s, marketList('p2', 'sell', 'metal', 50, 2), s.time));
    expect(order(s, marketTake('p1', lots(s)[0]!.id), s.time).error).toBe('E_EMBARGO');
  });

  it('эмбарго не мешает своим: сделка между невраждующими проходит', () => {
    let s = rich();
    s = ok(order(s, marketList('p2', 'sell', 'metal', 50, 2), s.time));
    const before = s.players.p1!.resources.metal ?? 0;
    s = ok(order(s, marketTake('p1', lots(s)[0]!.id), s.time));
    expect(s.players.p1!.resources.metal).toBe(before + 50);
  });

  it('отмена возвращает эскроу владельцу без комиссии', () => {
    let s = rich();
    s = ok(order(s, marketList('p1', 'sell', 'metal', 100, 2), 0));
    expect(s.players.p1!.resources.metal).toBe(900);
    s = ok(order(s, marketCancel('p1', lots(s)[0]!.id), s.time));
    expect(s.players.p1!.resources.metal).toBe(1000);
    expect(lots(s)).toHaveLength(0);
  });
});

describe('рынок в сборке прототипа — бот торгует излишками', () => {
  it('бот выставляет только излишек сверх резерва, и эмбарго держит соурнувшегося', () => {
    let s = newGame(); // p2 = AI
    // Экономика зданий научила бота рабочему РЕЗЕРВУ (120 food) — стартовый запас ровно
    // такой, поэтому на старте он не продаёт НИЧЕГО…
    const atStart = aiOrders(s, 'p2').filter(
      (a) => a.type === 'market.list' && (a.payload as { side?: string }).side === 'sell',
    );
    expect(
      atStart.find((a) => (a.payload as { resource?: string }).resource === 'food'),
    ).toBeUndefined();
    // …и выставляет только то, что выше резерва, когда запас вырос.
    s.players.p2!.resources.food = 220;
    const sells = aiOrders(s, 'p2').filter(
      (a) => a.type === 'market.list' && (a.payload as { side?: string }).side === 'sell',
    );
    const food = sells.find((a) => (a.payload as { resource?: string }).resource === 'food');
    expect(food).toBeDefined();
    expect((food!.payload as { amount: number }).amount).toBe(50); // (220 − 120) / 2

    // Применяем заявки бота, после чего поссорившийся игрок их не заполнит.
    for (const a of sells) s = ok(order(s, a, 0));
    s = ok(order(s, declareWar('p1', 'p2'), s.time)); // портим расположение p2 к p1
    const botFoodLot = lots(s).find((l) => l.owner === 'p2' && l.resource === 'food');
    expect(botFoodLot).toBeDefined();
    expect(order(s, marketTake('p1', botFoodLot!.id), s.time).error).toBe('E_EMBARGO');
  });
});
