/**
 * Пары релизов, между которыми соло-сохранение читается миграцией, — ДАННЫЕ правила, а не
 * его логика. Логика (как читать и как переносить) — `soloSaveMigration.ts`, он же
 * реэкспортирует всё отсюда, поэтому потребители импортируют, как раньше.
 *
 * Вынесено из `soloSaveMigration.ts`, когда список перерос сторож размеров (SLIM-1): каждая
 * правка правил добавляет сюда пару, а логика от этого не меняется.
 *
 * Старшие пары (каталоги 0.1.66 → 0.1.80) — в закрытом архиве
 * `soloSaveMigrationPairsArchive.ts`; новая пара — в конец этого файла.
 */
import type { SoloMigration } from './soloSaveMigration';
import {
  ARCHIVED_SOLO_MIGRATIONS,
  CONTROL_TECH_SOLO_MIGRATION,
} from './soloSaveMigrationPairsArchive';

export * from './soloSaveMigrationPairsArchive';

/** Catalogue + rules pair: the viceroy (BAL-19), a branchless scientist whose own line of three
 *  main-game nodes raises the control limit 10 → 12 → 14 → 16 at +10% army upkeep each.
 *  `economy` 1.4.0 multiplies unit upkeep through the `economy.unitUpkeep` hook, `technology`
 *  1.7.0 adds `armyUpkeep` to it and knows a scientist by id in `has_scientist`. No saved
 *  council holds the viceroy, and nothing new is stored, so a save of the previous release
 *  reads as is. */
export const VICEROY_SOLO_MIGRATION = {
  fromRules: CONTROL_TECH_SOLO_MIGRATION.toRules,
  fromData: CONTROL_TECH_SOLO_MIGRATION.toData,
  fromDataHash: CONTROL_TECH_SOLO_MIGRATION.toDataHash,
  toRules: '0294e673859e48',
  toData: '0.1.81',
  toDataHash: '086a8a70acb1f4',
} as const;

/** Research catalogue prices ×10. Keep the world, treasury, host price multipliers,
 *  already-paid research and its completion time; new starts use the new catalogue. */
export const TECHNOLOGY_PRICES_SOLO_MIGRATION = {
  fromRules: VICEROY_SOLO_MIGRATION.toRules,
  fromData: VICEROY_SOLO_MIGRATION.toData,
  fromDataHash: VICEROY_SOLO_MIGRATION.toDataHash,
  toRules: '0a6f76b86a4d0a',
  toData: '0.1.82',
  toDataHash: '0f70af91e21327',
} as const;

/** Rules-only patch: fleet-ops 1.14.1 and auto-merge 1.0.1 preserve enabled
 * bombardment/auto-assault on fusion. Saved fleets, cargo and clocks retain their
 * shape; only future merges use the new inheritance rule. */
export const FLEET_MERGE_ORDERS_SOLO_MIGRATION = {
  fromRules: TECHNOLOGY_PRICES_SOLO_MIGRATION.toRules,
  fromData: TECHNOLOGY_PRICES_SOLO_MIGRATION.toData,
  fromDataHash: TECHNOLOGY_PRICES_SOLO_MIGRATION.toDataHash,
  toRules: '08565a49533ff1',
  toData: TECHNOLOGY_PRICES_SOLO_MIGRATION.toData,
  toDataHash: TECHNOLOGY_PRICES_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only price change: station 1.4.1 charges 480 metal for new deployments.
 *  Existing worlds, already-paid assembly/repair orders and their clocks are retained. */
export const FORTRESS_PRICE_SOLO_MIGRATION = {
  fromRules: FLEET_MERGE_ORDERS_SOLO_MIGRATION.toRules,
  fromData: FLEET_MERGE_ORDERS_SOLO_MIGRATION.toData,
  fromDataHash: FLEET_MERGE_ORDERS_SOLO_MIGRATION.toDataHash,
  toRules: '199d8dd397071e',
  toData: FLEET_MERGE_ORDERS_SOLO_MIGRATION.toData,
  toDataHash: FLEET_MERGE_ORDERS_SOLO_MIGRATION.toDataHash,
} as const;

/** Long-range optics: a new utility module (+20 fleet direct sight). The catalogue
 *  only GAINS an entry; saved fleets, loadouts and clocks keep their shape. */
export const LONG_RANGE_OPTICS_SOLO_MIGRATION = {
  fromRules: FORTRESS_PRICE_SOLO_MIGRATION.toRules,
  fromData: FORTRESS_PRICE_SOLO_MIGRATION.toData,
  fromDataHash: FORTRESS_PRICE_SOLO_MIGRATION.toDataHash,
  toRules: '0c2693b7ff4f82',
  toData: '0.1.83',
  toDataHash: '134b32679b2ec3',
} as const;

/** Shared mobilization and selectable flagships. Existing paid jobs and clocks remain;
 * legacy parallel ground jobs finish before another mobilization starts. New fields are optional. */
export const PRODUCTION_WORKBENCH_SOLO_MIGRATION = {
  fromRules: LONG_RANGE_OPTICS_SOLO_MIGRATION.toRules,
  fromData: LONG_RANGE_OPTICS_SOLO_MIGRATION.toData,
  fromDataHash: LONG_RANGE_OPTICS_SOLO_MIGRATION.toDataHash,
  toRules: '1de9e10c071afd',
  toData: LONG_RANGE_OPTICS_SOLO_MIGRATION.toData,
  toDataHash: LONG_RANGE_OPTICS_SOLO_MIGRATION.toDataHash,
} as const;

/** Category timing for new main-game maps after shared mobilization. Campaign and
 * saved pricing, accepted work and paid repair budgets retain their original terms. */
export const BUILD_PRODUCTION_TIMES_SOLO_MIGRATION = {
  fromRules: PRODUCTION_WORKBENCH_SOLO_MIGRATION.toRules,
  fromData: PRODUCTION_WORKBENCH_SOLO_MIGRATION.toData,
  fromDataHash: PRODUCTION_WORKBENCH_SOLO_MIGRATION.toDataHash,
  toRules: '1633b24f2a883e',
  toData: PRODUCTION_WORKBENCH_SOLO_MIGRATION.toData,
  toDataHash: PRODUCTION_WORKBENCH_SOLO_MIGRATION.toDataHash,
} as const;

/** Data 0.1.84: research catalogue ×3 of the original (was ×10) and new main maps build ×2
 *  (was ×3). Saved pricing, paid research and accepted work keep their terms. */
export const PACE_RELIEF_SOLO_MIGRATION = {
  fromRules: BUILD_PRODUCTION_TIMES_SOLO_MIGRATION.toRules,
  fromData: BUILD_PRODUCTION_TIMES_SOLO_MIGRATION.toData,
  fromDataHash: BUILD_PRODUCTION_TIMES_SOLO_MIGRATION.toDataHash,
  toRules: '0d0fe0f3664984',
  toData: '0.1.84',
  toDataHash: '0d3235ac256571',
} as const;

/** Rules-only patch: fleet-ops 1.15.1 and auto-merge 1.0.2 carry a fleet's clocks (shield
 * delay, point-defense reload, cloak break) through split and merge, and keep the LATER of
 * two bombardment deadlines. Saved fleets keep their shape; only future splits and merges
 * use the new rule. */
export const FLEET_CLOCKS_SOLO_MIGRATION = {
  fromRules: PACE_RELIEF_SOLO_MIGRATION.toRules,
  fromData: PACE_RELIEF_SOLO_MIGRATION.toData,
  fromDataHash: PACE_RELIEF_SOLO_MIGRATION.toDataHash,
  toRules: '0789174782bba3',
  toData: PACE_RELIEF_SOLO_MIGRATION.toData,
  toDataHash: PACE_RELIEF_SOLO_MIGRATION.toDataHash,
} as const;

/** Data 0.1.85 + missiles 1.0.0, rocketMines 3.4.0: a buildable cruise missile kept in the
 *  hangar like a squadron and launched by `missile.launch`; every missile homes on its target
 *  and misses only when the target leaves its range from the launch point. A saved missile
 *  without guidance still flies to its point, as before. */
export const MISSILES_SOLO_MIGRATION = {
  fromRules: FLEET_CLOCKS_SOLO_MIGRATION.toRules,
  fromData: FLEET_CLOCKS_SOLO_MIGRATION.toData,
  fromDataHash: FLEET_CLOCKS_SOLO_MIGRATION.toDataHash,
  toRules: '029c750e7d056f',
  toData: '0.1.85',
  toDataHash: '02451de143b4e0',
} as const;

/** hero 4.12.2: «Аннигиляция» отказывает по миру игрока, с которым нет войны. Мир сохранения
 *  не меняется: прежде такой удар просто проходил. */
export const ANNIHILATE_PEACE_SOLO_MIGRATION = {
  fromRules: MISSILES_SOLO_MIGRATION.toRules,
  fromData: MISSILES_SOLO_MIGRATION.toData,
  fromDataHash: MISSILES_SOLO_MIGRATION.toDataHash,
  toRules: '093b4c8af2ade6',
  toData: MISSILES_SOLO_MIGRATION.toData,
  toDataHash: MISSILES_SOLO_MIGRATION.toDataHash,
} as const;

/** Приостановленная постройка держит место в крепости (construction 1.15.2): мир сейва
 *  не меняется, меняется только счёт мест на следующем заказе. */
export const PAUSED_SLOTS_SOLO_MIGRATION = {
  fromRules: ANNIHILATE_PEACE_SOLO_MIGRATION.toRules,
  fromData: ANNIHILATE_PEACE_SOLO_MIGRATION.toData,
  fromDataHash: ANNIHILATE_PEACE_SOLO_MIGRATION.toDataHash,
  toRules: '03f991eb289f8d',
  toData: ANNIHILATE_PEACE_SOLO_MIGRATION.toData,
  toDataHash: ANNIHILATE_PEACE_SOLO_MIGRATION.toDataHash,
} as const;

/** Приостановленная стройка платит содержание за свою долю (economy 1.4.2): мир сейва
 *  не меняется, меняется только счёт содержания со следующего шага часов. */
export const PAUSED_UPKEEP_SOLO_MIGRATION = {
  fromRules: PAUSED_SLOTS_SOLO_MIGRATION.toRules,
  fromData: PAUSED_SLOTS_SOLO_MIGRATION.toData,
  fromDataHash: PAUSED_SLOTS_SOLO_MIGRATION.toDataHash,
  toRules: '11840548fb0fdf',
  toData: PAUSED_SLOTS_SOLO_MIGRATION.toData,
  toDataHash: PAUSED_SLOTS_SOLO_MIGRATION.toDataHash,
} as const;

/** Data 0.1.86: a new province kind, the accretion disk round the Abyss black hole of
 *  `ffa-50`. A saved world keeps its map and provinces: the kind only appears in new matches
 *  on that map. */
export const ACCRETION_DISK_SOLO_MIGRATION = {
  fromRules: PAUSED_UPKEEP_SOLO_MIGRATION.toRules,
  fromData: PAUSED_UPKEEP_SOLO_MIGRATION.toData,
  fromDataHash: PAUSED_UPKEEP_SOLO_MIGRATION.toDataHash,
  toRules: '18ddffcbbefbff',
  toData: '0.1.86',
  toDataHash: '0ab210564da766',
} as const;

/** Rules-only pair: espionage 2.0.0 — named spies fly to their world, wait there for orders
 *  and come home to the capital (SPY-23). The catalogue is unchanged; a saved world's
 *  anonymous agents (`spyAgents`) are all home at its first tick, their posts closed. */
export const SPY_TRAVEL_SOLO_MIGRATION = {
  fromRules: ACCRETION_DISK_SOLO_MIGRATION.toRules,
  fromData: ACCRETION_DISK_SOLO_MIGRATION.toData,
  fromDataHash: ACCRETION_DISK_SOLO_MIGRATION.toDataHash,
  toRules: '17b676831d1377',
  toData: ACCRETION_DISK_SOLO_MIGRATION.toData,
  toDataHash: ACCRETION_DISK_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `spy-levels` 1.0.0 joins right after `espionage` — spies earn
 *  experience and levels that bend the espionage odds, deeds and speed. The catalogue is
 *  unchanged; a saved world's spies start without experience. */
export const SPY_LEVELS_SOLO_MIGRATION = {
  fromRules: SPY_TRAVEL_SOLO_MIGRATION.toRules,
  fromData: SPY_TRAVEL_SOLO_MIGRATION.toData,
  fromDataHash: SPY_TRAVEL_SOLO_MIGRATION.toDataHash,
  toRules: '0e16aa5f86099a',
  toData: SPY_TRAVEL_SOLO_MIGRATION.toData,
  toDataHash: SPY_TRAVEL_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `economy` 1.5.0 and `espionage` 2.1.0 — spies are paid a salary in
 *  credits with the daily upkeep. The catalogue is unchanged; a saved world's spies go on
 *  the payroll from the first settlement after loading. */
export const SPY_SALARY_SOLO_MIGRATION = {
  fromRules: SPY_LEVELS_SOLO_MIGRATION.toRules,
  fromData: SPY_LEVELS_SOLO_MIGRATION.toData,
  fromDataHash: SPY_LEVELS_SOLO_MIGRATION.toDataHash,
  toRules: '1bff113e714514',
  toData: SPY_LEVELS_SOLO_MIGRATION.toData,
  toDataHash: SPY_LEVELS_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 2.2.0 checks a spy order against what the player knows of the
 *  world and lets recon look at unclaimed worlds (SPY-24). The catalogue is unchanged; a saved
 *  world has no spy records yet (`scouted`): a fogged world takes deeds once a spy gets there. */
export const SPY_FOG_SOLO_MIGRATION = {
  fromRules: SPY_SALARY_SOLO_MIGRATION.toRules,
  fromData: SPY_SALARY_SOLO_MIGRATION.toData,
  fromDataHash: SPY_SALARY_SOLO_MIGRATION.toDataHash,
  toRules: '010f60df85806f',
  toData: SPY_LEVELS_SOLO_MIGRATION.toData,
  toDataHash: SPY_LEVELS_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: forcedMarch 1.2.0 + movement 1.9.0 — a forced march switched on or off
 *  in flight re-times the current leg at once. The catalogue is unchanged; a saved fleet keeps
 *  its leg as it was, and only a later switch re-times it. */
export const FORCED_MARCH_PACE_SOLO_MIGRATION = {
  fromRules: SPY_FOG_SOLO_MIGRATION.toRules,
  fromData: SPY_FOG_SOLO_MIGRATION.toData,
  fromDataHash: SPY_FOG_SOLO_MIGRATION.toDataHash,
  toRules: '1ed425397264f6',
  toData: SPY_FOG_SOLO_MIGRATION.toData,
  toDataHash: SPY_FOG_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: fleetBrood 1.3.0 — onboard brood measures the hold shared with shuttles in
 *  the hangar and out on a strike (SHU-5.1). The catalogue is unchanged; organisms already
 *  aboard stay, and only later cycles see the shuttles. */
export const BROOD_HOLD_SOLO_MIGRATION = {
  fromRules: FORCED_MARCH_PACE_SOLO_MIGRATION.toRules,
  fromData: FORCED_MARCH_PACE_SOLO_MIGRATION.toData,
  fromDataHash: FORCED_MARCH_PACE_SOLO_MIGRATION.toDataHash,
  toRules: '0b513e5c40130b',
  toData: FORCED_MARCH_PACE_SOLO_MIGRATION.toData,
  toDataHash: FORCED_MARCH_PACE_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: effects 0.3.0 — scheduled dark events inside one span fire in time order
 *  (then by rule id), so an offline catch-up lands what the same hours stepped one by one would.
 *  The catalogue is unchanged. */
export const SCHEDULE_ORDER_SOLO_MIGRATION = {
  fromRules: BROOD_HOLD_SOLO_MIGRATION.toRules,
  fromData: BROOD_HOLD_SOLO_MIGRATION.toData,
  fromDataHash: BROOD_HOLD_SOLO_MIGRATION.toDataHash,
  toRules: '03926c569ac068',
  toData: BROOD_HOLD_SOLO_MIGRATION.toData,
  toDataHash: BROOD_HOLD_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: `auto-rally` 1.4.0 and `movement` 1.10.0 — a rally point may aim at any
 *  world except visibly closed territory, and its ships stop at such a border on the way.
 *  The catalogue is unchanged and a saved point keeps its shape, so a saved world reads as is. */
export const RALLY_ANY_WORLD_SOLO_MIGRATION = {
  fromRules: SCHEDULE_ORDER_SOLO_MIGRATION.toRules,
  fromData: SCHEDULE_ORDER_SOLO_MIGRATION.toData,
  fromDataHash: SCHEDULE_ORDER_SOLO_MIGRATION.toDataHash,
  toRules: '1b563be4dcc083',
  toData: SCHEDULE_ORDER_SOLO_MIGRATION.toData,
  toDataHash: SCHEDULE_ORDER_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: espionage 2.3.0 — a turned agent asks its catcher to take it in (for
 *  good) or flees, instead of serving it for a day. The catalogue is unchanged; a saved
 *  world's turned agent (`turnedUntil`) serves out its term. */
export const SPY_DEFECTOR_SOLO_MIGRATION = {
  fromRules: RALLY_ANY_WORLD_SOLO_MIGRATION.toRules,
  fromData: RALLY_ANY_WORLD_SOLO_MIGRATION.toData,
  fromDataHash: RALLY_ANY_WORLD_SOLO_MIGRATION.toDataHash,
  toRules: '1f5a277badc3ab',
  toData: SPY_LEVELS_SOLO_MIGRATION.toData,
  toDataHash: SPY_LEVELS_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: captive 1.3.0 — an immobile fleet (mine, missile, fortress guns) does
 *  not take the captive aboard (`E_NO_SHIPS`). The catalogue is unchanged; a captive already
 *  aboard such a fleet stays where it is. */
export const CAPTIVE_CARRIER_SOLO_MIGRATION = {
  fromRules: SPY_DEFECTOR_SOLO_MIGRATION.toRules,
  fromData: SPY_DEFECTOR_SOLO_MIGRATION.toData,
  fromDataHash: SPY_DEFECTOR_SOLO_MIGRATION.toDataHash,
  toRules: '1f9e1d06b0cbfa',
  toData: SPY_DEFECTOR_SOLO_MIGRATION.toData,
  toDataHash: SPY_DEFECTOR_SOLO_MIGRATION.toDataHash,
} as const;

/** Catalogue 0.1.87 + shuttle 2.1.0: the base's shared sortie pool is gone; a squadron that
 *  lands refuels for `refuelMinutes` (owner's decision 2026-11-17). A saved `sortie` counter
 *  is left in place and ignored; squadrons already parked carry no `readyAt` and are ready. */
export const SQUADRON_REFUEL_SOLO_MIGRATION = {
  fromRules: CAPTIVE_CARRIER_SOLO_MIGRATION.toRules,
  fromData: CAPTIVE_CARRIER_SOLO_MIGRATION.toData,
  fromDataHash: CAPTIVE_CARRIER_SOLO_MIGRATION.toDataHash,
  toRules: '12281b71e968af',
  toData: '0.1.87',
  toDataHash: '0f85efc1673abe',
} as const;

/** Rules-only pair: orbital 1.8.0 — the world's flak and a fleet's bombardment land in the
 *  order of time however the span is cut, and a flak volley stamps `lastDamagedAt` with its
 *  own instant (FORT-5.17). The catalogue is unchanged and so is the saved shape: a saved
 *  world reads as is, only later spans interleave the two fires. */
export const ORBITAL_TIME_ORDER_SOLO_MIGRATION = {
  fromRules: SQUADRON_REFUEL_SOLO_MIGRATION.toRules,
  fromData: SQUADRON_REFUEL_SOLO_MIGRATION.toData,
  fromDataHash: SQUADRON_REFUEL_SOLO_MIGRATION.toDataHash,
  toRules: '1e9665469708f6',
  toData: SQUADRON_REFUEL_SOLO_MIGRATION.toData,
  toDataHash: SQUADRON_REFUEL_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: shuttle 2.2.0 — a patrol dives on a target in its circle with a full
 *  strike and flies home to refuel; `patrol.radar` picks any radar blip over identified
 *  targets only; a held patrol that dove keeps its point in `rejoin`; the patrol circle is a
 *  radar, not eyes (SHU-6.18). The catalogue is unchanged and so is the saved shape: a saved
 *  patrol has no `radar` and reads as «identified only», the owner's default. */
export const PATROL_DIVE_SOLO_MIGRATION = {
  fromRules: ORBITAL_TIME_ORDER_SOLO_MIGRATION.toRules,
  fromData: ORBITAL_TIME_ORDER_SOLO_MIGRATION.toData,
  fromDataHash: ORBITAL_TIME_ORDER_SOLO_MIGRATION.toDataHash,
  toRules: '00a22acf381e46',
  toData: ORBITAL_TIME_ORDER_SOLO_MIGRATION.toData,
  toDataHash: ORBITAL_TIME_ORDER_SOLO_MIGRATION.toDataHash,
} as const;

/** Data 0.1.88: a new province kind, the star, and its six classes (owner 2026-11-17: a
 *  star stands in its own province with a ring its class makes). A saved world keeps its map
 *  and provinces: stars only appear in new matches. */
export const STAR_PROVINCE_SOLO_MIGRATION = {
  fromRules: PATROL_DIVE_SOLO_MIGRATION.toRules,
  fromData: PATROL_DIVE_SOLO_MIGRATION.toData,
  fromDataHash: PATROL_DIVE_SOLO_MIGRATION.toDataHash,
  toRules: '092a2fe87e2178',
  toData: '0.1.88',
  toDataHash: '1dc3f007dd5f9e',
} as const;

/** Rules-only pair: combat 4.1.0 — what a volley leaves unspent on a fallen side goes to the
 *  shooter's living enemies, and a fleet keeps what found no target as a charge for five game
 *  minutes (`Fleet.overcharge`, MSB-10). The catalogue is unchanged; a saved world has no
 *  charge and reads as is. */
export const VOLLEY_OVERFLOW_SOLO_MIGRATION = {
  fromRules: STAR_PROVINCE_SOLO_MIGRATION.toRules,
  fromData: STAR_PROVINCE_SOLO_MIGRATION.toData,
  fromDataHash: STAR_PROVINCE_SOLO_MIGRATION.toDataHash,
  toRules: '1bea1871c0f6b4',
  toData: STAR_PROVINCE_SOLO_MIGRATION.toData,
  toDataHash: STAR_PROVINCE_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: combat 4.2.0 — one battle line per power: N in `min(1, L/N)` counts every
 *  living unit the owner has in the battle, not one fleet's (MSB-11). The catalogue and the
 *  saved shape are unchanged. */
export const LINE_PER_POWER_SOLO_MIGRATION = {
  fromRules: VOLLEY_OVERFLOW_SOLO_MIGRATION.toRules,
  fromData: VOLLEY_OVERFLOW_SOLO_MIGRATION.toData,
  fromDataHash: VOLLEY_OVERFLOW_SOLO_MIGRATION.toDataHash,
  toRules: '0ed98354e9290d',
  toData: VOLLEY_OVERFLOW_SOLO_MIGRATION.toData,
  toDataHash: VOLLEY_OVERFLOW_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: economy 1.6.0 — a power falls into arrears at the instant its treasury
 *  runs dry, not at the end of the advanced span, so one long span equals many short ones
 *  (PE-2.2). The catalogue and the saved shape are unchanged. */
export const ARREARS_INSTANT_SOLO_MIGRATION = {
  fromRules: LINE_PER_POWER_SOLO_MIGRATION.toRules,
  fromData: LINE_PER_POWER_SOLO_MIGRATION.toData,
  fromDataHash: LINE_PER_POWER_SOLO_MIGRATION.toDataHash,
  toRules: '126c8ad2a73c74',
  toData: LINE_PER_POWER_SOLO_MIGRATION.toData,
  toDataHash: LINE_PER_POWER_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: visibility 2.7.0 — fog memory of a fleet is taken at the instant it leaves
 *  sight and a province survey is stamped at the instant the border is crossed, not at the end
 *  of the advanced span. The catalogue and the saved shape are unchanged. */
export const FOG_INSTANT_SOLO_MIGRATION = {
  fromRules: ARREARS_INSTANT_SOLO_MIGRATION.toRules,
  fromData: ARREARS_INSTANT_SOLO_MIGRATION.toData,
  fromDataHash: ARREARS_INSTANT_SOLO_MIGRATION.toDataHash,
  toRules: '1bc313c4745206',
  toData: ARREARS_INSTANT_SOLO_MIGRATION.toData,
  toDataHash: ARREARS_INSTANT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: bot-diplomacy 0.3.0 — favour thresholds allow 1e-9 of float dust, and a
 *  bot that a caught spy sinks under the war line declares war at once, checked again at a
 *  span's start before healing. How time is cut no longer decides it (PE-2.2). */
export const BOT_FAVOUR_LINE_SOLO_MIGRATION = {
  fromRules: FOG_INSTANT_SOLO_MIGRATION.toRules,
  fromData: FOG_INSTANT_SOLO_MIGRATION.toData,
  fromDataHash: FOG_INSTANT_SOLO_MIGRATION.toDataHash,
  toRules: '1b05ec284f4729',
  toData: FOG_INSTANT_SOLO_MIGRATION.toData,
  toDataHash: FOG_INSTANT_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: orbital 1.9.0 — every flak and bombardment volley is a world step of
 *  its own (`time.stop` → `time.stopped`), landing after the span before it has been
 *  accrued, repairs included. The catalogue and the saved shape are unchanged. */
export const VOLLEY_STEP_SOLO_MIGRATION = {
  fromRules: BOT_FAVOUR_LINE_SOLO_MIGRATION.toRules,
  fromData: BOT_FAVOUR_LINE_SOLO_MIGRATION.toData,
  fromDataHash: BOT_FAVOUR_LINE_SOLO_MIGRATION.toDataHash,
  toRules: '0884e1e2622619',
  toData: BOT_FAVOUR_LINE_SOLO_MIGRATION.toData,
  toDataHash: BOT_FAVOUR_LINE_SOLO_MIGRATION.toDataHash,
} as const;

/** Rules-only pair: combat 4.3.0 — the battle line counts fleets, not ships: N in
 *  `min(1, L/N)` is one fleet's own units again, and past five fleets of one power each fires
 *  at 5/M (MSB-13). The catalogue and the saved shape are unchanged. */
export const FLEET_LINE_SOLO_MIGRATION = {
  fromRules: VOLLEY_STEP_SOLO_MIGRATION.toRules,
  fromData: VOLLEY_STEP_SOLO_MIGRATION.toData,
  fromDataHash: VOLLEY_STEP_SOLO_MIGRATION.toDataHash,
  toRules: '03ce0ec8268cc3',
  toData: VOLLEY_STEP_SOLO_MIGRATION.toData,
  toDataHash: VOLLEY_STEP_SOLO_MIGRATION.toDataHash,
} as const;

/** Data 0.1.89 + shuttle 2.3.0, missiles 1.1.0: the closed sky (owner 2026-11-19). A province
 *  kind with `overflight: false` — the star, the black hole, the accretion disk — closes the
 *  sky above it: no strike, patrol, ferry or missile flies over it (`E_SKY_CLOSED`). The saved
 *  shape is unchanged; a flight already in the air flies on, only new orders are checked. */
export const CLOSED_SKY_SOLO_MIGRATION = {
  fromRules: FLEET_LINE_SOLO_MIGRATION.toRules,
  fromData: FLEET_LINE_SOLO_MIGRATION.toData,
  fromDataHash: FLEET_LINE_SOLO_MIGRATION.toDataHash,
  toRules: '11ce709e7a74d5',
  toData: '0.1.89',
  toDataHash: '0c94b5782dc447',
} as const;

/** A pair from where `prev` ends; `to` names only the pins that moved (TEC-3). */
const after = (prev: SoloMigration, to: Partial<SoloMigration> & { toRules: string }): SoloMigration => ({
  fromRules: prev.toRules, fromData: prev.toData, fromDataHash: prev.toDataHash, toData: prev.toData, toDataHash: prev.toDataHash, ...to });

/** Data 0.1.90: the time matrix (TEC-1, owner 2026-11-19) — the `timeValue` fragment. No
 *  rule reads it yet, so a saved world plays on unchanged; only the catalogue pin moves. */
export const TIME_VALUE_SOLO_MIGRATION = after(CLOSED_SKY_SOLO_MIGRATION, {
  toRules: '0c1bb362ecae00', toData: '0.1.90', toDataHash: '03a2caa630fe0d',
});

/** Data 0.1.91 + `speedup` 1.0.0 (TEC-3): hurrying a queue. A saved world has no speed-up
 *  record and reads as one that never hurried; queues and their timings are untouched. */
export const SPEEDUP_SOLO_MIGRATION = after(TIME_VALUE_SOLO_MIGRATION, {
  toRules: '014cda3b66c91d', toData: '0.1.91', toDataHash: '18512a1ab58092',
});

/** Data 0.1.92: the rings round the bodies (owner 2026-11-18/19). Six ring kinds — corona,
 *  dust shell, stellar wind, planetary nebula, pulsar wind, circumbinary disk — join the
 *  catalogue, impassable and closed to aviation like the accretion disk. A save keeps the map
 *  it was dealt; the saved shape is unchanged. */
export const CELESTIAL_RINGS_SOLO_MIGRATION = after(SPEEDUP_SOLO_MIGRATION, {
  toRules: '034650f6d786f9', toData: '0.1.92', toDataHash: '05bcf6dbb76099',
});

/** TEC-4: rules only — `speedup` 1.1.0 sells resources for ◆ (`resources.buy`, host-only). */
export const RESOURCE_PURCHASE_SOLO_MIGRATION = after(CELESTIAL_RINGS_SOLO_MIGRATION, { toRules: '0f558d0bf17afc' });

/** Rules only — `shuttle` 2.3.1 and `missiles` 1.1.1: a fortress site is no cell of the closed
 *  sky, and a squadron whose way home lies over it lands at the nearest open base. A saved
 *  world plays on unchanged until such a flight. */
export const FORTRESS_SKY_SOLO_MIGRATION = after(RESOURCE_PURCHASE_SOLO_MIGRATION, { toRules: '1b308c299ad835' });

/** Rules only — `victory` 1.12.0: a capital match also ends on the share of the map its map
 *  or mode names (the duel, 90%). A saved duel short of that share plays on unchanged. */
export const CAPITAL_SHARE_SOLO_MIGRATION = after(FORTRESS_SKY_SOLO_MIGRATION, { toRules: '1aa681c64bbe8f' });

/** The audited pairs, oldest first; each starts where the one before it ends, so a save
 *  of any listed release reaches a later one pair by pair. Nothing else is migrated. */
export const SOLO_MIGRATIONS: readonly SoloMigration[] = [
  ...ARCHIVED_SOLO_MIGRATIONS,
  VICEROY_SOLO_MIGRATION,
  TECHNOLOGY_PRICES_SOLO_MIGRATION,
  FLEET_MERGE_ORDERS_SOLO_MIGRATION,
  FORTRESS_PRICE_SOLO_MIGRATION,
  LONG_RANGE_OPTICS_SOLO_MIGRATION,
  PRODUCTION_WORKBENCH_SOLO_MIGRATION,
  BUILD_PRODUCTION_TIMES_SOLO_MIGRATION,
  PACE_RELIEF_SOLO_MIGRATION,
  FLEET_CLOCKS_SOLO_MIGRATION,
  MISSILES_SOLO_MIGRATION,
  ANNIHILATE_PEACE_SOLO_MIGRATION,
  PAUSED_SLOTS_SOLO_MIGRATION,
  PAUSED_UPKEEP_SOLO_MIGRATION,
  ACCRETION_DISK_SOLO_MIGRATION,
  SPY_TRAVEL_SOLO_MIGRATION,
  SPY_LEVELS_SOLO_MIGRATION,
  SPY_SALARY_SOLO_MIGRATION,
  SPY_FOG_SOLO_MIGRATION,
  FORCED_MARCH_PACE_SOLO_MIGRATION,
  BROOD_HOLD_SOLO_MIGRATION,
  SCHEDULE_ORDER_SOLO_MIGRATION,
  RALLY_ANY_WORLD_SOLO_MIGRATION,
  SPY_DEFECTOR_SOLO_MIGRATION,
  CAPTIVE_CARRIER_SOLO_MIGRATION,
  SQUADRON_REFUEL_SOLO_MIGRATION,
  ORBITAL_TIME_ORDER_SOLO_MIGRATION,
  PATROL_DIVE_SOLO_MIGRATION,
  STAR_PROVINCE_SOLO_MIGRATION,
  VOLLEY_OVERFLOW_SOLO_MIGRATION,
  LINE_PER_POWER_SOLO_MIGRATION,
  ARREARS_INSTANT_SOLO_MIGRATION,
  FOG_INSTANT_SOLO_MIGRATION,
  BOT_FAVOUR_LINE_SOLO_MIGRATION,
  VOLLEY_STEP_SOLO_MIGRATION,
  FLEET_LINE_SOLO_MIGRATION,
  CLOSED_SKY_SOLO_MIGRATION,
  TIME_VALUE_SOLO_MIGRATION,
  SPEEDUP_SOLO_MIGRATION,
  CELESTIAL_RINGS_SOLO_MIGRATION,
  RESOURCE_PURCHASE_SOLO_MIGRATION,
  FORTRESS_SKY_SOLO_MIGRATION,
  CAPITAL_SHARE_SOLO_MIGRATION,
];
