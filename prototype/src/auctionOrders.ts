/**
 * Заказы на покупку на аукционе: форма заказа в шторке плитки «Купить» (и у
 * предмета, которого нет в продаже) и список заказов во вкладке «Мои». Заморозку,
 * лимит и выкуп держит сервер — `packages/server/src/metaOrders.ts`; здесь только показ.
 */
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { arsenalItemName } from './arsenalScreen';
import { esc, nfmt } from './format';
import { CAT_ICON, itemIcon, tierOf } from './marketParts';

/** Свой заказ, как его отдаёт `GET /meta-market` (`BuyOrderView`). */
export interface MyOrder {
  id: string;
  key: string;
  price: number;
  quantity: number;
  filled: number;
  createdAt: number;
}

export const MAX_ORDER_QUANTITY = 10;

/** Ключ типа `kind:form:defId` → предмет-образец для имени и значка. */
export function orderSample(key: string): ArsenalItem | null {
  const [kind, form, defId] = key.split(':');
  if ((kind !== 'module' && kind !== 'hull') || (form !== 'instance' && form !== 'blueprint'))
    return null;
  if (!defId) return null;
  return { itemId: key, kind, form, defId, soulbound: false, origin: 'drop', acquiredAt: 0 };
}

export const nameOf = (key: string): string => {
  const sample = orderSample(key);
  return sample ? arsenalItemName(sample) : key;
};

/** Поля заказа в шторке плитки «Купить»; `key` — тип предмета плитки. */
export function orderFormHtml(key: string, price: number, disabled: string): string {
  return `<section class="mm-order"><h4>${t('auction.order.title')}</h4><label class="mm-field">${t('auction.order.price')} <input data-mm-order-price="${esc(key)}" type="number" min="1" step="1" inputmode="numeric" value="${Math.max(1, price)}"></label><label class="mm-field">${t('auction.order.quantity')} <input data-mm-order-qty="${esc(key)}" type="number" min="1" max="${MAX_ORDER_QUANTITY}" step="1" inputmode="numeric" value="1"></label><p class="mm-fee">${t('auction.order.hold')}</p><button type="button" class="mm-ghost" data-mm-order="${esc(key)}"${disabled}>${t('auction.order.place')}</button></section>`;
}

/** Вкладка «Мои»: открытые заказы с заморозкой и отменой. */
export function myOrdersHtml(orders: readonly MyOrder[], limit: number, disabled: string): string {
  const rows = orders
    .map((o) => {
      const sample = orderSample(o.key);
      return `<article class="mm-lot r-${sample ? esc(tierOf(sample)) : 'simple'}"><span class="mm-ic" aria-hidden="true">${sample ? itemIcon(sample) : CAT_ICON.all}</span><div class="mm-lot-info"><b>${esc(nameOf(o.key))}</b><span>${t('auction.order.progress', { filled: o.filled, quantity: o.quantity, price: nfmt(o.price) })}</span><span>${t('auction.order.frozen', { n: nfmt(o.price * (o.quantity - o.filled)) })}</span></div><div class="mm-lot-side"><button type="button" class="mm-ghost" data-mm-order-cancel="${esc(o.id)}"${disabled}>${t('auction.order.cancel')}</button></div></article>`;
    })
    .join('');
  return `<h3 class="mm-sec">${t('auction.orders', { n: orders.length, max: limit })}</h3>${rows ? `<div class="mm-lots">${rows}</div>` : `<p class="hub-empty">${t('auction.orders.empty')}</p>`}`;
}
