/**
 * Кошелёк главного экрана (UIX-10.2, заказ владельца 2026-10-01: «на главном экране должны
 * показываться, сколько валюты есть; можно там же рядом кнопку аукциона»).
 *
 * Показываются только известные балансы; нулём неизвестный баланс не подменяется:
 *  - Суверены — та же золотая стеклянная плашка с «+» (`.dl-donate`), дверь в магазин
 *    «Снабжения» (решение владельца 2026-10-15: «магазин не скрывай»). Пока у основной
 *    игры нет авторитетного кошелька, на плашке нет числа — только знак и «+».
 *  - Варранты ⌖ — кошелёк аукциона, а клавиша при нём и есть дверь в аукцион: валюта и место,
 *    где её тратят, в одной кнопке. Число — последний ответ сервера; без входа 0, как в шапке
 *    самого аукциона.
 */
import { t } from '../../localization/runtime';
import { kfmt } from './format';
import { SOV_SVG } from './icons';

export interface HubWallet {
  sovereigns: number | null;
  warrants: number;
}

export function hubWalletHtml(w: HubWallet): string {
  const sov = w.sovereigns === null ? null : kfmt(w.sovereigns);
  const war = kfmt(w.warrants);
  return (
    `<button type="button" class="dl-donate" data-hub-wallet="donate" title="${t('hub.sovereigns')}" aria-label="${sov === null ? t('donate.open') : t('donate.aria', { n: sov })}">` +
    `<i aria-hidden="true">${SOV_SVG}</i>${sov === null ? '' : `<b>${sov}</b>`}<em aria-hidden="true">+</em>` +
    `<span class="dl-glint" aria-hidden="true"></span></button>` +
    `<button type="button" class="tw-cur tw-warrants" data-hub-wallet="auction" title="${t('hub.wallet.auction', { n: war })}" aria-label="${t('hub.wallet.auction', { n: war })}">` +
    `<i aria-hidden="true">⌖</i>${war}<span class="hw-go" aria-hidden="true">${t('hub.tile.auction')}</span></button>`
  );
}

export interface HubWalletHost {
  root: HTMLElement;
  wallet(): HubWallet;
  /** «+» у Суверенов: открыть магазин. */
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
