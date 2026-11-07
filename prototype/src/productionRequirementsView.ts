import { productionRequirements, facilityLevel } from '../../decisions/productionRequirements';
import type { GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { buildingName, displayUnit, esc } from './format';
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
  const arsenal = state.players[me]?.arsenal;
  if (
    kind === 'unit' &&
    data.units[id]?.domain === 'space' &&
    arsenal &&
    !arsenal.hulls.includes(id)
  )
    rows.push(`<span>${t('production.blueprint-required')}</span>`);
  if (needs.technology)
    rows.push(
      `${techWhyHtml(needs.technology)}<button data-bw-tech="${esc(needs.technology.offer)}">${techOfferLabel(needs.technology)}</button>`,
    );
  if (needs.facilityCode)
    rows.push(
      needs.facilities.length
        ? needs.facilities
            .map(
              (f) =>
                `<button data-pw-building="${esc(f.building)}" data-pw-level="${f.level}">${esc(t('production.requires-building', { name: buildingName(data.buildings[f.building]?.name, f.building), n: f.level }))}</button>`,
            )
            .join('')
        : `<span>${t('production.no-facility-here')}</span>`,
    );
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
