import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadShippedData } from './scenario';
import { loadMetaEconomyCatalog, parseMetaEconomyCatalog } from './metaEconomyCatalog';
import { PROFILE_MEDALS, REGISTRATION_REWARD } from '@void/protocol';

const data = loadShippedData();
const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync('data/metaEconomy.json', 'utf8')) as Record<string, unknown>;

describe('main-game meta content', () => {
  it('reserves corporation materials for match rewards, outside craft, store and advertisement grants', () => {
    for (const path of ['match', 'recipe', 'payment', 'store', 'reward-category']) {
      const catalog = loadMetaEconomyCatalog(data);
      if (path === 'match') catalog.rewards.materials.command_cores = 1;
      if (path === 'recipe') catalog.recipes.siege_platform!.ingredients.command_cores = 1;
      if (path === 'payment') catalog.commerce.products.supply_personal!.materials!.command_cores = 1;
      if (path === 'store') Object.values(catalog.store.offers).find((offer) => offer.materials)!.materials = { command_cores: 1 };
      if (path === 'reward-category') catalog.rewards.corporationMaterials.ferroalloys = 1;
      expect(() => parseMetaEconomyCatalog(catalog, data), path).toThrow('E_META_MATERIAL_PURPOSE');
    }
  });
  it('ships five equipment and three corporation materials, six modules and a complete seasonal track', () => {
    const catalog = loadMetaEconomyCatalog(data);
    expect(Object.values(catalog.materials).filter((m) => !m.purpose)).toHaveLength(5);
    expect(Object.values(catalog.materials).filter((m) => m.purpose === 'corporation')).toHaveLength(3);
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

  it('sells each corporation base style once and never the free standard one', () => {
    const shipped = Object.values(loadMetaEconomyCatalog(data).store.offers).filter(
      (offer) => offer.corpStyle,
    );
    expect(shipped.map((offer) => offer.corpStyle).sort()).toEqual([
      'high_tech',
      'imperial_gothic',
    ]);
    expect(shipped.every((offer) => offer.category === 'styles' && offer.price)).toBe(true);
    const free = loadMetaEconomyCatalog(data);
    free.store.offers.corp_style_high_tech!.corpStyle = 'standard';
    const twice = loadMetaEconomyCatalog(data);
    twice.store.offers.corp_style_high_tech!.corpStyle = 'imperial_gothic';
    const limited = loadMetaEconomyCatalog(data);
    limited.store.offers.corp_style_high_tech!.limit = 1;
    const shelved = loadMetaEconomyCatalog(data);
    shelved.store.offers.corp_style_high_tech!.category = 'premium';
    const unpriced = loadMetaEconomyCatalog(data);
    delete unpriced.store.offers.corp_style_high_tech!.price;
    for (const catalog of [free, twice, limited, shelved, unpriced])
      expect(() => parseMetaEconomyCatalog(catalog, data)).toThrow('E_META_STORE');
  });

  it('sells each backdrop once, never the free one, and never under a style id', () => {
    const shipped = Object.values(loadMetaEconomyCatalog(data).store.offers).filter(
      (offer) => offer.corpBackdrop,
    );
    expect(shipped.map((offer) => offer.corpBackdrop).sort()).toEqual([
      'gas_giant',
      'ice_moon',
      'nebula',
    ]);
    expect(shipped.every((offer) => offer.category === 'styles' && offer.price === 290)).toBe(true);
    const free = loadMetaEconomyCatalog(data);
    free.store.offers.corp_backdrop_nebula!.corpBackdrop = 'orbit';
    const asStyle = loadMetaEconomyCatalog(data);
    asStyle.store.offers.corp_backdrop_nebula!.corpBackdrop = 'high_tech';
    const both = loadMetaEconomyCatalog(data);
    both.store.offers.corp_backdrop_nebula!.corpStyle = 'other';
    for (const catalog of [free, asStyle, both])
      expect(() => parseMetaEconomyCatalog(catalog, data)).toThrow('E_META_STORE');
  });
});

describe('profile medal rewards', () => {
  it('pays more for each higher degree', () => {
    const { medals } = loadMetaEconomyCatalog(data);
    const { 1: top, 2: middle, 3: first } = medals.grades;
    for (const key of ['sovereigns', 'warrants', 'xp'] as const) {
      expect(first[key]).toBeGreaterThan(0);
      expect(middle[key]).toBeGreaterThan(first[key]);
      expect(top[key]).toBeGreaterThan(middle[key]);
    }
  });

  // Medals earned without a match pay in full since 2026-10-30 (owner): the market gate,
  // not a Sovereigns-only rule, keeps a fresh account from trading on that XP alone.
  it('keeps everything an account earns without a match below the market gate', () => {
    const { medals, market } = loadMetaEconomyCatalog(data);
    const free = PROFILE_MEDALS.filter((m) => m.id === 'contribution' || m.id === 'tutorial');
    expect(free).toHaveLength(2);
    const xp = free.reduce<number>(
      (sum, m) => sum + (medals.sovereignsOnly.includes(m.id) ? 0 : medals.grades[3].xp),
      REGISTRATION_REWARD.xp,
    );
    expect(xp).toBeLessThan(market.minimumAccountXp);
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
