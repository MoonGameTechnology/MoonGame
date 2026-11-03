/**
 * Вкладка «Торги» аукциона: лоты со ставками и таймером, шторка ставки и торговые лоты
 * на полке продавца. Правила (заморозка ставки, шаг 5%, продление в последние 2 минуты,
 * выкуп) держит сервер — `packages/server/src/metaAuction.ts`; здесь только показ.
 */
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import {
  AUCTION_HOT_MS,
  countdown,
  inCategory,
  type AuctionCategory,
} from '../../decisions/auctionHouse';
import { arsenalItemName } from './arsenalScreen';
import { esc, nfmt } from './format';
import { moduleItemHtml } from './moduleProgression';
import { effectsLine, itemCat, itemIcon, matches, sheet, stars, tierOf } from './marketParts';

/** Лот торгов, как его отдаёт `GET /meta-market` (`AuctionLotView`): имени лидера нет. */
export interface AuctionLot {
  id: string;
  sellerLogin: string;
  item: ArsenalItem;
  start: number;
  buyout?: number;
  endsAt: number;
  bids: number;
  current?: number;
  minimum: number;
  leading: boolean;
  mine: boolean;
  createdAt: number;
}

export const AUCTION_HOURS = [12, 24, 48] as const;

const timer = (lot: AuctionLot, now: number): string =>
  `<span class="mm-timer${lot.endsAt - now < AUCTION_HOT_MS ? ' hot' : ''}" data-mm-end="${lot.endsAt}" aria-label="${esc(t('auction.bid.ends'))}">${countdown(lot.endsAt - now)}</span>`;

const price = (lot: AuctionLot): string =>
  `${lot.current === undefined ? t('auction.bid.start') : t('auction.bid.current')} <b>⌖ ${nfmt(lot.current ?? lot.start)}</b>`;

function rowHtml(lot: AuctionLot, now: number, tradeDisabled: string): string {
  const action = lot.mine
    ? `<span class="mm-pill">${t('auction.bid.mine')}</span>`
    : lot.leading
      ? `<span class="mm-pill lead">${t('auction.bid.leading')}</span>`
      : `<button type="button" class="mm-primary" data-mm-open="bid:${esc(lot.id)}"${tradeDisabled}>${t('auction.bid.place')}</button>`;
  return `<article class="mm-lot r-${esc(tierOf(lot.item))}${lot.leading ? ' lead' : ''}"><span class="mm-ic" aria-hidden="true">${itemIcon(lot.item)}</span><div class="mm-lot-info"><b>${esc(arsenalItemName(lot.item))} ${stars(lot.item)}</b><span>${esc(lot.sellerLogin)}${lot.bids ? ` · ${t('auction.bid.count', { n: lot.bids })}` : ''}</span><span>${price(lot)}</span>${lot.buyout === undefined ? '' : `<span>${t('auction.bid.buyout', { n: nfmt(lot.buyout) })}</span>`}${effectsLine(lot.item)}</div><div class="mm-lot-side">${timer(lot, now)}${action}</div></article>`;
}

export function bidsHtml(
  lots: readonly AuctionLot[],
  cat: AuctionCategory,
  search: string,
  open: string | null,
  now: number,
  tradeDisabled: string,
): string {
  const shown = lots.filter(
    (l) => inCategory(cat, itemCat(l.item)) && matches(search, arsenalItemName(l.item)),
  );
  const list = shown.length
    ? `<div class="mm-lots">${shown.map((l) => rowHtml(l, now, tradeDisabled)).join('')}</div>`
    : `<p class="hub-empty">${t(lots.length ? 'auction.no-match' : 'auction.bids-empty')}</p>`;
  const lot = open?.startsWith('bid:')
    ? lots.find((l) => l.id === open.slice(4) && !l.mine && !l.leading)
    : undefined;
  if (!lot) return list;
  return (
    list +
    sheet(
      arsenalItemName(lot.item),
      itemIcon(lot.item),
      `${moduleItemHtml(lot.item)}<dl class="mm-kv"><dt>${lot.current === undefined ? t('auction.bid.start') : t('auction.bid.current')}</dt><dd>⌖ ${nfmt(lot.current ?? lot.start)}</dd><dt>${t('auction.bid.minimum')}</dt><dd>⌖ ${nfmt(lot.minimum)}</dd><dt>${t('auction.bid.ends')}</dt><dd>${timer(lot, now)}</dd></dl><label class="mm-field">${t('auction.bid.amount')} <input data-mm-bid-amount="${esc(lot.id)}" type="number" min="${lot.minimum}" step="1" inputmode="numeric" value="${lot.minimum}"></label><p class="mm-fee">${t('auction.bid.hold')}</p><button type="button" class="mm-primary" data-mm-bid="${esc(lot.id)}"${tradeDisabled}>${t('auction.bid.place')}</button>${lot.buyout === undefined ? '' : `<button type="button" class="mm-ghost" data-mm-buyout="${esc(lot.id)}" data-mm-buyout-amount="${lot.buyout}"${tradeDisabled}>${t('auction.bid.buyout-do', { n: nfmt(lot.buyout) })}</button>`}`,
    )
  );
}

/** Свой торговый лот на полке: текущая ставка, таймер; снять можно, пока ставок нет. */
export function shelfAuctionTile(lot: AuctionLot, now: number, disabled: string): string {
  return `<div class="mm-slot used r-${esc(tierOf(lot.item))}"><span class="mm-ic" aria-hidden="true">${itemIcon(lot.item)}</span><span class="mm-nm">${esc(arsenalItemName(lot.item))} ${stars(lot.item)}</span><span class="mm-pill">${t('auction.mode.bid')}</span><b>⌖ ${nfmt(lot.current ?? lot.start)}</b>${timer(lot, now)}${lot.bids ? '' : `<button type="button" data-mm-cancel="${esc(lot.id)}"${disabled}>${t('auction.cancel')}</button>`}</div>`;
}

/** Поля продажи на торги в шторке склада. */
export function auctionTermsHtml(itemId: string, hours: number): string {
  return `<label class="mm-field">${t('auction.buyout-price')} <input data-mm-buyout-price="${esc(itemId)}" type="number" min="2" step="1" inputmode="numeric" placeholder="—"></label><div class="mm-field">${t('auction.duration')}<div class="mm-chips">${AUCTION_HOURS.map((h) => `<button type="button" data-mm-hours="${h}" aria-pressed="${h === hours}">${t('auction.hours', { n: h })}</button>`).join('')}</div></div>`;
}
