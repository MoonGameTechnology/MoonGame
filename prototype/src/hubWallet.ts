/**
 * Кошелёк главного экрана (UIX-10.2, заказ владельца 2026-10-01: «на главном экране должны
 * показываться, сколько валюты есть; можно там же рядом кнопку аукциона»).
 *
 * Две валюты основной игры — две плашки с клавишей действия, как фишка Суверенов в строке
 * статуса партии:
 *  - Суверены — та же золотая стеклянная плашка с «+» (`.dl-donate`). Магазина пока нет, и
 *    нажатие говорит об этом той же строкой, что в партии (`donate.soon`).
 *  - Варранты ⌖ — кошелёк аукциона, а клавиша при нём и есть дверь в аукцион: валюта и место,
 *    где её тратят, в одной кнопке. Число — последний ответ сервера; без входа 0, как в шапке
 *    самого аукциона.
 */
import { t } from '../../localization/runtime';
import { kfmt } from './format';
import { SOV_SVG } from './icons';

export interface HubWallet {
  sovereigns: number;
  warrants: number;
}

export function hubWalletHtml(w: HubWallet): string {
  const sov = kfmt(w.sovereigns);
  const war = kfmt(w.warrants);
  return (
    `<button type="button" class="dl-donate" data-hub-wallet="donate" title="${t('hub.sovereigns')}" aria-label="${t('donate.aria', { n: sov })}">` +
    `<i aria-hidden="true">${SOV_SVG}</i><b>${sov}</b><em aria-hidden="true">+</em></button>` +
    `<button type="button" class="tw-cur tw-warrants" data-hub-wallet="auction" title="${t('hub.wallet.auction', { n: war })}" aria-label="${t('hub.wallet.auction', { n: war })}">` +
    `<i aria-hidden="true">⌖</i>${war}<span class="hw-go" aria-hidden="true">${t('hub.tile.auction')}</span></button>`
  );
}

export interface HubWalletHost {
  root: HTMLElement;
  wallet(): HubWallet;
  /** «+» у Суверенов. */
  donate(): void;
  /** Плашка Варрантов: открыть аукцион. */
  auction(): void;
}

/** Хаб зовёт `render` при каждом переходе и после ответа аукциона; нажатия ловит сам кошелёк. */
export function initHubWallet(h: HubWalletHost): { render(): void } {
  let last = '';
  const render = (): void => {
    const html = hubWalletHtml(h.wallet());
    if (html === last) return;
    h.root.innerHTML = html;
    last = html;
  };
  h.root.addEventListener('click', (ev) => {
    const go = (ev.target as Element).closest<HTMLElement>('[data-hub-wallet]')?.dataset.hubWallet;
    if (go === 'donate') h.donate();
    if (go === 'auction') h.auction();
  });
  return { render };
}
