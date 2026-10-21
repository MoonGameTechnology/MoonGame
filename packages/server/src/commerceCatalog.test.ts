import { describe, expect, it } from 'vitest';
import { commerceOffers } from './commerceCatalog';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { loadShippedData } from './scenario';

describe('published Commerce content contract', () => {
  it('matches the independent Meta entitlement allowlist and disclosed rewarded limit', () => {
    const meta = loadMetaEconomyCatalog(loadShippedData());
    const offers = commerceOffers();
    expect(offers.map((offer) => offer.productId).sort()).toEqual(
      Object.keys(meta.commerce.products).sort(),
    );
    for (const offer of offers) {
      const product = meta.commerce.products[offer.productId]!;
      expect(offer.catalogVersion).toBe(meta.version);
      expect(offer.source).toBe(product.source);
      expect(offer.contents).toEqual({
        soulbound: true,
        ...(product.materials ? { materials: product.materials } : {}),
        ...(product.module ? { moduleId: product.module } : {}),
        ...(product.premiumSeason ? { seasonId: product.premiumSeason } : {}),
        ...(product.sovereigns ? { sovereigns: product.sovereigns } : {}),
        ...(product.bonusSovereigns ? { bonusSovereigns: product.bonusSovereigns } : {}),
      });
      expect(offer.dailyLimit).toBe(
        offer.source === 'rewarded_ad' ? meta.commerce.dailyAdLimit : undefined,
      );
      expect(offer.available).toBe(false);
      expect(offer.price).toBeUndefined();
    }
  });
});
