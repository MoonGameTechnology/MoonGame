/** РЫНОК В ХОДЕ БОТА (SLIM-3): свои лоты по таблице цен и одна выгодная чужая сделка. */
import {
  MARKET_COMMISSION,
  type MarketSide,
  type Player,
} from '../../../packages/shared-core/src/index';
import { marketList, marketTake } from '../../../decisions/actions';
import { botEmbargoes } from '../botFavour';
import type { AiTurn } from './turn';

/**
 * Что СИЛЬНЫЙ БОТ думает про каждый торгуемый товар (AI-BAL-9): сколько держит про запас
 * (`keep`), почём готов купить (`bid`) и почём отдать (`ask`).
 *
 * Одна таблица на ВСЮ торговлю — и на выставление своих лотов, и на снятие чужих.
 * Держать оценку в двух местах нельзя: бот, который выставляет лот по одной цене, а
 * чужой снимает по другой, торгует сам против себя, и первым признаком была бы не
 * ошибка, а тихо изменившийся баланс.
 *
 * Товар без `ask` бот не продаёт (металл он тратит быстрее всех и отдавать его незачем),
 * товар без `bid` — не покупает (еда и энергия ему не нужны вовсе, BAL-3). Микроэлектроника
 * единственная торгуется в обе стороны, и это не прихоть: она гейтит крейсера и артиллерию
 * (`ECON-7`), но производится фабрикатором, которого у соперника может не быть, — то есть
 * ровно тот случай, когда у одного излишек, а у другого нехватка.
 */
const TRADE_BOOK: Record<string, { keep: number; bid?: number; ask?: number }> = {
  metal: { keep: 80, bid: 3 },
  microelectronics: { keep: 40, bid: 3, ask: 2 },
  food: { keep: 120, ask: 2 },
  energy: { keep: 120, ask: 2 },
};
/** Столько кредитов бот НЕ тратит на рынке — казна нужна стройке и войскам. */
const TRADE_CREDIT_FLOOR = 300;

// Trade on the session market: a passive bot liquidates the surplus goods it never
// uses (food/energy/microelectronics) into the credits it always needs, and — when
// flush — bids for the goods it burns fastest. One open lot per resource so it doesn't
// spam. Prices and working stocks come from ONE table (`TRADE_BOOK`).
export function marketOrders(bot: AiTurn, pl: Player): void {
  const { state, ai, out, skilled } = bot;
  const lots = state.market ?? [];
  const hasLot = (side: MarketSide, resource: string): boolean =>
    lots.some((l) => l.owner === ai && l.side === side && l.resource === resource);
  const stock = (good: string): number => pl.resources[good] ?? 0;
  // Порядок обхода — по ключам таблицы, а не по перебору казны: раскладка объекта
  // `resources` зависит от истории начислений, и один сид разыгрался бы по-разному.
  const goods = Object.keys(TRADE_BOOK);
  for (const good of goods) {
    const book = TRADE_BOOK[good]!;
    const have = stock(good);
    // NPC на слабом профиле получает прежний набор лотов: излишки на продажу и заявка на
    // металл. Заявка на микроэлектронику — из блока AI-BAL, она у обычных мест.
    const bid = skilled || good === 'metal' ? book.bid : undefined;
    if (book.ask !== undefined && have >= book.keep + 40 && !hasLot('sell', good)) {
      out.push(marketList(ai, 'sell', good, Math.floor((have - book.keep) / 2), book.ask));
    }
    if (
      bid !== undefined &&
      have < book.keep &&
      stock('credits') > TRADE_CREDIT_FLOOR &&
      !hasLot('buy', good)
    ) {
      out.push(marketList(ai, 'buy', good, 30, bid));
    }
  }
  // ═══ СИЛЬНЫЙ БОТ (AI-BAL-9): БОТ СНИМАЕТ ЧУЖИЕ ЛОТЫ ═══
  // Диагноз кирпича: `market.take` не звал НИКТО — за прогон ровно ноль сделок. Лоты
  // выставлялись, книга наполнялась и умирала нетронутой, а значит межигроковая
  // экономика (торговля, ценовое давление, эмбарго, комиссия-сток) не меряется вовсе.
  //
  // Правило симметрично собственным лотам и берёт цены из той же таблицы: чужой `sell`
  // снимается, когда товар нужен и просят не дороже своего `bid`; чужой `buy`
  // исполняется, когда товар в излишке и ЧИСТАЯ выручка не ниже своего `ask`. «Чистая»
  // тут не педантизм: комиссия ядра (`MARKET_COMMISSION`, 15% и она СГОРАЕТ) снимается
  // с получателя кредитов, поэтому сравнение с валовой ценой систематически завышало бы
  // выгоду — бот отдавал бы товар дешевле, чем сам его оценивает.
  //
  // Эмбарго зеркалится ЗДЕСЬ, хотя судит его ядро: `market.take` от игрока, на которого
  // владелец лота обиделся, отбивается `E_EMBARGO` — и без проверки бот сыпал бы этим
  // отказом каждые два часа на один и тот же лот. Правило то же самое (`botEmbargoes`),
  // взятое из общего места, а не переписанное здесь второй копией.
  let best: { id: string; qty: number; gain: number } | null = null;
  for (const lot of skilled ? lots : []) {
    if (lot.owner === ai || lot.amount <= 0) continue;
    if (botEmbargoes(state, lot.owner, ai)) continue;
    const book = TRADE_BOOK[lot.resource];
    if (!book) continue;
    const have = stock(lot.resource);
    let qty: number;
    let gain: number;
    if (lot.side === 'sell') {
      if (book.bid === undefined || lot.price > book.bid || have >= book.keep) continue;
      const affordable = Math.floor((stock('credits') - TRADE_CREDIT_FLOOR) / lot.price);
      qty = Math.min(lot.amount, book.keep - have, affordable);
      gain = (book.bid - lot.price) * qty;
    } else {
      if (book.ask === undefined) continue;
      const net = lot.price * (1 - MARKET_COMMISSION);
      if (net < book.ask) continue;
      qty = Math.min(lot.amount, have - book.keep);
      gain = (net - book.ask) * qty;
    }
    if (qty <= 0) continue;
    // Одна сделка за тик — как одна стройка за тик. Тай-брейк по id: выгода легко
    // совпадает у двух лотов, а порядок массива книги зависит от истории заказов.
    if (best === null || gain > best.gain || (gain === best.gain && lot.id < best.id)) {
      best = { id: lot.id, qty, gain };
    }
  }
  if (best !== null) out.push(marketTake(ai, best.id, best.qty));
}
