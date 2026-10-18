import type { CommerceOffer } from '@void/protocol';

export const COMMERCE_CATALOG_VERSION = 'meta-v0.1';
export const COMMERCE_PRODUCTS = [
  'supply_personal',
  'module_shield_booster',
  'frontier_fleet_premium',
  'rewarded_supply',
] as const;
export type CommerceProductId = (typeof COMMERCE_PRODUCTS)[number];

/** No invented real-money prices: unconfigured products remain unavailable. */
export function commerceOffers(): CommerceOffer[] {
  return COMMERCE_PRODUCTS.map((productId) => ({
    productId,
    catalogVersion: COMMERCE_CATALOG_VERSION,
    source: productId === 'rewarded_supply' ? 'rewarded_ad' : 'payment',
    nameKey: `commerce.offer.${productId}.name`,
    contentsKey: `commerce.offer.${productId}.contents`,
    contents: {
      soulbound: true,
      ...(productId === 'supply_personal'
        ? {
            materials: {
              ferroalloys: 5,
              technical_composites: 3,
              control_circuits: 3,
              energy_cells: 2,
            },
          }
        : {}),
      ...(productId === 'rewarded_supply'
        ? {
            materials: {
              ferroalloys: 2,
              technical_composites: 2,
              control_circuits: 1,
              energy_cells: 1,
            },
          }
        : {}),
      ...(productId === 'module_shield_booster' ? { moduleId: 'shield_booster' } : {}),
      ...(productId === 'frontier_fleet_premium' ? { seasonId: 'frontier_fleet_2026' } : {}),
    },
    ...(productId === 'rewarded_supply' ? { dailyLimit: 2 } : {}),
    available: false,
    unavailableReason: 'E_COMMERCE_UNAVAILABLE',
  }));
}
