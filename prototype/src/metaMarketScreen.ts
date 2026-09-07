import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc, nfmt } from './format';
import { arsenalItemName } from './arsenalScreen';

interface Listing {
  id: string;
  sellerId: string;
  sellerLogin: string;
  item: ArsenalItem;
  price: number;
  createdAt: number;
  mine?: boolean;
}
interface MarketView {
  balance: number;
  feeRate: number;
  listings: Listing[];
}
export interface MetaMarketHost {
  root(): HTMLElement;
  arsenal(): readonly ArsenalItem[];
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  note(message: string): void;
}

const empty: MarketView = { balance: 0, feeRate: 0.08, listings: [] };

export function metaMarketHtml(view: MarketView, mine: readonly ArsenalItem[]): string {
  const lots = view.listings
    .map(
      (l) =>
        `<article class="mm-card"><b>${esc(arsenalItemName(l.item))}</b><span>${esc(l.sellerLogin)} · ${l.item.grade ? `+${l.item.grade} · ` : ''}⌖ ${nfmt(l.price)}</span><button ${l.mine ? 'data-mm-cancel' : 'data-mm-buy'}="${esc(l.id)}">${l.mine ? t('auction.cancel') : t('auction.buy')}</button></article>`,
    )
    .join('');
  const sell = mine
    .filter((i) => i.form === 'instance' && !i.soulbound)
    .map(
      (i) =>
        `<article class="mm-card"><b>${esc(arsenalItemName(i))}</b><label>${t('auction.price')} <input data-mm-price="${esc(i.itemId)}" type="number" min="1" step="1" value="100"></label><button data-mm-list="${esc(i.itemId)}">${t('auction.list')}</button></article>`,
    )
    .join('');
  return `<header class="mm-head"><div><strong>${t('auction.title')}</strong><small>${t('auction.subtitle')}</small></div><b>⌖ ${nfmt(view.balance)}</b></header><p class="mm-fee">${t('auction.fee', { n: Math.round(view.feeRate * 100) })}</p><h3>${t('auction.browse')}</h3><div class="mm-grid">${lots || `<p class="hub-empty">${t('auction.empty')}</p>`}</div><h3>${t('auction.sell')}</h3><div class="mm-grid">${sell || `<p class="hub-empty">${t('auction.no-items')}</p>`}</div>`;
}

export function initMetaMarket(host: MetaMarketHost): { refresh(): Promise<void> } {
  let view = empty;
  const paint = () => {
    host.root().innerHTML = metaMarketHtml(view, host.arsenal());
  };
  const request = async (path: string, body?: object) => {
    const auth = await host.authorizedBase();
    if (!auth) throw new Error('E_AUTH');
    const res = await fetch(auth.base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${auth.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({ error: 'E_NETWORK' }))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? 'E_NETWORK');
    return data;
  };
  const refresh = async () => {
    paint();
    try {
      view = (await request('/meta-market')) as unknown as MarketView;
      paint();
    } catch (e) {
      host.note(e instanceof Error ? e.message : 'E_NETWORK');
    }
  };
  host.root().addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!el) return;
    void (async () => {
      try {
        if (el.dataset.mmBuy) await request('/meta-market/buy', { listingId: el.dataset.mmBuy });
        if (el.dataset.mmCancel)
          await request('/meta-market/cancel', { listingId: el.dataset.mmCancel });
        if (el.dataset.mmList) {
          const input = host
            .root()
            .querySelector(
              `[data-mm-price="${CSS.escape(el.dataset.mmList)}"]`,
            ) as HTMLInputElement | null;
          await request('/meta-market/list', {
            itemId: el.dataset.mmList,
            price: Number(input?.value),
          });
        }
        await refresh();
      } catch (e) {
        host.note(e instanceof Error ? e.message : 'E_NETWORK');
      }
    })();
  });
  return { refresh };
}
