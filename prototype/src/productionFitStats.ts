/**
 * Характеристики в окне оснащения (заказ владельца 2026-11-17: «не показывает изменение в
 * характеристиках»). Раньше полосы прятались за «ⓘ» в шапке, а плитка модуля не говорила,
 * что он даст. Теперь строка характеристик видна над модулями отсека — у изменённых модулем
 * чисел зелёная или красная разница, — а на плитке написано, что станет с ЭТИМ кораблём
 * (`moduleSwapDelta`). Полные полосы и урон по целям остаются за «ⓘ».
 */
import { t } from '../../localization/runtime';
import type { GameData, UnitDef } from '../../packages/shared-core/src/index';
import type { LoadoutStatLine } from '../../packages/client/src/loadoutEditor';
import { moduleSwapDelta, type SwapBoosts } from '../../decisions/moduleSwapDelta';
import { deltaChip, STAT_KEY } from './moduleEffect';

const r = (v: number): number => Math.round(v * 10) / 10;

/** Строка характеристик корабля с надетыми модулями: «атака 26 +2». */
export function fitStripHtml(preview: readonly LoadoutStatLine[]): string {
  const cells = preview
    .map((p) => {
      const diff = p.delta
        ? `<span class="${p.delta > 0 ? 'pw-up' : 'pw-down'}">${p.delta > 0 ? '+' : '−'}${r(Math.abs(p.delta))}</span>`
        : '';
      return `<span class="pw-fs${p.delta ? ' changed' : ''}" data-stat="${p.stat}"><span class="pw-fs-k">${t(STAT_KEY[p.stat] ?? p.stat)}</span><b>${r(p.effective)}</b>${diff}</span>`;
    })
    .join('');
  return `<div class="pw-fit-strip" role="group" aria-label="${t('yard.stats')}">${cells}</div>`;
}

/** Чипы плитки модуля: что станет с кораблём, если выбрать его в открытом отсеке. */
export function swapChipsHtml(
  def: UnitDef,
  modules: readonly string[],
  fitted: string | undefined,
  candidate: string,
  boosts: SwapBoosts,
  data: GameData,
): string {
  return moduleSwapDelta(def, modules, fitted, candidate, boosts, data)
    .map(
      (c) =>
        `<span class="${c.delta > 0 ? 'pw-up' : 'pw-down'}">${deltaChip(c.stat, c.delta)}</span>`,
    )
    .join('');
}
