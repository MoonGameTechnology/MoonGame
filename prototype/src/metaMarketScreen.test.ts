import { describe, expect, it } from 'vitest';
import { metaMarketHtml } from './metaMarketScreen';

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
});
