/**
 * Статы-ДОЛИ за игровой час: `shieldRegen` — доля щита, `hullRepair` — доля корпуса
 * (ремонтный ангар, SHU-5.4). Обычное округление до десятых превращало +0.05 в «+0.1»
 * (или +0.02 в «+0»), поэтому такие статы показываются процентом в час. Список общий:
 * верфь, карточка корабля и экран подготовки обязаны читать один стат одинаково.
 */
export const PER_HOUR_SHARE_STATS: ReadonlySet<string> = new Set([
  'shieldRegen',
  'hullRepair',
  'fleetHullRepair',
]);

/**
 * Статы-ДОЛИ без времени (фаза 3 модулей кораблей): прибавка к цене отступления врага,
 * к доле трофеев, доля корпуса за срабатывание мины. Та же беда, что у долей в час:
 * до десятых +0.05 читалось бы «+0.1». Показываются процентом.
 */
export const PERCENT_STATS: ReadonlySet<string> = new Set([
  'retreatPull',
  'salvageBonus',
  'mineHit',
]);

export function isPercentStat(stat: string): boolean {
  return PERCENT_STATS.has(stat);
}

export function isPerHourShare(stat: string): boolean {
  return PER_HOUR_SHARE_STATS.has(stat);
}

/** Доля в час → проценты в час, до десятых: 0.05 → 5, 0.019 → 1.9. Округление только
 *  для показа — матч считает по неокруглённому. */
export function perHourPercent(share: number): number {
  return Math.round(share * 1000) / 10;
}
