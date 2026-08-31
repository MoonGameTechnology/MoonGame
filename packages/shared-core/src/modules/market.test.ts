import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { marketModule, MARKET_COMMISSION, type MarketEmbargoCapability } from './market';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';
import type { GameModule } from '../kernel/module';

// Двусторонняя книга: обе стороны кладут эскроу, комиссия 15% СГОРАЕТ, отмена без
// комиссии, товары берутся из данных, цена ≥ 1, эмбарго спрашивается капабилити.
// Слито из двух реализаций (CONV-9): форма книги от прототипа, денежные правила ядра.

/** Каталог БЕЗ белого списка — торгуется всё объявленное (историческое поведение). */
const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal', 'food'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
/** Каталог С белым списком — валюта в него намеренно не входит. */
const dataWhitelisted: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal', 'food'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  market: { goods: ['metal'] },
});
const ctx: Context = { now: 0, data };
const ctxWl: Context = { now: 0, data: dataWhitelisted };

function player(id: string, resources: Record<string, number>): Player {
  return { id, name: id, faction: 'x', status: 'active', resources };
}
function world(): GameState {
  const s = createInitialState({ seed: 'mkt', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: {
      a: player('a', { credits: 1000, metal: 100, food: 100 }),
      b: player('b', { credits: 1000, metal: 100, food: 100 }),
    },
  };
}
const act = (type: string, playerId: string, payload: unknown, seq = 1): Action => ({
  id: `s:${playerId}:${seq}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
function ok(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function err(r: ApplyResult): string {
  if (r.ok) throw new Error('expected rejection, got ok');
  return r.code;
}
const kernel = createKernel([marketModule]);
const firstId = (s: GameState): string => s.market![0]!.id;

describe('market — обе стороны книги кладут эскроу', () => {
  it('sell запирает товар, покупатель платит кредитами и получает его', () => {
    let s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 40, price: 5,
    }), ctx)).state;
    expect(s.players.a!.resources.metal).toBe(60); // товар в эскроу
    expect(s.market).toHaveLength(1);
    expect(s.market![0]).toMatchObject({ side: 'sell', owner: 'a', resource: 'metal', amount: 40 });

    s = ok(kernel.applyAction(s, act('market.take', 'b', { id: firstId(s) }), ctx)).state;
    const gross = 40 * 5;
    expect(s.players.b!.resources.metal).toBe(140); // товар доставлен
    expect(s.players.b!.resources.credits).toBe(1000 - gross); // покупатель заплатил полностью
    expect(s.players.a!.resources.credits).toBe(1000 + gross * (1 - MARKET_COMMISSION)); // 85%
    expect(s.market).toHaveLength(0);
  });

  it('buy запирает кредиты, продавец отдаёт товар и получает их', () => {
    let s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'buy', resource: 'metal', amount: 20, price: 3,
    }), ctx)).state;
    expect(s.players.a!.resources.credits).toBe(1000 - 60); // кредиты в эскроу

    s = ok(kernel.applyAction(s, act('market.take', 'b', { id: firstId(s) }), ctx)).state;
    expect(s.players.b!.resources.metal).toBe(80); // отдал товар
    expect(s.players.b!.resources.credits).toBe(1000 + 60 * (1 - MARKET_COMMISSION)); // получил 85%
    expect(s.players.a!.resources.metal).toBe(120); // товар пришёл заказчику
  });

  it('частичное заполнение оставляет остаток открытым', () => {
    let s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 40, price: 5,
    }), ctx)).state;
    s = ok(kernel.applyAction(s, act('market.take', 'b', { id: firstId(s), amount: 15 }), ctx)).state;
    expect(s.market![0]!.amount).toBe(25);
    expect(s.players.b!.resources.metal).toBe(115);
  });
});

describe('market — комиссия 15% сгорает (правило 1)', () => {
  it('сумма кредитов в мире УМЕНЬШАЕТСЯ ровно на комиссию', () => {
    const held = (s: GameState): number =>
      Object.values(s.players).reduce((n, p) => n + (p.resources.credits ?? 0), 0);
    const start = world();
    let s = ok(kernel.applyAction(start, act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 40, price: 5,
    }), ctx)).state;
    s = ok(kernel.applyAction(s, act('market.take', 'b', { id: firstId(s) }), ctx)).state;
    expect(held(start) - held(s)).toBeCloseTo(40 * 5 * MARKET_COMMISSION, 6);
  });

  it('отмена возвращает эскроу БЕЗ комиссии — держать заявку ничего не стоит', () => {
    let s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 40, price: 5,
    }), ctx)).state;
    s = ok(kernel.applyAction(s, act('market.cancel', 'a', { id: firstId(s) }), ctx)).state;
    expect(s.players.a!.resources.metal).toBe(100);
    expect(s.market).toHaveLength(0);
  });

  it('отмена buy-заявки возвращает кредиты целиком', () => {
    let s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'buy', resource: 'metal', amount: 20, price: 3,
    }), ctx)).state;
    s = ok(kernel.applyAction(s, act('market.cancel', 'a', { id: firstId(s) }), ctx)).state;
    expect(s.players.a!.resources.credits).toBe(1000);
  });
});

describe('market — товары объявляются ДАННЫМИ (правило 2)', () => {
  it('без белого списка торгуется любой объявленный ресурс', () => {
    expect(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'food', amount: 10, price: 2,
    }), ctx).ok).toBe(true);
  });

  it('с белым списком не входящий в него ресурс отклоняется', () => {
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'food', amount: 10, price: 2,
    }), ctxWl))).toBe('E_UNKNOWN_RESOURCE');
  });

  it('валюта вне белого списка — кредиты за кредиты не торгуются', () => {
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'credits', amount: 10, price: 2,
    }), ctxWl))).toBe('E_UNKNOWN_RESOURCE');
  });

  it('ресурса нет в каталоге вовсе — тоже отказ', () => {
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'nosuch', amount: 10, price: 2,
    }), ctx))).toBe('E_UNKNOWN_RESOURCE');
  });
});

describe('market — fail-secure', () => {
  it('цена 0 — не сделка, а бесплатный перевод (правило 3, SEC-A06-5)', () => {
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: 0,
    }), ctx))).toBe('E_BAD_PAYLOAD');
  });

  it('числовая СТРОКА не проходит: typeof раньше сравнения', () => {
    // '10' >= 1 и Math.floor('10') оба привелись бы — обработчик обязан проверять тип,
    // потому что негейтованный хост зовёт его напрямую.
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: '10', price: 3,
    }), ctx))).toBe('E_BAD_PAYLOAD');
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: '3',
    }), ctx))).toBe('E_BAD_PAYLOAD');
  });

  it('сторона обязательна — без неё непонятно, что класть в эскроу', () => {
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      resource: 'metal', amount: 10, price: 3,
    }), ctx))).toBe('E_BAD_PAYLOAD');
  });

  it('нечем платить эскроу — отказ, а не заявка в долг', () => {
    expect(err(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 500, price: 3,
    }), ctx))).toBe('E_INSUFFICIENT');
  });

  it('свою заявку не заполняют, чужой заявки нет — разные коды', () => {
    const s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: 3,
    }), ctx)).state;
    expect(err(kernel.applyAction(s, act('market.take', 'a', { id: firstId(s) }), ctx))).toBe('E_OWN_ORDER');
    expect(err(kernel.applyAction(s, act('market.take', 'b', { id: 'nope' }), ctx))).toBe('E_NO_ORDER');
  });

  it('чужую заявку не отменить', () => {
    const s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: 3,
    }), ctx)).state;
    expect(err(kernel.applyAction(s, act('market.cancel', 'b', { id: firstId(s) }), ctx))).toBe('E_FORBIDDEN');
  });

  it('книга не раздувается: больше 20 открытых заявок на игрока нельзя (A06)', () => {
    let s = world();
    for (let i = 0; i < 20; i++) {
      s = ok(kernel.applyAction(s, act('market.list', 'a', {
        side: 'sell', resource: 'metal', amount: 1, price: 1,
      }, i), ctx)).state;
    }
    expect(err(kernel.applyAction(s, act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 1, price: 1,
    }, 99), ctx))).toBe('E_ORDER_LIMIT');
  });
});

describe('market — эмбарго спрашивается капабилити (правило 4)', () => {
  /** Хост, объявляющий, что `a` не торгует с `b`. */
  const embargoModule: GameModule = {
    id: 'test-embargo',
    version: '1.0.0',
    setup(api) {
      api.provideCapability<MarketEmbargoCapability>('market.embargo', {
        embargoed: (_s, owner, taker) => owner === 'a' && taker === 'b',
      });
    },
  };

  it('провайдер есть — сделка отклоняется', () => {
    const k = createKernel([marketModule, embargoModule]);
    const s = ok(k.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: 3,
    }), ctx)).state;
    expect(err(k.applyAction(s, act('market.take', 'b', { id: firstId(s) }), ctx))).toBe('E_EMBARGO');
  });

  it('провайдера нет — базовый ответ «эмбарго нет», а не крах (инвариант 3)', () => {
    const s = ok(kernel.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: 3,
    }), ctx)).state;
    expect(kernel.applyAction(s, act('market.take', 'b', { id: firstId(s) }), ctx).ok).toBe(true);
  });

  it('эмбарго не мешает ВЫСТАВИТЬ заявку — только заполнить её', () => {
    const k = createKernel([marketModule, embargoModule]);
    expect(k.applyAction(world(), act('market.list', 'a', {
      side: 'sell', resource: 'metal', amount: 10, price: 3,
    }), ctx).ok).toBe(true);
  });
});
