import { buildingLevel, type GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { BUILD_ICON } from './icons';
import { resChip } from './format';
import { productionInfoButton } from './productionRequirementsView';

/** Compact mockup hierarchy; all availability, price and action decisions come from buildScreen. */
export function productionBuildingRow(
  state: GameState, world: string, id: string, level: number, nextLevel: number,
  name: string, action: string, quote: string, requirements: string, repairs: string,
): string {
  const def = data.buildings[id]!;
  const current = level ? buildingLevel(def, level).produces ?? {} : {};
  const output = buildingLevel(def, nextLevel).produces ?? {};
  const yieldHtml = Object.entries(output).filter(([, n]) => n > 0).map(([r,n]) =>
    `<strong class="${n > (current[r] ?? 0) ? 'pw-better' : n < (current[r] ?? 0) ? 'pw-worse' : ''}">${resChip(r, n, { per: 'h' })}</strong>`,
  ).join('');
  const core = state.planets[world]?.fortress && id === 'starfort';
  return `<article class="pw-building"${core ? '' : ` data-bw="${id}"`}><div class="pw-building-top"><div class="pw-building-identity"><span class="bw-ic">${BUILD_ICON[id] ?? '▣'}</span><span><b>${name}</b>${level ? '' : `<small>${t('production.not-built')}</small>`}</span></div>${yieldHtml ? `<div class="pw-building-output"><small>${t(nextLevel > level ? 'production.output-after' : 'production.output-current')}</small>${yieldHtml}</div>` : ''}</div><div class="pw-building-bottom">${quote}<span class="pw-building-action">${action}</span>${productionInfoButton('building', id)}</div>${requirements}${repairs}</article>`;
}
