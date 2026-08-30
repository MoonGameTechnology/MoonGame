// AI-BAL-9: рынок у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. Бот выставлял лоты (`market.list`), но `market.take` не звал
// НИКТО — за прогон ровно ноль сделок. Книга наполнялась и умирала нетронутой, поэтому
// межигроковая экономика (торговля, ценовое давление, эмбарго, комиссия-сток) в балансе
// не участвовала вовсе, притом что «лоты выставляются» выглядело как работающий рынок.
//
// Правило снятия симметрично собственным лотам и берёт цены из ТОЙ ЖЕ таблицы
// (`TRADE_BOOK`): чужой `sell` снимается, когда товар нужен и просят не дороже своего
// `bid`; чужой `buy` исполняется, когда товар в излишке и ЧИСТАЯ (после комиссии ядра)
// выручка не ниже своего `ask`. Две копии оценки разъехались бы, и бот торговал бы сам
// против себя — поэтому тесты ниже пиннят именно связь обеих сторон с одной таблицей.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import { MARKET_COMMISSION } from '../../packages/shared-core/src/index';
import type { Action, GameState, MarketOrder } from '../../packages/shared-core/src/index';

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
const orders = (s: GameState, profile: 'basic' | 'test' = 'test'): Action[] =>
  aiOrders(s, 'p2', 'expand', profile);
const takes = (s: GameState, profile: 'basic' | 'test' = 'test') =>
  payloads<{ id: string; amount?: number }>(orders(s, profile), 'market.take');

/** Состояние с заданной казной места p2 и книгой заказов. */
function book(
  resources: Record<string, number>,
  lots: Array<Partial<MarketOrder> & { id: string; side: 'sell' | 'buy'; resource: string }>,
): GameState {
  const s = game2();
  return {
    ...s,
    players: { ...s.players, p2: { ...s.players.p2!, resources } },
    market: lots.map((l) => ({
      owner: 'p1',
      amount: 100,
      price: 3,
      ...l,
    })) as MarketOrder[],
  };
}

/** Казна, где ВСЕГО в достатке: ни один лот не нужен и ничего не в излишке сверх меры. */
const NEUTRAL = { credits: 1000, metal: 500, food: 100, energy: 100, microelectronics: 60 };

describe('AI-BAL-9 — бот снимает чужой `sell`, когда товар нужен', () => {
  it('снимает лот на дефицитный товар по цене не выше своей', () => {
    // Микроэлектроники 10 при рабочем запасе 40 — нехватка; просят 2 при своём bid 3.
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:micro', side: 'sell', resource: 'microelectronics', price: 2, amount: 12 },
    ]);
    expect(takes(s)).toEqual([{ id: 'lot:micro', amount: 12 }]);
  });

  it('берёт ровно до рабочего запаса, а не весь лот', () => {
    // Нехватка 30 (40 − 10), в лоте 100 — сверх запаса товар боту не нужен.
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:big', side: 'sell', resource: 'microelectronics', price: 2, amount: 100 },
    ]);
    expect(takes(s)[0]!.amount).toBe(30);
  });

  it('переплачивать не станет: цена выше своего `bid` — приказа нет', () => {
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:dear', side: 'sell', resource: 'microelectronics', price: 9, amount: 12 },
    ]);
    expect(takes(s)).toHaveLength(0);
  });

  it('товар, которого хватает, не покупается даже задёшево', () => {
    const s = book({ ...NEUTRAL, microelectronics: 200 }, [
      { id: 'lot:cheap', side: 'sell', resource: 'microelectronics', price: 1, amount: 12 },
    ]);
    expect(takes(s)).toHaveLength(0);
  });

  it('казну до дна не тратит — остаётся рабочий остаток кредитов', () => {
    // Кредитов 320 при полу 300 ⇒ на покупку идёт 20, то есть 10 штук по 2.
    const s = book({ ...NEUTRAL, credits: 320, microelectronics: 10 }, [
      { id: 'lot:micro', side: 'sell', resource: 'microelectronics', price: 2, amount: 100 },
    ]);
    expect(takes(s)[0]!.amount).toBe(10);
  });

  it('на пустой казне приказа нет, а не `E_INSUFFICIENT` каждые два часа', () => {
    const s = book({ ...NEUTRAL, credits: 50, microelectronics: 10 }, [
      { id: 'lot:micro', side: 'sell', resource: 'microelectronics', price: 2, amount: 100 },
    ]);
    expect(takes(s)).toHaveLength(0);
  });
});

describe('AI-BAL-9 — бот исполняет чужой `buy`, когда товар в излишке', () => {
  it('продаёт излишек, если ЧИСТАЯ выручка не ниже своего `ask`', () => {
    // Микроэлектроники 200 при запасе 40 ⇒ излишек 160; цена 3 даёт 3×0.85 = 2.55 ≥ 2.
    const s = book({ ...NEUTRAL, microelectronics: 200 }, [
      { id: 'lot:bid', side: 'buy', resource: 'microelectronics', price: 3, amount: 20 },
    ]);
    expect(takes(s)).toEqual([{ id: 'lot:bid', amount: 20 }]);
  });

  it('считает выручку ПОСЛЕ комиссии — валовая цена систематически завышала бы выгоду', () => {
    // Цена подобрана так, что валовая ≥ ask, а чистая уже нет: ровно та ошибка, на
    // которой бот отдавал бы товар дешевле собственной оценки.
    const gross = 2 / (1 - MARKET_COMMISSION); // чистая ровно = ask
    const s = book({ ...NEUTRAL, microelectronics: 200 }, [
      { id: 'lot:thin', side: 'buy', resource: 'microelectronics', price: gross - 0.2, amount: 20 },
    ]);
    expect(takes(s)).toHaveLength(0);
    const ok = book({ ...NEUTRAL, microelectronics: 200 }, [
      { id: 'lot:fat', side: 'buy', resource: 'microelectronics', price: gross + 0.2, amount: 20 },
    ]);
    expect(takes(ok)).toHaveLength(1);
  });

  it('рабочий запас не продаётся — отдаётся только то, что сверх него', () => {
    const s = book({ ...NEUTRAL, microelectronics: 55 }, [
      { id: 'lot:bid', side: 'buy', resource: 'microelectronics', price: 3, amount: 100 },
    ]);
    expect(takes(s)[0]!.amount).toBe(15); // 55 − 40
  });

  it('товар, который бот не продаёт вовсе, не отдаётся и с излишком', () => {
    // У металла в таблице нет `ask`: он тратится быстрее всех, и отдавать его незачем.
    const s = book({ ...NEUTRAL, metal: 5000 }, [
      { id: 'lot:metal', side: 'buy', resource: 'metal', price: 9, amount: 100 },
    ]);
    expect(takes(s)).toHaveLength(0);
  });
});

describe('AI-BAL-9 — границы книги', () => {
  it('свой лот не снимается — ядро ответило бы `E_OWN_ORDER`', () => {
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:mine', owner: 'p2', side: 'sell', resource: 'microelectronics', price: 1 },
    ]);
    expect(takes(s)).toHaveLength(0);
  });

  it('лот от того, кто нас эмбаргует, пропускается — а не сыплет `E_EMBARGO`', () => {
    // Правило эмбарго судит ядро (capability `market.embargo`), но отказ на один и тот же
    // лот повторялся бы каждые два часа до конца матча.
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:sour', side: 'sell', resource: 'microelectronics', price: 1, amount: 12 },
    ]);
    // Шкала расположения — прототипное расширение состояния (`approval`, botFavour.ts):
    // 0 у p1 к p2 это глубоко ниже порога эмбарго (35).
    const soured = { ...s, approval: { p1: { p2: 0 } } } as GameState;
    expect(takes(s)).toHaveLength(1);
    expect(takes(soured)).toHaveLength(0);
  });

  it('неторгуемый ботом товар пропускается', () => {
    const s = book({ ...NEUTRAL, credits: 5000 }, [
      { id: 'lot:odd', side: 'sell', resource: 'unobtainium', price: 1, amount: 10 },
    ]);
    expect(takes(s)).toHaveLength(0);
  });

  it('одна сделка за тик, и это САМАЯ выгодная', () => {
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:meh', side: 'sell', resource: 'microelectronics', price: 3, amount: 20 },
      { id: 'lot:best', side: 'sell', resource: 'microelectronics', price: 1, amount: 20 },
    ]);
    expect(takes(s)).toEqual([{ id: 'lot:best', amount: 20 }]);
  });

  it('при равной выгоде выбор не зависит от порядка книги', () => {
    // Порядок массива книги — история чужих заказов; тай-брейк по id держит инвариант #1.
    const lots: Array<Partial<MarketOrder> & { id: string; side: 'sell'; resource: string }> = [
      { id: 'lot:b', side: 'sell', resource: 'microelectronics', price: 2, amount: 15 },
      { id: 'lot:a', side: 'sell', resource: 'microelectronics', price: 2, amount: 15 },
    ];
    const forward = book({ ...NEUTRAL, microelectronics: 25 }, lots);
    const reversed = book({ ...NEUTRAL, microelectronics: 25 }, [...lots].reverse());
    expect(takes(forward)[0]!.id).toBe('lot:a');
    expect(takes(reversed)[0]!.id).toBe('lot:a');
  });

  it('ИГРОВОЙ бот и заявку на микроэлектронику не выставляет', () => {
    // Прежний набор лотов у игрового бота: излишки на продажу и заявка на МЕТАЛЛ.
    // Заявка на микроэлектронику — новинка тест-профиля, как и снятие чужих лотов.
    const s = book({ ...NEUTRAL, credits: 4000, metal: 10, microelectronics: 10 }, []);
    const bids = (profile: 'basic' | 'test'): string[] =>
      payloads<{ side: string; resource: string }>(orders(s, profile), 'market.list')
        .filter((l) => l.side === 'buy')
        .map((l) => l.resource);
    expect(bids('basic')).toEqual(['metal']);
    expect(bids('test')).toContain('microelectronics');
  });

  it('ИГРОВОЙ бот чужих лотов не снимает', () => {
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:micro', side: 'sell', resource: 'microelectronics', price: 1, amount: 12 },
    ]);
    expect(takes(s, 'basic')).toHaveLength(0);
  });
});

describe('AI-BAL-9 — обе стороны книги живут от ОДНОЙ таблицы', () => {
  it('бот выставляет `buy` ровно на то, что готов и снимать', () => {
    // Дефицит микроэлектроники при пустой книге ⇒ собственный заказ на покупку; та же
    // нехватка при чужом лоте ⇒ снятие. Разъедься эти два места — бот покупал бы по
    // одной цене, а снимал по другой.
    const empty = book({ ...NEUTRAL, credits: 4000, microelectronics: 10 }, []);
    const lists = payloads<{ side: string; resource: string; price: number }>(
      orders(empty),
      'market.list',
    );
    const bid = lists.find((l) => l.side === 'buy' && l.resource === 'microelectronics');
    expect(bid).toBeDefined();
    const s = book({ ...NEUTRAL, credits: 4000, microelectronics: 10 }, [
      { id: 'lot:at-bid', side: 'sell', resource: 'microelectronics', price: bid!.price, amount: 5 },
    ]);
    expect(takes(s)).toHaveLength(1); // по своей же цене — снимает
  });

  it('своя цена продажи и есть порог, ниже которого бот не отдаёт', () => {
    const empty = book({ ...NEUTRAL, credits: 4000, microelectronics: 200 }, []);
    const ask = payloads<{ side: string; resource: string; price: number }>(
      orders(empty),
      'market.list',
    ).find((l) => l.side === 'sell' && l.resource === 'microelectronics')!.price;
    const below = book({ ...NEUTRAL, microelectronics: 200 }, [
      { id: 'lot:low', side: 'buy', resource: 'microelectronics', price: ask, amount: 20 },
    ]);
    expect(takes(below)).toHaveLength(0); // валовая = ask ⇒ чистая ниже ⇒ не отдаёт
  });
});

describe('AI-BAL-9 — инвариант #1 цел', () => {
  it('решение — чистая функция состояния: повтор даёт тот же набор приказов', () => {
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:micro', side: 'sell', resource: 'microelectronics', price: 2, amount: 12 },
    ]);
    const shape = (st: GameState): string =>
      JSON.stringify(orders(st).map((a) => [a.type, a.payload]));
    expect(shape(s)).toBe(shape(s));
  });

  it('книга и казна не мутируются', () => {
    const s = book({ ...NEUTRAL, microelectronics: 10 }, [
      { id: 'lot:micro', side: 'sell', resource: 'microelectronics', price: 2, amount: 12 },
    ]);
    const market = JSON.stringify(s.market);
    const purse = JSON.stringify(s.players.p2!.resources);
    orders(s);
    expect(JSON.stringify(s.market)).toBe(market);
    expect(JSON.stringify(s.players.p2!.resources)).toBe(purse);
  });
});
