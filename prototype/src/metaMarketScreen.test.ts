import { afterEach, describe, expect, it, vi } from 'vitest';
import { initMetaMarket, metaMarketHtml } from './metaMarketScreen';

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
    expect(html).toContain('data-mm-buy="lot"');
    expect(html).toContain('data-mm-list="trade"');
    expect(html).not.toContain('data-mm-list="bound"');
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
    );
    expect(html).toContain('data-mm-list="bp"');
    expect(html).not.toContain('data-mm-list="paid"');
    expect(html).toContain('data-mm-quantity="ferroalloys" type="number" min="1" max="4"');
    expect(html).not.toContain('data-mm-material-list="energy_cells"');
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
    );
    expect(html).toContain('data-mm-material-buy="buy" disabled');
    expect(html).toContain('data-mm-material-cancel="mine">');
  });

  // «Продать» в арсенале ведёт сюда: форма продажи этой копии в фокусе, но только после
  // загрузки (раньше её перерисовка сбросила бы фокус) и только один раз.
  it('focuses the sell form of the copy the arsenal sent, once the market has loaded', async () => {
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
    const root = {
      innerHTML: '',
      addEventListener: () => {},
      querySelector: (selector: string) => ({
        scrollIntoView: () => {},
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
    expect(focused).toEqual(['[data-mm-price="drop-b"]']);
    await market.refresh();
    expect(focused).toHaveLength(1);
  });
});
