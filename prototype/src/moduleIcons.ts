/**
 * Значки модулей и отсеков — общие для конструктора (`shipyard.ts`) и карточки корабля
 * (`shipCard.ts`): один и тот же модуль обязан выглядеть одинаково там, где его надевают,
 * и там, где его потом видно на корабле.
 */

/** Подпись типа отсека. */
export const SLOT_KEY: Record<string, string> = {
  weapon: 'yard.slot.weapon',
  defense: 'yard.slot.defense',
  utility: 'yard.slot.utility',
};

/** Значок пустого отсека по типу. */
export const SLOT_ICON: Record<string, string> = { weapon: '🎯', defense: '🛡', utility: '⊞' };

/** Значок модуля. Нет своего — нейтральный квадрат, а не пустота. */
export const MODULE_ICON: Record<string, string> = {
  targeting_array: '🎯',
  shield_booster: '🛡',
  ablative_plating: '🧱',
  point_defense_array: '✴',
  void_shield_i: '🔰',
  void_shield_ii: '🔰',
  void_shield_iii: '🔰',
  ion_engine: '🚀',
  radar_module: '📡',
  compact_radar: '📡',
  cargo_bay: '📦',
  repair_bay: '🔧',
  siege_platform: '💥',
  swarm_brood_chamber: '🧬',
};

export function moduleIcon(id: string): string {
  return MODULE_ICON[id] ?? '▪';
}
