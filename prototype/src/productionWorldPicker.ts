/**
 * Выбор мира в шапке окна «Производство» (макет 2026-11-09). Мир, где линия может строить,
 * но стоит, подписан «простой», а у выбора горит точка: игрок видит простой верфи на
 * другом мире, не обходя их по одному. Что считается простоем — `idleProductionLanes`.
 */
import { UNIT_LANES, type GameState, type Planet } from '../../packages/shared-core/src/index';
import { idleProductionLanes } from '../../decisions/productionLanes';
import { t } from '../../localization/runtime';
import { data } from './gameData';
import { esc } from './format';
import { worldName } from './planetName';

export function productionWorldSelect(state: GameState, selected: string, worlds: readonly Planet[]): string {
  const idle = new Set(
    worlds.filter((p) => p.id !== selected && idleProductionLanes(state, p.id, UNIT_LANES, data).length).map((p) => p.id),
  );
  const options = worlds
    .map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(worldName(state, p.id))}${idle.has(p.id) ? ` · ${t('production.world.idle')}` : ''}</option>`)
    .join('');
  const label = esc(t('production.world.idle-count', { n: idle.size }));
  const dot = idle.size ? `<span class="pw-idle-dot" role="img" aria-label="${label}" title="${label}"></span>` : '';
  return `<span class="pw-world"><select id="cn-planet" class="cn-plan" aria-label="${t('yard.where')}">${options}</select>${dot}</span>`;
}
