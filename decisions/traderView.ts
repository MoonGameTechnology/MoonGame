/**
 * Что показывает окно торговца экспедиции (решение владельца 2026-09-26, «живой курс»): по
 * каждому товару — запас, цена покупки и продажи выбранного количества, насколько курс ушёл от
 * базы, и что даст обмен выбранного количества на каждый другой товар. Числа считает ЯДРО
 * (`modules/trader.ts`) — те же функции, что исполнят сделку, поэтому цена на кнопке и цена
 * сделки не разъедутся.
 *
 * Кнопка честно гаснет, когда сделку не провести (не хватает кредитов или товара, обмен не
 * набирает ни одной единицы): игрок видит цену и тогда, когда платить нечем (EC-2.3).
 */
import {
  traderAffordable,
  traderBuyCost,
  traderSellValue,
  traderShift,
  type Context,
  type GameState,
  type ModeTrader,
} from '../packages/shared-core/src/index';

/** Сколько штук за раз — ряд кнопок окна. */
export const TRADER_AMOUNTS: readonly number[] = [10, 50, 100, 500];

export interface TraderGoodView {
  good: string;
  stock: number;
  /** Курс против базы в процентах, со знаком: +12 — на 12% дороже базы. */
  shiftPct: number;
  buy: { credits: number; ok: boolean };
  sell: { credits: number; ok: boolean };
}

export interface TraderSwapView {
  get: string;
  got: number;
  ok: boolean;
}

export interface TraderView {
  credits: number;
  goods: TraderGoodView[];
  /** Обмен `amount` штук выбранного товара на каждый другой. */
  swaps: TraderSwapView[];
}

export function traderView(
  state: GameState,
  cfg: ModeTrader,
  ctx: Context,
  me: string,
  sel: string,
  amount: number,
): TraderView {
  const res = state.players[me]?.resources ?? {};
  const credits = res.credits ?? 0;
  const goods = Object.keys(cfg.goods).map((good) => {
    const shift = traderShift(state, cfg, good, ctx);
    const stock = res[good] ?? 0;
    const buy = traderBuyCost(cfg, good, shift, amount);
    const sell = traderSellValue(cfg, good, shift, amount);
    return {
      good,
      stock,
      shiftPct: Math.round(shift * 100),
      buy: { credits: buy, ok: credits >= buy },
      sell: { credits: sell, ok: stock >= amount },
    };
  });
  const own = res[sel] ?? 0;
  const proceeds = traderSellValue(cfg, sel, traderShift(state, cfg, sel, ctx), amount);
  const swaps = Object.keys(cfg.goods)
    .filter((get) => get !== sel)
    .map((get) => {
      const got = traderAffordable(cfg, get, traderShift(state, cfg, get, ctx), proceeds);
      return { get, got, ok: own >= amount && got >= 1 };
    });
  return { credits, goods, swaps };
}
