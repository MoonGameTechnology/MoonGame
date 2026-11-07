import {
  buildingLevel, buildingRepairQuote, effectiveStats, fortressFleetId, fortressRepairQuote,
  matchCost, matchBuildingHours, type Action, type BuildingInstance, type GameState, type Planet,
  fleetAtStation,
} from '../../packages/shared-core/src/index';
import { repairBuilding, repairStation } from '../../decisions/actions';
import { t, tData } from '../../localization/runtime';
import { data } from './gameData';
import { cost, esc, fmtEta } from './format';
import { fleetHangar, planetHangar, hasHangar, transferOffer, type HangarView } from './hangarPanel';
import { liveTimerHtml } from './liveTimers';
import { actionButton } from './panelKit';

/** Services share the physical berth used by the server's dock and hangar gates. */
export function fortressServicesHtml(state: GameState, site: Planet, me: string, view: {
  production(tab: 'ships' | 'shuttle'): string;
  hangar(port: HangarView): string;
  hasShipyard: boolean;
}): string {
  let html = view.hasShipyard ? view.production('ships') : '';
  const port = planetHangar(site, data);
  if (hasHangar(port)) html += view.hangar(port) + view.production('shuttle');
  const carrier = Object.values(state.fleets).find((fleet) => fleet.owner === me && !fleet.battleId &&
    fleetAtStation(state, fleet, site) && hasHangar(fleetHangar(fleet, data, state)));
  if (carrier) {
    const offer = transferOffer(port, fleetHangar(carrier, data, state), { docked: true, mine: true });
    if (offer.load || offer.unload) html += '<div class="row">' +
      (offer.load ? actionButton('wingload', carrier.id, t('side.wing.load'), true) : '') +
      (offer.unload ? actionButton('wingunload', carrier.id, t('side.wing.unload'), true) : '') + '</div>';
  }
  return html;
}

/** The same authoritative quote drives the button and the server's paid HP budget. */
export function buildingRepairHtml(
  state: GameState, me: string, planetId: string, building: BuildingInstance,
  probe: (action: Action) => string | null,
): string {
  if (state.planets[planetId]?.fortress && building.type === 'starfort') return '';
  const def = data.buildings[building.type];
  if (!def) return '';
  const max = buildingLevel(def, building.level).hp;
  const health = `<span>${t('fortress.building-hp', { hp: Math.ceil(building.hp), max })}</span>`;
  // Сроки ремонта и сборки — живые узлы (`liveTimers.ts`): цифры в разметке пересобирали бы
  // окно и карточку мира с часами, вместе с кнопками под курсором.
  if (building.repair) return `<div class="bw-foot">${health}<span>${t('repair.running', {
    time: liveTimerHtml(building.repair.doneAt),
  })}</span></div>`;
  const quote = buildingRepairQuote(building, data);
  if (!(quote.missingHp > 0) || state.planets[planetId]?.owner !== me) return `<div class="building-health">${health}</div>`;
  const block = probe(repairBuilding(me, planetId, building.type, building.uid));
  return `<div class="bw-foot repair-offer">${health}<span>${cost(matchCost(state, quote.cost), state.players[me]?.resources ?? {})} · ${fmtEta(matchBuildingHours(state, quote.hours))}</span>` +
    `<button class="bw-take btn-second" data-bw-repair="${esc(building.type)}" data-uid="${esc(building.uid ?? '')}"${block ? ' disabled' : ''}>${t('repair.start')}</button></div>`;
}

export function fortressStatusHtml(state: GameState, site: Planet, me: string, probe: (action: Action) => string | null): string {
  const fleet = state.fleets[fortressFleetId(site.id)];
  const body = fleet?.units[0];
  const def = body ? data.units[body.unit] : undefined;
  if (!site.fortress || !body || !def) return '';
  const stats = effectiveStats(def, body, data);
  const max = stats.hp ?? 0;
  const readiness = Math.round(100 * Math.min(1, (body.stationScale ?? 1) / site.fortress.level));
  let html = `<div class="fortress-status"><b>${esc(t('fortress.readiness', { p: readiness }))}</b>` +
    `<progress max="100" value="${readiness}" aria-label="${esc(t('fortress.readiness-label'))}"></progress>` +
    `<div>${esc(t('fortress.hull', { hp: Math.ceil(body.hp ?? max), max: Math.ceil(max) }))}` +
    ` · ${esc(t('fortress.shield', { hp: Math.ceil(body.shieldHp ?? stats.shield ?? 0), max: Math.ceil(stats.shield ?? 0) }))}</div>` +
    `<div>${esc(t('fortress.firepower', { attack: Math.round(stats.attack ?? 0), defense: Math.round(stats.defense ?? 0) }))}</div>`;
  if (body.modules?.length) html += `<div>${esc(t('fortress.equipment'))}: ${body.modules
    .map((id) => esc(tData(data.modules[id]?.name ?? id))).join(' · ')}</div>`;
  if (site.owner === me) {
    if (site.fortress.assembly) html += `<div class="dim">${t(site.fortress.assembly.paused ? 'fortress.paused' : 'fortress.assembling', {
      time: liveTimerHtml(site.fortress.assembly.doneAt),
    })}</div>`;
    if (site.fortress.repair) html += `<div>${t('repair.running', {
      time: liveTimerHtml(site.fortress.repair.doneAt),
    })}</div>`;
    else {
      const quote = fortressRepairQuote(state, site, data);
      const blocked = quote.missingHp > 0 && probe(repairStation(me, site.id)) !== null;
      if (quote.missingHp > 0) html += `<div class="repair-offer">${cost(matchCost(state, quote.cost), state.players[me]?.resources ?? {})} · ${fmtEta(matchBuildingHours(state, quote.hours))}` +
        `<button class="bw-open btn-second" data-act="repairfortress" data-arg="${esc(site.id)}"${blocked ? ' disabled' : ''}>${t('repair.hull')}</button></div>`;
    }
    html += `<p class="dim">${esc(t('fortress.damage-rule'))}</p>`;
  }
  return html + '</div>';
}
