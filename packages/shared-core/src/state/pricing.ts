/** Множители цен партии (`MatchMap.pricing`, `util/pricing.ts`). */
export interface MatchPricing {
  /** Множитель цены по ресурсу: строка каталога × множитель. Нет ресурса ⇒ ×1. */
  cost?: Record<string, number>;
  /** Additional resource multipliers for buildable ship hulls only. Applied before
   *  rounding, together with `cost`; no entry means the original match price. */
  shipCost?: Record<string, number>;
  /** Множитель сроков постройки и исследования. Нет ⇒ ×1. */
  hours?: number;
  /** Additional construction/upgrade/repair multiplier, pinned at match creation. */
  buildingHours?: number;
  /** Additional unit production/mobilization multiplier. No field means ×1. */
  unitHours?: number;
  /** Множитель стартового запаса места по ресурсу. Нет ресурса ⇒ ×1. */
  start?: Record<string, number>;
}
