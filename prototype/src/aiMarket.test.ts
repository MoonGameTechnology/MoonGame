// AI-BAL-9: рынок был мёртв В ОБЕ СТОРОНЫ.
//
// Бот умел выставлять лоты (`market.list`) и не умел их забирать: `market.take` не звал
// НИКТО, поэтому за прогон случалось ровно 0 сделок — оба места торговали в пустоту, а
// межигроковая экономика (торговля, ценовое давление, эмбарго) не мерялась ни одной
// цифрой. Здесь закрепляется вторая половина торга.
//
// Порогов НОВЫХ у неё нет и быть не должно: бот покупает металл не дороже собственной
// заявки и отдаёт излишек не дешевле собственной цены продажи — те же числа, которыми он
// уже торгует сам. Иначе половины торга разъехались бы, и бот покупал бы дороже, чем
// просит.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, GameState, MarketOrder } from '../../packages/shared-core/src/index';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const takes = (actions: Action[]): Array<{ id: string; amount?: number }> =>
  actions.filter((a) => a.type === 'market.take').map((a) => a.payload as { id: string });

/** Состояние с одним чужим лотом и заданными запасами бота. */
function withLot(lot: Partial<MarketOrder>, mine: Record<string, number>): GameState {
  const s = game2();
  const p2 = s.players.p2!;
  p2.resources = { ...p2.resources, ...mine };
  s.market = [
    { id: 'L1', side: 'sell', owner: 'p1', resource: 'metal', amount: 30, price: 3, ...lot },
  ];
  return s;
}

describe('бот забирает чужой лот — вторая половина торга (AI-BAL-9)', () => {
  it('ПОКУПАЕТ металл, когда его мало, а чужая цена не выше собственной заявки', () => {
    const s = withLot({ side: 'sell', resource: 'metal', price: 3 }, { metal: 10, credits: 5000 });
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([{ id: 'L1', amount: 30 }]);
  });

  it('НЕ покупает дороже собственной заявки — иначе половины торга разъезжаются', () => {
    const s = withLot({ side: 'sell', resource: 'metal', price: 4 }, { metal: 10, credits: 5000 });
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([]);
  });

  it('НЕ покупает, когда металла и так хватает', () => {
    const s = withLot({ side: 'sell', resource: 'metal', price: 3 }, { metal: 900, credits: 5000 });
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([]);
  });

  it('берёт СТОЛЬКО, на сколько хватает кредитов, а не весь лот', () => {
    // Ядро отклонило бы `E_INSUFFICIENT` целиком: просить больше, чем можешь оплатить,
    // значит не купить ничего и засорить статистику реджектов.
    const s = withLot({ side: 'sell', resource: 'metal', price: 3, amount: 30 }, { metal: 10, credits: 31 });
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([{ id: 'L1', amount: 10 }]);
  });

  it('ПРОДАЁТ излишек в чужую заявку, когда цена не ниже собственной', () => {
    const s = withLot(
      { side: 'buy', resource: 'food', amount: 50, price: 2 },
      { food: 400, credits: 100 },
    );
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([{ id: 'L1', amount: 50 }]);
  });

  it('НЕ продаёт дешевле собственной цены', () => {
    const s = withLot(
      { side: 'buy', resource: 'food', amount: 50, price: 1 },
      { food: 400, credits: 100 },
    );
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([]);
  });

  it('НЕ продаёт запас, который держит для себя — только излишек сверх резерва', () => {
    const s = withLot(
      { side: 'buy', resource: 'food', amount: 50, price: 2 },
      { food: 130, credits: 100 },
    );
    // Резерв продовольствия 120: сверх него всего 10, их и отдаёт.
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([{ id: 'L1', amount: 10 }]);
  });

  it('ЗАКРЫВАЕТ чужую заявку на МЕТАЛЛ — единственный ресурс, на котором рынок сходится', () => {
    // Сам бот металл не продаёт: он его жжёт. Но оба места просят металл и предлагают еду
    // с энергией, поэтому спрос и предложение не встречаются вовсе — за прогон было 48
    // лотов и 0 сделок. Закрытие чужой заявки — единственное, чем книга может сойтись.
    const s = withLot(
      { side: 'buy', resource: 'metal', amount: 30, price: 3 },
      { metal: 5000, credits: 100 },
    );
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([{ id: 'L1', amount: 30 }]);
  });

  it('НЕ продаёт себя в дефицит, который сам же объявляет нуждой', () => {
    // Резерв металла — та же граница `METAL_LOW`, при которой бот сам просит металл.
    const s = withLot(
      { side: 'buy', resource: 'metal', amount: 30, price: 3 },
      { metal: 95, credits: 100 },
    );
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([{ id: 'L1', amount: 15 }]);
  });

  it('СВОЙ лот не трогает — ядро отвечает E_OWN_ORDER', () => {
    const s = withLot({ side: 'sell', resource: 'metal', price: 3, owner: 'p2' }, { metal: 10, credits: 5000 });
    expect(takes(aiOrders(s, 'p2', 'expand', 'test'))).toEqual([]);
  });
});
