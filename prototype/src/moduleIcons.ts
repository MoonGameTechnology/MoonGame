import { data } from './gameData';
import { MODULE_PICTOGRAMS } from './modulePictograms';
/**
 * Значки модулей и отсеков — общие для конструктора (`shipyard.ts`) и карточки корабля
 * (`shipCard.ts`): один и тот же модуль обязан выглядеть одинаково там, где его надевают,
 * и там, где его потом видно на корабле.
 */

/** Подпись типа отсека. Универсальный отсек (усиленный крейсер) берёт модуль любого типа. */
export const SLOT_KEY: Record<string, string> = {
  weapon: 'yard.slot.weapon',
  defense: 'yard.slot.defense',
  utility: 'yard.slot.utility',
  universal: 'yard.slot.universal',
};

/** Значок пустого отсека по типу. */
export const SLOT_ICON: Record<string, string> = { weapon: '🎯', defense: '🛡', utility: '⊞', universal: '⧉' };

/** Значок модуля. Нет своего — нейтральный квадрат, а не пустота. */
export const MODULE_ICON: Record<string, string> = {
  targeting_array: '🎯',
  intercept_turret: '⌖',
  shield_booster: '🛡',
  ablative_plating: '🧱',
  point_defense_array: '✴',
  rocket_mine_layer: '✺',
  cloak_field: '◌',
  void_shield_i: '🔰',
  void_shield_ii: '🔰',
  void_shield_iii: '🔰',
  ion_engine: '🚀',
  radar_module: '📡',
  compact_radar: '📡',
  long_range_optics: '🔭',
  cargo_bay: '📦',
  repair_bay: '🔧',
  siege_platform: '💥',
  tractor_beam: '🧲',
  salvage_rig: '♻',
  repair_tender: '🛠',
  mine_layer: '💣',
  swarm_brood_chamber: '🧬',
};

export function moduleIcon(id: string): string {
  return MODULE_PICTOGRAMS[id] ? `<span class="module-pictogram slot-${data.modules[id]?.slot ?? 'utility'}">${MODULE_PICTOGRAMS[id]}${id.startsWith('void_shield_') ? `<small>${id.slice(12).toUpperCase()}</small>` : ''}</span>` : MODULE_ICON[id] ?? '▪';
}
