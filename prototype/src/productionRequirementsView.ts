import { productionRequirements, facilityLevel } from '../../decisions/productionRequirements';
import { buildingLevel, buildingMaxLevel, matchCost, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { buildingName, displayUnit, esc, cost } from './format';
import { completedUnitSpend } from './economy';
import { techOfferLabel, techWhyHtml } from './techOffer';
import { INFO_ICON } from './infoIcon';

export function productionInfoButton(kind: 'unit' | 'building', id: string): string {
  return `<button class="pw-info" data-pw-info="${kind}:${esc(id)}" aria-label="${esc(t('production.info'))}">${INFO_ICON}</button>`;
}

export function productionRequirementsHtml(
  state: GameState,
  me: string,
  world: string,
  kind: 'building' | 'unit',
  id: string,
): string {
  const needs = productionRequirements(state, me, world, data, kind, id);
  const rows: string[] = [];
  let resources = '';
  const planet = state.planets[world];
  if (planet?.owner === me) {
    const def = data.buildings[id];
    const level = Math.max(0, ...planet.buildings.filter(b => b.type === id).map(b => b.level));
    const price = kind === 'unit' && data.units[id]
      ? completedUnitSpend(state, { unit: id, count: 1, modules: [] })
      : def && level < buildingMaxLevel(def) ? matchCost(state, buildingLevel(def, level + 1).cost) : {};
    const shortage = Object.fromEntries(Object.entries(price).map(([r,n]) => [r, n - (state.players[me]?.resources[r] ?? 0)]).filter(([,n]) => Number(n) > 0));
    if (Object.keys(shortage).length) resources = `<div class="pw-requirement-row"><span>${t('production.resources-required')} ${cost(shortage)}</span><button data-pw-income="${esc(world)}">${t('production.planet-income')} ›</button></div>`;
  }
  const arsenal = state.players[me]?.arsenal;
  if (
    kind === 'unit' &&
    data.units[id]?.domain === 'space' &&
    arsenal &&
    !arsenal.hulls.includes(id)
  )
    rows.push(`<div class="pw-requirement-row"><span>${t('production.blueprint-required')}</span></div>`);
  if (needs.technology)
    rows.push(
      `<div class="pw-requirement-row">${techWhyHtml(needs.technology)}<button data-bw-tech="${esc(needs.technology.offer)}">${techOfferLabel(needs.technology)}</button></div>`,
    );
  if (needs.facilityCode)
    rows.push(
      needs.facilities.length
        ? needs.facilities
            .map(
              (f) =>
                `<div class="pw-requirement-row"><span>${esc(t('production.requires-building', { name: buildingName(data.buildings[f.building]?.name, f.building), n: f.level }))}</span><button data-pw-building="${esc(f.building)}" data-pw-level="${f.level}">${t('production.go-building')} ›</button></div>`,
            )
            .join('')
        : `<span>${t('production.no-facility-here')}</span>`,
    );
  if (resources) rows.push(resources);
  return rows.length ? `<div class="pw-requirements" role="status">${rows.join('')}</div>` : '';
}

export function productionUnlocksHtml(
  state: GameState,
  world: string,
  building: string,
  roster: readonly string[],
): string {
  const planet = state.planets[world];
  if (!planet) return '';
  const rows = roster.flatMap((unit) => {
    const level = facilityLevel(data, planet, building, unit);
    return level === null
      ? []
      : [
          `<div class="pw-unlock"><span>${esc(displayUnit(unit))} · ${t('codex.lvl', { n: level })}</span>${productionInfoButton('unit', unit)}</div>`,
        ];
  });
  return rows.length
    ? `<details class="pw-section" open><summary>${t('production.unlocks')}</summary>${rows.join('')}</details>`
    : '';
}
