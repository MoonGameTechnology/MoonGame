/**
 * Торговец экспедиции в шипнутых данных (решение владельца 2026-09-26, «живой курс»):
 * «товары — металл, еда, энергия, микроэлектроника; валюта — кредиты». Механику держит
 * `modules/trader.test.ts`; здесь — что числа режима забега дают ту торговлю, которую
 * заказывали.
 */
import { describe, expect, it } from 'vitest';
import {
  traderBuyCost,
  traderSellValue,
  traderShiftAfter,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const trader = data.modes.pve_waves?.trader;

describe('торговец экспедиции — данные режима забега', () => {
  it('у экспедиции торговец есть; товары — четыре ресурса рынка, кредиты — валюта', () => {
    expect(trader).toBeDefined();
    expect(Object.keys(trader!.goods).sort()).toEqual([...data.market.goods].sort());
    for (const good of Object.keys(trader!.goods)) expect(data.resources).toContain(good);
    expect(trader!.goods.credits).toBeUndefined();
  });

  it('у полигона и сетевых режимов торговца нет', () => {
    const withTrader = Object.entries(data.modes)
      .filter(([, m]) => m.trader !== undefined)
      .map(([id]) => id);
    expect(withTrader).toEqual(['pve_waves']);
  });

  it('перепродажей не заработать: купить и сразу продать — в минусе на любом объёме', () => {
    for (const good of Object.keys(trader!.goods))
      for (const n of [1, 10, 100, 1000]) {
        const cost = traderBuyCost(trader!, good, 0, n);
        const after = traderShiftAfter(trader!, good, 0, n, 'buy');
        expect([good, n, traderSellValue(trader!, good, after, n) < cost]).toEqual([good, n, true]);
      }
  });
});
