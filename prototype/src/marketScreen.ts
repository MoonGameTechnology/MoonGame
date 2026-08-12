/**
 * Session market screen (ECON-4, REFM-6) — the in-match two-sided order book: sell
 * lots (asks) and buy lots (bids) per tradeable good, one tab each. You place your
 * own, or take a rival's.
 *
 * `sessionMarket.ts` next door is the MODEL (the kernel module, escrow, the fee);
 * `actions.ts` builds the orders. This is the window: markup + the two bits of view
 * state the box owns (which good is open, which side the form is composing).
 *
 * Same REFM shape as the other screens — the markup is pure (`marketBoxHtml`,
 * `netNoteText`), and only `initMarket(host)` touches the host, through explicit
 * hooks instead of `main.ts`'s module-level state.
 */
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc, curIc } from './format';
import { marketLots, MARKET_FEE } from './sessionMarket';
import { marketList, marketTake, marketCancel } from './actions';
import { houseDisplayName } from './setupSeats';

/** Credits are the currency, so they are not themselves a tradeable good. */
export type MarketGood = 'metal' | 'food' | 'energy' | 'microelectronics';

const MARKET_RES: Array<{ key: MarketGood; label: string }> = [
  { key: 'metal', label: 'market.res.metal' },
  { key: 'food', label: 'market.res.food' },
  { key: 'energy', label: 'market.res.energy' },
  { key: 'microelectronics', label: 'market.res.microelectronics' },
];

export type MarketSide = 'sell' | 'buy';

/** The live «к получению» line under the form: net after the burn for the side that
 *  will RECEIVE credits (a sell lot: you, once someone takes it; a buy bid: the
 *  escrow you post now). Pure — the wiring only feeds it the two input values. */
export function netNoteText(side: MarketSide, amount: number, price: number): string {
  const gross = amount * price;
  const pct = Math.round(MARKET_FEE * 100);
  return side === 'sell'
    ? t('market.net-after-fee', { p: pct, n: Math.floor(gross * (1 - MARKET_FEE)) })
    : t('market.escrow-note', { n: Math.ceil(gross), p: pct });
}

/** The whole window as markup: tabs, your holdings, the compose form, then the ask
 *  and bid books for the open good. Asks sort cheapest-first, bids highest-first —
 *  the best offer for the reader sits on top of each list. */
export function marketBoxHtml(
  state: GameState,
  me: string,
  tab: MarketGood,
  formSide: MarketSide,
): string {
  const res = (state.players[me]?.resources ?? {}) as Record<string, number>;
  // Имя дома в состоянии — английское имя ДАННЫХ (одно на всех, локаль у каждого своя),
  // поэтому переводится на месте показа; ник живого игрока проходит насквозь (AUD-14).
  const nameOf = (id: string): string => esc(houseDisplayName(state.players[id]?.name ?? id));
  const lots = marketLots(state);
  const asks = lots
    .filter((l) => l.side === 'sell' && l.resource === tab)
    .sort((a, b) => a.price - b.price);
  const bids = lots
    .filter((l) => l.side === 'buy' && l.resource === tab)
    .sort((a, b) => b.price - a.price);
  const lotRow = (l: (typeof lots)[number], bid: boolean): string => {
    const mine = l.owner === me;
    // ECON-4: получатель кредитов получает net (5% сгорает) — в биде это исполнитель.
    const takerNet = Math.floor(l.amount * l.price * (1 - MARKET_FEE));
    const qp = `<span class="mk-qp"><b>${l.amount}</b> ${curIc(l.resource)} @ ${l.price} ${curIc('credits')}${
      bid && !mine
        ? ` <span class="mk-net">→ ${takerNet} ${curIc('credits')}</span>`
        : ''
    }</span>`;
    const who = `<span class="mk-who">${mine ? t('market.own-lot') : nameOf(l.owner)}</span>`;
    let btn: string;
    if (mine) {
      btn = `<button class="mk-btn cancel" data-mkcancel="${l.id}">${t('market.cancel')}</button>`;
    } else {
      const can = l.side === 'sell' ? (res.credits ?? 0) >= l.price : (res[l.resource] ?? 0) >= 1;
      btn = `<button class="mk-btn" data-mktake="${l.id}"${can ? '' : ' disabled'}>${l.side === 'sell' ? t('market.buy') : t('market.sell')}</button>`;
    }
    return `<div class="mk-row ${bid ? 'buy' : ''}">${qp}${who}${btn}</div>`;
  };
  const seg = (side: MarketSide, label: string): string =>
    `<button class="${formSide === side ? 'on' : ''}" data-mkside="${side}">${label}</button>`;
  const tabBtn = (k: string, label: string): string =>
    `<button class="mk-tab${tab === k ? ' on' : ''}" data-mtab="${k}">${label}</button>`;
  const stock =
    `<div class="mk-lbl" style="margin-bottom:8px">${t('market.in-treasury')}: ${curIc(tab)} <b style="color:var(--ink)">${Math.round(res[tab] ?? 0)}</b>` +
    ` · ${curIc('credits')} <b style="color:var(--ink)">${Math.round(res.credits ?? 0)}</b></div>`;
  const form =
    `<div class="mk-form"><div class="mk-seg">${seg('sell', t('market.sell'))}${seg('buy', t('market.buy'))}</div>` +
    `<span class="mk-lbl">${t('market.qty')}</span><input class="mk-in" id="mk-amt" type="number" min="1" value="10">` +
    `<span class="mk-lbl">${t('market.price')}</span><input class="mk-in" id="mk-price" type="number" min="0" value="3">` +
    `<button class="mk-go" data-mkgo>${t('market.place')}</button></div>` +
    `<div class="mk-lbl" id="mk-net"></div>`;
  const askList = asks.length
    ? asks.map((l) => lotRow(l, false)).join('')
    : `<div class="mk-empty">${t('market.no-asks')}</div>`;
  const bidList = bids.length
    ? bids.map((l) => lotRow(l, true)).join('')
    : `<div class="mk-empty">${t('market.no-bids')}</div>`;
  return (
    `<div class="mkbox"><div class="lw-head"><b>${t('market.title')}</b><button class="mk-close" style="margin-left:auto">✕</button></div>` +
    `<div class="mk-tabs">${MARKET_RES.map((r) => tabBtn(r.key, t(r.label))).join('')}</div>` +
    `<div id="marketbody">${stock}${form}` +
    `<div class="mk-sec">${t('market.side.sell')} · ${asks.length}</div>${askList}` +
    `<div class="mk-sec buy">${t('market.side.buy')} · ${bids.length}</div>${bidList}</div></div>`
  );
}

/** What the order book needs from the match screen. */
export interface MarketHost {
  /** The window element (`#market`) — painted and click-delegated here. */
  root(): HTMLElement;
  /** The current match state (read fresh on every paint — it is replaced, not mutated). */
  state(): GameState;
  /** Whose book this is: the seat you are playing. */
  me(): string;
  /** Submit a player order through the host's usual path (gate, net, replay). */
  order(action: Action): void;
  /** Fired when the window opens — the host shows its just-in-time intro card here. */
  onOpen(): void;
}

/** Wire the window up: tabs, the compose form, taking and cancelling lots. Call once
 *  at boot (it attaches the window's click delegate); `open()` is what the rail button
 *  calls. */
export function initMarket(host: MarketHost): { open: (resource?: string) => void } {
  let tab: MarketGood = 'metal';
  let formSide: MarketSide = 'sell';

  // Every lookup is scoped to the window, never to `document`: the box owns these ids,
  // and a module that reaches for the global document is one stray duplicate id away
  // from editing someone else's screen.
  const field = (id: string): number =>
    Number((host.root().querySelector(`#${id}`) as HTMLInputElement | null)?.value) || 0;

  function paint(): void {
    const root = host.root();
    root.innerHTML = marketBoxHtml(host.state(), host.me(), tab, formSide);
    // The «к получению» line follows the inputs live, so it is bound after each paint
    // (the box is re-rendered wholesale, taking its inputs with it).
    const netEl = root.querySelector('#mk-net');
    const updNet = (): void => {
      if (netEl) netEl.textContent = netNoteText(formSide, field('mk-amt'), field('mk-price'));
    };
    updNet();
    root.querySelector('#mk-amt')?.addEventListener('input', updNet);
    root.querySelector('#mk-price')?.addEventListener('input', updNet);
  }

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.mk-close')) {
      host.root().classList.remove('show');
      return;
    }
    const nextTab = (tg.closest('.mk-tab') as HTMLElement | null)?.dataset.mtab;
    if (nextTab) {
      tab = nextTab as MarketGood;
      paint();
      return;
    }
    const side = (tg.closest('.mk-seg button') as HTMLElement | null)?.dataset.mkside;
    if (side) {
      formSide = side as MarketSide;
      paint();
      return;
    }
    if (tg.closest('[data-mkgo]')) {
      const amt = Math.floor(field('mk-amt'));
      const price = Math.max(0, field('mk-price'));
      if (amt > 0) host.order(marketList(host.me(), formSide, tab, amt, price));
      paint();
      return;
    }
    const takeId = (tg.closest('[data-mktake]') as HTMLElement | null)?.dataset.mktake;
    if (takeId) {
      host.order(marketTake(host.me(), takeId));
      paint();
      return;
    }
    const cancelId = (tg.closest('[data-mkcancel]') as HTMLElement | null)?.dataset.mkcancel;
    if (cancelId) {
      host.order(marketCancel(host.me(), cancelId));
      paint();
    }
  });

  return {
    open: (resource?: string) => {
      if (resource && (MARKET_RES.some((r) => r.key === resource))) {
        tab = resource as MarketGood;
      }
      host.root().classList.add('show');
      paint();
      host.onOpen();
    },
  };
}
