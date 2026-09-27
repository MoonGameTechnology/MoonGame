import type { GameModule, HandlerContext } from '../kernel/module';
import type { ModeTrader } from '../data/schemas';
import type { GameState } from '../state/gameState';
import { hoursToMs, type Context } from '../action/types';

/**
 * Торговец экспедиции (решение владельца 2026-09-26, «живой курс»): рынок забега без второй
 * стороны — игрок торгует с самим рынком, а цена отвечает на сделки. Книга заявок
 * (`market.ts`) в забеге бесполезна: живых игроков, выставляющих лоты, там нет. Поэтому это
 * отдельная механика, а не режим книги.
 *
 * 1. **Базовая цена — в данных режима** (`data.modes[mode].trader.goods`, кредиты за
 *    единицу). Режим без раздела `trader` торговца не имеет: действия → `E_NO_TRADER`
 *    (инвариант №3: нет данных — нет механики, и ничего не падает).
 * 2. **Покупка поднимает курс, продажа опускает.** Курс — сдвиг от базы (`shift`: 0,1 — на
 *    10% дороже). Единица товара сдвигает его на `impact × база`: вес сделки меряется
 *    кредитами, поэтому сотня металла и десяток микросхем двигают цену по своей стоимости,
 *    а не по числу штук. Сдвиг не выходит за ±`maxShift` — цена не падает до нуля.
 * 3. **Курс возвращается к базе со временем** — `recoveryPerHour` за игровой час, линейно.
 *    Без `Math.pow`: степень не обязана совпадать бит в бит между движками, а ядро
 *    детерминировано. Возврат считается лениво — в момент сделки или вопроса.
 * 4. **Продажа платит меньше покупки** (`spread`): покупка — по курсу × (1 + spread/2),
 *    продажа — × (1 − spread/2). Круг «купил — продал» всегда в минусе, и сдвиг курса от
 *    своей же сделки добавляет убытка: перепродажей не заработать.
 * 5. **Обмен — одним действием.** Продаёт товар и на ВСЮ выручку покупает другой; остаток
 *    меньше цены единицы остаётся кредитами. Выручки не хватило даже на одну единицу —
 *    отказ `E_TRADE_TOO_SMALL`, и ничего не продано.
 * 6. **Деньги округляются против игрока:** цена покупки — вверх, выручка — вниз.
 *
 * Цену считают экспортированные функции ниже — они же у окна торговца, поэтому цена на
 * кнопке и цена сделки не разъедутся. Состояние — `GameState.trader`: курс каждого товара
 * и момент, когда он записан. Оно публичное (цена рынка), туман его не режет.
 */

const MONEY = 'credits';
/** Потолок одной сделки в штуках: граница входа, а не баланс (A06 — расход ресурсов). */
export const TRADER_MAX_UNITS = 100_000;

/** Раздел торговца режима текущего матча; нет раздела — торговца нет. */
export function traderOf(ctx: Pick<Context, 'config' | 'data'>): ModeTrader | undefined {
  const modeId = ctx.config?.modeId;
  return modeId === undefined ? undefined : ctx.data.modes[modeId]?.trader;
}

/** Курс товара к моменту `ctx.now`: записанный сдвиг, вернувшийся к базе за прошедшее время
 *  (правило 3). */
export function traderShift(
  state: Pick<GameState, 'trader'>,
  cfg: ModeTrader,
  good: string,
  ctx: Context,
): number {
  const rate = state.trader?.[good];
  if (!rate) return 0;
  const back = cfg.recoveryPerHour * (Math.max(0, ctx.now - rate.at) / hoursToMs(ctx, 1));
  return rate.shift > 0 ? Math.max(0, rate.shift - back) : Math.min(0, rate.shift + back);
}

/**
 * Σ по `n` единицам множителя цены (1 + сдвиг), когда каждая единица двигает сдвиг на `step`
 * (плюс — покупка, минус — продажа), а сдвиг упирается в ±`cap`. Закрытая форма, без цикла по
 * штукам: поиск «сколько купит выручка» остаётся дешёвым.
 */
function pathSum(shift: number, step: number, n: number, cap: number): number {
  if (n <= 0) return 0;
  const room = step > 0 ? cap - shift : shift + cap; // сколько сдвига до упора
  const d = Math.abs(step);
  const free = room <= 0 ? 0 : d === 0 ? n : Math.min(n, Math.ceil(room / d));
  const linear = free * (1 + shift) + (step * free * (free - 1)) / 2;
  return linear + (n - free) * (1 + (step > 0 ? cap : -cap));
}

/** Цена покупки `n` штук при курсе `shift`, кредиты, вверх (правило 6). */
export function traderBuyCost(cfg: ModeTrader, good: string, shift: number, n: number): number {
  const base = cfg.goods[good] ?? 0;
  const raw = base * (1 + cfg.spread / 2) * pathSum(shift, base * cfg.impact, n, cfg.maxShift);
  return Math.ceil(raw - 1e-9);
}

/** Выручка за продажу `n` штук при курсе `shift`, кредиты, вниз (правило 6). */
export function traderSellValue(cfg: ModeTrader, good: string, shift: number, n: number): number {
  const base = cfg.goods[good] ?? 0;
  const raw = base * (1 - cfg.spread / 2) * pathSum(shift, -base * cfg.impact, n, cfg.maxShift);
  return Math.max(0, Math.floor(raw + 1e-9));
}

/** Курс после сделки в `n` штук: покупка поднимает, продажа опускает, в пределах ±`maxShift`. */
export function traderShiftAfter(
  cfg: ModeTrader,
  good: string,
  shift: number,
  n: number,
  side: 'buy' | 'sell',
): number {
  const move = (cfg.goods[good] ?? 0) * cfg.impact * n;
  const next = side === 'buy' ? shift + move : shift - move;
  return Math.max(-cfg.maxShift, Math.min(cfg.maxShift, next));
}

/** Сколько штук `good` купит `budget` кредитов при курсе `shift`: наибольшее n, чья цена не
 *  выше бюджета. Цена растёт с n, поэтому — двоичный поиск. */
export function traderAffordable(
  cfg: ModeTrader,
  good: string,
  shift: number,
  budget: number,
): number {
  const base = cfg.goods[good] ?? 0;
  if (!(base > 0) || !(budget > 0)) return 0;
  // Дешевле упора единица не бывает — это верхняя граница поиска.
  const cheapest = base * (1 + cfg.spread / 2) * (1 - cfg.maxShift);
  let lo = 0;
  let hi = Math.min(TRADER_MAX_UNITS, Math.floor(budget / cheapest) + 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (traderBuyCost(cfg, good, shift, mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Штуки из payload: целое ≥ 1 и не больше потолка; иначе — null. `typeof` первым: строка с
 *  числом прошла бы сравнения через приведение (как в `market.ts`). */
function units(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 1 && n <= TRADER_MAX_UNITS ? n : null;
}

/** Казна того, кто торгует; `null` — торговать ему нельзя. Торгует живой игрок стола: не
 *  NPC (у них своя экономика) и не выбывший. Fail-secure: нет строки игрока — отказ. */
function treasuryOf(h: HandlerContext, playerId: string): Record<string, number> | null {
  const player = h.state.players[playerId];
  if (!player || player.npc || player.status !== 'active' || h.state.pve?.npcPlayerId === playerId)
    return null;
  return player.resources;
}

function record(h: HandlerContext, good: string, shift: number): void {
  (h.state.trader ??= {})[good] = { shift, at: h.ctx.now };
}

export const traderModule: GameModule = {
  id: 'trader',
  version: '1.0.0',
  setup(api) {
    api.onAction('trader.buy', (action, h) => {
      const p = action.payload as { resource?: unknown; amount?: unknown };
      const n = units(p?.amount);
      if (typeof p?.resource !== 'string' || n === null) return h.reject('E_BAD_PAYLOAD');
      const cfg = traderOf(h.ctx);
      if (!cfg) return h.reject('E_NO_TRADER');
      const bag = treasuryOf(h, action.playerId);
      if (!bag) return h.reject('E_FORBIDDEN');
      if (!(p.resource in cfg.goods)) return h.reject('E_UNKNOWN_RESOURCE');
      const shift = traderShift(h.state, cfg, p.resource, h.ctx);
      const cost = traderBuyCost(cfg, p.resource, shift, n);
      if ((bag[MONEY] ?? 0) < cost) return h.reject('E_INSUFFICIENT');
      bag[MONEY] = (bag[MONEY] ?? 0) - cost;
      bag[p.resource] = (bag[p.resource] ?? 0) + n;
      record(h, p.resource, traderShiftAfter(cfg, p.resource, shift, n, 'buy'));
      h.emit('trader.bought', {
        owner: action.playerId,
        resource: p.resource,
        amount: n,
        credits: cost,
      });
    });

    api.onAction('trader.sell', (action, h) => {
      const p = action.payload as { resource?: unknown; amount?: unknown };
      const n = units(p?.amount);
      if (typeof p?.resource !== 'string' || n === null) return h.reject('E_BAD_PAYLOAD');
      const cfg = traderOf(h.ctx);
      if (!cfg) return h.reject('E_NO_TRADER');
      const bag = treasuryOf(h, action.playerId);
      if (!bag) return h.reject('E_FORBIDDEN');
      if (!(p.resource in cfg.goods)) return h.reject('E_UNKNOWN_RESOURCE');
      if ((bag[p.resource] ?? 0) < n) return h.reject('E_INSUFFICIENT');
      const shift = traderShift(h.state, cfg, p.resource, h.ctx);
      const credits = traderSellValue(cfg, p.resource, shift, n);
      bag[p.resource] = (bag[p.resource] ?? 0) - n;
      bag[MONEY] = (bag[MONEY] ?? 0) + credits;
      record(h, p.resource, traderShiftAfter(cfg, p.resource, shift, n, 'sell'));
      h.emit('trader.sold', { owner: action.playerId, resource: p.resource, amount: n, credits });
    });

    api.onAction('trader.swap', (action, h) => {
      const p = action.payload as { give?: unknown; get?: unknown; amount?: unknown };
      const n = units(p?.amount);
      if (
        typeof p?.give !== 'string' ||
        typeof p?.get !== 'string' ||
        n === null ||
        p.give === p.get
      )
        return h.reject('E_BAD_PAYLOAD');
      const cfg = traderOf(h.ctx);
      if (!cfg) return h.reject('E_NO_TRADER');
      const bag = treasuryOf(h, action.playerId);
      if (!bag) return h.reject('E_FORBIDDEN');
      if (!(p.give in cfg.goods) || !(p.get in cfg.goods)) return h.reject('E_UNKNOWN_RESOURCE');
      if ((bag[p.give] ?? 0) < n) return h.reject('E_INSUFFICIENT');
      const giveShift = traderShift(h.state, cfg, p.give, h.ctx);
      const proceeds = traderSellValue(cfg, p.give, giveShift, n);
      const getShift = traderShift(h.state, cfg, p.get, h.ctx);
      const got = traderAffordable(cfg, p.get, getShift, proceeds);
      if (got < 1) return h.reject('E_TRADE_TOO_SMALL'); // правило 5: ничего не продано
      const change = proceeds - traderBuyCost(cfg, p.get, getShift, got);
      bag[p.give] = (bag[p.give] ?? 0) - n;
      bag[p.get] = (bag[p.get] ?? 0) + got;
      bag[MONEY] = (bag[MONEY] ?? 0) + change;
      record(h, p.give, traderShiftAfter(cfg, p.give, giveShift, n, 'sell'));
      record(h, p.get, traderShiftAfter(cfg, p.get, getShift, got, 'buy'));
      h.emit('trader.swapped', {
        owner: action.playerId,
        give: p.give,
        gave: n,
        get: p.get,
        got,
        change,
      });
    });
  },
};
