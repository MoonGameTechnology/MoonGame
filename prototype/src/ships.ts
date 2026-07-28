/**
 * Ship modularity (GDD §6.1) — the SAME modular pattern as heroes, applied to fleets.
 *
 * Design (forks resolved from the docs):
 *  - CLASS / blueprint, not per-instance (GDD §6.1 + hundreds of units + the
 *    `FormationTemplate` precedent): the player fits a loadout per ship HULL; every ship
 *    built of that hull uses it. Keeps the deterministic JSON state small.
 *  - FROZEN at session start (GDD §2 "дека модулей фиксируется при создании сессии"):
 *    the loadout rides in `SetupConfig`, like `templates` / `heroes`.
 *  - Decoupled from the meta-economy (items/enchant/auction, EC-1..3): this is the pure,
 *    in-match model — prototyped data-first the way heroes were before the server.
 *
 * A module is data: a set of fractional stat modifiers (`+0.25` = +25%). The engine sums
 * the equipped modules' modifiers per stat and applies them to the hull's base stats —
 * the same "passive → stat" shape as hero fittings. Feeding the derived stats into combat
 * is the NEXT brick (SHIP-2); until then a module is `live: false` (a preview, "скоро").
 */

export type ShipStat = 'attack' | 'defense' | 'speed' | 'hp';

/** A buildable hull = a base unit id + how many module slots it fields. Slot count grows
 *  with the hull's role/size (a workhorse cruiser fits more than a scout drone). */
export interface ShipHull {
  name: string;
  icon: string;
  slots: number;
  /** The `data/units.json` id this hull derives from (its base stats). */
  base: string;
}

export const SHIP_HULLS: Record<string, ShipHull> = {
  cruiser: { name: 'ship.hull.cruiser', icon: '▲', slots: 3, base: 'cruiser' },
  siege_lance: { name: 'ship.hull.siege_lance', icon: '✦', slots: 2, base: 'siege' },
  scout_drone: { name: 'ship.hull.scout_drone', icon: '◌', slots: 1, base: 'scout' },
  dropship: { name: 'ship.hull.dropship', icon: '⊟', slots: 2, base: 'dropship' },
};

export const SHIP_HULL_IDS: string[] = Object.keys(SHIP_HULLS);

/** Module slots per hull. Unknown hull ⇒ 0 (graceful). */
export function hullSlots(hull: string): number {
  return SHIP_HULLS[hull]?.slots ?? 0;
}

/** A ship module: fractional stat modifiers, summed across the equipped modules and
 *  applied to the hull's base stats. `live` = the effect already reaches combat. */
export interface ShipModule {
  id: string;
  name: string;
  icon: string;
  desc: string;
  mods: Partial<Record<ShipStat, number>>;
  live: boolean;
}

export const SHIP_MODULES: Record<string, ShipModule> = {
  battery: { id: 'battery', name: 'ship.module.battery.name', icon: '≡', desc: 'ship.module.battery.desc', mods: { attack: 0.3 }, live: false },
  plating: { id: 'plating', name: 'ship.module.plating.name', icon: '▮', desc: 'ship.module.plating.desc', mods: { hp: 0.25 }, live: false },
  shield: { id: 'shield', name: 'ship.module.shield.name', icon: '◊', desc: 'ship.module.shield.desc', mods: { defense: 0.3 }, live: false },
  thruster: { id: 'thruster', name: 'ship.module.thruster.name', icon: '»', desc: 'ship.module.thruster.desc', mods: { speed: 0.2 }, live: false },
  targeting: { id: 'targeting', name: 'ship.module.targeting.name', icon: '⊹', desc: 'ship.module.targeting.desc', mods: { attack: 0.15, defense: 0.15 }, live: false },
};

export const SHIP_MODULE_IDS: string[] = Object.keys(SHIP_MODULES);

/** A player's loadout for one hull: an ordered list of equipped module ids (or `null`
 *  for an empty slot). Stackable — two `plating` is a valid, heavier choice. */
export interface ShipLoadout {
  hull: string;
  modules: (string | null)[];
}

/** Apply a loadout's modules to a hull's base stats. Per stat: `derived = round(base ×
 *  (1 + Σ module mods))`, never below 0. Only the first `slots` entries count (over-cap
 *  modules are ignored); empty / unknown ids are skipped. Pure & deterministic. */
export function shipStats(
  base: Record<ShipStat, number>,
  loadout: ShipLoadout,
): Record<ShipStat, number> {
  const factor: Record<ShipStat, number> = { attack: 1, defense: 1, speed: 1, hp: 1 };
  const slots = hullSlots(loadout.hull);
  for (const id of loadout.modules.slice(0, slots)) {
    if (id == null) continue;
    const m = SHIP_MODULES[id];
    if (!m) continue;
    for (const stat of Object.keys(m.mods) as ShipStat[]) factor[stat] += m.mods[stat] ?? 0;
  }
  return {
    attack: Math.max(0, Math.round(base.attack * factor.attack)),
    defense: Math.max(0, Math.round(base.defense * factor.defense)),
    speed: Math.max(0, Math.round(base.speed * factor.speed)),
    hp: Math.max(0, Math.round(base.hp * factor.hp)),
  };
}

export interface ShipLoadoutInfo {
  hull: string;
  slots: number;
  /** Resolved modules in slot order (over-cap and empty/unknown dropped). */
  modules: ShipModule[];
  count: number;
  /** How many equipped modules are not yet wired into combat (the "скоро" preview). */
  planned: number;
}

/** Resolve a loadout to its hull's slot count + the modules actually fielded. */
export function shipLoadoutInfo(loadout: ShipLoadout): ShipLoadoutInfo {
  const slots = hullSlots(loadout.hull);
  const modules = loadout.modules
    .slice(0, slots)
    .map((id) => (id == null ? undefined : SHIP_MODULES[id]))
    .filter((m): m is ShipModule => m !== undefined);
  return {
    hull: loadout.hull,
    slots,
    modules,
    count: modules.length,
    planned: modules.filter((m) => !m.live).length,
  };
}

/** Default per-hull loadouts (one per buildable hull, filled to its slot count). */
export const DEFAULT_SHIP_LOADOUTS: ShipLoadout[] = [
  { hull: 'cruiser', modules: ['battery', 'plating', 'shield'] },
  { hull: 'siege_lance', modules: ['battery', 'targeting'] },
  { hull: 'scout_drone', modules: ['thruster'] },
  { hull: 'dropship', modules: ['plating', 'plating'] },
];
