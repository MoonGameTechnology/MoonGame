import { moduleItemHtml } from './moduleProgression';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import type { MetaMaterialListing } from '../../packages/protocol/src/metaEconomy';
import type { MetaMaterialView } from '../../packages/protocol/src/metaEconomyView';
import { hasKey, t } from '../../localization/runtime';
import { refusalKeyOf } from '../../decisions/refusalText';
import { canSell } from '../../decisions/arsenalView';
import { accountLevel } from '../../decisions/playerCareer';
import { esc, nfmt } from './format';
import {
  AUCTION_CATEGORIES,
  AUCTION_HOT_MS,
  countdown,
  groupOffers,
  inCategory,
  shelfSlots,
  type AuctionCategory,
  type OfferGroup,
} from '../../decisions/auctionHouse';
import { arsenalItemName } from './arsenalScreen';
import {
  CAT_ICON,
  CAT_KEY,
  effectsLine,
  TAB_KEY,
  itemCat,
  itemIcon,
  itemKey,
  matches,
  sheet,
  stars,
  tierOf,
} from './marketParts';
import { detach } from './detach';
import { auctionTermsHtml, bidsHtml, shelfAuctionTile, type AuctionLot } from './auctionBids';

export interface Listing {
  id: string;
  sellerId: string;
  sellerLogin: string;
  item: ArsenalItem;
  price: number;
  createdAt: number;
  mine?: boolean;
}
export interface MarketView {
  balance: number;
  feeRate: number;
  listings: Listing[];
  materialListings?: Array<MetaMaterialListing & { mine?: boolean }>;
  canTrade?: boolean;
  minimumAccountXp?: number;
  materials?: MetaMaterialView[];
  /** Полка продавца от сервера; без неё (старый сервер) мест столько, сколько лотов. */
  shelf?: { open: number; lockedXp: number[] };
  /** Идущие торги (`metaAuction.ts`), без имени лидера. */
  auctions?: AuctionLot[];
  /** Часы сервера в момент ответа: таймеры торгов считаются от них, а не от часов телефона. */
  serverNow?: number;
}
export interface MetaMarketHost {
  root(): HTMLElement;
  arsenal(): readonly ArsenalItem[];
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  note(message: string): void;
  changed?(): void;
  inventoryChanged?(): Promise<void>;
}

const empty: MarketView = { balance: 0, feeRate: 0.08, listings: [] };
const materialLabel = (view: MarketView, id: string): string =>
  t(view.materials?.find((m) => m.id === id)?.nameKey ?? `meta.material.${id}`);

/** Что открыто на экране: вкладка, категория, поиск и раскрытая карточка
 *  (плитка «Купить» по ключу типа или предмет склада `item:`/`mat:`). */
export interface MarketUi {
  tab: 'buy' | 'bids' | 'sell';
  cat: AuctionCategory;
  search: string;
  open: string | null;
  /** Шторка продажи: по цене или на торги, и длительность торгов в часах. */
  mode: 'fixed' | 'bid';
  hours: number;
}
export const defaultMarketUi: MarketUi = {
  tab: 'buy',
  cat: 'all',
  search: '',
  open: null,
  mode: 'fixed',
  hours: 24,
};

type BuyOffer =
  | { id: string; price: number; key: string; kind: 'item'; lot: Listing }
  | {
      id: string;
      price: number;
      key: string;
      kind: 'material';
      lot: MetaMaterialListing & { mine?: boolean };
    };

function buyOffers(view: MarketView, ui: MarketUi): BuyOffer[] {
  const items: BuyOffer[] = view.listings
    .filter(
      (l) => inCategory(ui.cat, itemCat(l.item)) && matches(ui.search, arsenalItemName(l.item)),
    )
    .map((l) => ({ id: l.id, price: l.price, key: itemKey(l.item), kind: 'item', lot: l }));
  const materials: BuyOffer[] = (view.materialListings ?? [])
    .filter(
      (l) =>
        inCategory(ui.cat, 'material') && matches(ui.search, materialLabel(view, l.materialId)),
    )
    .map((l) => ({
      id: l.id,
      price: l.price,
      key: `mat:${l.materialId}`,
      kind: 'material',
      lot: l,
    }));
  return [...items, ...materials];
}

function offerName(view: MarketView, offer: BuyOffer): string {
  return offer.kind === 'item'
    ? arsenalItemName(offer.lot.item)
    : materialLabel(view, offer.lot.materialId);
}

function tileHtml(view: MarketView, group: OfferGroup<BuyOffer>): string {
  const first = group.offers[0]!;
  const icon = first.kind === 'item' ? itemIcon(first.lot.item) : CAT_ICON.material;
  const tier = first.kind === 'item' ? tierOf(first.lot.item) : 'simple';
  const blueprint = first.kind === 'item' && first.lot.item.form === 'blueprint';
  return `<button type="button" class="mm-tile r-${esc(tier)}" data-mm-open="${esc(group.key)}"><span class="mm-ic" aria-hidden="true">${icon}<b class="mm-count">${group.offers.length}</b></span><span class="mm-nm">${esc(offerName(view, first))}</span>${blueprint ? `<small>${t('auction.blueprint')}</small>` : ''}<span class="mm-from">${t('auction.from', { n: nfmt(group.lowest) })}</span></button>`;
}

function offerRowHtml(
  view: MarketView,
  offer: BuyOffer,
  disabled: string,
  tradeDisabled: string,
): string {
  if (offer.kind === 'material') {
    const l = offer.lot;
    return `<div class="mm-offer"><span>${esc(l.sellerLogin)} · ×${nfmt(l.quantity)}</span><b>⌖ ${nfmt(l.price)}</b><button type="button" ${l.mine ? 'data-mm-material-cancel' : 'data-mm-material-buy'}="${esc(l.id)}"${l.mine ? disabled : tradeDisabled}>${l.mine ? t('auction.cancel') : t('auction.buy')}</button></div>`;
  }
  const l = offer.lot;
  return `<div class="mm-offer r-${esc(tierOf(l.item))}"><span>${esc(l.sellerLogin)} · ${l.item.kind === 'module' && l.item.form === 'instance' ? esc(t('rarity.' + tierOf(l.item))) : ''} ${stars(l.item)}</span><b>⌖ ${nfmt(l.price)}</b><button type="button" ${l.mine ? 'data-mm-cancel' : 'data-mm-buy'}="${esc(l.id)}"${l.mine ? disabled : tradeDisabled}>${l.mine ? t('auction.cancel') : t('auction.buy')}</button>${effectsLine(l.item)}</div>`;
}

function buyHtml(view: MarketView, ui: MarketUi, disabled: string, tradeDisabled: string): string {
  const groups = groupOffers(buyOffers(view, ui), (o) => o.key);
  const any = view.listings.length + (view.materialListings?.length ?? 0) > 0;
  const grid = groups.length
    ? `<div class="mm-tiles">${groups.map((g) => tileHtml(view, g)).join('')}</div>`
    : `<p class="hub-empty">${t(any ? 'auction.no-match' : 'auction.empty')}</p>`;
  const open = groups.find((g) => g.key === ui.open);
  if (!open) return grid;
  const first = open.offers[0]!;
  return (
    grid +
    sheet(
      offerName(view, first),
      first.kind === 'item' ? itemIcon(first.lot.item) : CAT_ICON.material,
      `<p class="mm-fee">${t('auction.offers', { n: open.offers.length })}</p>${open.offers.map((o) => offerRowHtml(view, o, disabled, tradeDisabled)).join('')}`,
    )
  );
}

function sellHtml(
  view: MarketView,
  mine: readonly ArsenalItem[],
  ui: MarketUi,
  disabled: string,
  tradeDisabled: string,
  now: number,
): string {
  const myItems = view.listings.filter((l) => l.mine);
  const myMaterials = (view.materialListings ?? []).filter((l) => l.mine);
  const myAuctions = (view.auctions ?? []).filter((l) => l.mine);
  const used = myItems.length + myMaterials.length + myAuctions.length;
  const open = view.shelf?.open ?? used;
  const slots = shelfSlots(used, Math.max(open, used), view.shelf?.lockedXp ?? []);
  const lotTile = (index: number): string => {
    if (index < myItems.length) {
      const l = myItems[index]!;
      return `<div class="mm-slot used r-${esc(tierOf(l.item))}"><span class="mm-ic" aria-hidden="true">${itemIcon(l.item)}</span><span class="mm-nm">${esc(arsenalItemName(l.item))} ${stars(l.item)}</span><b>⌖ ${nfmt(l.price)}</b><button type="button" data-mm-cancel="${esc(l.id)}"${disabled}>${t('auction.cancel')}</button></div>`;
    }
    if (index >= myItems.length + myMaterials.length)
      return shelfAuctionTile(
        myAuctions[index - myItems.length - myMaterials.length]!,
        now,
        disabled,
      );
    const l = myMaterials[index - myItems.length]!;
    return `<div class="mm-slot used"><span class="mm-ic" aria-hidden="true">${CAT_ICON.material}</span><span class="mm-nm">${esc(materialLabel(view, l.materialId))} ×${nfmt(l.quantity)}</span><b>⌖ ${nfmt(l.price)}</b><button type="button" data-mm-material-cancel="${esc(l.id)}"${disabled}>${t('auction.cancel')}</button></div>`;
  };
  const shelfHtml = `<section class="mm-shelf"><h3>${t('auction.shelf', { n: used, max: Math.max(open, used) })}</h3><div class="mm-slots">${slots
    .map((s) =>
      s.state === 'used'
        ? lotTile(s.index)
        : s.state === 'free'
          ? `<div class="mm-slot free">${t('auction.shelf.free')}</div>`
          : `<div class="mm-slot locked"><span aria-hidden="true">🔒</span>${t('auction.shelf.locked', { n: accountLevel(s.xp).level })}</div>`,
    )
    .join('')}</div></section>`;
  const full = view.shelf !== undefined && used >= view.shelf.open;
  const items = mine.filter(
    (i) =>
      canSell(i) &&
      !view.listings.some((l) => l.item.itemId === i.itemId) &&
      !(view.auctions ?? []).some((l) => l.item.itemId === i.itemId) &&
      inCategory(ui.cat, itemCat(i)) &&
      matches(ui.search, arsenalItemName(i)),
  );
  const materials = (view.materials ?? []).filter(
    (m) => m.tradable > 0 && inCategory(ui.cat, 'material') && matches(ui.search, t(m.nameKey)),
  );
  const stock = [
    ...items.map(
      (i) =>
        `<button type="button" class="mm-orb r-${esc(tierOf(i))}" data-mm-open="item:${esc(i.itemId)}"><span class="mm-ic" aria-hidden="true">${itemIcon(i)}</span><span class="mm-nm">${esc(arsenalItemName(i))} ${stars(i)}</span>${i.form === 'blueprint' ? `<small>${t('auction.blueprint')}</small>` : ''}</button>`,
    ),
    ...materials.map(
      (m) =>
        `<button type="button" class="mm-orb" data-mm-open="mat:${esc(m.id)}"><span class="mm-ic" aria-hidden="true">${CAT_ICON.material}<b class="mm-count">${nfmt(m.tradable)}</b></span><span class="mm-nm">${esc(t(m.nameKey))}</span></button>`,
    ),
  ].join('');
  const listDisabled = full ? ' disabled' : tradeDisabled;
  let form = '';
  const pick = ui.open?.startsWith('item:')
    ? items.find((i) => i.itemId === ui.open!.slice(5))
    : undefined;
  const pickMat = ui.open?.startsWith('mat:')
    ? materials.find((m) => m.id === ui.open!.slice(4))
    : undefined;
  const fullNote = full ? `<p class="mm-fee">${t('auction.shelf.full')}</p>` : '';
  if (pick) {
    const modes = (['fixed', 'bid'] as const)
      .map(
        (m) =>
          `<button type="button" data-mm-mode="${m}" aria-pressed="${ui.mode === m}">${t(m === 'fixed' ? 'auction.mode.fixed' : 'auction.mode.bid')}</button>`,
      )
      .join('');
    const bid = ui.mode === 'bid';
    form = sheet(
      arsenalItemName(pick),
      itemIcon(pick),
      `${moduleItemHtml(pick)}${pick.form === 'blueprint' ? `<span class="mm-fee">${t('auction.blueprint')}</span>` : ''}<div class="mm-chips" role="group">${modes}</div><label class="mm-field">${t(bid ? 'auction.start-price' : 'auction.price')} <input data-mm-price="${esc(pick.itemId)}" type="number" min="1" step="1" inputmode="numeric" value="100"></label>${bid ? auctionTermsHtml(pick.itemId, ui.hours) : ''}<small data-mm-net="${esc(pick.itemId)}">${t('auction.net', { n: nfmt(100 - Math.ceil(100 * view.feeRate)) })}</small>${fullNote}<button type="button" class="mm-primary" ${bid ? 'data-mm-auction-open' : 'data-mm-list'}="${esc(pick.itemId)}"${listDisabled}>${t('auction.list')}</button>`,
    );
  } else if (pickMat)
    form = sheet(
      t(pickMat.nameKey),
      CAT_ICON.material,
      `<span class="mm-fee">${t('auction.available', { n: nfmt(pickMat.tradable) })}</span><label class="mm-field">${t('auction.quantity')} <input data-mm-quantity="${esc(pickMat.id)}" type="number" min="1" max="${pickMat.tradable}" step="1" inputmode="numeric" value="1"></label><label class="mm-field">${t('auction.price')} <input data-mm-material-price="${esc(pickMat.id)}" type="number" min="1" step="1" inputmode="numeric" value="100"></label>${fullNote}<button type="button" class="mm-primary" data-mm-material-list="${esc(pickMat.id)}"${listDisabled}>${t('auction.list')}</button>`,
    );
  return `${shelfHtml}<h3 class="mm-sec">${t('auction.stock')}</h3>${stock ? `<div class="mm-stock">${stock}</div>` : `<p class="hub-empty">${t('auction.no-items')}</p>`}${form}`;
}

export function metaMarketHtml(
  view: MarketView,
  mine: readonly ArsenalItem[],
  busy = false,
  ui: MarketUi = defaultMarketUi,
  now = view.serverNow ?? 0,
): string {
  const disabled = busy ? ' disabled' : '';
  const tradeDisabled = busy || view.canTrade === false ? ' disabled' : '';
  const tabs = (['buy', 'bids', 'sell'] as const)
    .map(
      (tab) =>
        `<button type="button" data-mm-tab="${tab}"${ui.tab === tab ? ' aria-current="page"' : ''}>${t(TAB_KEY[tab])}</button>`,
    )
    .join('');
  const cats = AUCTION_CATEGORIES.map(
    (c) =>
      `<button type="button" data-mm-cat="${c}" aria-pressed="${ui.cat === c}"><span aria-hidden="true">${CAT_ICON[c]}</span>${t(CAT_KEY[c])}</button>`,
  ).join('');
  const gate =
    view.canTrade === false
      ? `<p class="mm-fee">${view.minimumAccountXp === undefined ? t('err.level-required') : t('auction.level-required', { n: accountLevel(view.minimumAccountXp).level })}</p>`
      : '';
  return `<header class="mm-head"><div><strong>${t('auction.title')}</strong><small>${t('auction.fee', { n: Math.round(view.feeRate * 100) })}</small></div><b>⌖ ${nfmt(view.balance)}</b></header>${gate}<nav class="mm-tabs">${tabs}</nav><div class="mm-tools"><input type="search" data-mm-filter="search" value="${esc(ui.search)}" placeholder="${esc(t('auction.search'))}" aria-label="${esc(t('auction.search'))}"></div><nav class="mm-cats" aria-label="${esc(t('auction.cats'))}">${cats}</nav>${ui.tab === 'buy' ? buyHtml(view, ui, disabled, tradeDisabled) : ui.tab === 'bids' ? bidsHtml(view.auctions ?? [], ui.cat, ui.search, ui.open, now, tradeDisabled) : sellHtml(view, mine, ui, disabled, tradeDisabled, now)}`;
}

export function initMetaMarket(host: MetaMarketHost): {
  refresh(): Promise<void>;
  sync(): Promise<void>;
  balance(): number;
  /** «Продать» в арсенале: после ближайшей загрузки форма этой копии в фокусе. */
  focusSell(itemId: string): void;
} {
  let view = empty;
  let busy = false;
  let identity = '';
  let ui: MarketUi = { ...defaultMarketUi };
  const drafts = new Map<string, string>();
  let wantSell: string | null = null;
  const attempts = new Map<string, string>();
  /** Разница часов сервера и устройства: таймер торгов идёт по серверу. */
  let clockOffset = 0;
  const clientNow = (): number => Date.now() + clockOffset;
  let ticker: ReturnType<typeof setInterval> | null = null;
  const tick = (): void => {
    const now = clientNow();
    let ended = false;
    host
      .root()
      .querySelectorAll?.<HTMLElement>('[data-mm-end]')
      .forEach((el) => {
        const left = Number(el.dataset.mmEnd) - now;
        el.textContent = countdown(left);
        el.classList.toggle('hot', left < AUCTION_HOT_MS);
        if (left <= 0) ended = true;
      });
    // Торги вышли — сервер их уже закрыл или закроет при обзоре: перечитать один раз.
    if (ended && !busy) {
      view = { ...view, auctions: (view.auctions ?? []).filter((l) => l.endsAt > now) };
      detach('аукцион: конец торгов', refresh());
    }
  };
  const updateNet = (el: HTMLInputElement) => {
    if (!el.dataset.mmPrice) return;
    const output = host.root().querySelector(`[data-mm-net="${CSS.escape(el.dataset.mmPrice)}"]`);
    if (output)
      output.textContent = t('auction.net', {
        n: nfmt(Math.max(0, Number(el.value) - Math.ceil(Number(el.value) * view.feeRate))),
      });
  };
  const paint = () => {
    const root = host.root();
    root
      .querySelectorAll?.<HTMLInputElement>(
        'input[data-mm-price],input[data-mm-material-price],input[data-mm-quantity],input[data-mm-buyout-price]',
      )
      .forEach((el) =>
        drafts.set(
          [...el.attributes]
            .filter((a) => a.name.startsWith('data-mm-'))
            .map((a) => a.name + a.value)
            .join(''),
          el.value,
        ),
      );
    root.innerHTML = metaMarketHtml(view, host.arsenal(), busy, ui, clientNow());
    root
      .querySelectorAll?.<HTMLInputElement>(
        'input[data-mm-price],input[data-mm-material-price],input[data-mm-quantity],input[data-mm-buyout-price]',
      )
      .forEach((el) => {
        const v = drafts.get(
          [...el.attributes]
            .filter((a) => a.name.startsWith('data-mm-'))
            .map((a) => a.name + a.value)
            .join(''),
        );
        if (v !== undefined) el.value = v;
        updateNet(el);
      });
  };
  const request = async (path: string, body?: object) => {
    const auth = await host.authorizedBase();
    if (!auth) throw new Error('E_AUTH');
    const currentIdentity = auth.base + auth.token;
    if (body && currentIdentity !== identity) {
      view = empty;
      attempts.clear();
      throw new Error('E_AUTH');
    }
    if (currentIdentity !== identity) {
      identity = currentIdentity;
      attempts.clear();
      drafts.clear();
      ui = { ...defaultMarketUi };
    }
    const res = await fetch(auth.base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${auth.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = (await res.json().catch(() => ({ error: 'E_NETWORK' }))) as { error?: string };
    if (!res.ok || result.error) throw new Error(result.error ?? 'E_NETWORK');
    return result;
  };
  const load = async () => {
    const [market, economy] = await Promise.all([
      request('/meta-market'),
      request('/meta-economy/me').catch(() => ({})),
    ]);
    view = {
      ...(market as unknown as MarketView),
      materials: (economy as { materials?: MetaMaterialView[] }).materials ?? [],
    };
    if (typeof view.serverNow === 'number') clockOffset = view.serverNow - Date.now();
    if (!ticker && typeof setInterval === 'function') ticker = setInterval(tick, 1000);
    paint();
    if (wantSell) {
      ui = { ...ui, tab: 'sell', cat: 'all', search: '', open: `item:${wantSell}` };
      paint();
      const price = host
        .root()
        .querySelector<HTMLInputElement>(`[data-mm-price="${CSS.escape(wantSell)}"]`);
      price?.scrollIntoView({ block: 'center' });
      wantSell = null;
    }
    host.changed?.();
  };
  const noteError = (error: unknown) => {
    const key = refusalKeyOf(error instanceof Error ? error.message : 'E_NETWORK');
    host.note(hasKey(key) ? t(key) : t('supply.failed'));
  };
  const refresh = async () => {
    paint();
    try {
      await load();
    } catch (e) {
      wantSell = null;
      noteError(e);
    }
  };
  const sync = async () => {
    try {
      const result = await request('/meta-market');
      view = { ...(result as unknown as MarketView), materials: view.materials };
      host.changed?.();
    } catch {
      /* A guest or an unreachable server keeps the previous wallet. */
    }
  };
  const input = (attribute: string, id: string) =>
    Number(
      host.root().querySelector<HTMLInputElement>(`[${attribute}="${CSS.escape(id)}"]`)?.value,
    );
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  host.root().addEventListener('input', (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.mmFilter === 'search') {
      ui = { ...ui, search: el.value, open: null };
      const selection = el.selectionStart;
      paint();
      const next = host.root().querySelector<HTMLInputElement>('[data-mm-filter="search"]');
      next?.focus();
      if (selection !== null) next?.setSelectionRange?.(selection, selection);
    } else updateNet(el);
  });
  host.root().addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const nav = target.closest<HTMLElement>(
      '[data-mm-tab],[data-mm-cat],[data-mm-open],[data-mm-close],[data-mm-mode],[data-mm-hours]',
    );
    if (nav && (nav.dataset.mmClose === undefined || nav === target || nav.tagName === 'BUTTON')) {
      if (nav.dataset.mmTab) ui = { ...ui, tab: nav.dataset.mmTab as MarketUi['tab'], open: null };
      else if (nav.dataset.mmCat)
        ui = { ...ui, cat: nav.dataset.mmCat as AuctionCategory, open: null };
      else if (nav.dataset.mmOpen) ui = { ...ui, open: nav.dataset.mmOpen };
      else if (nav.dataset.mmMode) ui = { ...ui, mode: nav.dataset.mmMode as MarketUi['mode'] };
      else if (nav.dataset.mmHours) ui = { ...ui, hours: Number(nav.dataset.mmHours) };
      else ui = { ...ui, open: null };
      paint();
      return;
    }
    const el = target.closest<HTMLButtonElement>('button');
    if (!el || el.disabled || busy) return;
    let path: string;
    let body: Record<string, unknown>;
    let idField: 'requestId' | 'tradeId' | null = null;
    if (el.dataset.mmBuy) {
      path = '/meta-market/buy';
      body = { listingId: el.dataset.mmBuy };
      idField = 'tradeId';
    } else if (el.dataset.mmCancel) {
      path = '/meta-market/cancel';
      body = { listingId: el.dataset.mmCancel };
    } else if (el.dataset.mmList) {
      const price = input('data-mm-price', el.dataset.mmList);
      if (!positive(price)) {
        host.note(t('auction.invalid-amount'));
        return;
      }
      path = '/meta-market/list';
      body = { itemId: el.dataset.mmList, price };
    } else if (el.dataset.mmAuctionOpen) {
      const itemId = el.dataset.mmAuctionOpen;
      const start = input('data-mm-price', itemId);
      const buyoutText =
        host
          .root()
          .querySelector<HTMLInputElement>(`[data-mm-buyout-price="${CSS.escape(itemId)}"]`)
          ?.value.trim() ?? '';
      const buyout = buyoutText ? Number(buyoutText) : undefined;
      if (!positive(start) || (buyout !== undefined && !(positive(buyout) && buyout > start))) {
        host.note(t('auction.invalid-buyout'));
        return;
      }
      path = '/meta-market/auction/open';
      body = { itemId, start, hours: ui.hours, ...(buyout === undefined ? {} : { buyout }) };
    } else if (el.dataset.mmBid || el.dataset.mmBuyout) {
      const listingId = (el.dataset.mmBid ?? el.dataset.mmBuyout)!;
      const amount = el.dataset.mmBuyout
        ? Number(el.dataset.mmBuyoutAmount)
        : input('data-mm-bid-amount', listingId);
      if (!positive(amount)) {
        host.note(t('auction.invalid-amount'));
        return;
      }
      path = '/meta-market/auction/bid';
      body = { listingId, amount };
      idField = 'tradeId';
    } else if (el.dataset.mmMaterialBuy) {
      path = '/meta-market/material/buy';
      body = { listingId: el.dataset.mmMaterialBuy };
      idField = 'tradeId';
    } else if (el.dataset.mmMaterialCancel) {
      path = '/meta-market/material/cancel';
      body = { listingId: el.dataset.mmMaterialCancel };
    } else if (el.dataset.mmMaterialList) {
      const materialId = el.dataset.mmMaterialList;
      const quantity = input('data-mm-quantity', materialId);
      const price = input('data-mm-material-price', materialId);
      if (!positive(quantity) || !positive(price)) {
        host.note(t('auction.invalid-amount'));
        return;
      }
      path = '/meta-market/material/list';
      body = { materialId, quantity, price };
      idField = 'requestId';
    } else return;
    busy = true;
    paint();
    detach(
      'аукцион: действие по лоту',
      (async () => {
        try {
          const key = path + JSON.stringify(body);
          if (idField) {
            const id = attempts.get(key) ?? crypto.randomUUID();
            attempts.set(key, id);
            body[idField] = id;
          }
          await request(path, body);
          attempts.delete(key);
          view = { ...empty, canTrade: false };
          await host.inventoryChanged?.();
          await load();
        } catch (e) {
          noteError(e);
        } finally {
          busy = false;
          paint();
        }
      })(),
    );
  });
  return {
    refresh,
    sync,
    balance: () => view.balance,
    focusSell: (itemId) => {
      wantSell = itemId;
    },
  };
}
