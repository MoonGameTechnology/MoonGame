import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import {
  traderModule,
  traderAffordable,
  traderBuyCost,
  traderSellValue,
  traderShift,
  traderShiftAfter,
} from './trader';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData, type ModeTrader } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

// Торговец экспедиции («живой курс», решение владельца 2026-09-26): покупка поднимает курс,
// продажа опускает, со временем курс возвращается к базе; продажа платит меньше покупки;
// обмен — продажа и покупка одним действием.

const TRADER: ModeTrader = {
  goods: { metal: 0.5, energy: 1, microelectronics: 6 },
  spread: 0.2,
  impact: 0.001,
  maxShift: 0.5,
  recoveryPerHour: 0.05,
};
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal', 'energy', 'microelectronics', 'food'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  modes: { run: { name: 'Run', trader: TRADER }, plain: { name: 'Plain' } },
});
const at = (now: number, modeId = 'run'): Context => ({
  now,
  data,
  config: { timeScale: 1, modeId },
});

function player(
  id: string,
  resources: Record<string, number>,
  extra: Partial<Player> = {},
): Player {
  return { id, name: id, faction: 'x', status: 'active', resources, ...extra };
}
function world(): GameState {
  const s = createInitialState({ seed: 'trd', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: {
      a: player('a', { credits: 1000, metal: 1000, energy: 100, microelectronics: 10, food: 50 }),
      pirates: player('pirates', { credits: 1000, metal: 1000 }, { npc: 'pirate' }),
      gone: player('gone', { credits: 1000, metal: 1000 }, { status: 'defeated' }),
    },
  };
}
let seq = 0;
const act = (type: string, payload: unknown, playerId = 'a'): Action => ({
  id: `t:${playerId}:${seq++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const kernel = createKernel([traderModule]);
function ok(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r.state;
}
function code(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection');
  return r.code;
}
const bag = (s: GameState, id = 'a') => s.players[id]!.resources;

describe('торговец экспедиции — цена', () => {
  it('закрытая форма цены совпадает с суммой по штукам, с упором и без', () => {
    const perUnit = (shift: number, n: number, side: 'buy' | 'sell') => {
      const base = TRADER.goods.metal!;
      let s = shift;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += base * (1 + s);
        s = traderShiftAfter(TRADER, 'metal', s, 1, side);
      }
      return sum * (1 + (side === 'buy' ? 1 : -1) * (TRADER.spread / 2));
    };
    for (const shift of [-0.5, -0.2, 0, 0.3, 0.5])
      for (const n of [1, 7, 100, 999, 2500]) {
        expect(traderBuyCost(TRADER, 'metal', shift, n)).toBe(
          Math.ceil(perUnit(shift, n, 'buy') - 1e-9),
        );
        expect(traderSellValue(TRADER, 'metal', shift, n)).toBe(
          Math.floor(perUnit(shift, n, 'sell') + 1e-9),
        );
      }
  });

  it('продажа платит меньше покупки: у базы металл 100 — купить 57, продать 43', () => {
    // Путь курса 0 → 0,05: средняя цена 0,5 × 1,02475; покупка × 1,1 = 56,4 → вверх,
    // продажа идёт вниз по курсу: 0,5 × 0,97525 × 0,9 = 43,9 → вниз.
    expect(traderBuyCost(TRADER, 'metal', 0, 100)).toBe(57);
    expect(traderSellValue(TRADER, 'metal', 0, 100)).toBe(43);
  });

  it('сдвиг не выходит за упор, а цена за упором стоит на нём', () => {
    expect(traderShiftAfter(TRADER, 'metal', 0.4, 100_000, 'buy')).toBe(0.5);
    expect(traderShiftAfter(TRADER, 'metal', -0.4, 100_000, 'sell')).toBe(-0.5);
    // Всё на упоре: 100 штук по 0,5 × 1,5 × 1,1.
    expect(traderBuyCost(TRADER, 'metal', 0.5, 100)).toBe(Math.ceil(100 * 0.5 * 1.5 * 1.1 - 1e-9));
  });

  it('бюджет покупает наибольшее число штук, которое по карману', () => {
    for (const budget of [1, 55, 56, 300, 5000]) {
      const n = traderAffordable(TRADER, 'metal', 0.1, budget);
      expect(traderBuyCost(TRADER, 'metal', 0.1, n)).toBeLessThanOrEqual(budget);
      expect(traderBuyCost(TRADER, 'metal', 0.1, n + 1)).toBeGreaterThan(budget);
    }
    expect(traderAffordable(TRADER, 'microelectronics', 0, 5)).toBe(0); // 6 × 1,1 > 5
  });

  it('курс возвращается к базе линейно и не проскакивает её', () => {
    const s = { trader: { metal: { shift: 0.3, at: 0 }, energy: { shift: -0.2, at: 0 } } };
    expect(traderShift(s, TRADER, 'metal', at(2 * MS_PER_HOUR))).toBeCloseTo(0.2, 12);
    expect(traderShift(s, TRADER, 'energy', at(2 * MS_PER_HOUR))).toBeCloseTo(-0.1, 12);
    expect(traderShift(s, TRADER, 'metal', at(100 * MS_PER_HOUR))).toBe(0);
    expect(traderShift(s, TRADER, 'energy', at(100 * MS_PER_HOUR))).toBe(0);
    expect(traderShift({}, TRADER, 'metal', at(0))).toBe(0); // без записи — база
  });
});

describe('торговец экспедиции — сделки', () => {
  it('покупка: списывает кредиты по цене, даёт товар и поднимает курс', () => {
    const s = ok(
      kernel.applyAction(world(), act('trader.buy', { resource: 'metal', amount: 100 }), at(0)),
    );
    expect([bag(s).credits, bag(s).metal]).toEqual([1000 - 57, 1100]);
    expect(s.trader?.metal).toEqual({ shift: 0.05, at: 0 });
  });

  it('продажа: забирает товар, платит кредиты и опускает курс', () => {
    const s = ok(
      kernel.applyAction(world(), act('trader.sell', { resource: 'metal', amount: 100 }), at(0)),
    );
    expect([bag(s).credits, bag(s).metal]).toEqual([1043, 900]);
    expect(s.trader?.metal).toEqual({ shift: -0.05, at: 0 });
  });

  it('купить и сразу продать — всегда в минусе: перепродажей не заработать', () => {
    for (const [good, n] of [
      ['metal', 400],
      ['energy', 60],
      ['microelectronics', 10],
    ] as const) {
      const w = world();
      w.players.a!.resources.credits = 10_000;
      const bought = ok(
        kernel.applyAction(w, act('trader.buy', { resource: good, amount: n }), at(0)),
      );
      const sold = ok(
        kernel.applyAction(bought, act('trader.sell', { resource: good, amount: n }), at(0)),
      );
      expect([good, bag(sold)[good]]).toEqual([good, w.players.a!.resources[good]]);
      expect(bag(sold).credits).toBeLessThan(10_000);
    }
  });

  it('через время курс вернулся — вторая покупка по базе', () => {
    const first = ok(
      kernel.applyAction(world(), act('trader.buy', { resource: 'metal', amount: 100 }), at(0)),
    );
    const later = ok(
      kernel.applyAction(
        first,
        act('trader.buy', { resource: 'metal', amount: 100 }),
        at(MS_PER_HOUR),
      ),
    );
    expect(bag(first).credits! - bag(later).credits!).toBe(57); // сдвиг 0,05 ушёл за час
    expect(later.trader?.metal).toEqual({ shift: 0.05, at: MS_PER_HOUR });
  });

  it('обмен: продаёт товар и на всю выручку покупает другой, сдача — кредитами', () => {
    const w = world();
    const s = ok(
      kernel.applyAction(
        w,
        act('trader.swap', { give: 'metal', get: 'energy', amount: 100 }),
        at(0),
      ),
    );
    const proceeds = traderSellValue(TRADER, 'metal', 0, 100);
    const got = traderAffordable(TRADER, 'energy', 0, proceeds);
    expect([proceeds, got]).toEqual([43, 38]);
    expect([bag(s).metal, bag(s).energy]).toEqual([900, 100 + got]);
    expect(bag(s).credits).toBe(1000 + proceeds - traderBuyCost(TRADER, 'energy', 0, got));
    expect([s.trader?.metal?.shift, s.trader?.energy?.shift]).toEqual([
      -0.05,
      traderShiftAfter(TRADER, 'energy', 0, got, 'buy'),
    ]);
  });

  it('обмен, выручки которого не хватает и на одну штуку, — отказ, и ничего не продано', () => {
    const w = world();
    const r = kernel.applyAction(
      w,
      act('trader.swap', { give: 'metal', get: 'microelectronics', amount: 2 }),
      at(0),
    );
    expect(code(r)).toBe('E_TRADE_TOO_SMALL');
  });

  it('не хватает кредитов или товара — отказ', () => {
    const w = world();
    expect(
      code(
        kernel.applyAction(
          w,
          act('trader.buy', { resource: 'microelectronics', amount: 1000 }),
          at(0),
        ),
      ),
    ).toBe('E_INSUFFICIENT');
    expect(
      code(kernel.applyAction(w, act('trader.sell', { resource: 'energy', amount: 101 }), at(0))),
    ).toBe('E_INSUFFICIENT');
    expect(
      code(
        kernel.applyAction(w, act('trader.swap', { give: 'food', get: 'metal', amount: 1 }), at(0)),
      ),
    ).toBe('E_UNKNOWN_RESOURCE'); // еды у торговца нет
  });

  it('кредиты, биомасса и чужое — не товар; кривой payload — отказ', () => {
    const w = world();
    for (const resource of ['credits', 'food', 'biomass'])
      expect(code(kernel.applyAction(w, act('trader.buy', { resource, amount: 1 }), at(0)))).toBe(
        'E_UNKNOWN_RESOURCE',
      );
    for (const amount of [0, -5, '10', Number.NaN, 100_001])
      expect(
        code(kernel.applyAction(w, act('trader.buy', { resource: 'metal', amount }), at(0))),
      ).toBe('E_BAD_PAYLOAD');
    expect(
      code(
        kernel.applyAction(
          w,
          act('trader.swap', { give: 'metal', get: 'metal', amount: 5 }),
          at(0),
        ),
      ),
    ).toBe('E_BAD_PAYLOAD');
  });

  it('режим без торговца — торговца нет; NPC и выбывший не торгуют', () => {
    const w = world();
    expect(
      code(
        kernel.applyAction(w, act('trader.buy', { resource: 'metal', amount: 1 }), at(0, 'plain')),
      ),
    ).toBe('E_NO_TRADER');
    for (const who of ['pirates', 'gone', 'nobody'])
      expect(
        code(
          kernel.applyAction(w, act('trader.sell', { resource: 'metal', amount: 1 }, who), at(0)),
        ),
      ).toBe('E_FORBIDDEN');
  });

  it('входное состояние не меняется', () => {
    const w = world();
    const before = JSON.stringify(w);
    ok(
      kernel.applyAction(
        w,
        act('trader.swap', { give: 'metal', get: 'energy', amount: 100 }),
        at(0),
      ),
    );
    expect(JSON.stringify(w)).toBe(before);
  });
});
