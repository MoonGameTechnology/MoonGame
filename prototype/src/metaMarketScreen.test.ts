import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultMarketUi, initMetaMarket, metaMarketHtml } from './metaMarketScreen';
import { t } from '../../localization/runtime';
import { moduleItemEffects } from './moduleProgression';
import { esc } from './format';

afterEach(() => vi.unstubAllGlobals());

describe('meta market screen', () => {
  it('renders wallet, listings and only tradable instances in the sell section', () => {
    const tradable = {
      itemId: 'trade',
      kind: 'module' as const,
      form: 'instance' as const,
      defId: 'ion_engine',
      grade: 2,
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const bound = { ...tradable, itemId: 'bound', soulbound: true };
    const html = metaMarketHtml(
      {
        balance: 420,
        feeRate: 0.08,
        listings: [
          {
            id: 'lot',
            sellerId: 'other',
            sellerLogin: 'Rival',
            item: tradable,
            price: 75,
            createdAt: 1,
          },
        ],
      },
      [tradable, bound],
    );
    expect(html).toContain('⌖ 420');
    // «Купить»: одна плитка на тип, продавцы — после нажатия на неё.
    expect(html).toContain('data-mm-open="module:instance:ion_engine"');
    expect(html).not.toContain('data-mm-buy="lot"');
    const opened = metaMarketHtml(
      {
        balance: 420,
        feeRate: 0.08,
        listings: [
          {
            id: 'lot',
            sellerId: 'other',
            sellerLogin: 'Rival',
            item: tradable,
            price: 75,
            createdAt: 1,
          },
        ],
      },
      [],
      false,
      { ...defaultMarketUi, open: 'module:instance:ion_engine' },
    );
    expect(opened).toContain('data-mm-buy="lot"');
    // Покупатель видит фактические бонусы копии (с её звёздами) до покупки.
    const effects = moduleItemEffects(tradable);
    expect(effects.length).toBeGreaterThan(0);
    expect(opened).toContain(`<small class="mm-eff">${esc(effects.join(' · '))}</small>`);
    const sell = metaMarketHtml(
      {
        balance: 420,
        feeRate: 0.08,
        listings: [
          {
            id: 'lot',
            sellerId: 'other',
            sellerLogin: 'Rival',
            item: tradable,
            price: 75,
            createdAt: 1,
          },
        ],
      },
      [tradable, bound],
      false,
      { ...defaultMarketUi, tab: 'sell' },
    );
    expect(sell).not.toContain('data-mm-open="item:trade"'); // already listed: cannot offer twice
    expect(sell).not.toContain('data-mm-open="item:bound"');
  });

  it('offers earned blueprints and only the tradable material balance for sale', () => {
    const blueprint = {
      itemId: 'bp',
      kind: 'module' as const,
      form: 'blueprint' as const,
      defId: 'ion_engine',
      grade: 0,
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const html = metaMarketHtml(
      {
        balance: 0,
        feeRate: 0.08,
        listings: [],
        materials: [
          { id: 'ferroalloys', nameKey: 'meta.material.ferroalloys', tradable: 4, soulbound: 99 },
          { id: 'energy_cells', nameKey: 'meta.material.energy_cells', tradable: 0, soulbound: 20 },
        ],
      },
      [blueprint, { ...blueprint, itemId: 'paid', soulbound: true }],
      false,
      { ...defaultMarketUi, tab: 'sell' },
    );
    expect(html).toContain('data-mm-open="item:bp"');
    expect(html).not.toContain('data-mm-open="item:paid"');
    expect(html).toContain('data-mm-open="mat:ferroalloys"');
    expect(html).not.toContain('data-mm-open="mat:energy_cells"');
    const material = metaMarketHtml(
      {
        balance: 0,
        feeRate: 0.08,
        listings: [],
        materials: [
          { id: 'ferroalloys', nameKey: 'meta.material.ferroalloys', tradable: 4, soulbound: 99 },
        ],
      },
      [],
      false,
      { ...defaultMarketUi, tab: 'sell', open: 'mat:ferroalloys' },
    );
    expect(material).toContain('data-mm-quantity="ferroalloys" type="number" min="1" max="4"');
  });

  it('blocks purchases below the trading gate but still allows cancellation', () => {
    const lot = {
      id: 'buy',
      sellerId: 'other',
      sellerLogin: 'Rival',
      materialId: 'ferroalloys',
      quantity: 10,
      price: 30,
      createdAt: 1,
    };
    const html = metaMarketHtml(
      {
        balance: 100,
        feeRate: 0.08,
        listings: [],
        canTrade: false,
        materialListings: [lot, { ...lot, id: 'mine', mine: true }],
      },
      [],
      false,
      { ...defaultMarketUi, open: 'mat:ferroalloys' },
    );
    expect(html).toContain('data-mm-material-buy="buy" disabled');
    expect(html).toContain('data-mm-material-cancel="mine">');
    expect(html).toContain(t('err.level-required'));
  });

  it('names the account level the auction opens at when the server sends the gate', () => {
    const html = metaMarketHtml(
      { balance: 0, feeRate: 0.08, listings: [], canTrade: false, minimumAccountXp: 700 },
      [],
    );
    expect(html).toContain(t('auction.level-required', { n: 5 }));
    expect(html).not.toContain(t('err.level-required'));
  });

  // «Продать» в арсенале прокручивает к форме этой копии после загрузки,
  // но не открывает клавиатуру без нажатия на цену.
  it('scrolls to the sell form without focusing its price, once the market has loaded', async () => {
    const copy = {
      itemId: 'drop-b',
      kind: 'module' as const,
      form: 'blueprint' as const,
      defId: 'targeting_array',
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const focused: string[] = [];
    const scrolled: string[] = [];
    const root = {
      innerHTML: '',
      addEventListener: () => {},
      querySelector: (selector: string) => ({
        scrollIntoView: () => scrolled.push(selector),
        focus: () => focused.push(selector),
      }),
    };
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ balance: 0, feeRate: 0.08, listings: [] }),
      })),
    );
    const market = initMetaMarket({
      root: () => root as unknown as HTMLElement,
      arsenal: () => [copy],
      authorizedBase: async () => ({ base: 'https://srv', token: 'tok' }),
      note: () => {},
    });
    market.focusSell('drop-b');
    await market.refresh();
    expect(root.innerHTML).toContain('data-mm-price="drop-b"');
    expect(scrolled).toEqual(['[data-mm-price="drop-b"]']);
    expect(root.innerHTML).toContain('aria-current="page">' + t('auction.tab.sell'));
    expect(focused).toEqual([]);
    await market.refresh();
    expect(scrolled).toHaveLength(1);
    expect(focused).toEqual([]);
  });

  it('draws the seller shelf with used, free and level-locked places and blocks listing when full', () => {
    const copy = {
      itemId: 'c',
      kind: 'module' as const,
      form: 'instance' as const,
      defId: 'ion_engine',
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const lot = {
      id: 'mine',
      sellerId: 'me',
      sellerLogin: 'me',
      item: { ...copy, itemId: 'x' },
      price: 50,
      createdAt: 1,
      mine: true,
    };
    const html = metaMarketHtml(
      { balance: 0, feeRate: 0.08, listings: [lot], shelf: { open: 2, lockedXp: [3850] } },
      [copy],
      false,
      { ...defaultMarketUi, tab: 'sell', open: 'item:c' },
    );
    expect(html).toContain(t('auction.shelf', { n: 1, max: 2 }));
    expect(html).toContain('data-mm-cancel="mine"');
    expect(html).toContain(t('auction.shelf.free'));
    expect(html).toContain(t('auction.shelf.locked', { n: 12 }));
    expect(html).toContain('data-mm-list="c">');
    const full = metaMarketHtml(
      { balance: 0, feeRate: 0.08, listings: [lot], shelf: { open: 1, lockedXp: [] } },
      [copy],
      false,
      { ...defaultMarketUi, tab: 'sell', open: 'item:c' },
    );
    expect(full).toContain('data-mm-list="c" disabled');
    expect(full).toContain(t('auction.shelf.full'));
  });

  it('filters tiles by category', () => {
    const shield = {
      itemId: 's',
      kind: 'module' as const,
      form: 'instance' as const,
      defId: 'shield_booster',
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const view = {
      balance: 0,
      feeRate: 0.08,
      listings: [
        { id: 'l', sellerId: 'o', sellerLogin: 'o', item: shield, price: 9, createdAt: 1 },
      ],
    };
    const defense = metaMarketHtml(view, [], false, { ...defaultMarketUi, cat: 'defense' });
    expect(defense).toContain('data-mm-open="module:instance:shield_booster"');
    expect(defense).toContain(t('auction.from', { n: '9' }));
    // Каталог показывает и то, чего никто не продаёт.
    expect(defense).toContain(t('auction.none'));
    expect(metaMarketHtml(view, [], false, { ...defaultMarketUi, cat: 'weapon' })).not.toContain(
      'data-mm-open="module:instance:shield_booster"',
    );
  });

  it('lists timed lots with the server clock and opens a bid sheet with the minimum', () => {
    const item = {
      itemId: 'x',
      kind: 'module' as const,
      form: 'instance' as const,
      defId: 'ion_engine',
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const lot = {
      id: 'a1',
      sellerLogin: 'Vega',
      item,
      start: 100,
      endsAt: 1_000 + 4_718_000,
      bids: 2,
      current: 120,
      minimum: 126,
      leading: false,
      mine: false,
      createdAt: 1,
      buyout: 900,
    };
    const view = {
      balance: 500,
      feeRate: 0.08,
      listings: [],
      auctions: [lot, { ...lot, id: 'a2', leading: true }],
      serverNow: 1_000,
    };
    const list = metaMarketHtml(view, [], false, { ...defaultMarketUi, tab: 'bids' });
    expect(list).toContain('01:18:38');
    expect(list).toContain('data-mm-open="bid:a1"');
    expect(list).not.toContain('data-mm-open="bid:a2"');
    expect(list).toContain(t('auction.bid.leading'));
    const sheet = metaMarketHtml(view, [], false, {
      ...defaultMarketUi,
      tab: 'bids',
      open: 'bid:a1',
    });
    expect(sheet).toContain('data-mm-bid-amount="a1" type="number" min="126"');
    expect(sheet).toContain('data-mm-buyout="a1" data-mm-buyout-amount="900"');
    expect(sheet).toContain('class="mi-effects"');
    expect(sheet).toContain(t('auction.bid.place-do', { n: '126' }));
    expect(sheet).toContain('data-mm-step="1"');
    // «Мои → Ставки»: только лидирующий лот, его ставка заморожена в шапке.
    const mine = metaMarketHtml(view, [], false, { ...defaultMarketUi, tab: 'mine' });
    expect(mine).toContain(t('auction.bid.leader'));
    expect(mine).not.toContain('data-mm-open="bid:a1"');
    expect(mine).toContain(t('auction.order.frozen', { n: '120' }));
  });

  it('offers a timed sale in the sell sheet and shows own timed lots on the shelf', () => {
    const copy = {
      itemId: 'c',
      kind: 'module' as const,
      form: 'instance' as const,
      defId: 'ion_engine',
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const own = {
      id: 'm1',
      sellerLogin: 'me',
      item: { ...copy, itemId: 'on-auction' },
      start: 50,
      endsAt: 99_000,
      bids: 0,
      minimum: 50,
      leading: false,
      mine: true,
      createdAt: 1,
    };
    const html = metaMarketHtml(
      {
        balance: 0,
        feeRate: 0.08,
        listings: [],
        auctions: [own],
        shelf: { open: 6, lockedXp: [] },
        serverNow: 0,
      },
      [copy, own.item],
      false,
      { ...defaultMarketUi, tab: 'sell', open: 'item:c', mode: 'bid', hours: 48 },
    );
    expect(html).toContain('data-mm-auction-open="c"');
    expect(html).toContain('data-mm-hours="48" aria-pressed="true"');
    expect(html).toContain('data-mm-cancel="m1"');
    expect(html).not.toContain('data-mm-open="item:on-auction"');
    expect(html).toContain(t('auction.shelf', { n: 1, max: 6 }));
  });
  it('offers a buy order in the tile sheet, orders unlisted items and lists own orders', () => {
    const engine = {
      itemId: 'e',
      kind: 'module' as const,
      form: 'instance' as const,
      defId: 'ion_engine',
      soulbound: false,
      origin: 'drop' as const,
      acquiredAt: 1,
    };
    const view = {
      balance: 500,
      feeRate: 0.08,
      listings: [
        { id: 'l', sellerId: 'o', sellerLogin: 'o', item: engine, price: 90, createdAt: 1 },
      ],
      orders: [
        {
          id: 'o1',
          key: 'module:instance:ion_engine',
          price: 40,
          quantity: 3,
          filled: 1,
          createdAt: 2,
        },
      ],
      orderLimit: 10,
    };
    const tile = metaMarketHtml(view, [], false, {
      ...defaultMarketUi,
      open: 'module:instance:ion_engine',
    });
    expect(tile).toContain('data-mm-order="module:instance:ion_engine"');
    expect(tile).toContain(
      'data-mm-order-price="module:instance:ion_engine" type="number" min="1" step="1" inputmode="numeric" value="89"',
    );
    const fresh = metaMarketHtml(view, [], false, {
      ...defaultMarketUi,
      open: 'module:instance:cargo_bay',
    });
    expect(fresh).toContain(t('auction.none'));
    expect(fresh).toContain('data-mm-order="module:instance:cargo_bay"');
    // Заморожено в шапке: остаток заказа 2 × 40.
    expect(fresh).toContain(t('auction.order.frozen', { n: '80' }));
    const mine = metaMarketHtml(view, [], false, {
      ...defaultMarketUi,
      tab: 'mine',
      mineSeg: 'orders',
    });
    expect(mine).toContain(t('auction.orders', { n: 1, max: 10 }));
    expect(mine).toContain(t('auction.order.frozen', { n: '80' }));
    expect(mine).toContain('data-mm-order-cancel="o1"');
  });
});
