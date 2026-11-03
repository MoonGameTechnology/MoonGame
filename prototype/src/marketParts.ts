/**
 * Общие куски разметки аукциона: значки категорий, редкость, звёзды, шторка.
 * Нужны и экрану рынка (`metaMarketScreen.ts`), и торгам (`auctionBids.ts`).
 */
import { data } from './gameData';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { moduleItemEffects } from './moduleProgression';
import { itemCategory, type AuctionCategory } from '../../decisions/auctionHouse';

/** Контурные значки макета аукциона: категория предмета, цвет даёт редкость (`--rar`). */
const GLYPH: Record<AuctionCategory | 'lock' | 'up' | 'clock', string> = {
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  weapon:
    '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.5"/>',
  defense: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8 12l3 3 5-6"/>',
  utility:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  hull: '<path d="M12 2l4 7v9l-4 4-4-4V9z"/><path d="M8 13l-4 3v3l4-1M16 13l4 3v3l-4-1"/>',
  blueprint: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  material: '<path d="M12 2l7 6-7 14-7-14z"/><path d="M5 8h14M12 2v20"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  up: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export const glyph = (name: keyof typeof GLYPH): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[name]}</svg>`;
export const CAT_ICON = Object.fromEntries(
  (Object.keys(GLYPH) as Array<keyof typeof GLYPH>).map((k) => [k, glyph(k)]),
) as Record<AuctionCategory, string>;
export const CAT_KEY: Record<AuctionCategory, string> = {
  all: 'auction.cat.all',
  weapon: 'auction.cat.weapon',
  defense: 'auction.cat.defense',
  utility: 'auction.cat.utility',
  hull: 'auction.cat.hull',
  blueprint: 'auction.cat.blueprint',
  material: 'auction.cat.material',
};
export const TAB_KEY = {
  buy: 'auction.tab.buy',
  bids: 'auction.tab.bids',
  sell: 'auction.tab.sell',
  mine: 'auction.tab.mine',
} as const;
export const itemCat = (item: ArsenalItem): AuctionCategory =>
  itemCategory({ kind: item.kind, form: item.form, slot: data.modules[item.defId]?.slot });
export const itemKey = (item: ArsenalItem): string => `${item.kind}:${item.form}:${item.defId}`;
export const itemIcon = (item: ArsenalItem): string => CAT_ICON[itemCat(item)];
export const tierOf = (item: ArsenalItem): 'simple' | 'unique' | 'mythic' | 'legendary' =>
  item.kind === 'module' ? (item.rarity ?? data.modules[item.defId]?.rarity ?? 'simple') : 'simple';
export const matches = (search: string, name: string): boolean =>
  !search.trim() || name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());

export const stars = (item: ArsenalItem): string =>
  item.grade
    ? `<span class="mm-stars" aria-label="${esc(t('module.stars', { n: item.grade, cap: data.sectorZeroStars.capByRarity?.[tierOf(item)] ?? 6 }))}">${'★'.repeat(item.grade)}</span>`
    : '';

export const sheet = (title: string, icon: string, body: string): string =>
  `<div class="mm-scrim" data-mm-close><section class="mm-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><span class="mm-ic" aria-hidden="true">${icon}</span><b>${esc(title)}</b><button type="button" class="btn-x" data-mm-close aria-label="${esc(t('auction.close'))}">×</button></header>${body}</section></div>`;

/** Фактические бонусы копии (редкость и звёзды учтены) — покупатель видит их до траты варрантов. */
export const effectsLine = (item: ArsenalItem): string => {
  const effects = moduleItemEffects(item);
  return effects.length ? `<small class="mm-eff">${esc(effects.join(' · '))}</small>` : '';
};
