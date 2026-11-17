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

/** Свой цвет у каждого модуля (макет окна оснащения, владелец 2026-11-17: «красивые иконки
 *  модулей»): по одному цвету слота значки сливались. Нет строки — цвет слота. */
export const MODULE_COLOR: Record<string, string> = {
  targeting_array: '#ff6b5a',
  intercept_turret: '#ffb43a',
  siege_platform: '#ff8f3c',
  tractor_beam: '#e58fd0',
  station_battery_1: '#ff8a5c',
  station_battery_2: '#ff8a5c',
  station_battery_3: '#ff8a5c',
  shield_booster: '#4da3ff',
  ablative_plating: '#e8a05c',
  point_defense_array: '#5ff0c0',
  void_shield_i: '#a98bff',
  void_shield_ii: '#a98bff',
  void_shield_iii: '#a98bff',
  repair_tender: '#65deb7',
  swarm_intercept_veil: '#c58cff',
  cargo_bay: '#e0b04f',
  repair_bay: '#9fd36b',
  radar_module: '#52d9e7',
  compact_radar: '#52d9e7',
  long_range_optics: '#7fc8ff',
  ion_engine: '#ffcf5a',
  salvage_rig: '#9fd36b',
  mine_layer: '#ff5a4d',
  rocket_mine_layer: '#ff5a4d',
  cloak_field: '#b9a7ff',
  swarm_brood_chamber: '#c58cff',
  leviathan_brood: '#c58cff',
};

export function moduleIcon(id: string): string {
  const color = MODULE_COLOR[id] ? ` mc" style="--mc:${MODULE_COLOR[id]}` : '';
  return MODULE_PICTOGRAMS[id] ? `<span class="module-pictogram slot-${data.modules[id]?.slot ?? 'utility'}${color}">${MODULE_PICTOGRAMS[id]}${id.startsWith('void_shield_') ? `<small>${id.slice(12).toUpperCase()}</small>` : ''}</span>` : MODULE_ICON[id] ?? '▪';
}
