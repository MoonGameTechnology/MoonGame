import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  traderAffordable,
  traderBuyCost,
  traderSellValue,
  type Context,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';
import { traderView, TRADER_AMOUNTS } from './traderView';

const data = shippedGameData();
const cfg = data.modes.pve_waves!.trader!;
const ctx: Context = { now: 0, data, config: { timeScale: 1, modeId: 'pve_waves' } };

function world(resources: Record<string, number>, trader?: GameState['trader']): GameState {
  const s = createInitialState({ seed: 'tv', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: { me: { id: 'me', name: 'me', faction: 'x', status: 'active', resources } },
    ...(trader ? { trader } : {}),
  };
}

describe('окно торговца — что показать', () => {
  it('у каждого товара цена покупки и продажи — те же числа, что возьмёт сделка', () => {
    const v = traderView(world({ credits: 1000, metal: 500 }), cfg, ctx, 'me', 'metal', 100);
    expect(v.goods.map((g) => g.good)).toEqual(Object.keys(cfg.goods));
    const metal = v.goods.find((g) => g.good === 'metal')!;
    expect(metal.buy.credits).toBe(traderBuyCost(cfg, 'metal', 0, 100));
    expect(metal.sell.credits).toBe(traderSellValue(cfg, 'metal', 0, 100));
    expect(metal.sell.credits).toBeLessThan(metal.buy.credits);
  });

  it('кнопка гаснет, когда сделку не провести, а цена видна всё равно', () => {
    const v = traderView(world({ credits: 10, metal: 5 }), cfg, ctx, 'me', 'metal', 100);
    const metal = v.goods.find((g) => g.good === 'metal')!;
    expect([metal.buy.ok, metal.sell.ok]).toEqual([false, false]);
    expect(metal.buy.credits).toBeGreaterThan(0);
  });

  it('курс против базы — в процентах со знаком', () => {
    const v = traderView(
      world({}, { metal: { shift: 0.12, at: 0 }, energy: { shift: -0.3, at: 0 } }),
      cfg,
      ctx,
      'me',
      'metal',
      10,
    );
    expect(v.goods.find((g) => g.good === 'metal')!.shiftPct).toBe(12);
    expect(v.goods.find((g) => g.good === 'energy')!.shiftPct).toBe(-30);
  });

  it('обмен выбранного товара — на каждый другой, по выручке продажи', () => {
    const v = traderView(world({ credits: 0, metal: 500 }), cfg, ctx, 'me', 'metal', 100);
    expect(v.swaps.map((s) => s.get)).toEqual(Object.keys(cfg.goods).filter((g) => g !== 'metal'));
    const proceeds = traderSellValue(cfg, 'metal', 0, 100);
    for (const s of v.swaps) expect(s.got).toBe(traderAffordable(cfg, s.get, 0, proceeds));
    // Микроэлектроника дорогая: выручки хватает, но не всегда — кнопка честно гаснет на нуле.
    for (const s of v.swaps) expect(s.ok).toBe(s.got >= 1);
  });

  it('ряд количеств — возрастающий, от штучного до оптового', () => {
    expect([...TRADER_AMOUNTS]).toEqual([...TRADER_AMOUNTS].sort((a, b) => a - b));
    expect(TRADER_AMOUNTS[0]).toBeGreaterThanOrEqual(1);
  });
});
