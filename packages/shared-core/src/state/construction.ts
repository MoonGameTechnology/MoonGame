export interface BuildUnitPayload {
  planetId: string;
  unit: string;
  count?: number;
  /** Ship modules to install on the built stack (loadout). Validated against the
   *  hull's slots at order time, paid for up-front, then LOCKED onto the stack —
   *  there is no refit action. Absent/empty = a bare hull. */
  modules?: string[];
  /** Десантный челнок (трейт `lander`, SHU-5.2): какой наземный юнит он несёт. Цена и
   *  срок заказа — челнок плюс этот юнит, условия его постройки проверяются здесь же. */
  troop?: string;
}
/** Payload of the internal `construction.complete` schedule (we author it, so
 *  it is well-formed; the handler still guards types and is fail-secure). */
export interface CompletePayload {
  /** Accepted full duration, with match pricing applied; retained on pause/resume. */
  durationHours?: number;
  kind?: 'building' | 'unit' | 'upgrade';
  planetId?: string;
  playerId?: string;
  building?: string;
  unit?: string;
  count?: number;
  level?: number;
  modules?: string[];
  moduleSnapshot?: { stars: Record<string, number>; rarity: Record<string, string> };
  /** Наземный юнит десантного челнока (SHU-5.2). */
  troop?: string;
  /** RULES-2.1: instance uid for upgrade completion (when maxPerPlanet > 1). */
  uid?: string;
  /** Scheduled event seq (for uid generation). */
  seq?: number;
}
