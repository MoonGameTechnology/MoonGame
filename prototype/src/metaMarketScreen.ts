import { moduleItemHtml } from './moduleProgression';
import { data } from './gameData';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import type { MetaMaterialListing } from '../../packages/protocol/src/metaEconomy';
import type { MetaMaterialView } from '../../packages/protocol/src/metaEconomyView';
import { hasKey, t } from '../../localization/runtime';
import { refusalKeyOf } from '../../decisions/refusalText';
import { canSell } from '../../decisions/arsenalView';
import { accountLevel } from '../../decisions/playerCareer';
import { esc, nfmt } from './format';
import { arsenalItemName } from './arsenalScreen';
import { detach } from './detach';

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

export interface MarketFilter { search: string; rarity: string; stars: number; sort: 'price' | 'stars' | 'new' }
const noFilter: MarketFilter = { search: '', rarity: '', stars: 0, sort: 'price' };
export function filteredModuleListings(listings: readonly Listing[], filter: MarketFilter): Listing[] {
  const query = filter.search.trim().toLocaleLowerCase();
  return listings.filter((l) => (!query || arsenalItemName(l.item).toLocaleLowerCase().includes(query)) &&
    (!filter.rarity || (l.item.rarity ?? data.modules[l.item.defId]?.rarity ?? 'simple') === filter.rarity) &&
    (l.item.grade ?? 0) >= filter.stars).sort((a, b) =>
      (filter.sort === 'stars' ? (b.item.grade ?? 0) - (a.item.grade ?? 0) : filter.sort === 'new' ? b.createdAt - a.createdAt : a.price - b.price) || a.id.localeCompare(b.id));
}
function marketFiltersHtml(filter: MarketFilter, count: number): string {
  const option = (value: string, label: string, current: string) => `<option value="${value}"${current === value ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="mm-tools"><label>${t('auction.search')}<input type="search" data-mm-filter="search" value="${esc(filter.search)}"></label><label>${t('auction.all-rarity')}<select data-mm-filter="rarity">${option('', t('auction.all-rarity'), filter.rarity)}${['simple', 'unique', 'mythic', 'legendary'].map((r) => option(r, t('rarity.' + r), filter.rarity)).join('')}</select></label><label>${t('auction.all-stars')}<select data-mm-filter="stars">${option('0', t('auction.all-stars'), String(filter.stars))}${[1, 2, 3, 4, 5, 6].map((n) => option(String(n), t('auction.star-min', { n }), String(filter.stars))).join('')}</select></label><label>${t('auction.browse')}<select data-mm-filter="sort">${['price', 'stars', 'new'].map((s) => option(s, t(({ price: 'auction.sort-price', stars: 'auction.sort-stars', new: 'auction.sort-new' } as Record<string, string>)[s]!), filter.sort)).join('')}</select></label><span role="status">${t('auction.results', { n: count })}</span></div>`;
}

export function metaMarketHtml(
  view: MarketView,
  mine: readonly ArsenalItem[],
  busy = false,
  filter: MarketFilter = noFilter,
): string {
  const disabled = busy ? ' disabled' : '';
  const tradeDisabled = busy || view.canTrade === false ? ' disabled' : '';
  const shown = filteredModuleListings(view.listings, filter);
  const lots = shown
    .map(
      (l) =>
        `<article class="mm-card"><b>${esc(arsenalItemName(l.item))}</b>${moduleItemHtml(l.item)}<span>${esc(l.sellerLogin)} · ${l.item.form === 'blueprint' ? `${t('auction.blueprint')} · ` : ''}${l.item.grade ? `+${l.item.grade} · ` : ''}⌖ ${nfmt(l.price)}</span><button type="button" ${l.mine ? 'data-mm-cancel' : 'data-mm-buy'}="${esc(l.id)}"${l.mine ? disabled : tradeDisabled}>${l.mine ? t('auction.cancel') : t('auction.buy')}</button></article>`,
    )
    .join('');
  const sell = mine
    .filter((i) => canSell(i) && !view.listings.some((l) => l.item.itemId === i.itemId))
    .map(
      (i) =>
        `<article class="mm-card"><b>${esc(arsenalItemName(i))}</b>${moduleItemHtml(i)}${i.form === 'blueprint' ? `<span>${t('auction.blueprint')}</span>` : ''}<label>${t('auction.price')} <input data-mm-price="${esc(i.itemId)}" type="number" min="1" step="1" value="100"></label><small data-mm-net="${esc(i.itemId)}">${t('auction.net', { n: nfmt(100 - Math.ceil(100 * view.feeRate)) })}</small><button type="button" data-mm-list="${esc(i.itemId)}"${tradeDisabled}>${t('auction.list')}</button></article>`,
    )
    .join('');
  const materialLots = (view.materialListings ?? [])
    .map(
      (l) =>
        `<article class="mm-card"><b>${esc(materialLabel(view, l.materialId))} ×${nfmt(l.quantity)}</b><span>${esc(l.sellerLogin)} · ⌖ ${nfmt(l.price)}</span><button type="button" ${l.mine ? 'data-mm-material-cancel' : 'data-mm-material-buy'}="${esc(l.id)}"${l.mine ? disabled : tradeDisabled}>${l.mine ? t('auction.cancel') : t('auction.buy')}</button></article>`,
    )
    .join('');
  const materialSell = (view.materials ?? [])
    .filter((m) => m.tradable > 0)
    .map(
      (m) =>
        `<article class="mm-card"><b>${esc(t(m.nameKey))}</b><span>${t('auction.available', { n: nfmt(m.tradable) })}</span><label>${t('auction.quantity')} <input data-mm-quantity="${esc(m.id)}" type="number" min="1" max="${m.tradable}" step="1" value="1"></label><label>${t('auction.price')} <input data-mm-material-price="${esc(m.id)}" type="number" min="1" step="1" value="100"></label><button type="button" data-mm-material-list="${esc(m.id)}"${tradeDisabled}>${t('auction.list')}</button></article>`,
    )
    .join('');
  return `<header class="mm-head"><div><strong>${t('auction.title')}</strong><small>${t('auction.subtitle')}</small></div><b>⌖ ${nfmt(view.balance)}</b></header><p class="mm-fee">${t('auction.fee', { n: Math.round(view.feeRate * 100) })}</p>${view.canTrade === false ? `<p class="mm-fee">${view.minimumAccountXp === undefined ? t('err.level-required') : t('auction.level-required', { n: accountLevel(view.minimumAccountXp).level })}</p>` : ''}<h3>${t('auction.browse')}</h3>${marketFiltersHtml(filter, shown.length)}<div class="mm-grid">${lots || `<p class="hub-empty">${t(view.listings.length ? 'auction.no-match' : 'auction.empty')}</p>`}</div><h3>${t('auction.materials')}</h3><div class="mm-grid">${materialLots || `<p class="hub-empty">${t('auction.empty')}</p>`}</div><h3>${t('auction.sell')}</h3><div class="mm-grid">${sell || `<p class="hub-empty">${t('auction.no-items')}</p>`}${materialSell || `<p class="hub-empty">${t('auction.no-materials')}</p>`}</div>`;
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
  let filter = { ...noFilter };
  const drafts = new Map<string, string>();
  let wantSell: string | null = null;
  const attempts = new Map<string, string>();
  const updateNet = (el: HTMLInputElement) => {
    if (!el.dataset.mmPrice) return;
    const output = host.root().querySelector(`[data-mm-net="${CSS.escape(el.dataset.mmPrice)}"]`);
    if (output) output.textContent = t('auction.net', { n: nfmt(Math.max(0, Number(el.value) - Math.ceil(Number(el.value) * view.feeRate))) });
  };
  const paint = () => {
    const root = host.root();
    root.querySelectorAll?.<HTMLInputElement>('input[data-mm-price],input[data-mm-material-price],input[data-mm-quantity]').forEach((el) => drafts.set([...el.attributes].filter((a) => a.name.startsWith('data-mm-')).map((a) => a.name + a.value).join(''), el.value));
    root.innerHTML = metaMarketHtml(view, host.arsenal(), busy, filter);
    root.querySelectorAll?.<HTMLInputElement>('input[data-mm-price],input[data-mm-material-price],input[data-mm-quantity]').forEach((el) => { const v = drafts.get([...el.attributes].filter((a) => a.name.startsWith('data-mm-')).map((a) => a.name + a.value).join('')); if (v !== undefined) el.value = v; updateNet(el); });
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
      filter = { ...noFilter };
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
    paint();
    if (wantSell) {
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
    const name = el.dataset.mmFilter;
    if (name) {
      if (name === 'search') filter.search = el.value;
      else if (name === 'rarity') filter.rarity = el.value;
      else if (name === 'stars') filter.stars = Number(el.value);
      else if (name === 'sort') filter.sort = el.value as MarketFilter['sort'];
      const selection = name === 'search' ? el.selectionStart : null;
      paint();
      const next = host.root().querySelector<HTMLInputElement>(`[data-mm-filter="${name}"]`);
      next?.focus();
      if (selection !== null) next?.setSelectionRange?.(selection, selection);
    } else updateNet(el);
  });
  host.root().addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
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
