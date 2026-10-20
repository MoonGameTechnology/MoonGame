import { describe, expect, it } from 'vitest';
import type { CommerceOffer } from '../packages/protocol/src/commerce';
import type { MetaRecipeView, MetaStoreOfferView } from '../packages/protocol/src/metaEconomyView';
import {
  adSupply,
  bestPack,
  buyState,
  defaultPick,
  discountOf,
  moduleOfferFor,
  packTotal,
  premiumDaysLeft,
  premiumSavings,
  recipeCoverage,
  shelf,
  sovereignPacks,
} from './shopView';

const commerce = (
  productId: string,
  contents: Partial<CommerceOffer['contents']>,
  source: CommerceOffer['source'] = 'payment',
): CommerceOffer => ({
  productId,
  catalogVersion: 'v',
  source,
  nameKey: `commerce.offer.${productId}.name`,
  contentsKey: `commerce.offer.${productId}.contents`,
  contents: { soulbound: true, ...contents },
  available: false,
});

const offer = (over: Partial<MetaStoreOfferView> & { id: string }): MetaStoreOfferView => ({
  category: 'modules',
  price: 100,
  bought: 0,
  ...over,
});

describe('shopView — Суверены', () => {
  const packs = [
    commerce('sovereigns_690', { sovereigns: 600, bonusSovereigns: 90 }),
    commerce('supply_personal', { materials: { ferroalloys: 5 } }),
    commerce('sovereigns_100', { sovereigns: 100 }),
    commerce('sovereigns_7800', { sovereigns: 6000, bonusSovereigns: 1800 }),
  ];
  it('только товары с ◆, от меньшего к большему, с подарком в сумме', () => {
    const list = sovereignPacks(packs);
    expect(list.map((p) => p.productId)).toEqual([
      'sovereigns_100',
      'sovereigns_690',
      'sovereigns_7800',
    ]);
    expect(list.map(packTotal)).toEqual([100, 690, 7800]);
  });
  it('«Лучшая цена» — у самой большой доли подарка; без подарков метки нет', () => {
    expect(bestPack(sovereignPacks(packs))).toBe('sovereigns_7800');
    expect(bestPack([commerce('sovereigns_100', { sovereigns: 100 })])).toBeUndefined();
  });
  it('снабжение за рекламу — товар с источником rewarded_ad', () => {
    const ad = commerce('rewarded_supply', { materials: { ferroalloys: 2 } }, 'rewarded_ad');
    expect(adSupply([...packs, ad])).toBe(ad);
    expect(adSupply(packs)).toBeUndefined();
  });
});

describe('shopView — полки и кнопка', () => {
  const store = [
    offer({ id: 'premium_7', category: 'premium', price: 149, premiumDays: 7 }),
    offer({ id: 'premium_30', category: 'premium', price: 449, premiumDays: 30 }),
    offer({ id: 'premium_90', category: 'premium', price: 1090, premiumDays: 90 }),
    offer({ id: 'season', category: 'premium', price: 690, premiumSeason: 's' }),
    offer({ id: 'module_a', modules: [{ defId: 'a', owned: false }] }),
    offer({ id: 'module_b', modules: [{ defId: 'b', owned: true }], blocked: 'owned' }),
    offer({
      id: 'pack',
      price: 153,
      fullPrice: 180,
      modules: [
        { defId: 'a', owned: false },
        { defId: 'b', owned: true },
      ],
    }),
    offer({ id: 'mat', category: 'materials', materials: { ferroalloys: 30 } }),
  ];
  it('полка вкладки — её категория в порядке каталога; у «Суверенов» витрины нет', () => {
    expect(shelf(store, 'premium').map((o) => o.id)).toEqual([
      'premium_7',
      'premium_30',
      'premium_90',
      'season',
    ]);
    expect(shelf(store, 'materials').map((o) => o.id)).toEqual(['mat']);
    expect(shelf(store, 'sovereigns')).toEqual([]);
  });
  it('запрет сервера сильнее баланса, нехватка — числом', () => {
    const b = store.find((o) => o.id === 'module_b')!;
    expect(buyState(b, 10_000)).toEqual({ kind: 'blocked', reason: 'owned' });
    const a = store.find((o) => o.id === 'module_a')!;
    expect(buyState(a, 40)).toEqual({ kind: 'short', lack: 60 });
    expect(buyState(a, 100)).toEqual({ kind: 'buy' });
  });
  it('скидка набора — к сумме поштучно', () => {
    expect(discountOf(store.find((o) => o.id === 'pack')!)).toBe(15);
    expect(discountOf(store.find((o) => o.id === 'module_a')!)).toBe(0);
  });
  it('выгода срока — к самому короткому, по цене дня', () => {
    expect(premiumSavings(shelf(store, 'premium'))).toEqual({ premium_30: 30, premium_90: 43 });
    expect(premiumSavings([])).toEqual({});
  });
  it('модуль из Арсенала ведёт на штучный товар, пока его можно купить', () => {
    expect(moduleOfferFor(store, 'a')?.id).toBe('module_a');
    expect(moduleOfferFor(store, 'b')).toBeUndefined();
    expect(moduleOfferFor(store, 'zzz')).toBeUndefined();
  });
  it('по умолчанию открыт первый доступный товар, иначе первый', () => {
    expect(
      defaultPick([
        { id: 'x', open: false },
        { id: 'y', open: true },
      ]),
    ).toBe('y');
    expect(defaultPick([{ id: 'x', open: false }])).toBe('x');
    expect(defaultPick([])).toBeUndefined();
  });
});

describe('shopView — материалы и премиум', () => {
  const recipe = (id: string, need: Record<string, number>): MetaRecipeView => ({
    id,
    defId: id,
    ingredients: Object.entries(need).map(([materialId, required]) => ({
      materialId,
      required,
      tradable: 0,
      soulbound: 0,
    })),
    canCraft: false,
    requiresSoulbound: false,
    salvage: [],
  });
  it('покрытие рецепта — в единицах, лишнее не засчитывается', () => {
    const recipes = [
      recipe('siege', { ferroalloys: 25, technical_composites: 10, energy_cells: 8 }),
      recipe('tractor', { control_circuits: 20, technology_archives: 1 }),
      recipe('shield', { energy_cells: 12 }),
    ];
    expect(recipeCoverage({ ferroalloys: 30 }, recipes)).toEqual([
      { recipeId: 'siege', defId: 'siege', percent: 58 },
    ]);
    expect(recipeCoverage({ energy_cells: 6, control_circuits: 25 }, recipes, 2)).toEqual([
      { recipeId: 'tractor', defId: 'tractor', percent: 95 },
      { recipeId: 'shield', defId: 'shield', percent: 50 },
    ]);
  });
  it('дни премиума округляются вверх; истёкший и отсутствующий — 0', () => {
    const now = 1_000_000;
    expect(premiumDaysLeft(now + 1, now)).toBe(1);
    expect(premiumDaysLeft(now + 86_400_000 * 3, now)).toBe(3);
    expect(premiumDaysLeft(now, now)).toBe(0);
    expect(premiumDaysLeft(null, now)).toBe(0);
  });
});
