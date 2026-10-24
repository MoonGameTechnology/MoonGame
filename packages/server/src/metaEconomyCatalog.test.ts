import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadShippedData } from './scenario';
import { loadMetaEconomyCatalog, parseMetaEconomyCatalog } from './metaEconomyCatalog';

const data = loadShippedData();
const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync('data/metaEconomy.json', 'utf8')) as Record<string, unknown>;

describe('main-game meta content', () => {
  it('ships five useful materials, six existing modules and a complete seasonal track', () => {
    const catalog = loadMetaEconomyCatalog(data);
    expect(Object.keys(catalog.materials)).toHaveLength(5);
    expect(Object.keys(catalog.recipes)).toHaveLength(6);
    expect(catalog.seasons[0]).toMatchObject({ durationDays: 56, levels: 50 });
    expect(catalog.seasons[0]!.milestones.map((row) => row.level)).toEqual([1, 10, 20, 30, 40, 50]);
    expect(catalog.seasons[0]!.contracts).toHaveLength(8);
  });

  it('rejects dangling material/module references and salvage multiplication', () => {
    const catalog = loadMetaEconomyCatalog(data);
    expect(() =>
      parseMetaEconomyCatalog(
        {
          ...catalog,
          recipes: {
            ...catalog.recipes,
            bad: { defId: 'missing', ingredients: { ferroalloys: 1 }, salvage: { ferroalloys: 1 } },
          },
        },
        data,
      ),
    ).toThrow('E_META_MODULE');
    expect(() =>
      parseMetaEconomyCatalog(
        { ...catalog, rewards: { ...catalog.rewards, materials: { fake: 3 } } },
        data,
      ),
    ).toThrow('E_META_MATERIAL');
    catalog.recipes.siege_platform!.salvage.ferroalloys = 25;
    expect(() => parseMetaEconomyCatalog(catalog, data)).toThrow('E_META_SALVAGE');
  });

  it('rejects unordered stage budgets and advertising season XP bypasses', () => {
    const catalog = loadMetaEconomyCatalog(data);
    catalog.rewards.stageFractions = [0.5, 0.25];
    expect(() => parseMetaEconomyCatalog(catalog, data)).toThrow('E_META_STAGES');
    const other = loadMetaEconomyCatalog(data);
    other.commerce.products.rewarded_supply!.premiumSeason = other.seasons[0]!.id;
    expect(() => parseMetaEconomyCatalog(other, data)).toThrow('E_META_AD_PRODUCT');
    expect(() => parseMetaEconomyCatalog({ ...raw(), typo: true }, data)).toThrow();
  });

  it('requires a presence rule for every stage, never easing towards later stages', () => {
    const shipped = loadMetaEconomyCatalog(data).rewards.participation;
    expect(shipped).toMatchObject({ stageDays: [3, 7], finalPresence: 0.25 });
    for (const stageDays of [[3], [7, 3]]) {
      const catalog = loadMetaEconomyCatalog(data);
      catalog.rewards.participation.stageDays = stageDays;
      expect(() => parseMetaEconomyCatalog(catalog, data)).toThrow('E_META_PARTICIPATION');
    }
    const catalog = loadMetaEconomyCatalog(data);
    catalog.rewards.participation.finalPresence = 0;
    expect(() => parseMetaEconomyCatalog(catalog, data)).toThrow();
  });

  it('keeps every store offer to one kind of goods with a price the server can compute', () => {
    const shipped = loadMetaEconomyCatalog(data);
    expect(Object.keys(shipped.store.offers).length).toBeGreaterThan(0);
    const mixed = loadMetaEconomyCatalog(data);
    mixed.store.offers.premium_7!.materials = { ferroalloys: 1 };
    expect(() => parseMetaEconomyCatalog(mixed, data)).toThrow('E_META_STORE');
    const unpriced = loadMetaEconomyCatalog(data);
    unpriced.store.offers.pack_full!.modules!.push('cargo_bay');
    expect(() => parseMetaEconomyCatalog(unpriced, data)).toThrow('E_META_STORE');
    const adCurrency = loadMetaEconomyCatalog(data);
    adCurrency.commerce.products.rewarded_supply!.sovereigns = 10;
    expect(() => parseMetaEconomyCatalog(adCurrency, data)).toThrow('E_META_AD_PRODUCT');
  });
});

describe('profile medal rewards', () => {
  it('pays more for each higher degree and only Sovereigns for medals earned without play', () => {
    const { medals } = loadMetaEconomyCatalog(data);
    const { 1: top, 2: middle, 3: first } = medals.grades;
    for (const key of ['sovereigns', 'warrants', 'xp'] as const) {
      expect(first[key]).toBeGreaterThan(0);
      expect(middle[key]).toBeGreaterThan(first[key]);
      expect(top[key]).toBeGreaterThan(middle[key]);
    }
    expect(medals.sovereignsOnly).toEqual(['contribution', 'tutorial']);
  });

  it('rejects an unknown medal and a missing degree', () => {
    const catalog = loadMetaEconomyCatalog(data);
    expect(() =>
      parseMetaEconomyCatalog(
        { ...catalog, medals: { ...catalog.medals, sovereignsOnly: ['nonexistent'] } },
        data,
      ),
    ).toThrow('E_META_MEDAL');
    const { 1: _top, ...partial } = catalog.medals.grades;
    expect(() =>
      parseMetaEconomyCatalog({ ...catalog, medals: { ...catalog.medals, grades: partial } }, data),
    ).toThrow();
  });
});
