import { productionRequirements } from '../../decisions/productionRequirements';
import { matchUnitHours, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { completedUnitSpend } from './economy';
import { cost, displayUnit, esc, fmtDur } from './format';
import { catalogPortraitHtml } from './shipArt';
import { productionInfoButton, productionRequirementsHtml } from './productionRequirementsView';

export function productionCatalogHeading(section?: string): string {
  const labels: Record<string, string> = {
    ships: 'production.catalog.ships', support: 'yard.tab.support', squads: 'yard.tab.squads',
    infantry: 'production.catalog.infantry', vehicles: 'production.catalog.vehicles',
  };
  const ground = section === 'infantry' || section === 'vehicles';
  return `<header class="pw-catalog-heading"><h2>${t(labels[section ?? 'ships'] ?? 'production.catalog.ships')}</h2>${ground ? '' : `<button class="cn-tplbtn" data-cntpl>${t('production.templates')}</button>`}</header>`;
}

/** Catalog cards use real match prices and the shared structural requirement readers. */
export function productionCatalogTile(state: GameState, me: string, world: string, id: string, selected: string): string {
  const unit = data.units[id]!;
  const ground = unit.domain === 'ground';
  const art = catalogPortraitHtml('u', id, data, ground ? 'thumb' : 'portrait');
  const title = `<b>${esc(displayUnit(id))}</b>`;
  const price = completedUnitSpend(state, { unit: id, count: 1, modules: [] });
  const resources = state.players[me]?.resources ?? {};
  const needs = productionRequirements(state, me, world, data, 'unit', id);
  const arsenal = state.players[me]?.arsenal;
  const blocked = !!needs.technology || !!needs.facilityCode ||
    (!ground && arsenal !== undefined && !arsenal.hulls.includes(id)) ||
    Object.entries(price).some(([key, n]) => n > (resources[key] ?? 0));
  const action = `<button class="cn-hbtn${id === selected ? ' on' : ''}" data-cnhull="${esc(id)}"${blocked ? ' disabled' : ''}>${t(ground ? 'production.hire' : 'production.equip')}</button>`;
  const quote = `<div class="pw-catalog-quote">${cost(price)}<small>${fmtDur(matchUnitHours(state, unit.buildTimeHours))}</small></div>`;
  return `<article class="pw-hull-tile pw-catalog-tile${ground ? ' pw-ground-card' : ''}">${ground
    ? `<div class="pw-ground-identity">${art}<span>${title}<small>${t('production.stat.hp')} ${unit.stats.hp}</small></span></div><div class="pw-catalog-actions">${quote}${action}${productionInfoButton('unit', id)}</div>`
    : `${art}${title}${quote}<div class="pw-catalog-actions">${action}${productionInfoButton('unit', id)}</div>`}${productionRequirementsHtml(state, me, world, 'unit', id)}</article>`;
}
