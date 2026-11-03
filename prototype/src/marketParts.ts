/**
 * Общие куски разметки аукциона: значки категорий, редкость, звёзды, шторка.
 * Нужны и экрану рынка (`metaMarketScreen.ts`), и торгам (`auctionBids.ts`).
 */
import { data } from './gameData';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { moduleIcon } from './moduleIcons';
import { itemCategory, type AuctionCategory } from '../../decisions/auctionHouse';

export const CAT_ICON: Record<AuctionCategory, string> = {
  all: '▦',
  weapon: '🎯',
  defense: '🛡',
  utility: '⊞',
  hull: '🛰',
  blueprint: '📜',
  material: '◈',
};
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
} as const;
export const itemCat = (item: ArsenalItem): AuctionCategory =>
  itemCategory({ kind: item.kind, form: item.form, slot: data.modules[item.defId]?.slot });
export const itemKey = (item: ArsenalItem): string => `${item.kind}:${item.form}:${item.defId}`;
export const itemIcon = (item: ArsenalItem): string =>
  item.kind === 'hull' ? CAT_ICON.hull : moduleIcon(item.defId);
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
