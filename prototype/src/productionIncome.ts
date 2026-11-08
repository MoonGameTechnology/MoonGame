import type { GameState } from '../../packages/shared-core/src/index';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { netIncome } from './economy';
import { esc, resChip, curIc, flowPer, flowWord } from './format';
import { worldName } from './planetName';
import { INFO_ICON } from './infoIcon';
import { feedsOnBiomass } from '../../packages/shared-core/src/util/infestation';

/** The same read as the HUD, with its actual running costs collected in the same pass. */
export function productionIncomeDetails(state: GameState, me: string, world: string) {
  if (state.planets[world]?.owner !== me) return null;
  const upkeep: Record<string, number> = {};
  const net = netIncome(state, me, undefined, world, upkeep);
  const resources = data.resources.filter(r => r !== 'biomass' || feedsOnBiomass(state, me, data) ||
    !!net[r] || !!upkeep[r] || !!state.players[me]?.resources[r]);
  return { net, upkeep, resources };
}

export function productionIncomeHtml(state: GameState, me: string, world: string): string {
  const rates = productionIncomeDetails(state, me, world);
  if (!rates) return '';
  return `<button class="pw-income" data-pw-income="${esc(world)}"><span class="pw-income-label">${t('production.planet-income')} <small>${flowPer()}</small>${INFO_ICON}</span><span class="pw-income-values">${rates.resources.map(r => `<span class="${(rates.net[r] ?? 0) < 0 ? 'pw-worse' : 'pw-better'}">${resChip(r, rates.net[r] ?? 0, { sign: true, per: 'h' })}</span>`).join('')}</span></button>`;
}

export function productionIncomeCard(state: GameState, me: string, world: string): string {
  const rates = productionIncomeDetails(state, me, world);
  if (!rates) return `<p>${t('production.income-unavailable')}</p>`;
  return `<h3>${t('production.planet-income')} · ${esc(worldName(state, world))}</h3><p>${flowWord()} · ${t('production.income-scope')}</p><table class="pw-income-table"><thead><tr><th>${t('production.income-resource')}</th><th>${t('production.income-gross')}</th><th>${t('production.income-upkeep')}</th><th>${t('production.income-net')}</th></tr></thead><tbody>${rates.resources.map(r => `<tr><th>${curIc(r)}<span>${esc(tData(r))}</span></th><td>${resChip(r, (rates.net[r] ?? 0) + (rates.upkeep[r] ?? 0), { per: 'h' })}</td><td>${resChip(r, -(rates.upkeep[r] ?? 0), { per: 'h' })}</td><td>${resChip(r, rates.net[r] ?? 0, { sign: true, per: 'h' })}</td></tr>`).join('')}</tbody></table>`;
}

/** Account stock, separate from this planet's production rates. */
export function productionStockHtml(state: GameState, me: string, contentsOnly = false): string {
  const stock = state.players[me]?.resources ?? {};
  const contents = data.resources.filter(r => r !== 'biomass' || feedsOnBiomass(state, me, data) || !!stock[r]).map(r => resChip(r, stock[r] ?? 0)).join('');
  return contentsOnly ? contents : `<div class="pw-stock">${contents}</div>`;
}

export function refreshProductionStock(root: HTMLElement, state: GameState, me: string): void {
  const stock = root.querySelector('.pw-stock');
  if (stock) stock.innerHTML = productionStockHtml(state, me, true);
}
