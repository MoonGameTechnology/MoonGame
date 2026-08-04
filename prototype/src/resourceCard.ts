/**
 * Resource card (RC-1) — tap a resource chip in the top bar → a popup with the
 * resource name, stock, net flow, an income/expense breakdown, and a button that
 * opens the in-game market on that resource (or shows «not tradeable» for credits).
 *
 * Same REFM shape as the other screens: pure markup functions + `initResourceCard(host)`
 * takes its host dependencies explicitly.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { incomeBreakdown } from './economy';

/** Resources that can be traded on the in-game market (credits are the currency). */
const TRADEABLE = new Set(['metal', 'food', 'energy', 'microelectronics']);

export interface ResourceCardHost {
  root: () => HTMLElement | null;
  state: () => GameState;
  me: () => string;
  icons: Record<string, string>;
  onOpenMarket: (resource: string) => void;
}

export function initResourceCard(host: ResourceCardHost): { open: (resource: string) => void } {
  function paint(resource: string): void {
    const root = host.root();
    if (!root) return;
    root.innerHTML = resourceCardHtml(host.state(), host.me(), resource, host.icons);
  }

  function open(resource: string): void {
    const root = host.root();
    if (!root) return;
    paint(resource);
    root.classList.add('show');
  }

  host.root()?.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg === host.root() || tg.closest('.rc-close')) {
      host.root()?.classList.remove('show');
      return;
    }
    const marketBtn = tg.closest('[data-rc-market]') as HTMLElement | null;
    if (marketBtn) {
      const res = marketBtn.dataset.rcMarket!;
      host.root()?.classList.remove('show');
      if (TRADEABLE.has(res)) host.onOpenMarket(res);
      return;
    }
  });

  return { open };
}

/** Pure HTML for the resource card. Exported so tests can assert on structure. */
export function resourceCardHtml(state: GameState, me: string, resource: string, icons: Record<string, string>): string {
  const player = state.players[me];
  const stock = Math.round(player?.resources?.[resource] ?? 0);
  const bd = incomeBreakdown(state, me)[resource] ?? { production: 0, buildingUpkeep: 0, unitUpkeep: 0, net: 0 };
  const name = t(`hud.resource.${resource}`);
  const icon = icons[resource] ?? '';
  const canTrade = TRADEABLE.has(resource);
  const inDeficit = (player?.arrears ?? []).includes(resource);

  const fmt = (v: number) => (Math.abs(v) >= 1 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  const netStr = (bd.net >= 0 ? '+' : '') + fmt(bd.net);
  const netCls = bd.net >= 0 ? 'pos' : 'neg';

  return `<div class="rc-box">
    <div class="rc-head">
      <span class="rc-ic">${icon}</span>
      <b>${esc(name)}</b>
    </div>
    <div class="rc-stat"><span class="rc-k">${esc(t('rescard.stock'))}</span><span class="rc-v">${stock}</span></div>
    ${inDeficit ? `<div style="color:#ff6b6b;font-size:12px;text-align:center;padding:4px 0">${esc(t('hud.deficit'))}</div>` : ''}
    <div class="rc-sec">${esc(t('rescard.income'))}</div>
    <div class="rc-stat"><span class="rc-k">${esc(t('rescard.production'))}</span><span class="rc-v pos">+${fmt(bd.production)}</span></div>
    <div class="rc-sec">${esc(t('rescard.expense'))}</div>
    <div class="rc-stat"><span class="rc-k">${esc(t('rescard.upkeep'))}</span><span class="rc-v neg">−${fmt(bd.buildingUpkeep)}</span></div>
    <div class="rc-stat"><span class="rc-k">${esc(t('rescard.army'))}</span><span class="rc-v neg">−${fmt(bd.unitUpkeep)}</span></div>
    <div class="rc-sec">${esc(t('rescard.net'))}</div>
    <div class="rc-flow ${netCls}">${netStr}/ч</div>
    <button class="rc-market ${canTrade ? '' : 'disabled'}" data-rc-market="${esc(resource)}">
      ${canTrade ? esc(t('rescard.market')) : esc(t('rescard.no-trade'))}
    </button>
    <button class="rc-close">${esc(t('rescard.close'))}</button>
  </div>`;
}