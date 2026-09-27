/**
 * Окно торговца экспедиции (решение владельца 2026-09-26, «живой курс»): купить, продать и
 * обменять ресурсы забега за кредиты. Механика и цены — ядро (`modules/trader.ts`), что
 * показать — решение `decisions/traderView.ts`; здесь только разметка и проводка кнопок.
 *
 * Та же форма, что у окна рынка (REFM-6): разметка чистая (`traderBoxHtml`), а хозяина окно
 * трогает только через явные крючки `TraderHost`. Рынок основной игры — книга заявок живых
 * игроков, и в забеге его нет (`decisions/sectorZeroTools.ts`); это другое окно, и в архив
 * площадки оно едет.
 */
import type { Action, Context, GameState, ModeTrader } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc, curIc, fmtHrs } from './format';
import { TRADER_AMOUNTS, traderView, type TraderView } from '../../decisions/traderView';
import { traderBuy, traderSell, traderSwap } from '../../decisions/actions';

/** Сдвиг курса от базы знаком и числом: ▲ дороже базы, ▼ дешевле; у базы — ничего. */
function shiftMark(pct: number): string {
  if (pct === 0) return '';
  return `<i class="tr-shift ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct)}%</i>`;
}

/** Всё окно разметкой: товары с запасом и курсом, выбор количества, купить/продать выбранный
 *  товар и обмен его на каждый другой. Цена — на самой кнопке. */
export function traderBoxHtml(
  view: TraderView,
  cfg: ModeTrader,
  sel: string,
  amount: number,
  status: string,
): string {
  const good = view.goods.find((g) => g.good === sel) ?? view.goods[0];
  if (!good) return '';
  const cr = curIc('credits');
  const goods = view.goods
    .map(
      (g) =>
        `<button type="button" class="tr-good${g.good === good.good ? ' on' : ''}" data-tr-good="${esc(g.good)}">${curIc(g.good)}<b>${Math.floor(g.stock)}</b>${shiftMark(g.shiftPct)}</button>`,
    )
    .join('');
  const amounts = TRADER_AMOUNTS.map(
    (n) =>
      `<button type="button" class="tr-amt${n === amount ? ' on' : ''}" data-tr-amt="${n}">${n}</button>`,
  ).join('');
  const spreadPct = Math.round((1 - (1 - cfg.spread / 2) / (1 + cfg.spread / 2)) * 100);
  const rule = t('trader.rule', {
    h: fmtHrs(cfg.maxShift / Math.max(1e-9, cfg.recoveryPerHour)),
    n: spreadPct,
  });
  const swaps = view.swaps
    .map(
      (s) =>
        `<button type="button" class="tr-swap" data-tr-swap="${esc(s.get)}"${s.ok ? '' : ' disabled'}>${curIc(s.get)} +${s.got}</button>`,
    )
    .join('');
  return (
    `<div class="trbox"><div class="lw-head"><b>${esc(t('trader.title'))}</b><span class="tr-purse">${cr} <b>${Math.floor(view.credits)}</b></span><button type="button" class="tr-close" aria-label="${esc(t('card.close'))}">✕</button></div>` +
    `<div class="tr-body"><p class="tr-rule">${esc(rule)}</p>` +
    `<div class="tr-goods">${goods}</div>` +
    `<div class="tr-lbl">${esc(t('trader.amount'))}</div><div class="tr-amts">${amounts}</div>` +
    `<div class="tr-deal"><button type="button" class="tr-go" data-tr="buy"${good.buy.ok ? '' : ' disabled'}>${esc(t('trader.buy', { n: amount, c: good.buy.credits }))} ${cr}</button>` +
    `<button type="button" class="tr-go sell" data-tr="sell"${good.sell.ok ? '' : ' disabled'}>${esc(t('trader.sell', { n: amount, c: good.sell.credits }))} ${cr}</button></div>` +
    `<div class="tr-lbl">${esc(t('trader.swap', { n: amount }))} ${curIc(good.good)}</div><div class="tr-swaps">${swaps}</div>` +
    `<div class="tr-status" role="status" aria-live="polite">${status}</div></div></div>`
  );
}

/** Что окну нужно от экрана матча. */
export interface TraderHost {
  /** Окно (`#trader`) — рисуется и ловит клики здесь. */
  root(): HTMLElement;
  /** Текущее состояние матча (читается заново на каждую отрисовку). */
  state(): GameState;
  /** Чья казна: место, которым играет игрок. */
  me(): string;
  /** Контекст ядра на сейчас — по нему считается курс, вернувшийся к базе. */
  ctx(): Context;
  /** Раздел торговца режима матча; нет — окна нет. */
  cfg(): ModeTrader | undefined;
  /** Отдать приказ обычным путём хоста; `true` — не отвергнут. */
  order(action: Action): boolean;
}

/** Строка итога сделки без слов: иконка и знак числа по каждому ресурсу, что изменился. */
function deltaHtml(before: Record<string, number>, after: Record<string, number>): string {
  return Object.keys({ ...before, ...after })
    .map((res) => [res, Math.round((after[res] ?? 0) - (before[res] ?? 0))] as const)
    .filter(([, d]) => d !== 0)
    .map(([res, d]) => `${curIc(res)} ${d > 0 ? '+' : '−'}${Math.abs(d)}`)
    .join(' · ');
}

export function initTrader(host: TraderHost): {
  open: (resource?: string) => void;
  refresh: () => void;
  isOpen: () => boolean;
  close: () => void;
} {
  let sel = 'metal';
  let amount: number = TRADER_AMOUNTS[2] ?? 100;
  let status = '';
  let painted = '';

  function paint(): void {
    const cfg = host.cfg();
    if (!cfg) return;
    if (!(sel in cfg.goods)) sel = Object.keys(cfg.goods)[0] ?? sel;
    const view = traderView(host.state(), cfg, host.ctx(), host.me(), sel, amount);
    const html = traderBoxHtml(view, cfg, sel, amount, status);
    // Перерисовка только при изменении: курс плывёт каждую секунду, а числа на кнопках —
    // целые, и новый DOM на каждый кадр съедал бы нажатие посреди клика.
    if (html === painted) return;
    painted = html;
    host.root().innerHTML = html;
  }
  const isOpen = (): boolean => host.root().classList.contains('show');
  const close = (): void => host.root().classList.remove('show');

  host.root().addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.tr-close')) return close();
    const good = (tg.closest('[data-tr-good]') as HTMLElement | null)?.dataset.trGood;
    if (good) {
      sel = good;
      status = '';
      return paint();
    }
    const amt = Number((tg.closest('[data-tr-amt]') as HTMLElement | null)?.dataset.trAmt);
    if (amt > 0) {
      amount = amt;
      status = '';
      return paint();
    }
    const btn = tg.closest('button:not([disabled])') as HTMLElement | null;
    const side = btn?.dataset.tr;
    const swapTo = btn?.dataset.trSwap;
    if (!side && !swapTo) return;
    const me = host.me();
    const before = { ...(host.state().players[me]?.resources ?? {}) };
    const action =
      side === 'buy'
        ? traderBuy(me, sel, amount)
        : side === 'sell'
          ? traderSell(me, sel, amount)
          : traderSwap(me, sel, swapTo!, amount);
    const ok = host.order(action);
    status = ok ? deltaHtml(before, host.state().players[me]?.resources ?? {}) : '';
    paint();
  });

  return {
    open: (resource?: string) => {
      const cfg = host.cfg();
      if (!cfg) return;
      if (resource && resource in cfg.goods) sel = resource;
      status = '';
      painted = '';
      host.root().classList.add('show');
      paint();
    },
    refresh: () => {
      if (isOpen()) paint();
    },
    isOpen,
    close,
  };
}
