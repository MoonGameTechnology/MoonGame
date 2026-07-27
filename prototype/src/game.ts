/**
 * Void Dominion — playable prototype, game setup.
 *
 * This file is pure game wiring (no DOM): it builds the data-driven content,
 * the map and the kernel out of the REAL `@void/shared-core` simulation, so the
 * browser UI and a Node smoke-test drive exactly the same deterministic core.
 */
import {
  createKernel,
  createInitialState,
  buildingLevel,
  hasOrbit,
  allowedBuildings,
  isBuildable,
  isCapturable,
  isBombarded,
  economyModule,
  effectsModule,
  BROWNOUT,
  movementModule,
  factionModule,
  heroModule,
  heroEffectsModule,
  combatModule,
  orbitalModule,
  artilleryModule,
  interceptModule,
  captureOnArrivalModule,
  sectorModule,
  planetTypeModule,
  constructionModule,
  arsenalSyncModule,
  armyModule,
  victoryModule,
  technologyModule,
  espionageModule,
  stewardModule,
  diplomacyModule,
  stewardActive,
  STEWARD_POSTURES,
  STEWARD_LOSS_LIMIT,
  MAX_STEWARD_HOLD_POINTS,
  scanNodeThreats,
  previewBattle,
  hullPool,
  journeyDestination,
  planRoute,
  routeDistance,
  estimateTravelHours,
  getStance,
  clearOffers,
  setStance,
  pairKey,
  identifiedNodes,
  timeScaleOf,
  hoursToMs,
  effectiveStats,
  buildProgress,
  thresholdRamp,
  type DiplomaticStance,
  type GameData,
  type GameModule,
  type GameState,
  type ResourceBag,
  type Hero,
  type Planet,
  type Fleet,
  type UnitStack,
  type Player,
  type StewardLogEntry,
  type Action,
  type Context,
  type DomainEvent,
  type Battle,
  type StewardPosture,
} from '../../packages/shared-core/src/index';
import { canAfford, payCost } from '../../packages/shared-core/src/util/treasury';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import { sumUnitStat, findHealthyStack } from '../../packages/shared-core/src/util/stacks';
import {
  garrisonUnderAssault,
  requireOwnedIdleFleet,
} from '../../packages/shared-core/src/util/fleet';
import type { HandlerContext } from '../../packages/shared-core/src/kernel/module';
import {
  GROUND_ROSTER,
  makeSide,
  damageBuckets,
  OFFICERS,
  type GroundStack,
  type DamageTable,
  type Officer,
} from './groundcombat';
import { DEFAULT_HEROES, type HeroGrade, type HeroLoadout } from './heroes';

/** Menu grade → core hero archetype: the four default roster heroes ARE the four
 *  catalog archetypes (Командир/Разрушитель/Авангард/Страж), so the grade doubles as
 *  the archetype key when the roster rides into the match as core hero instances. */
const ARCHETYPE_OF_GRADE: Record<HeroGrade, string> = {
  main: 'commander',
  legendary: 'ravager',
  rare: 'vanguard',
  common: 'warden',
};
import { DEFAULT_SHIP_LOADOUTS, type ShipLoadout } from './ships';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// --- data-driven content -----------------------------------------------------
// REFP-1: the inline `parseGameData({...})` catalogue moved to `prototypeData.ts`
// (it had no internal deps on the rest of game.ts). Imported here for internal use
// AND re-exported so the public API of `game.ts` stays unchanged for `main.ts` /
// `netserver.ts` / the tests.
import { data } from './prototypeData';
export { data };

// --- sectors -----------------------------------------------------------------
// REFP-2: the sector-type registry and the generated match map moved to `map.ts`
// (depended only on `data` + the core `sectorKind` helpers). Imported here for
// internal use AND re-exported so the public API of `game.ts` stays unchanged for
// `main.ts` / `netserver.ts` / the tests.
import { SECTOR_TYPES, MAP, START_CANDIDATES, type SectorType, type MapNode } from './map';
export { SECTOR_TYPES, MAP, START_CANDIDATES, type SectorType, type MapNode };
// Shared stance vocabulary — main.ts routes propose-vs-declare by the same ranks
// the core module enforces (one table, no drift).
export { STANCE_RANK } from '../../packages/shared-core/src/index';

function player(
  id: string,
  name: string,
  faction: string,
  resources: Record<string, number>,
  ai = false,
): Player {
  return { id, name, faction, status: 'active', resources, ...(ai ? { ai: true } : {}) };
}

function fleet(
  id: string,
  owner: string,
  location: string,
  units: Array<[string, number]>,
  landing: Array<[string, number]>,
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    landing: landing.map(([unit, count]) => ({ unit, count })),
    traits: [],
  };
}

// REFP-3: the stack-list helpers (loadout signature, pro-rata split, loadout-aware
// merge) moved to `fleetStacks.ts` — pure functions over `UnitStack[]`, no other
// game.ts deps. Imported here for the fleet launch/merge/split modules.
import { loadoutKey, takeFromStacks, mergeStacks } from './fleetStacks';
// --- taxes: inhabited worlds collect credits --------------------------------
// REFP-4: civic tax (constants + isInhabited/civicTax/inhabitedWorldCount + taxModule)
// moved to `tax.ts` — depended only on `data` + core sectorKind helpers, hooks
// `economy.production`. Imported here for MODULES and re-exported for main.ts / tests.
import {
  TAX_PER_HOUR,
  TAX_OFFICE_BONUS,
  TAX_DIMINISH,
  isInhabited,
  civicTax,
  inhabitedWorldCount,
  taxModule,
} from './tax';
export { TAX_PER_HOUR, TAX_OFFICE_BONUS, TAX_DIMINISH, isInhabited, civicTax, inhabitedWorldCount };

// REFP-9: hunger module (HUNGER_MULT + hungerModule) moved to `hunger.ts` — a single
// combat.damage hook, no other game.ts deps. Imported here for MODULES and re-exported.
import { HUNGER_MULT, hungerModule } from './hunger';
export { HUNGER_MULT, hungerModule };

// REFP-10: fleet.launch/merge/split/engage (fleetLaunchModule + the monotonic
// fleet-id counter) moved to `fleetLaunch.ts` — depends on `divisionsOf` (still
// here, division state isn't extracted yet, REFP-13). `game.ts` imports
// `fleetLaunchModule` for `MODULES`.
import { fleetLaunchModule } from './fleetLaunch';
export { fleetLaunchModule };

// --- assembling the match ----------------------------------------------------

/** A seat in a match: who spawns where, and whether the AI drives it. Up to 10. */
export interface SeatConfig {
  id: string;
  name: string;
  faction: string;
  start: string; // a START_CANDIDATES world id
  ai: boolean;
  /** Team side for a team battle (e.g. 'A' / 'B'). Seats sharing a team start ALLIED;
   *  across teams they start at WAR. Absent on every seat ⇒ free-for-all (all pairs
   *  seeded at peace, the classic skirmish). Mirrors the core map's slot `team`. */
  team?: string;
}
export interface SetupConfig {
  seats: SeatConfig[];
  /** RNG seed of the match. Absent → the historical fixed 'prototype-1'. Self-play
   *  (M4) varies it per run — with the fixed seed an identical setup plays out
   *  identically every time (the determinism the core guarantees). */
  seed?: string;
  /** The human player's chosen research-leader council — up to 2 scientist ids from
   *  `data.scientists`, picked BEFORE the start-point at setup (a start consecration,
   *  GDD §5.2). Absent → the command leader «overseer» by default. */
  scientists?: string[];
  /** The player's 3 division templates, designed in the main menu and LOCKED for the
   *  session (mobilised in-match via `formation.mobilize`). Absent → DEFAULT_TEMPLATES. */
  templates?: FormationTemplate[];
  /** The player's hero roster (up to 3 loadouts), composed in the main menu. Absent →
   *  DEFAULT_HEROES. In-match instances / capital / respawn land in a later phase. */
  heroes?: HeroLoadout[];
  /** The player's ship blueprints — a module loadout per hull class (the "Верфь"
   *  designer). Frozen at session start (GDD §2). Absent → DEFAULT_SHIP_LOADOUTS. */
  ships?: ShipLoadout[];
  /** Meta-progression grant for the HUMAN seat (prototype/src/meta.ts metaGrant),
   *  snapshotted at match start like scientists/templates: hidden techs land as
   *  `completed`, the council starts higher, the treasury opens fatter. Earned by
   *  play only — never sold (main-menu.md §5). Absent = a fresh commander. */
  meta?: { tech: string[]; scientistLevel: number; resourceMult: number };
}

// REFP-5: ground division templates (FORMATION_*, FormationTemplate/OfficerTemplate,
// DEFAULT_TEMPLATES/OFFICER_TEMPLATES, formationStats) moved to `formations.ts` —
// depended only on `data` + GROUND_ROSTER. Imported here for internal use (newGame,
// templatesOf) AND re-exported for main.ts / tests.
import {
  FORMATION_UNITS,
  FORMATION_SLOTS,
  FORMATION_TEMPLATE_COUNT,
  DEFAULT_TEMPLATES,
  OFFICER_TEMPLATES,
  formationStats,
  type FormationUnit,
  type FormationTemplate,
  type OfficerTemplate,
  type FormationSynergy,
  type FormationStats,
} from './formations';
export {
  FORMATION_UNITS,
  FORMATION_SLOTS,
  FORMATION_TEMPLATE_COUNT,
  DEFAULT_TEMPLATES,
  OFFICER_TEMPLATES,
  formationStats,
  type FormationUnit,
  type FormationTemplate,
  type OfficerTemplate,
  type FormationSynergy,
  type FormationStats,
};

// REFP-6: bot favour (approval) scale — FAVOUR_* constants + botFavour/botEmbargoes
// moved to `botFavour.ts` (pure reads of the prototype's `approval` state extension).
// Imported here for newGame/botDiplomacy/market and re-exported for main.ts / tests.
import {
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  FAVOUR_PEACE_ACCEPT,
  FAVOUR_PACT_ACCEPT,
  FAVOUR_WAR_DECLARED_HIT,
  FAVOUR_SPY_CAUGHT_HIT,
  FAVOUR_WAR_DECAY_PER_DAY,
  FAVOUR_HEAL_PER_DAY,
  botFavour,
  botEmbargoes,
} from './botFavour';
export {
  FAVOUR_BASE,
  FAVOUR_EMBARGO,
  FAVOUR_WAR,
  FAVOUR_PEACE_ACCEPT,
  FAVOUR_PACT_ACCEPT,
  FAVOUR_WAR_DECLARED_HIT,
  FAVOUR_SPY_CAUGHT_HIT,
  FAVOUR_WAR_DECAY_PER_DAY,
  FAVOUR_HEAL_PER_DAY,
  botFavour,
  botEmbargoes,
};

/** Default solo skirmish: you (p1) vs one AI (p2), at two of the start candidates. */
export const DEFAULT_SETUP: SetupConfig = {
  seats: [
    { id: 'p1', name: 'Azure Compact', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
    { id: 'p2', name: 'Crimson Hegemony', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
  ],
};

export type NetworkMatchMode = 'ffa' | '2v2' | '5v5';

const NETWORK_HOUSES = [
  { name: 'Azure Compact', faction: 'azure' },
  { name: 'Crimson Hegemony', faction: 'crimson' },
  { name: 'Amber Concord', faction: 'amber' },
  { name: 'Violet Ascendancy', faction: 'violet' },
] as const;

export function parseNetworkMatchMode(value: string | undefined): NetworkMatchMode {
  if (value === undefined) return 'ffa';
  if (value === '2v2' || value === '5v5') return value;
  throw new Error(`TEAMS must be 2v2 or 5v5, got: ${value}`);
}

/** Claimable human chairs for the prototype host. Empty chairs are driven by server AI. */
export function networkSeats(mode: NetworkMatchMode = 'ffa'): SeatConfig[] {
  const startIndexes = mode === '2v2' ? [9, 8, 3, 4] : START_CANDIDATES.map((_, i) => i);
  return startIndexes.map((startIndex, i) => {
    const house = NETWORK_HOUSES[i % NETWORK_HOUSES.length]!;
    const cycle = Math.floor(i / NETWORK_HOUSES.length) + 1;
    const suffix = cycle === 1 ? '' : cycle === 2 ? ' II' : ' III';
    return {
      id: `p${i + 1}`,
      name: `${house.name}${suffix}`,
      faction: house.faction,
      start: START_CANDIDATES[startIndex]!,
      ai: false,
      ...(mode === '2v2' ? { team: i < 2 ? 'A' : 'B' } : {}),
      ...(mode === '5v5' ? { team: i < 5 ? 'A' : 'B' } : {}),
    };
  });
}

export function newGame(setup: SetupConfig = DEFAULT_SETUP): GameState {
  const base = createInitialState({
    seed: setup.seed ?? 'prototype-1',
    version: { data: '0.1.0', manifest: '1' },
  });
  // Every province starts NEUTRAL; the chosen seats below claim + fortify their homeworld.
  const planets: Record<string, Planet> = {};
  for (const n of MAP) {
    planets[n.id] = {
      id: n.id,
      owner: null,
      position: { x: n.x, y: n.y },
      links: n.links,
      terrain: SECTOR_TYPES[n.sector]?.core ?? 'empty_space',
      kind: n.sector, // planet / asteroid / nebula / … — drives capturable (sectorKinds)
      // relative territory weight — planets are the small sectors, fields/clouds bigger
      size: n.sector === 'nebula' ? 1.5 : n.sector === 'asteroid' ? 1.3 : 1,
      planetType: n.type,
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
    };
  }
  const players: Record<string, Player> = {};
  const fleets: Record<string, Fleet> = {};
  const heroes: Record<string, Hero> = {};
  for (const seat of setup.seats) {
    const home = planets[seat.start];
    if (!home) continue;
    home.owner = seat.id;
    home.buildings = [
      { type: 'mine', level: 1, hp: hpOfLevel('mine', 1) },
      { type: 'radar', level: 1, hp: hpOfLevel('radar', 1) },
      // Anti-ship defence is a building now: an orbital-AA emplacement over the homeworld.
      { type: 'orbital_aa', level: 1, hp: hpOfLevel('orbital_aa', 1) },
      // A starting yard — space-domain hulls need a standing shipyard/spaceport to
      // build at all (enablesShipConstruction); without one, turn-1 fleet-building
      // would be impossible.
      { type: 'spaceport', level: 1, hp: hpOfLevel('spaceport', 1) },
    ];
    // Ground defence is what holds a world against capture (an AA battery bleeds a fleet
    // but can't stop a landing — only ground troops do). Seed a starting infantry garrison
    // so the homeworld isn't a free walk-in; mobile ground beyond it comes via divisions.
    home.garrison = [
      { unit: 'militia', count: 2 },
      { unit: 'heavy_infantry', count: 1 },
    ];
    players[seat.id] = player(
      seat.id,
      seat.name,
      seat.faction,
      { credits: 260, metal: 320, food: 120, energy: 90, microelectronics: 40 },
      seat.ai,
    );
    // Human seats get the research-leader council chosen at setup (before the start-point
    // pick — a start consecration). Default to the command leader «Куратор» so the Steward
    // line stays reachable when unset; the has_scientist + day-15 gates still apply.
    if (!seat.ai) {
      const ids = setup.scientists?.length ? setup.scientists.slice(0, 2) : ['overseer'];
      // Meta-progression raises the whole council's level (snapshot at match start).
      const lvl = 1 + Math.max(0, setup.meta?.scientistLevel ?? 0);
      players[seat.id]!.scientists = ids.map((id) => ({ id, level: lvl }));
      // …opens the treasury fatter…
      const mult = 1 + Math.max(0, setup.meta?.resourceMult ?? 0);
      if (mult > 1) {
        const bag = players[seat.id]!.resources;
        for (const r of Object.keys(bag)) bag[r] = Math.round((bag[r] ?? 0) * mult);
      }
      // …and lands the unlocked hidden techs as completed (bonuses ride the normal
      // technology hooks from the first second — the C3 pre-match seam, reused).
      const grant = (setup.meta?.tech ?? []).filter((id) => data.technologies[id]);
      if (grant.length) players[seat.id]!.technologies = { completed: [...new Set(grant)] };
    }
    fleets[`${seat.id}-1`] = fleet(
      `${seat.id}-1`,
      seat.id,
      seat.start,
      [
        ['hero', 1], // the commander's projection — flagship of the home fleet
        ['cruiser', 2],
        ['scout', 1],
      ],
      [], // no marine landing troops — mobile ground is via the division system now
    );
    // The roster rides in as CORE hero instances (the HERO-9 model): each menu hero
    // maps onto its archetype (grade → archetype flavour, 1:1 by design). The MAIN one
    // deploys as flagship of the home fleet (named by the commander's nick); the rest
    // seed UNDEPLOYED, mirroring `buildFromMap` — `hero.spawn` raises their ships
    // in-match (active cap 3). All respawn at the capital (`home`, re-designatable).
    const roster = !seat.ai && setup.heroes ? setup.heroes : DEFAULT_HEROES;
    const mainIdx = Math.max(
      0,
      roster.findIndex((x) => x.grade === 'main'),
    );
    roster.forEach((loadout, i) => {
      const archetype = ARCHETYPE_OF_GRADE[loadout.grade] ?? 'commander';
      const def = data.heroes[archetype];
      // Ability loadout = the menu picks (catalog-known ids) + the archetype's
      // spawn-marker perks (not menu-pickable — they ride with the archetype).
      const picks = loadout.abilities.filter(
        (id): id is string => !!id && !!data.heroAbilities[id],
      );
      const markers = (def?.startAbilities ?? []).filter((id) =>
        data.heroAbilities[id]?.type.startsWith('spawn_'),
      );
      const main = i === mainIdx;
      const heroId = `hero:${seat.id}:${i + 1}`;
      heroes[heroId] = {
        id: heroId,
        owner: seat.id,
        name: main ? seat.name : loadout.name,
        location: seat.start,
        cooldowns: {},
        grade: loadout.grade,
        archetype,
        abilities: [...new Set([...picks, ...markers])],
        passives: [...(def?.startPassives ?? [])],
        home: seat.start,
        ...(main ? { alive: true, fleetId: `${seat.id}-1` } : {}),
      };
    });
  }
  // Free-for-all seeds every pair at PEACE (not the core's war default): no marching
  // through another commander's space and no combat until war is declared. A TEAM
  // battle instead seeds by side — same team ALLIED (win together, no friendly fire),
  // across teams at WAR (fight from the first hour). A team alliance is seeded state,
  // so it bypasses the `E_BOT_ALLIANCE` declare-gate — an AI teammate is a real ally
  // (the SES-1 victory clique reads the stance, so the coalition forms).
  const teamed = setup.seats.some((seat) => seat.team !== undefined);
  const teamOf = new Map(setup.seats.map((seat) => [seat.id, seat.team]));
  const diplomacy: Record<string, DiplomaticStance> = {};
  const ids = setup.seats.map((seat) => seat.id);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const ta = teamOf.get(ids[i]!);
      const tb = teamOf.get(ids[j]!);
      const stance: DiplomaticStance = !teamed
        ? 'peace'
        : ta !== undefined && ta === tb
          ? 'alliance'
          : 'war';
      diplomacy[pairKey(ids[i]!, ids[j]!)] = stance;
    }
  // Bots track a favour meter toward every other seat (seeded neutral-friendly). Only a
  // player's aggression lowers it; a bot never wars for expansion (see botDiplomacyModule).
  const approval: Record<string, Record<string, number>> = {};
  for (const seat of setup.seats) {
    if (!seat.ai) continue;
    approval[seat.id] = {};
    for (const other of ids) if (other !== seat.id) approval[seat.id]![other] = FAVOUR_BASE;
  }
  // The player's locked division templates ride into the match; the AI uses the defaults.
  const templates: Record<string, FormationTemplate[]> = {};
  const heroRoster: Record<string, HeroLoadout[]> = {};
  const shipLoadouts: Record<string, ShipLoadout[]> = {};
  const capital: Record<string, string> = {};
  for (const seat of setup.seats) {
    templates[seat.id] = !seat.ai && setup.templates ? setup.templates : DEFAULT_TEMPLATES;
    heroRoster[seat.id] = !seat.ai && setup.heroes ? setup.heroes : DEFAULT_HEROES;
    shipLoadouts[seat.id] = !seat.ai && setup.ships ? setup.ships : DEFAULT_SHIP_LOADOUTS;
    capital[seat.id] = seat.start; // capital defaults to the homeworld; re-designatable in-match
  }
  // `divisions` / `divisionSeq` / `templates` / `groundBattles` / `heroRoster` are
  // prototype-only state (preserved by deepClone); cast past GameState's shape.
  return {
    ...base,
    players,
    planets,
    fleets,
    heroes,
    diplomacy,
    approval,
    sessionMarket: [],
    sessionMarketSeq: 0,
    divisions: {},
    divisionSeq: 0,
    templates,
    groundBattles: {},
    heroRoster,
    shipLoadouts,
    capital,
  } as GameState;
}

/** ECON-6: почасовой экономический срез для пайплайна наблюдений хоста — казна /
 *  чистый приток / arrears per player на мировом времени `state.time`. Чистая
 *  функция состояния: кривые пишет JSONL хоста, headline-счётчики — агрегатор. */
export function economySnapshot(state: GameState): {
  kind: 'economy';
  atTime: number;
  players: Record<
    string,
    { resources: Record<string, number>; netPerHour: Record<string, number>; arrears: string[] }
  >;
} {
  const players: Record<
    string,
    { resources: Record<string, number>; netPerHour: Record<string, number>; arrears: string[] }
  > = {};
  for (const [pid, pl] of Object.entries(state.players)) {
    players[pid] = {
      resources: { ...pl.resources },
      netPerHour: netIncome(state, pid),
      arrears: [...(pl.arrears ?? [])],
    };
  }
  return { kind: 'economy', atTime: state.time, players };
}

/** Net per-hour income for a player: production from owned, un-bombarded worlds
 *  (brownout-dimmed like the core) minus unit/garrison AND building upkeep
 *  (daily ÷ 24). Drives the HUD's `+/h` deltas. */
export function netIncome(state: GameState, playerId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const arrears = state.players[playerId]?.arrears ?? [];
  const inhabited = inhabitedWorldCount(state, playerId); // for the diminishing civic tax
  // BF-35: mirror the faction + tech `economy.production` hooks (factionModule /
  // technologyModule) — the HUD `+/h` used to apply only the planetType bonus, so a
  // production-boosted player (e.g. a +12% faction) saw a low readout from minute one.
  const me = state.players[playerId];
  const factionBonus = me?.faction
    ? (data.factions[me.faction]?.passives?.productionBonus ?? 0)
    : 0;
  let techBonus = 0;
  for (const id of me?.technologies?.completed ?? [])
    techBonus += data.technologies[id]?.effects?.productionBonus ?? 0;
  const bonusMult = (1 + factionBonus) * (1 + techBonus);
  for (const p of Object.values(state.planets)) {
    if (p.owner !== playerId || isBombarded(state, p.id)) continue;
    const mult =
      (1 + (p.planetType ? (data.planetTypes[p.planetType]?.productionBonus ?? 0) : 0)) * bonusMult;
    // Credits are settled per-planet so the civic tax + Tax Office boost mirror the
    // core's economy.production pipeline (taxModule); metal accrues straight to `out`.
    let credits = 0;
    // ECON-7: passive per-type base output, mirrored from the core's planetTypeModule
    // (scaled by the world's richness incl. productionByResource; base credits routed
    // through the tax accumulator so a Tax Office boosts them too).
    const ptDef = p.planetType ? data.planetTypes[p.planetType] : undefined;
    const ptByRes = ptDef?.productionByResource ?? {};
    for (const res of Object.keys(ptDef?.baseOutput ?? {})) {
      const v = (ptDef!.baseOutput[res] ?? 0) * mult * (1 + (ptByRes[res] ?? 0));
      if (res === 'credits') credits += v;
      else out[res] = (out[res] ?? 0) + v;
    }
    for (const b of p.buildings) {
      const def = data.buildings[b.type];
      if (!def) continue;
      const level = buildingLevel(def, b.level);
      // Mirror the core's brownout: a building starved of an arrears resource shows
      // its dimmed output, so the top-bar flow matches what actually accrues.
      const starved =
        arrears.length > 0 &&
        Object.keys(level.upkeep).some((r) => (level.upkeep[r] ?? 0) > 0 && arrears.includes(r));
      const bMult = mult * (starved ? BROWNOUT : 1);
      for (const res of Object.keys(level.produces)) {
        const v = (level.produces[res] ?? 0) * bMult;
        if (res === 'credits') credits += v;
        else out[res] = (out[res] ?? 0) + v;
      }
      // …and its running cost (daily → hourly), same drain the settlement applies.
      for (const res of Object.keys(level.upkeep))
        out[res] = (out[res] ?? 0) - (level.upkeep[res] ?? 0) / 24;
    }
    // Constructions in progress (≥50% built) chip in a partial/delta share too —
    // mirrors economy.ts's `pendingProduction` ramp rule. Point-evaluated (not
    // integrated) since this is a live HUD rate, not an accrual over a span; no
    // upkeep is charged on an unfinished building either, so no brownout applies here.
    for (const event of state.scheduled) {
      if (event.type !== 'construction.complete') continue;
      const cp = event.payload as {
        kind?: 'building' | 'unit' | 'upgrade';
        planetId?: string;
        building?: string;
        level?: number;
      };
      if (cp.planetId !== p.id) continue;
      if (cp.kind === 'building' && typeof cp.building === 'string') {
        const def = data.buildings[cp.building];
        if (!def) continue;
        const level1 = buildingLevel(def, 1);
        const ramp = thresholdRamp(
          buildProgress(state.time, event.at, level1.buildTimeHours * HOUR),
        );
        if (ramp <= 0) continue;
        for (const res of Object.keys(level1.produces)) {
          const v = (level1.produces[res] ?? 0) * ramp * mult;
          if (res === 'credits') credits += v;
          else out[res] = (out[res] ?? 0) + v;
        }
      } else if (
        cp.kind === 'upgrade' &&
        typeof cp.building === 'string' &&
        typeof cp.level === 'number'
      ) {
        const def = data.buildings[cp.building];
        const instance = p.buildings.find((b) => b.type === cp.building);
        if (!def || !instance) continue;
        const current = buildingLevel(def, instance.level);
        const target = buildingLevel(def, cp.level);
        const ramp = thresholdRamp(
          buildProgress(state.time, event.at, target.buildTimeHours * HOUR),
        );
        if (ramp <= 0) continue;
        const resources = new Set([
          ...Object.keys(current.produces),
          ...Object.keys(target.produces),
        ]);
        for (const res of resources) {
          const delta = ((target.produces[res] ?? 0) - (current.produces[res] ?? 0)) * ramp * mult;
          if (delta === 0) continue;
          if (res === 'credits') credits += delta;
          else out[res] = (out[res] ?? 0) + delta;
        }
      }
    }
    // A PAUSED site keeps its frozen share too — pausing halts further construction,
    // not the share of the building already standing (mirrors economy.ts's
    // `pausedProduction`: same threshold rule, held flat at `site.progress`).
    for (const site of p.pausedConstruction ?? []) {
      const ramp = thresholdRamp(site.progress);
      if (ramp <= 0) continue;
      if (site.kind === 'building' && typeof site.building === 'string') {
        const def = data.buildings[site.building];
        if (!def) continue;
        const level1 = buildingLevel(def, 1);
        for (const res of Object.keys(level1.produces)) {
          const v = (level1.produces[res] ?? 0) * ramp * mult;
          if (res === 'credits') credits += v;
          else out[res] = (out[res] ?? 0) + v;
        }
      } else if (
        site.kind === 'upgrade' &&
        typeof site.building === 'string' &&
        typeof site.level === 'number'
      ) {
        const def = data.buildings[site.building];
        const instance = p.buildings.find((b) => b.type === site.building);
        if (!def || !instance) continue;
        const current = buildingLevel(def, instance.level);
        const target = buildingLevel(def, site.level);
        const resources = new Set([
          ...Object.keys(current.produces),
          ...Object.keys(target.produces),
        ]);
        for (const res of resources) {
          const delta = ((target.produces[res] ?? 0) - (current.produces[res] ?? 0)) * ramp * mult;
          if (delta === 0) continue;
          if (res === 'credits') credits += delta;
          else out[res] = (out[res] ?? 0) + delta;
        }
      }
    }
    if (isInhabited(p)) {
      credits += civicTax(inhabited) * bonusMult; // civic tax is post-tax income → also boosted (BF-35)
      if (p.buildings.some((b) => b.type === 'tax_office')) credits *= 1 + TAX_OFFICE_BONUS;
    }
    if (credits !== 0) out.credits = (out.credits ?? 0) + credits;
  }
  const addUpkeep = (stacks: Array<{ unit: string; count: number }>) => {
    for (const st of stacks) {
      const def = data.units[st.unit];
      if (!def) continue;
      for (const res of Object.keys(def.upkeep))
        out[res] = (out[res] ?? 0) - ((def.upkeep[res] ?? 0) * st.count) / 24;
    }
  };
  for (const f of Object.values(state.fleets))
    if (f.owner === playerId) {
      addUpkeep(f.units);
      if (f.landing) addUpkeep(f.landing);
    }
  for (const p of Object.values(state.planets)) if (p.owner === playerId) addUpkeep(p.garrison);
  return out;
}

/** Max HP of a building level (mirrors the core's per-level data). */
export function hpOfLevel(type: string, level: number): number {
  const def = data.buildings[type];
  if (!def) return 0;
  if (level <= 1) return def.hp;
  return def.upgrades[level - 2]?.hp ?? def.hp;
}

// --- diplomacy ---------------------------------------------------------------
// D4: the prototype now runs the CORE `diplomacyModule` (imported above) — one
// implementation of `diplomacy.declare` for the whole repo (D2 escalation, D3
// consent offers, E_BOT_ALLIANCE, offer sweep on `player.eliminated`, plus the
// `diplomacy` capability combat consults). Stances still live in `state.diplomacy`
// (D1) and newGame seeds `peace`, so nothing changes at the table. Code deltas vs
// the retired prototype module: same-stance → `E_SAME_STANCE` (was `E_ALREADY`),
// malformed target → `E_BAD_PAYLOAD` (was `E_BAD_TARGET`), and `stance` is required
// (the `declareWar` builder still defaults it to 'war').

// REFP-11: bot diplomacy module moved to `botDiplomacy.ts` — depends on botFavour
// (REFP-6) + core diplomacy helpers. Imported here for MODULES.
import { botDiplomacyModule } from './botDiplomacy';

// REFP-12: session market (MARKET_*, MarketLot/marketLots, marketModule) moved to
// `sessionMarket.ts` — depends on canAfford/payCost + botEmbargoes. Imported for MODULES
// and re-exported for main.ts / tests.
import {
  MARKET_GOODS,
  MARKET_FEE,
  marketLots,
  marketModule,
  type MarketSide,
  type MarketLot,
} from './sessionMarket';
export { MARKET_GOODS, MARKET_FEE, marketLots, type MarketSide, type MarketLot };

// --- ground divisions: mobilisation + daily restoration ----------------------
// A division is a cohesive ground formation built from a LOCKED template. It lives in
// `state.divisions` (a prototype-only field, preserved through deepClone), garrisons a
// world, and passively heals there. Combat (resolveGround) + transport land next.

/** A mobilised division in play. */
export interface Division {
  id: string;
  owner: string;
  name: string;
  template: number;
  /** Template counts per type — the regrow target (units rebuild toward this). */
  max: Partial<Record<FormationUnit, number>>;
  units: GroundStack[];
  /** Optional attached officer (OFFICERS key) — its bonuses apply in battle / toughness. */
  officer?: string;
  /** Planet id it garrisons (the world it sits on when not aboard a fleet). */
  location: string;
  /** Fleet id carrying it as cargo, or null/absent when garrisoning `location`.
   *  A carried division is "in the hold": it rides the fleet and does not fight. */
  carriedBy?: string | null;
}

/** Prototype state extended with the division registry, per-player locked templates,
 *  and the live ground-battle clock (planetId → unticked combat-time remainder, ms).
 *  These are non-`GameState` fields, but deepClone preserves them (own-key copy). */
type DivState = GameState & {
  divisions?: Record<string, Division>;
  divisionSeq?: number;
  /** Monotonic fleet-id counter (BF-25) — never recycles a freed number. */
  fleetSeq?: number;
  /** Sortie state of wings whose patrol is currently OFF (BF-26): fuel/rearm
   *  survive the scramble toggle, so OFF→ON never refuels a dry wing for free. */
  wingSorties?: Record<string, SortieState>;
  templates?: Record<string, FormationTemplate[]>;
  groundBattles?: Record<string, number>;
  heroRoster?: Record<string, HeroLoadout[]>;
  shipLoadouts?: Record<string, ShipLoadout[]>;
  capital?: Record<string, string>;
  /** Bot favour toward each other seat: approval[bot][player] on a 0..100 meter. */
  approval?: Record<string, Record<string, number>>;
  /** Session market: a two-sided order book of open lots (sell/buy) + its id counter. */
  sessionMarket?: MarketLot[];
  sessionMarketSeq?: number;
  /** CC-2 standing order, AUTHORITATIVE (was a client-only Set): fleets that auto-storm
   *  the enemy world they arrive at. Driven server-side (serverAutoAssaultActions). */
  autoAssault?: Record<string, true>;
  /** CC-4 standing patrols, AUTHORITATIVE (was a client-only Map): fleetId → patrol
   *  (center/radius/sortie + the next rearm-round due time). Driven server-side
   *  (serverPatrolActions), so «дежурный вылет» works in NET and offline. */
  patrols?: Record<string, Patrol & { rearmAt?: number }>;
  /** CC-1 order chains, AUTHORITATIVE: fleetId → queued steps the fleet runs one by
   *  one whenever it is free (Задержка = wait, Точка+ = several move steps, «прийти и
   *  открыть огонь» = move+barrage). The key is `orders` on purpose: `visibleState`
   *  already strips it for other viewers (future intent, like `scheduled`). Driven
   *  server-side (serverChainActions) and by the solo frame loop. */
  orders?: Record<string, FleetChain>;
  /** BOOST-1 форс-марш («Ускорить»): fleets trading hull for speed — ×1.5 to
   *  `fleet.speed` at the cost of 5% max-HP wear per hour IN TRANSIT. One march:
   *  the flag drops on arrival. Stripped for other viewers (visibility.ts). */
  forcedMarch?: Record<string, true>;
};
export function divisionsOf(state: GameState): Record<string, Division> {
  const s = state as DivState;
  return (s.divisions ??= {});
}
/** The live ground-battle accumulator (planetId → combat-time remainder not yet
 *  ticked, ms). A world is in here exactly while a ground battle is underway. */
function groundBattlesOf(state: GameState): Record<string, number> {
  const s = state as DivState;
  return (s.groundBattles ??= {});
}
export function templatesOf(state: GameState, playerId: string): FormationTemplate[] {
  return (state as DivState).templates?.[playerId] ?? DEFAULT_TEMPLATES;
}
/** A player's hero roster (the loadouts composed in the menu), or the defaults. */
export function heroRosterOf(state: GameState, playerId: string): HeroLoadout[] {
  return (state as DivState).heroRoster?.[playerId] ?? DEFAULT_HEROES;
}

/** Base passive restoration: +1 HP per unit per day on a friendly planet (hospitals /
 *  hero / officer bonuses raise it — later). */
export const REGEN_PER_UNIT_PER_DAY = 1;

/** Per-unit max HP for a division's type, including any attached officer's toughness. */
function unitMaxHp(div: Division, type: FormationUnit): number {
  const base = GROUND_ROSTER[type]?.hp ?? 1;
  const bonus = div.officer ? (OFFICERS[div.officer]?.hp ?? 0) : 0;
  return base * (1 + bonus);
}

/** Heal + regrow a division toward its template `max` over `days` (per type, capped at
 *  full strength). A fully-dead TYPE regrows; the division as a whole is removed only
 *  when wiped in battle (handled there) — regen never resurrects a 0-unit division. */
export function regenDivision(div: Division, days: number): void {
  if (days <= 0) return;
  const byType: Record<string, GroundStack> = {};
  for (const s of div.units) byType[s.type] = s;
  const next: GroundStack[] = [];
  for (const type of Object.keys(div.max) as FormationUnit[]) {
    const maxCount = div.max[type] ?? 0;
    if (maxCount <= 0) continue;
    const hpEach = unitMaxHp(div, type);
    const maxHp = maxCount * hpEach;
    const cur = byType[type]?.hp ?? 0;
    const healed = Math.min(maxHp, cur + REGEN_PER_UNIT_PER_DAY * maxCount * days);
    const count = healed <= 0 ? 0 : Math.ceil(healed / hpEach);
    if (count > 0) next.push({ type, count, hp: healed, hpEach });
  }
  div.units = next;
}

// --- ground transport: divisions ride a fleet by cargo capacity --------------
// "По грузоподъёмности": a division's transport footprint is the summed `cargoSize`
// of its template, and a fleet carries as many divisions as fit in its ships' summed
// `cargoCapacity`. A carried division is "in the hold" — it rides the fleet and does
// not garrison or fight until unloaded onto a world.

/** A division's transport footprint = Σ template-unit `cargoSize` (stable across
 *  casualties — the hold is reserved for the whole formation). */
export function divisionCargo(div: Division): number {
  let total = 0;
  for (const type of Object.keys(div.max) as FormationUnit[]) {
    total += (div.max[type] ?? 0) * (data.units[type]?.stats.cargoSize ?? 0);
  }
  return total;
}

/** Hold left on a fleet = Σ ship `cargoCapacity` − Σ carried divisions' footprint
 *  − the legacy `landing` army aboard (both share the same hold, billed by cargoSize). */
export function fleetCargoFree(state: GameState, fleet: Fleet): number {
  const cap = sumUnitStat(fleet.units, data, 'cargoCapacity');
  const landingUsed = sumUnitStat(fleet.landing ?? [], data, 'cargoSize');
  let divUsed = 0;
  for (const d of Object.values(divisionsOf(state))) {
    if (d.carriedBy === fleet.id) divUsed += divisionCargo(d);
  }
  return cap - landingUsed - divUsed;
}

// --- ground battle: co-located hostile divisions trade matrix damage ---------
// "Потиково во времени": each owner's divisions on a contested world merge into one
// fighting side (so combat width 12 spans the whole force), the two sides trade
// `damageBuckets` each tick, casualties spread back per division by HP share, a wiped
// division is removed, and the attacker that clears the defenders CAPTURES the world.
// Resolved in discrete ticks as the clock advances — driven by `time.advanced` with a
// per-world remainder, so the tick sequence is the same however finely time is stepped.
// (Near/mid/far lines are a FLEET concept; ground routes damage by the type matrix.)

/** Hours of real time per ground combat tick (a ground assault plays out over hours). */
export const GROUND_TICK_HOURS = 3;
const GROUND_TICK_MS = GROUND_TICK_HOURS * HOUR;
/** Fail-secure cap on ticks resolved in one span (real battles end far sooner). */
const MAX_GROUND_TICKS_PER_SPAN = 1000;

const atWar = (state: GameState, a: string, b: string): boolean =>
  a !== b && getStance(state, a, b) === 'war';

/** The garrisoning (not in-transit) divisions at a world that still have units,
 *  lowest id first (deterministic order). */
function divisionsAt(state: GameState, planetId: string): Division[] {
  return Object.values(divisionsOf(state))
    .filter(
      (d) => d.carriedBy == null && d.location === planetId && d.units.some((u) => u.count > 0),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Merge a side's divisions into one stack list (summed counts per type). Only the
 *  per-type COUNT matters to `damageBuckets`; hp/hpEach here are unused placeholders. */
function mergeSide(divs: Division[]): GroundStack[] {
  const byType = {} as Record<FormationUnit, number>;
  for (const d of divs) for (const u of d.units) byType[u.type] = (byType[u.type] ?? 0) + u.count;
  const out: GroundStack[] = [];
  for (const type of Object.keys(byType) as FormationUnit[]) {
    if (byType[type] > 0) out.push({ type, count: byType[type], hp: byType[type], hpEach: 1 });
  }
  return out;
}

/** A merged side's effective officer = count-weighted mean of its divisions'
 *  attack/defence officer bonuses (per-division hp/atkVs are omitted in the merge). */
function mergeOfficer(divs: Division[]): Officer | undefined {
  let total = 0;
  let atk = 0;
  let def = 0;
  for (const d of divs) {
    const c = d.units.reduce((n, u) => n + u.count, 0);
    if (c <= 0) continue;
    total += c;
    const o = d.officer ? OFFICERS[d.officer] : undefined;
    if (o) {
      atk += (o.atk ?? 0) * c;
      def += (o.def ?? 0) * c;
    }
  }
  if (total <= 0 || (atk === 0 && def === 0)) return undefined;
  return { name: 'merged', atk: atk / total, def: def / total };
}

/** Spread a per-type damage bucket across a side's divisions, proportional to each
 *  stack's current HP; whole units die as the pool drops (per-division `hpEach`). */
function applyBucketsToDivs(divs: Division[], buckets: DamageTable): void {
  for (const type of Object.keys(buckets) as FormationUnit[]) {
    const dmg = buckets[type] ?? 0;
    if (dmg <= 0) continue;
    const stacks: GroundStack[] = [];
    for (const d of divs)
      for (const u of d.units) if (u.type === type && u.count > 0) stacks.push(u);
    const totalHp = stacks.reduce((n, u) => n + u.hp, 0);
    if (totalHp <= 0) continue;
    for (const u of stacks) {
      u.hp = Math.max(0, u.hp - dmg * (u.hp / totalHp));
      u.count = u.hp <= 0 ? 0 : Math.ceil(u.hp / u.hpEach);
    }
  }
  for (const d of divs) d.units = d.units.filter((u) => u.count > 0);
}

/** Drop fully-wiped divisions (last unit gone) from the registry. Survivors keep
 *  their HP; restoration regrows dead TYPES, never a fully-wiped division. */
function reapWipedDivisions(state: GameState): void {
  const divs = divisionsOf(state);
  for (const id of Object.keys(divs)) {
    if (!divs[id]!.units.some((u) => u.count > 0)) delete divs[id];
  }
}

/** Hand a world to the lowest-id attacker present (a non-`defenderOwner` owner),
 *  unless it isn't capturable or a hostile fleet garrison still holds it. The legacy
 *  ground/emplacement garrison is NOT engaged by division combat yet (a documented seam):
 *  a garrisoned world resists division capture until cleared via the fleet-assault path. */
function captureGround(h: HandlerContext, planetId: string, defenderOwner: string | null): void {
  const planet = h.state.planets[planetId];
  if (!planet || !isCapturable(data, planet)) return;
  if (planet.garrison.some((srv) => srv.count > 0)) return;
  // The taker is the lowest-id owner present that is actually AT WAR with the defender —
  // a co-located ally / non-belligerent must never steal the capture.
  const owners = [
    ...new Set(
      divisionsAt(h.state, planetId)
        .filter(
          (d) =>
            d.owner !== defenderOwner &&
            defenderOwner !== null &&
            atWar(h.state, d.owner, defenderOwner),
        )
        .map((d) => d.owner),
    ),
  ].sort();
  const taker = owners[0];
  if (taker === undefined) return;
  const from = planet.owner;
  planet.owner = taker;
  // Emit the SAME event the fleet path uses (`via: 'ground'`), so victory re-evaluates
  // and the UI logs + refreshes — a division-only event had no listener.
  h.emit('planet.captured', { planetId, owner: taker, from, via: 'ground' });
}

/** Whether a world currently hosts a ground battle: its owner's divisions facing a
 *  co-located at-war intruder's. (Undefended/neutral capture is a walk-in, not here.) */
function groundContested(state: GameState, planetId: string): boolean {
  const O = state.planets[planetId]?.owner ?? null;
  if (O === null) return false;
  const divs = divisionsAt(state, planetId);
  return (
    divs.some((d) => d.owner === O) && divs.some((d) => d.owner !== O && atWar(state, d.owner, O))
  );
}

/** Resolve ONE ground tick at a contested world. Returns true if a two-sided fight is
 *  still ongoing afterwards (keep ticking), false once it has resolved. */
function groundTickAt(h: HandlerContext, planetId: string): boolean {
  const O = h.state.planets[planetId]?.owner ?? null;
  if (O === null) return false;
  const divs = divisionsAt(h.state, planetId);
  const defenders = divs.filter((d) => d.owner === O);
  const hostiles = divs.filter((d) => d.owner !== O && atWar(h.state, d.owner, O));
  if (hostiles.length === 0) return false; // no hostiles → no battle
  // One attacker owner at a time: the lowest-id at-war owner engages the defender this
  // tick. Distinct owners are NOT fused into a single side — that would force mutual
  // enemies into an alliance and let them share the combat-width-12 budget. When this
  // attacker captures, the next tick re-evaluates with the NEW owner, so an FFA resolves
  // as a deterministic sequence of pairwise fights (driver re-checks groundContested).
  const foe = [...new Set(hostiles.map((d) => d.owner))].sort()[0]!;
  const attackers = hostiles.filter((d) => d.owner === foe);
  if (defenders.length === 0) {
    captureGround(h, planetId, O); // undefended by division → attacker seizes it
    return false;
  }
  // Both sides present: one simultaneous tick from the pre-tick snapshot.
  const atkOfficer = mergeOfficer(attackers);
  const defOfficer = mergeOfficer(defenders);
  const atkMerged = mergeSide(attackers);
  const defMerged = mergeSide(defenders);
  const toDefender = damageBuckets(GROUND_ROSTER, atkMerged, defMerged, 'atk', atkOfficer);
  const toAttacker = damageBuckets(GROUND_ROSTER, defMerged, atkMerged, 'def', defOfficer);
  applyBucketsToDivs(defenders, toDefender);
  applyBucketsToDivs(attackers, toAttacker);
  reapWipedDivisions(h.state);
  const after = divisionsAt(h.state, planetId);
  const defLeft = after.some((d) => d.owner === O);
  const foeLeft = after.some((d) => d.owner === foe);
  if (!defLeft && foeLeft) {
    captureGround(h, planetId, O); // defenders wiped → attacker captures
    return false;
  }
  return defLeft && foeLeft; // this pairwise fight continues only while both stand
}

/** Drive ground combat over a continuous span: accumulate combat time per world and
 *  resolve one whole tick per GROUND_TICK_MS elapsed. The accumulated time is spent
 *  ACROSS battle transitions — a capture that opens a follow-on fight (new owner faces
 *  the next attacker) keeps ticking within the same span — and only the sub-tick
 *  remainder is carried. So the tick sequence is identical however finely time is
 *  stepped (a single big span === many small spans), which a coarse offline catch-up
 *  and a per-frame live client both depend on (replay / multiplayer determinism). */
function runGroundCombat(h: HandlerContext, elapsed: number): void {
  const battles = groundBattlesOf(h.state);
  // Candidate worlds: any holding a garrisoning division, plus any mid-battle.
  const worlds = new Set<string>(Object.keys(battles));
  for (const d of Object.values(divisionsOf(h.state)))
    if (d.carriedBy == null) worlds.add(d.location);
  for (const planetId of [...worlds].sort()) {
    let acc = (battles[planetId] ?? 0) + elapsed;
    let guard = 0;
    // Tick while there's a whole tick of time AND a live contest; re-check the contest
    // each iteration so a mid-span capture's follow-on fight is resolved here, not
    // discarded (which would diverge from finer stepping).
    while (acc >= GROUND_TICK_MS && guard < MAX_GROUND_TICKS_PER_SPAN) {
      if (!groundContested(h.state, planetId)) break;
      groundTickAt(h, planetId);
      acc -= GROUND_TICK_MS;
      guard += 1;
    }
    // Carry the sub-tick remainder while a contest survives; otherwise the world is
    // settled — drop it (no contest left to spend leftover time on).
    if (groundContested(h.state, planetId)) battles[planetId] = acc % GROUND_TICK_MS;
    else delete battles[planetId];
  }
}

export const divisionModule: GameModule = {
  id: 'division',
  version: '0.1.0',
  setup(api) {
    // Mobilise a division by template on an owned world: pay the summed slot cost, the
    // formation garrisons the world at full strength. (Build time / transport — later.)
    api.onAction('division.mobilize', (action, h) => {
      const p = action.payload as { planetId?: string; template?: number };
      if (typeof p?.planetId !== 'string' || typeof p?.template !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const planet = h.state.planets[p.planetId];
      if (!planet) return h.reject('E_NO_PLANET');
      if (planet.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      const fromOfficer = (action.payload as { officer?: unknown }).officer === true;
      const tpl = fromOfficer
        ? OFFICER_TEMPLATES[p.template]
        : templatesOf(h.state, action.playerId)[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      const stats = formationStats(tpl);
      if (stats.count <= 0) return h.reject('E_EMPTY_TEMPLATE');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      if (!canAfford(player.resources, stats.cost)) return h.reject('E_NO_FUNDS');
      payCost(player.resources, stats.cost);
      const divs = divisionsOf(h.state);
      const ds = h.state as DivState;
      const seq = (ds.divisionSeq ?? 0) + 1;
      ds.divisionSeq = seq;
      const id = `div:${action.playerId}:${seq}`;
      // Именной шаблон приходит со своим офицером — «готовый шаблон, менять нельзя».
      // Its HP bonus is baked into hpEach at birth, so the division is born AT its
      // regen-max (unitMaxHp reads the same officer), not below it.
      const officer = fromOfficer ? (tpl as OfficerTemplate).officer : undefined;
      divs[id] = {
        id,
        owner: action.playerId,
        name: tpl.name,
        template: p.template,
        max: { ...stats.byType },
        units: makeSide(GROUND_ROSTER, stats.byType, officer ? OFFICERS[officer] : undefined),
        location: p.planetId,
        ...(officer ? { officer } : {}),
      };
      h.emit('division.mobilized', {
        id,
        owner: action.playerId,
        planetId: p.planetId,
        template: p.template,
      });
    });

    // Assemble a division template in-match — set slot `slot` of the player's template
    // `template` to a formation unit (or null). Templates are no longer frozen at setup:
    // "сбор шаблона из разных юнитов" happens at mobilisation. Materialises the player's
    // templates from the defaults on first edit (per-player, deep-copied, JSON-safe).
    api.onAction('division.template', (action, h) => {
      const p = action.payload as { template?: number; slot?: number; unit?: string | null };
      if (typeof p?.template !== 'number' || typeof p?.slot !== 'number')
        return h.reject('E_BAD_PAYLOAD');
      if (p.slot < 0 || p.slot >= FORMATION_SLOTS) return h.reject('E_BAD_PAYLOAD');
      const unit = p.unit ?? null;
      if (unit !== null && !(FORMATION_UNITS as readonly string[]).includes(unit)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const ds = h.state as DivState;
      const all = (ds.templates ??= {});
      const mine = (all[action.playerId] ??= DEFAULT_TEMPLATES.map((t) => ({
        name: t.name,
        slots: [...t.slots],
      })));
      const tpl = mine[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      tpl.slots[p.slot] = unit as FormationUnit | null;
      h.emit('division.retemplated', { template: p.template, slot: p.slot, unit });
    });

    // Rename a CUSTOM template (Stellaris-style designer). Officer premades are not
    // player templates, so they are unreachable here — their name is locked by data.
    api.onAction('division.rename', (action, h) => {
      const p = action.payload as { template?: number; name?: unknown };
      if (typeof p?.template !== 'number' || typeof p?.name !== 'string')
        return h.reject('E_BAD_PAYLOAD');
      const name = p.name.trim().slice(0, 24);
      if (!name) return h.reject('E_BAD_PAYLOAD');
      const ds = h.state as DivState;
      const all = (ds.templates ??= {});
      const mine = (all[action.playerId] ??= DEFAULT_TEMPLATES.map((t) => ({
        name: t.name,
        slots: [...t.slots],
      })));
      const tpl = mine[p.template];
      if (!tpl) return h.reject('E_NO_TEMPLATE');
      tpl.name = name;
    });

    /** Own-key division lookup owned by `playerId` (rejects a poisoned id / a foreign
     *  or missing division — fail-secure, mirroring the artillery `ownFleet` guard). */
    const ownDivision = (h: HandlerContext, id: unknown, playerId: string): Division => {
      if (
        typeof id !== 'string' ||
        !Object.prototype.hasOwnProperty.call(divisionsOf(h.state), id)
      ) {
        h.reject('E_NO_DIVISION');
      }
      const div = divisionsOf(h.state)[id as string]!;
      if (div.owner !== playerId) h.reject('E_FORBIDDEN');
      return div;
    };

    // Load a garrisoning division into a co-located, idle fleet — bounded by the
    // fleet's free hold ("по грузоподъёмности"). A carried division rides the fleet.
    api.onAction('division.load', (action, h) => {
      const p = action.payload as { divisionId?: string; fleetId?: string };
      if (typeof p?.fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const div = ownDivision(h, p.divisionId, action.playerId);
      if (div.carriedBy != null) return h.reject('E_ALREADY_LOADED');
      const fleet = requireOwnedIdleFleet(h, p.fleetId, action.playerId); // docked, not in battle
      if (fleet.location !== div.location) return h.reject('E_NOT_COLOCATED');
      if (divisionCargo(div) > fleetCargoFree(h.state, fleet)) return h.reject('E_NO_CARGO');
      div.carriedBy = fleet.id;
      h.emit('division.loaded', {
        id: div.id,
        fleetId: fleet.id,
        owner: action.playerId,
        at: div.location,
      });
    });

    // Unload a carried division onto the world its carrier is docked over. An
    // undefended, capturable hostile/neutral world is seized on the spot (walk-in
    // capture), mirroring fleet capture-on-arrival; otherwise the world's ground
    // battle (if any) is resolved by the continuous-time driver below.
    api.onAction('division.unload', (action, h) => {
      const div = ownDivision(
        h,
        (action.payload as { divisionId?: string })?.divisionId,
        action.playerId,
      );
      if (div.carriedBy == null) return h.reject('E_NOT_LOADED');
      const fleet = requireOwnedIdleFleet(h, div.carriedBy, action.playerId); // docked at a node
      const target = fleet.location;
      div.carriedBy = null;
      div.location = target;
      const planet = h.state.planets[target];
      if (
        planet &&
        planet.owner !== div.owner &&
        isCapturable(data, planet) &&
        (planet.owner === null || atWar(h.state, div.owner, planet.owner)) &&
        !planet.garrison.some((srv) => srv.count > 0) &&
        !divisionsAt(h.state, target).some((d) => d.owner !== div.owner)
      ) {
        const from = planet.owner;
        planet.owner = div.owner;
        // Same event the fleet capture path uses (`via: 'ground'`) → victory + UI react.
        h.emit('planet.captured', { planetId: target, owner: div.owner, from, via: 'ground' });
      }
      h.emit('division.unloaded', {
        id: div.id,
        fleetId: fleet.id,
        owner: action.playerId,
        at: target,
      });
    });

    // NOTE: there is deliberately NO runtime officer attach/detach action. Officers
    // arrive ONLY with their locked premade (`division.mobilize {officer: true}`) —
    // a raw `division.officer` action used to attach any officer to any division for
    // free, bypassing the premade lock (bughunt BF-19).

    // Per-span ground upkeep: lose divisions with their destroyed carrier, resolve
    // tick-based ground battles, then restore survivors on friendly soil.
    api.on('time.advanced', (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const span = to - from;
      if (span <= 0) return;
      const elapsed = span * timeScaleOf(h.ctx); // clamps a missing/non-positive scale to 1, like every sibling module
      // A division aboard a destroyed carrier is lost with the ship.
      const divs = divisionsOf(h.state);
      for (const id of Object.keys(divs)) {
        const d = divs[id]!;
        if (
          d.carriedBy != null &&
          !Object.prototype.hasOwnProperty.call(h.state.fleets, d.carriedBy)
        ) {
          h.emit('division.lost', { id, owner: d.owner });
          delete divs[id];
        }
      }
      // Tick-based ground combat on contested worlds (real time → discrete ticks).
      runGroundCombat(h, elapsed);
      // Daily restoration: +1 HP/unit/day for a garrisoning division on a friendly
      // planet (not in transit; a wiped division is gone, never resurrected).
      const days = elapsed / DAY;
      if (days <= 0) return;
      for (const div of Object.values(divisionsOf(h.state))) {
        if (div.carriedBy != null) continue; // in transit / in a hold — no restoration
        const planet = h.state.planets[div.location];
        if (!planet || planet.owner !== div.owner) continue; // own planet only
        // No field repair under fire: regen while a ground battle rages would also
        // make the outcome depend on how finely the span is stepped (BF-22).
        if (groundContested(h.state, div.location)) continue;
        if (!div.units.some((s) => s.count > 0)) continue; // wiped → gone, never resurrected
        regenDivision(div, days);
      }
    });
  },
};

// REFP-14: capital module (capitalsOf/capitalOf/capitalModule) moved to `capital.ts` —
// depends on isInhabited (REFP-4) + the prototype's capital state extension.
import { capitalsOf, capitalOf, capitalModule } from './capital';
export { capitalOf };

// REFP-15: standing orders module (CC-2/CC-4 + chain/patrol stamps) moved to
// `standingOrders.ts`. Imported here for MODULES.
import { standingOrdersModule } from './standingOrders';
export { standingOrdersModule };

// REFP-16: forced march module (FORCED_MARCH_* + forcedMarchModule) moved to
// `forcedMarch.ts`. Imported here for MODULES and re-exported.
import { FORCED_MARCH_MULT, FORCED_MARCH_WEAR, forcedMarchModule } from './forcedMarch';
export { FORCED_MARCH_MULT, FORCED_MARCH_WEAR, forcedMarchModule };

// REFP-17/18: instant repair + econ screws (express dock repair) moved to their
// own files. Imported here for MODULES and re-exported for main.ts / tests.
import {
  INSTANT_REPAIR_CREDITS_PER_HP,
  missingHull,
  instantRepairCost,
  instantRepairModule,
} from './instantRepair';
import {
  REPAIR_HP_PER_METAL,
  dockRepairCost,
  fleetAtOwnDock,
  econScrewsModule,
} from './econScrews';
export {
  INSTANT_REPAIR_CREDITS_PER_HP,
  missingHull,
  instantRepairCost,
  instantRepairModule,
  REPAIR_HP_PER_METAL,
  dockRepairCost,
  fleetAtOwnDock,
  econScrewsModule,
};

export const MODULES: GameModule[] = [
  sectorModule,
  planetTypeModule,
  taxModule, // civic tax on inhabited worlds (hooks economy.production, after planetType)
  factionModule, // H3: чисто пассивные бонусы дома (production / fleet.speed / combat.damage)
  hungerModule, // ECON-1: food в arrears → наземный урон ×0.75 (корабли едят кредиты)
  economyModule,
  movementModule,
  heroModule, // projection hero: fleet combat aura (+5%) + death/respawn
  heroEffectsModule, // first hero.effect.<type> capability provider: recall (warp ship home)
  // The combat family (split along the bus seams). Order matters (invariant #6):
  // orbital stamps orbit on fleet.arrived BEFORE combat engages, and runs its
  // AA/bombard span BEFORE artillery's standoff span — the old internal sequence.
  orbitalModule, // the single near-orbit: stationing, AA fire, bombardment
  combatModule, // melee battles: engage / tick / assault / retreat / capture
  artilleryModule, // standoff fire accrual + barrage orders
  interceptModule, // schedules lane-crossing meetings (resolved by combat)
  captureOnArrivalModule, // walk-in capture now a kernel rule (was client-side seizeSector)
  constructionModule,
  arsenalSyncModule, // LARS-1: server-driver refresh of live build-catalog ownership (bypasses gate)
  technologyModule, // session research: branch/day-gated techs → effect bonuses + content unlocks
  stewardModule, // «Хранитель»: delegate the seat to the AI while you sleep (gated by the Steward tech)
  armyModule,
  victoryModule, // terminal match state from authoritative state (domination / elimination / score / timeout)
  fleetLaunchModule,
  diplomacyModule, // CORE D2+D3 (D4): escalation/consent offers; combat reads state.diplomacy
  espionageModule, // SPY-1 core module: espionage.spy → time-boxed intel windows (state.intel)
  botDiplomacyModule, // bots: friendly-by-default favour meter → embargo/war only when provoked
  marketModule, // session resource market: two-sided order book (sell/buy lots), embargo-gated
  divisionModule, // ground divisions: mobilise from a template + daily restoration
  capitalModule, // designatable capital (hero respawn / module re-fit anchor)
  standingOrdersModule, // CC-2/CC-4 standing orders (auto-storm / дежурный вылет), server-driven
  forcedMarchModule, // BOOST-1 форс-марш: +50% скорости за 5% max-HP износа в час хода
  instantRepairModule, // платный мгновенный ремонт корпуса (кредиты как премиум-валюта)
  econScrewsModule, // ECON-3: экспресс-ремонт корпуса за metal у своего дока
  effectsModule, // EFX-1: интерпретатор data.events (trigger→effect); инертен, пока events: {} пуст
];

export const kernel = createKernel(MODULES);

// Win at 1100 of the board's ~2410 base points (30 planets×50 + 91 provinces×10). Set
// below the ~60% domination line so a decisive-but-not-total lead — a fistful of planets
// plus built-up infrastructure — can win the SCORE race first, making the score/building
// system (scoreValue) meaningful instead of vestigial vs conquest. Tunable single source
// of truth, also read by the HUD score readout.
export const SCORE_LIMIT = 1100;
export function ctx(now: number): Context {
  return { now, data, config: { timeScale: 1, victory: { scoreLimit: SCORE_LIMIT } } };
}

export interface StepOut {
  state: GameState;
  events: DomainEvent[];
  error?: string;
}

/** Advance the world to `now`, collecting events. */
export function advance(state: GameState, now: number): StepOut {
  if (now <= state.time) return { state, events: [] };
  // Chain partial catch-ups (mirrors matchRoom.computeAdvance): a long-idle world
  // may exceed MAX_ADVANCE_STEPS per call; stopping short would leave due events in
  // the queue and `order()` would then hit the kernel's E_TIME_GAP guard. A chunk
  // that makes NO progress (same-instant runaway) breaks out — the frame loop
  // retries next tick rather than spinning here.
  let cur = state;
  const events: StepOut['events'] = [];
  for (let i = 0; i < 10; i++) {
    const r = kernel.advanceTo(cur, ctx(now));
    if (!r.ok) return { state: cur, events, error: r.code };
    const progressed = r.state.time > cur.time;
    cur = r.state;
    events.push(...r.events);
    if (!r.partial || !progressed) break;
  }
  return { state: cur, events };
}

/** Apply a player order at the current world time (advancing first if needed). */
export function order(state: GameState, action: Action, now: number): StepOut {
  const advanced = advance(state, now);
  const r = kernel.applyAction(advanced.state, action, ctx(Math.max(now, advanced.state.time)));
  if (!r.ok) return { state: advanced.state, events: advanced.events, error: r.code };
  return { state: r.state, events: [...advanced.events, ...r.events] };
}

// --- action builders ---------------------------------------------------------

let seqCounter = 0;
const act = (playerId: string, type: string, payload: unknown): Action => ({
  id: `ui:${playerId}:${seqCounter++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});

export const moveFleet = (playerId: string, fleetId: string, to: string) =>
  act(playerId, 'fleet.move', { fleetId, to });
/** March to a continuous point ON a lane (Bytro-style): the army routes to the
 *  road and parks at fraction `t` along (`from`,`to`) instead of at a node. */
export const moveFleetEdge = (
  playerId: string,
  fleetId: string,
  edge: { from: string; to: string; t: number },
) => act(playerId, 'fleet.move', { fleetId, toEdge: edge });
export const stopFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.stop', { fleetId });
// A single orbit (GDD §7.4): the only value is 'near' — "enter orbit".
export const orbitFleet = (playerId: string, fleetId: string, orbit: 'near' = 'near') =>
  act(playerId, 'fleet.orbit', { fleetId, orbit });
export const assaultFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.assault', { fleetId });
export const retreatFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.retreat', { fleetId });
export const bombardFleet = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'fleet.bombard', { fleetId, on });
/** Focus an artillery fleet's standoff fire on one enemy fleet (targetId), or
 *  clear (targetId null) to auto-target the nearest hostile in range. */
export const barrageFleet = (playerId: string, fleetId: string, targetId: string | null) =>
  act(playerId, 'fleet.barrage', { fleetId, targetId });
/** Set an artillery fleet's rules of engagement (passive/return/standard/aggressive). */
export const barrageModeFleet = (playerId: string, fleetId: string, mode: string) =>
  act(playerId, 'fleet.barrageMode', { fleetId, mode });
export const loadArmy = (playerId: string, fleetId: string, unit: string, count = 1) =>
  act(playerId, 'army.load', { fleetId, unit, count });
export const unloadArmy = (playerId: string, fleetId: string, unit: string, count = 1) =>
  act(playerId, 'army.unload', { fleetId, unit, count });
export const launchFleet = (playerId: string, planetId: string) =>
  act(playerId, 'fleet.launch', { planetId });
export const mergeFleet = (playerId: string, from: string, into: string) =>
  act(playerId, 'fleet.merge', { from, into });
export const splitFleet = (
  playerId: string,
  fleetId: string,
  take: Array<{ unit: string; count: number }>,
) => act(playerId, 'fleet.split', { fleetId, take });
export const buildBuilding = (playerId: string, planetId: string, building: string) =>
  act(playerId, 'building.construct', { planetId, building });
export const upgradeBuilding = (playerId: string, planetId: string, building: string) =>
  act(playerId, 'building.upgrade', { planetId, building });
export const buildUnit = (playerId: string, planetId: string, unit: string, count = 1) =>
  act(playerId, 'unit.build', { planetId, unit, count });
/** Build a hull with a chosen module loadout (the «Оснащение корабля» constructor).
 *  The modules ride in the `unit.build` payload; the core stamps them onto the built
 *  stack (validated + priced by `loadout.ts`), locked for good — no refit. */
export const buildShip = (
  playerId: string,
  planetId: string,
  unit: string,
  count: number,
  modules: string[],
) => act(playerId, 'unit.build', { planetId, unit, count, modules });
/** Cancel an ACTIVE (already paid) building/upgrade/unit order: refunds the unbuilt
 *  share of its cost and parks it as a resumable paused site — `seq` is the order's
 *  `construction.complete` scheduled-event seq (already read off `s.scheduled`, e.g.
 *  by `activeConstruction()`). */
export const cancelConstruction = (playerId: string, planetId: string, seq: number) =>
  act(playerId, 'construction.cancel', { planetId, seq });
/** Resume a paused site: pays exactly what was refunded, continues from the same
 *  progress. `id` is the `PausedConstructionSite.id` (= the original order's `seq`). */
export const resumeConstruction = (playerId: string, planetId: string, id: number) =>
  act(playerId, 'construction.resume', { planetId, id });
export const engageFleet = (playerId: string, fleetId: string, targetId: string) =>
  act(playerId, 'fleet.engage', { fleetId, targetId });
/** Begin researching a session technology (one active at a time — technologyModule). */
export const researchTech = (playerId: string, technology: string) =>
  act(playerId, 'technology.research', { technology });
/** «Хранитель»: hand this seat to the AI until game-time `until`, running `posture` —
 *  'defend' («Оборона», the safe default) or 'active_defend' («Активная оборона»,
 *  ST-3.3: + forecast-gated counterstrike and squadron fire-watch on own soil).
 *  Rejected (E_STEWARD_LOCKED) until the Steward tech is researched. */
export const delegateSteward = (
  playerId: string,
  until: number,
  posture: StewardPosture = 'defend',
) => act(playerId, 'steward.delegate', { posture, until });
/** Take the seat back early (a safe no-op if nothing was delegated). */
export const recallSteward = (playerId: string) => act(playerId, 'steward.recall', {});
/** Mark (or unmark) an OWN world as a hold point (ST-2.1) — a standing order the
 *  Steward honors under any posture: never auto-evacuated, reinforced under threat. */
export const setHoldPoint = (playerId: string, planetId: string, on: boolean) =>
  act(playerId, 'steward.holdpoint', { planetId, on });
// Re-export the Steward reads so the netserver + UI import them from the `./game` façade.
export { stewardActive, STEWARD_POSTURES, MAX_STEWARD_HOLD_POINTS };
/** Declare war on (or otherwise re-stance) another commander. */
export const declareWar = (playerId: string, target: string, stance: DiplomaticStance = 'war') =>
  act(playerId, 'diplomacy.declare', { target, stance });
/** Steal a time-boxed intel window on another commander (SPY-1 core module):
 *  `treasury` / `fleets` spy on the player; `planet` needs the world's id too. */
export const spyOn = (
  playerId: string,
  target: string,
  kind: 'treasury' | 'planet' | 'fleets',
  planetId?: string,
) => act(playerId, 'espionage.spy', { target, kind, ...(planetId ? { planetId } : {}) });

// REFP-8: CC-1 fleet order queue (ChainStep/FleetChain/MAX_CHAIN_*/fleetIdle/
// validateChainSteps) moved to `chain.ts` — pure functions over Fleet/GameState/data.
// Imported here for the chain driver/actions and re-exported for main.ts / tests.
import {
  fleetIdle,
  validateChainSteps,
  MAX_CHAIN_STEPS,
  MAX_CHAIN_WAIT_HOURS,
  type ChainStep,
  type FleetChain,
} from './chain';
export {
  fleetIdle,
  validateChainSteps,
  MAX_CHAIN_STEPS,
  MAX_CHAIN_WAIT_HOURS,
  type ChainStep,
  type FleetChain,
};

// REFP-7: squadron mechanics (squadronTake, SortieState/sortieSpec/freshSortie/
// canSortie/spendSortie/tickRearm, fleetHasSquadron, squadronStrikeRange,
// withinRange, squadronReaches) moved to `squadron.ts` — pure functions over
// Fleet + data. Imported here for the patrol/standing-order drivers and re-exported.
import {
  squadronTake,
  sortieSpec,
  freshSortie,
  canSortie,
  spendSortie,
  tickRearm,
  fleetHasSquadron,
  squadronStrikeRange,
  withinRange,
  squadronReaches,
  type SortieState,
} from './squadron';
export {
  squadronTake,
  sortieSpec,
  freshSortie,
  canSortie,
  spendSortie,
  tickRearm,
  fleetHasSquadron,
  squadronStrikeRange,
  withinRange,
  squadronReaches,
  type SortieState,
};

// --- squadron patrol (squadrons-roadmap SQ-4.1) ------------------------------
// A wing left on patrol auto-strikes an enemy that enters its radius, burning a sortie
// (SQ-2.1) each time; when it runs dry it rearms and then resumes — no live player in the
// moment, fully deterministic. The pure decision core lives here; the frame-loop driver
// (main.ts, mirrors autoEngage/driveQueues) issues the strike order, burns the sortie,
// and ticks the rearm on a game-hour cadence.

/** A standing patrol: guard `center` out to `radius` with the wing's sortie budget. */
export interface Patrol {
  center: { x: number; y: number };
  radius: number;
  sortie: SortieState;
}

/** The contact this patrol strikes this round: the lowest-id enemy inside the radius,
 *  and only while the wing is flight-ready (fuel left, not rearming). Stable tie-break by
 *  id — the same rule orbital AA / lane intercept use. Pure; null = hold fire. */
export function patrolTarget(
  patrol: Patrol,
  enemies: Array<{ id: string; pos: { x: number; y: number } }>,
): string | null {
  if (!canSortie(patrol.sortie)) return null;
  let best: string | null = null;
  for (const e of enemies) {
    if (withinRange(patrol.center, e.pos, patrol.radius) && (best === null || e.id < best)) {
      best = e.id;
    }
  }
  return best;
}

/** One reactive-scramble tick for a patrolling wing (CC-4 — "auto-sortie at an identified
 *  target in vision + range"): pick the in-range contact (SQ-4.1) and launch at it — engage
 *  if co-located, else fly to intercept its node — burning one fuel (SQ-2.1). `targets` are
 *  the pre-filtered hostile, identified contacts that are sitting on a node. Returns the
 *  order to issue (null = hold fire) plus the wing's new sortie state. Pure — the driver
 *  gathers the world (vision + diplomacy) and issues the order. */
export function scrambleOrder(
  me: string,
  fleet: Fleet,
  patrol: Patrol,
  targets: Array<{ id: string; location: string; pos: { x: number; y: number } }>,
  rearmRounds: number,
): { action: Action | null; sortie: SortieState } {
  const pick = patrolTarget(patrol, targets);
  if (pick === null) return { action: null, sortie: patrol.sortie };
  const foe = targets.find((t) => t.id === pick)!;
  const action =
    fleet.location === foe.location
      ? engageFleet(me, fleet.id, foe.id)
      : moveFleet(me, fleet.id, foe.location);
  return { action, sortie: spendSortie(patrol.sortie, rearmRounds) };
}

/** One tick of the SERVER-SIDE auto-storm driver (CC-2): every fleet flagged in
 *  `state.autoAssault` that sits over someone else's capturable world with the orbit
 *  clear gets its storm orders. Mirrors the client autoEngage() conditions exactly.
 *  Pure — the host applies the actions; a rejection is simply skipped (a standing
 *  stance has no chain to block). */
export function serverAutoAssaultActions(
  state: GameState,
): Array<{ fleetId: string; owner: string; actions: Action[] }> {
  const flagged = (state as DivState).autoAssault ?? {};
  const out: Array<{ fleetId: string; owner: string; actions: Action[] }> = [];
  for (const fid of Object.keys(flagged)) {
    const f = state.fleets[fid];
    if (!f || f.location === null || !fleetIdle(f)) continue;
    const here = state.planets[f.location];
    if (!here || !isCapturable(data, here) || here.owner === f.owner) continue;
    // Auto-storm only worlds we are AT WAR with (bug-hunt MINOR): the core rejects a
    // peaceful assault anyway (E_FORBIDDEN), but the driver re-issued the doomed pair
    // on every wake — rejected-action churn, and the fleet.orbit half DID apply.
    if (here.owner !== null && getStance(state, f.owner, here.owner) !== 'war') continue;
    const enemyHere = Object.values(state.fleets).some(
      (g) => g.owner !== f.owner && g.location === f.location && g.units.some((u) => u.count > 0),
    );
    if (enemyHere) continue; // let the orbital battle settle first
    // An assault needs near orbit first (orbit is instant), mirroring the AI capture pass.
    const actions =
      f.orbit === 'near'
        ? [assaultFleet(f.owner, fid)]
        : [orbitFleet(f.owner, fid), assaultFleet(f.owner, fid)];
    out.push({ fleetId: fid, owner: f.owner, actions });
  }
  return out;
}

/** The cooldown-ledger key an ability occupies — mirrors the core heroModule's
 *  `cooldownKey` so the chain driver reads the SAME slot the cast writes. */
function abilityCooldownKey(type: string): string {
  return type === 'temp_lane' ? 'path' : type === 'annihilate' ? 'annihilate' : `fx:${type}`;
}
/** Is `hero`'s `abilityId` still cooling down at `now`? An unknown ability id is NOT
 *  held (the core rejects it and the step is consumed — never a permanent deadlock). */
function abilityOnCooldown(hero: Hero, abilityId: string, now: number): boolean {
  const def = data.heroAbilities[abilityId];
  if (!def) return false;
  return ((hero.cooldowns ?? {})[abilityCooldownKey(def.type)] ?? 0) > now;
}
/** The living hero commanding this fleet (its ship), if any. Sorted-id lookup keeps it
 *  deterministic across hosts (JSONB scrambles object key order — BF-13). */
function heroCommandingFleet(state: GameState, fleetId: string): Hero | undefined {
  const heroes = state.heroes ?? {};
  for (const id of Object.keys(heroes).sort()) {
    const h = heroes[id]!;
    if (h.fleetId === fleetId && h.alive !== false) return h;
  }
  return undefined;
}

/** One tick of the CC-1 chain driver: for every chained fleet that is FREE (not in
 *  transit, not in battle), resolve the head step into the orders to issue plus the
 *  `chain.stamp` patch ([] steps = chain done → cleared). Consume-on-issue: a step
 *  whose order the core then rejects is SKIPPED, not retried forever (the CC-2
 *  rejected-churn lesson). Sorted fleet ids ⇒ deterministic across hosts (JSONB does
 *  not preserve object key order). Pure — hosts apply the patch, then the actions. */
export function serverChainActions(
  state: GameState,
  now: number,
): Array<{
  fleetId: string;
  owner: string;
  actions: Action[];
  patch?: { steps: ChainStep[]; waitUntil?: number };
}> {
  const chains = (state as DivState).orders ?? {};
  const out: Array<{
    fleetId: string;
    owner: string;
    actions: Action[];
    patch?: { steps: ChainStep[]; waitUntil?: number };
  }> = [];
  for (const fid of Object.keys(chains).sort()) {
    const chain = chains[fid]!;
    const f = state.fleets[fid];
    if (!f) continue; // dead fleet — the module's own housekeeping sweep clears it
    if (!fleetIdle(f)) continue; // busy: the chain resumes once the fleet is free
    const head = chain.steps[0];
    if (!head) {
      out.push({ fleetId: fid, owner: f.owner, actions: [], patch: { steps: [] } });
      continue;
    }
    const rest = chain.steps.slice(1);
    if (head.kind === 'wait') {
      // Two-phase hold: arm the deadline once, then consume when the clock passes it.
      if (chain.waitUntil === undefined) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: [],
          patch: { steps: chain.steps, waitUntil: now + head.hours * HOUR },
        });
      } else if (now >= chain.waitUntil) {
        out.push({ fleetId: fid, owner: f.owner, actions: [], patch: { steps: rest } });
      }
    } else if (head.kind === 'move') {
      out.push({
        fleetId: fid,
        owner: f.owner,
        // Already there → nothing to issue (the core would reject E_SAME_LOCATION).
        actions: f.location === head.to ? [] : [moveFleet(f.owner, fid, head.to)],
        patch: { steps: rest },
      });
    } else if (head.kind === 'assault') {
      out.push({
        fleetId: fid,
        owner: f.owner,
        actions:
          f.orbit === 'near'
            ? [assaultFleet(f.owner, fid)]
            : [orbitFleet(f.owner, fid), assaultFleet(f.owner, fid)],
        patch: { steps: rest },
      });
    } else if (head.kind === 'strike') {
      // Fire window, two-phase like `wait`: open — focus the guns and arm the
      // deadline; close — cease fire (clear focus) and move on. A fleet with no
      // artillery just idles through the window (the focus order rejects, the
      // window still runs — deterministic either way).
      if (chain.waitUntil === undefined) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: [barrageFleet(f.owner, fid, head.target)],
          patch: { steps: chain.steps, waitUntil: now + head.hours * HOUR },
        });
      } else if (now >= chain.waitUntil) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: [barrageFleet(f.owner, fid, null)],
          patch: { steps: rest },
        });
      }
    } else if (head.kind === 'ability') {
      // A hero ability queued as a step (CC-1 × HERO-4): the hero commanding THIS fleet
      // casts it once the fleet is free. Consume-on-issue like move/assault — the core
      // `hero.ability` re-gates ownership/liveness/equipment/range/cost, so a step it
      // rejects is skipped, not retried. The ONE hold is a live cooldown (a transient
      // that always clears): «дойти и открыть Коридор» waits the cooldown out instead of
      // wasting the cast. No hero on the fleet ⇒ drop the stale step (no action).
      const hero = heroCommandingFleet(state, fid);
      if (hero === undefined || !abilityOnCooldown(hero, head.abilityId, now)) {
        out.push({
          fleetId: fid,
          owner: f.owner,
          actions: hero
            ? [castHeroAbility(f.owner, hero.id, head.abilityId, head.target ?? undefined)]
            : [],
          patch: { steps: rest },
        });
      }
    } else {
      out.push({
        fleetId: fid,
        owner: f.owner,
        actions: [barrageFleet(f.owner, fid, head.target)],
        patch: { steps: rest },
      });
    }
  }
  return out;
}

/** One tick of the SERVER-SIDE patrol driver (CC-4): tick each standing patrol's rearm
 *  on its game-hour cadence, then — if the wing is parked and flight-ready — scramble at
 *  the lowest-id identified, at-war contact inside the radius (the same pure scrambleOrder
 *  the solo driver uses; vision comes from the owner's identify coverage, so the server
 *  never lets a patrol see through the fog its owner has). Pure — the host applies the
 *  strike `actions` and persists `patch` via patrol.stamp; `drop` retires a patrol whose
 *  fleet lost its wing. */
export function serverPatrolActions(
  state: GameState,
  now: number,
): Array<{
  fleetId: string;
  owner: string;
  actions: Action[];
  patch?: { sortie: SortieState; rearmAt?: number };
  drop?: boolean;
}> {
  const patrols = (state as DivState).patrols ?? {};
  const out: Array<{
    fleetId: string;
    owner: string;
    actions: Action[];
    patch?: { sortie: SortieState; rearmAt?: number };
    drop?: boolean;
  }> = [];
  const identify = new Map<string, Set<string>>(); // owner → identified nodes (hoisted per owner)
  // Sorted fleet-id iteration (like serverChainActions above): JSONB does not preserve
  // object key order, so unsorted iteration would make the strike-issue order — and thus
  // which of two co-located wings wins a race for the same target — host/hibernation
  // dependent. Sorting pins one order across hosts and wake cycles (invariant #6).
  for (const fid of Object.keys(patrols).sort()) {
    const p = patrols[fid]!;
    const f = state.fleets[fid];
    if (!f || !fleetHasSquadron(f)) {
      out.push({ fleetId: fid, owner: f?.owner ?? '', actions: [], drop: true });
      continue;
    }
    const spec = sortieSpec(f);
    // Rearm cadence: one round per game-hour past `rearmAt` (absolute stamps — no
    // wall-clock drift, works however rarely the offline room wakes).
    let sortie = p.sortie;
    let rearmAt = p.rearmAt ?? now + HOUR;
    while (now >= rearmAt) {
      sortie = tickRearm(sortie, spec.maxFuel);
      rearmAt += HOUR;
    }
    let actions: Action[] = [];
    if (fleetIdle(f)) {
      let seen = identify.get(f.owner);
      if (!seen) {
        seen = identifiedNodes(state, f.owner, data);
        identify.set(f.owner, seen);
      }
      const targets: Array<{ id: string; location: string; pos: { x: number; y: number } }> = [];
      for (const g of Object.values(state.fleets)) {
        if (g.owner === f.owner || !g.location || g.movement || !g.units.some((u) => u.count > 0))
          continue;
        if (g.battleId) continue; // already locked in a battle — engage would reject, yet the sortie fuel is spent (BF-30)
        if (getStance(state, f.owner, g.owner) !== 'war') continue; // declared enemies only — never auto-war
        if (!seen.has(g.location)) continue; // identified contacts only — fog-honest
        const pos = state.planets[g.location]?.position;
        if (pos) targets.push({ id: g.id, location: g.location, pos });
      }
      const res = scrambleOrder(f.owner, f, { ...p, sortie }, targets, spec.rearmRounds);
      sortie = res.sortie;
      if (res.action) actions = [res.action];
    }
    const changed =
      sortie.fuel !== p.sortie.fuel ||
      sortie.rearming !== p.sortie.rearming ||
      rearmAt !== p.rearmAt;
    out.push({
      fleetId: fid,
      owner: f.owner,
      actions,
      patch: changed ? { sortie, rearmAt } : undefined,
    });
  }
  return out;
}

/** Toggle the CC-2 auto-storm stance on an owned fleet (authoritative standing order). */
export const orderAuto = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'order.auto', { fleetId, on });
/** Stand (or stand down) a CC-4 reactive patrol on an owned squadron fleet — the server
 *  computes the patrol itself (center / radius / fresh sortie). */
export const orderScramble = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'order.scramble', { fleetId, on });
/** The patrol driver's runtime stamp: burned fuel / ticked rearm / next cadence mark. */
export const patrolStamp = (
  playerId: string,
  fleetId: string,
  sortie: SortieState,
  rearmAt?: number,
) =>
  act(
    playerId,
    'patrol.stamp',
    rearmAt === undefined ? { fleetId, sortie } : { fleetId, sortie, rearmAt },
  );
/** CC-1: set (or [] = cancel) an owned fleet's whole order chain atomically. */
export const orderChain = (playerId: string, fleetId: string, steps: ChainStep[]) =>
  act(playerId, 'order.chain', { fleetId, steps });
/** BOOST-1: toggle форс-марш on an owned fleet (+50% speed, hull wear in transit). */
export const forceMarchFleet = (playerId: string, fleetId: string, on: boolean) =>
  act(playerId, 'fleet.forcemarch', { fleetId, on });
/** Платный мгновенный ремонт корпуса всего флота (цена — `instantRepairCost`). */
export const instantRepairFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.instantRepair', { fleetId });
/** ECON-3а: экспресс-ремонт за metal у своего дока (цена — `dockRepairCost`). */
export const repairFleet = (playerId: string, fleetId: string) =>
  act(playerId, 'fleet.repair', { fleetId });
/** The chain driver's runtime stamp: consumed head / armed wait deadline. */
export const chainStamp = (
  playerId: string,
  fleetId: string,
  steps: ChainStep[],
  waitUntil?: number,
) =>
  act(
    playerId,
    'chain.stamp',
    waitUntil === undefined ? { fleetId, steps } : { fleetId, steps, waitUntil },
  );

/** Place a market lot: `sell` escrows `amount` of `resource` for `price` credits/unit;
 *  `buy` escrows the credits and offers to buy that much of `resource`. */
export const marketList = (
  playerId: string,
  side: MarketSide,
  resource: string,
  amount: number,
  price: number,
) => act(playerId, 'market.list', { side, resource, amount, price });
/** Take (fill) up to `amount` from an open lot — buy from a sell lot / sell into a buy lot. */
export const marketTake = (playerId: string, id: string, amount?: number) =>
  act(playerId, 'market.take', amount === undefined ? { id } : { id, amount });
/** Reclaim your own lot, refunding its remaining escrow. */
export const marketCancel = (playerId: string, id: string) =>
  act(playerId, 'market.cancel', { id });
/** Mobilise division template `template` (0-based) on your world `planetId`.
 *  `officer` = build from the named OFFICER_TEMPLATES roster instead (locked premades). */
export const mobilizeDivision = (
  playerId: string,
  planetId: string,
  template: number,
  officer = false,
) =>
  act(
    playerId,
    'division.mobilize',
    officer ? { planetId, template, officer: true } : { planetId, template },
  );
/** Rename your CUSTOM division template (designer menu). */
export const renameDivisionTemplate = (playerId: string, template: number, name: string) =>
  act(playerId, 'division.rename', { template, name });
/** Assemble a template: set slot `slot` of your template `template` to `unit` (null = clear). */
export const setDivisionTemplate = (
  playerId: string,
  template: number,
  slot: number,
  unit: string | null,
) => act(playerId, 'division.template', { template, slot, unit });
/** Load a garrisoning division into a co-located, idle fleet (by free hold). */
export const loadDivision = (playerId: string, divisionId: string, fleetId: string) =>
  act(playerId, 'division.load', { divisionId, fleetId });
/** Unload a carried division onto the world its carrier is docked over. */
export const unloadDivision = (playerId: string, divisionId: string) =>
  act(playerId, 'division.unload', { divisionId });
/** Designate one of your inhabited worlds as your capital (hero respawn / re-fit anchor). */
export const designateCapital = (playerId: string, planetId: string) =>
  act(playerId, 'capital.designate', { planetId });

// --- hero engine (core heroModule, HERO-3..9): the data-driven hero actions ---
/** Cast a hero ability (HERO-4 dispatcher); `target` — planet id for ranged casts. */
export const castHeroAbility = (
  playerId: string,
  heroId: string,
  abilityId: string,
  target?: string,
) =>
  act(playerId, 'hero.ability', { heroId, abilityId, ...(target !== undefined ? { target } : {}) });
/** Raise an undeployed hero's ship at an owned world (or own fleet / allied world
 *  when the hero carries the matching spawn-marker ability). */
export const spawnHero = (playerId: string, heroId: string, at: string) =>
  act(playerId, 'hero.spawn', { heroId, at });
/** Unlock a hero skill-tree node (branch/requires/cost gate the order). */
export const unlockHeroSkill = (playerId: string, heroId: string, node: string) =>
  act(playerId, 'hero.skill.unlock', { heroId, node });
/** Install a ship fitting into one of the hero archetype's slots (no refit). */
export const fitHero = (playerId: string, heroId: string, fitting: string) =>
  act(playerId, 'hero.fit', { heroId, fitting });

/** Can `mover`'s fleets enter/traverse a province owned by `owner`? Neutral, your own,
 *  and players you're at war / pact / alliance with are passable; a player you're at
 *  PEACE with is blocked (you'd have to declare war first). */
export function canTraverse(state: GameState, mover: string, owner: string | null): boolean {
  if (owner == null || owner === mover) return true;
  return getStance(state, mover, owner) !== 'peace';
}

// --- AI ----------------------------------------------------------------------

/** A garrison unit the evacuation can actually lift: the same gate `army.load`
 *  enforces (ground cargo only, fixed emplacements stay). */
const liftable = (unit: string): boolean => {
  const def = data.units[unit];
  return !!def && def.domain === 'ground' && !def.traits.includes('immobile');
};

/** Anti-shuttle cooldown (ST-3.4), game-hours: after the Steward evacuates X→Y,
 *  the REVERSE trip Y→X is off the haven list for this long — an enemy poking
 *  two nodes alternately must not make the wing челночить between them forever
 *  (each leg it defends nothing and a lane camper can catch it in the open).
 *  With no other haven the wing STANDS instead — a fight beats eternal transit. */
const EVAC_RETURN_COOLDOWN_H = 12;

/**
 * One guard-duty tick of the Steward for a delegated seat (posture «Оборона»,
 * ST-3.2 / steward-roadmap §ST-3): for every owned world a VISIBLE hostile
 * bears on, forecast the stand (`previewBattle`: every bearing force strikes,
 * the node's whole defense — docked fleets + garrison — answers). Forecast own
 * losses at/over `STEWARD_LOSS_LIMIT` mean the fight is a bad trade, so the
 * wing is pulled out to the nearest SAFE own world: self-moving fleets fly out
 * (lifting what garrison fits their holds on the way), and for the rest the
 * nearest idle transport with a free hold is summoned — only if it can arrive
 * with a tick to spare BEFORE the threat lands, because `army.load` locks the
 * moment the assault starts (`E_UNDER_ASSAULT`). Evacuation is loss-avoidance:
 * the autopilot saves what it cannot profitably defend, it never fights better
 * than the player would. Pure builder like `aiOrders`: returns actions only.
 * The forecast is the base model (no `combat.damage` hooks) over one combined
 * engagement — a retreat heuristic, not an oracle (ONB-6 semantics).
 */
export function stewardGuardOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture = 'defend',
): Action[] {
  const out: Action[] = [];
  const c = ctx(state.time);
  // SITREP (ST-2.4): every decision below is journaled and stamped as ONE
  // trailing `steward.report` — the morning report the sleeping owner reads.
  const report: StewardLogEntry[] = [];
  const frac = (x: number): number => Math.round(x * 1000) / 1000;
  // Repeat-prone facts (hold/stranded re-derive every 2h tick) are stamped once
  // per EPISODE: skipped while the node's latest journal line already says the
  // same thing. The journal lives in state, so the check survives the stateless
  // re-tick; any different entry for the node reopens the episode.
  const lastLogged = (node: string): string | undefined => {
    const log = state.players[ai]?.stewardLog;
    if (!log) return undefined;
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i]!.node === node) return log[i]!.kind;
    }
    return undefined;
  };
  const noteOnce = (entry: StewardLogEntry): void => {
    if (entry.node !== undefined && lastLogged(entry.node) === entry.kind) return;
    report.push(entry);
  };
  const identified = identifiedNodes(state, ai, data);
  const mine = Object.values(state.planets).filter((p) => p.owner === ai);
  // Threat scans are per-node; cache them — the haven search re-reads them.
  const threatCache = new Map<string, ReturnType<typeof scanNodeThreats>>();
  const threatsOf = (node: string): ReturnType<typeof scanNodeThreats> => {
    let t = threatCache.get(node);
    if (t === undefined) {
      t = scanNodeThreats(state, node, ai, c, identified);
      threatCache.set(node, t);
    }
    return t;
  };
  // Hold points (ST-2.1): player-designated standing anchors — never evacuated,
  // reinforced instead; their docked wings are not poached for other errands.
  const holdPoints = new Set(state.players[ai]?.stewardHoldPoints ?? []);
  // A fleet gets ONE task per tick (evacuate or ferry) — never two nodes' errands.
  const tasked = new Set<string>();
  const idleOwn = (f: Fleet): boolean =>
    f.owner === ai && f.location != null && !f.movement && !f.battleId && !tasked.has(f.id);
  // fleetCargoFree, not a local re-count: the hold is shared with carried DIVISIONS
  // too — a transport already ferrying a formation must not be over-filled.
  const freeHold = (f: Fleet): number => fleetCargoFree(state, f);

  for (const p of mine) {
    const threats = threatsOf(p.id);
    if (threats.length === 0) continue;
    const docked = Object.values(state.fleets).filter((f) => idleOwn(f) && f.location === p.id);
    const defenders: UnitStack[] = [...docked.flatMap((f) => f.units), ...p.garrison];
    if (!defenders.some((s) => s.count > 0)) continue; // nothing here to save
    const attackers: UnitStack[] = threats.flatMap((t) => {
      const f = state.fleets[t.fleetId];
      return f ? [...f.units, ...(f.landing ?? [])] : [];
    });
    const stand = previewBattle(attackers, defenders, data);
    // A stand the forecast says we WIN is held regardless of its price: fleeing a
    // won fight gifts the world to a cheap feint (three scouts «push» a cruiser
    // off an empty rock and walk in). The loss limit judges only losing/pyrrhic
    // stands — the wing bails when it would be wiped or ground down for nothing.
    const holds =
      stand.outcome === 'defender' || stand.defender.damageFraction < STEWARD_LOSS_LIMIT;
    if (holds) {
      // Counterstrike (ST-3.3, «Активная оборона» only): war-stance intruders
      // PARKED at our node that auto-engage didn't already lock (war declared
      // after they docked; a resolved battle's leftovers). The combat module
      // AUTO-re-engages a battle's victor into the NEXT parked hostile, so the
      // gate must price the WHOLE ladder, not the first rung: the wing has to
      // clear EVERY parked intruder, chained in scan order, with CUMULATIVE
      // hull losses under the limit — else a cheap first fight would drag the
      // damaged wing into one its forecast declined («держим, но не
      // кровоточим»). One engager, one order — the victor chain does the rest;
      // the fight happens where the wing stands: own territory only.
      const holdEntry: StewardLogEntry = {
        at: state.time,
        kind: 'hold',
        node: p.id,
        fraction: frac(stand.defender.damageFraction),
      };
      if (posture !== 'active_defend') {
        noteOnce(holdEntry);
        continue;
      }
      const ladder: Fleet[] = [];
      for (const t of threats) {
        if (t.kind !== 'present') continue;
        const tf = state.fleets[t.fleetId];
        if (tf && !tf.battleId) ladder.push(tf);
      }
      if (ladder.length === 0) {
        noteOnce(holdEntry);
        continue;
      }
      const byStrength = [...docked].sort(
        (a, b) =>
          hullPool(b.units, data) - hullPool(a.units, data) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      let engaged = false;
      for (const f of byStrength) {
        if (tasked.has(f.id)) continue;
        let wing = f.units;
        let clears = true;
        for (const tf of ladder) {
          const rung = previewBattle(wing, tf.units, data);
          if (rung.outcome !== 'attacker') {
            clears = false;
            break;
          }
          wing = rung.attacker.survivors; // carry the hull damage into the next rung
        }
        const before = hullPool(f.units, data);
        if (!clears || before <= 0) continue;
        const ladderFraction = 1 - hullPool(wing, data) / before;
        if (ladderFraction >= STEWARD_LOSS_LIMIT) continue;
        out.push(engageFleet(ai, f.id, ladder[0]!.id));
        tasked.add(f.id);
        engaged = true;
        report.push({
          at: state.time,
          kind: 'strike',
          node: p.id,
          fleetId: f.id,
          count: ladder.length,
          fraction: frac(ladderFraction),
        });
        break;
      }
      if (!engaged) noteOnce(holdEntry);
      continue;
    }
    const earliest = threats[0]!.eta;
    // Hold point (ST-2.1): a player-designated anchor is NEVER auto-evacuated —
    // the standing order outranks the loss forecast. The Steward instead tries
    // to FLIP the forecast: summon ONE idle wing that (a) arrives with a tick
    // (2h) to spare before the earliest threat lands and (b) turns the combined
    // stand into a hold. Piecemeal feeding is refused — help that arrives late
    // or still loses would only widen the defeat; the wing then stands as
    // ordered, and the journal's bad fraction tells the owner the price.
    if (holdPoints.has(p.id)) {
      // Help already flying in (last tick's relief or the owner's own order) —
      // nothing to add; the episode is already journaled.
      const inboundHelp = Object.values(state.fleets).some(
        (f) => f.owner === ai && f.movement != null && journeyDestination(f.movement) === p.id,
      );
      if (!inboundHelp) {
        let relief: Fleet | null = null;
        let reliefEta = Infinity;
        let reliefFraction = 0;
        for (const f of Object.values(state.fleets)) {
          if (!idleOwn(f) || f.location === p.id) continue;
          if (!f.units.some((s) => s.count > 0)) continue;
          // Same no-poach rule as the ferry: a wing on another threatened node
          // (or another anchor) is needed where it stands.
          if (threatsOf(f.location!).length > 0 || holdPoints.has(f.location!)) continue;
          const hours = estimateTravelHours(state, data, f.location!, p.id, f);
          if (hours === null) continue;
          const arrives = state.time + hoursToMs(c, hours);
          if (arrives + hoursToMs(c, 2) > earliest) continue; // too late to matter
          const together = previewBattle(attackers, [...defenders, ...f.units], data);
          const flips =
            together.outcome === 'defender' ||
            together.defender.damageFraction < STEWARD_LOSS_LIMIT;
          if (!flips) continue;
          if (arrives < reliefEta) {
            reliefEta = arrives;
            relief = f;
            reliefFraction = together.defender.damageFraction;
          }
        }
        if (relief) {
          out.push(moveFleet(ai, relief.id, p.id));
          tasked.add(relief.id);
          report.push({
            at: state.time,
            kind: 'reinforce',
            node: p.id,
            fleetId: relief.id,
            fraction: frac(reliefFraction),
          });
        } else {
          noteOnce({
            at: state.time,
            kind: 'hold',
            node: p.id,
            fraction: frac(stand.defender.damageFraction),
          });
        }
      }
      continue; // a hold point never falls through to evacuation
    }
    // Bad trade — evacuate to the nearest reachable own world nothing bears on.
    // Anti-shuttle hysteresis (ST-3.4): a candidate we RECENTLY fled FROM into
    // this very node is the shuttle's return leg — journaled evacuations
    // (state-resident, so the check survives the stateless re-tick) block it
    // for EVAC_RETURN_COOLDOWN_H game-hours.
    const returnBlocked = (candidate: string): boolean => {
      const log = state.players[ai]?.stewardLog;
      if (!log) return false;
      const horizon = hoursToMs(c, EVAC_RETURN_COOLDOWN_H);
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i]!;
        if (e.kind !== 'evac' || e.node !== candidate || e.to !== p.id) continue;
        if (state.time - e.at < horizon) return true;
      }
      return false;
    };
    let haven: string | null = null;
    let havenDist = Infinity;
    for (const q of mine) {
      if (q.id === p.id || threatsOf(q.id).length > 0 || returnBlocked(q.id)) continue;
      const route = planRoute(state, p.id, q.id);
      if (!route) continue;
      const dist = routeDistance(state, p.id, route);
      if (dist < havenDist) {
        havenDist = dist;
        haven = q.id;
      }
    }
    if (haven === null) {
      // Nowhere safer — a FORCED stand; the bad fraction in the entry tells the
      // owner why the wing stayed put.
      noteOnce({
        at: state.time,
        kind: 'hold',
        node: p.id,
        fraction: frac(stand.defender.damageFraction),
      });
      continue;
    }
    const assaulted = garrisonUnderAssault(state, p.id);
    // What the garrison still holds after the loads planned below (state is
    // read-only). Counted EXACTLY as `army.load` will resolve it — via
    // findHealthyStack: only a full-health, default-loadout stack embarks.
    // Battle-worn troops cannot be lifted (they hold the line; hospitals mend
    // them) — planning them would bounce off E_NO_ARMY and, worse, mark the
    // garrison as handled so no ferry would come for anyone.
    const left = new Map<string, number>();
    for (const s of p.garrison) {
      if (s.count <= 0 || !liftable(s.unit) || left.has(s.unit)) continue;
      const healthy = findHealthyStack(p.garrison, s.unit);
      if (healthy) left.set(s.unit, healthy.count);
    }
    // Docked fleets fly out — lifting what garrison fits their holds first
    // (load and move stack in one tick: actions apply in order while docked).
    for (const f of docked) {
      if (!assaulted) {
        let free = freeHold(f);
        for (const [unit, have] of left) {
          if (free <= 0 || have <= 0) continue;
          const size = data.units[unit]?.stats.cargoSize ?? 0;
          const n = size > 0 ? Math.min(have, Math.floor(free / size)) : have;
          if (n <= 0) continue;
          out.push(loadArmy(ai, f.id, unit, n));
          left.set(unit, have - n);
          free -= n * size;
        }
      }
      // A standing patrol flies out with its carrier: stand it down first (the
      // sortie is stashed, BF-26) so no stale patrol record points at this node.
      if ((state as DivState).patrols?.[f.id]) out.push(orderScramble(ai, f.id, false));
      out.push(moveFleet(ai, f.id, haven));
      tasked.add(f.id);
    }
    if (docked.length > 0) {
      report.push({
        at: state.time,
        kind: 'evac',
        node: p.id,
        to: haven,
        count: docked.length,
        fraction: frac(stand.defender.damageFraction),
      });
    }
    // Garrison still stranded → summon the nearest idle transport with a free
    // hold, but only when it beats the threat with one AI tick (2h) to spare —
    // a transport that would arrive into the assault is not sent at all.
    const stranded = [...left.values()].some((n) => n > 0);
    const inboundAlready = Object.values(state.fleets).some(
      (f) => f.owner === ai && f.movement != null && journeyDestination(f.movement) === p.id,
    );
    if (stranded && !inboundAlready && !assaulted) {
      let ferry: Fleet | null = null;
      let ferryEta = Infinity;
      for (const f of Object.values(state.fleets)) {
        if (!idleOwn(f) || f.location === p.id || freeHold(f) <= 0) continue;
        // Never poach a transport off ANOTHER threatened node (its own evac
        // branch tasks it) or off a hold point (the anchor keeps its wing).
        if (threatsOf(f.location!).length > 0 || holdPoints.has(f.location!)) continue;
        const hours = estimateTravelHours(state, data, f.location!, p.id, f);
        if (hours === null) continue;
        const arrives = state.time + hoursToMs(c, hours);
        if (arrives + hoursToMs(c, 2) > earliest) continue; // too late to load — don't feed it in
        if (arrives < ferryEta) {
          ferryEta = arrives;
          ferry = f;
        }
      }
      if (ferry) {
        out.push(moveFleet(ai, ferry.id, p.id));
        tasked.add(ferry.id);
        report.push({ at: state.time, kind: 'ferry', node: p.id, fleetId: ferry.id });
      } else {
        // Liftable troops remain, no help is coming this tick — the owner should
        // wake up to «гарнизон не спасти», not to silence. Once per episode.
        noteOnce({
          at: state.time,
          kind: 'stranded',
          node: p.id,
          fraction: frac(stand.defender.damageFraction),
        });
      }
    }
  }
  // Fire-watch (ST-3.3, «Активная оборона» only): stand a CC-4 reactive patrol on
  // every wing docked at an OWN world that isn't patrolling yet — the дежурный
  // вылет then answers raiders inside its radius on its own cadence (including
  // the mid-lane standoff campers `fleet.engage` can't reach). Never on foreign
  // soil; a wing the evac branch just tasked is not re-ordered.
  if (posture === 'active_defend') {
    const patrols = (state as DivState).patrols;
    for (const f of Object.values(state.fleets)) {
      if (!idleOwn(f) || !fleetHasSquadron(f) || patrols?.[f.id]) continue;
      if (state.planets[f.location!]?.owner !== ai) continue;
      out.push(orderScramble(ai, f.id, true));
      report.push({ at: state.time, kind: 'watch', node: f.location!, fleetId: f.id });
    }
  }
  // The SITREP stamp rides LAST: it narrates the orders above. Applied through
  // the same kernel path (steward.report — server-driver-only, gate refuses it
  // from the wire), so the journal lands in state and survives the night.
  if (report.length > 0) out.push(act(ai, 'steward.report', { entries: report }));
  return out;
}

/** The two server-side AIs that can play a seat, kept explicitly DISTINCT
 *  (SES-2.2). `steward` — «Хранитель»: the player's OWN autopilot, a defensive
 *  posture they turned on to cover their sleep; it runs on their chosen posture
 *  even while they are connected-but-idle, and its live delegation OUTRANKS the
 *  abandon grace. `substitute` — «заместитель»: the full expansion bot that takes
 *  over an ABANDONED chair, only after the player has been gone past the
 *  real-time grace window, and it is reclaimed the instant they return. `none` —
 *  no AI drives the seat this tick (a present player commands it, or an absent
 *  one is still inside their reconnect grace). */
export type SeatAiKind = 'steward' | 'substitute' | 'none';

/** What drives a seat this tick + the posture to hand `aiOrders`. */
export interface SeatAiDecision {
  kind: SeatAiKind;
  posture: StewardPosture | 'expand' | null; // null ⇔ kind === 'none'
}

/** Decide which server AI (if any) plays ONE seat this tick — SES-2.2. Pure:
 *  reads only the three facts the host tracks, no time source of its own.
 *  `hasHuman` — a live peer holds the chair; `posture` — the seat's active
 *  Steward delegation (`stewardActive`), null if none; `graceExpired` — the
 *  player has been absent PAST the real-time abandon window (wall-clock, the host
 *  compares `Date.now()`; always true for a chair that never opened a window).
 *  The precedence encodes the owner's intent: a delegation they set beats the
 *  automatic takeover, and a present human beats the idle bot. */
export function seatAiDecision(
  hasHuman: boolean,
  posture: StewardPosture | null,
  graceExpired: boolean,
): SeatAiDecision {
  // A live Steward delegation is the player's OWN autopilot: it plays regardless
  // of connection and never waits on the abandon grace (they asked for it).
  if (posture) return { kind: 'steward', posture };
  // No delegation → a present human commands their own chair.
  if (hasHuman) return { kind: 'none', posture: null };
  // Empty chair: wait out the grace (a drop / restart blip / a few days away)
  // before the substitute bot seizes it — reclaimed the moment they return.
  if (!graceExpired) return { kind: 'none', posture: null };
  return { kind: 'substitute', posture: 'expand' };
}

/** One decision tick's orders for an AI-driven seat, evaluated against `state`.
 *  Read-only: it builds and returns the actions; the caller applies them — the
 *  client to its local sim, the server through the authoritative room. Drives
 *  empty seats the same way in solo and multiplayer (a seat with no human). */
export function aiOrders(
  state: GameState,
  ai: string,
  posture: StewardPosture | 'expand' = 'expand',
): Action[] {
  const out: Action[] = [];
  if (!state.players[ai]) return out; // seat not in play / eliminated
  // The defensive family: both Steward postures HOLD (no expansion, no war
  // declarations); «Активная оборона» merely adds the counterstrike/fire-watch
  // inside the guard-duty tick below.
  const defensive = posture === 'defend' || posture === 'active_defend';
  // Steward guard duty (ST-3.2/3.3): a delegated defensive seat watches its worlds,
  // evacuates a wing the forecast says it would lose ≥ STEWARD_LOSS_LIMIT of, and —
  // under «Активная оборона» — counterstrikes what it beats cheaply on own soil.
  if (defensive) out.push(...stewardGuardOrders(state, ai, posture as StewardPosture));
  const isShipUnit = (u: string): boolean => !data.units[u]?.traits.includes('ground');
  const capturable = (p: Planet): boolean => SECTOR_TYPES[p.kind ?? '']?.capturable ?? false;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);
  // Send each idle AI fleet toward the nearest capturable world it can reach — only
  // neutral worlds or territory of someone it's at WAR with (peace = off-limits).
  // Steward «Оборона» (a delegated human seat, posture 'defend') HOLDS: it skips this
  // offensive sweep entirely and only builds / reinforces / trades below — repelling an
  // attacker is automatic in combat. "Autopilot keeps you alive; active play wins."
  // Named `warFooting` (not `atWar`) so the module-level pair helper stays visible.
  const warFooting = Object.keys(state.players).some(
    (pid) =>
      pid !== ai && state.players[pid]?.status === 'active' && getStance(state, ai, pid) === 'war',
  );
  // The home base (build/launch anchor, and the rally point ships pool at during war).
  const base =
    Object.values(state.planets).find((p) => p.owner === ai && p.buildings.length > 0) ??
    Object.values(state.planets).find((p) => p.owner === ai);
  const shipCount = (f: Fleet): number =>
    f.units.reduce((n, s) => n + (isShipUnit(s.unit) ? s.count : 0), 0);
  const expandFleets: Fleet[] = defensive ? [] : Object.values(state.fleets);
  // Consolidate BEFORE moving (self-play M4): two idle fleets sharing a location fuse
  // into one — without this, battle remnants and rally leftovers accumulate into a
  // hundreds-strong swarm of one-ship fleets that grinds the whole sim (and feeds
  // enemy AA one hull at a time). The merged fleet sorties on the next tick.
  const skipMove = new Set<string>();
  {
    const byLoc = new Map<string, Fleet[]>();
    for (const f of expandFleets) {
      if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
      const group = byLoc.get(f.location);
      if (group) group.push(f);
      else byLoc.set(f.location, [f]);
    }
    for (const group of byLoc.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => shipCount(b) - shipCount(a));
      for (let k = 1; k < group.length; k++) {
        out.push(mergeFleet(ai, group[k]!.id, group[0]!.id));
        skipMove.add(group[k]!.id);
      }
      skipMove.add(group[0]!.id); // it grows this tick, sorties the next
    }
  }
  for (const f of expandFleets) {
    if (f.owner !== ai || f.location == null || f.movement || f.battleId) continue;
    if (skipMove.has(f.id)) continue;
    // Strike groups, not dribbles (self-play M4): auto-rally pools each new ship into
    // the IDLE rally fleet at its build world — but only while one is parked there.
    // Sending every single-ship fleet out at once therefore orphaned the rally point,
    // spawned a fresh one-ship fleet per build (hundreds of fleets, the sim ground to
    // a halt) and fed hulls into enemy AA one at a time. At war, ships HOLD at the
    // home rally point until a strike group has formed; peacetime keeps the old
    // race-to-claim behaviour (speed is everything, there is nothing to fight).
    if (warFooting && f.location === base?.id) {
      if (shipCount(f) < 3) continue;
      // Lift a landing party before the sortie: only ground troops can take a
      // garrisoned world (two-phase capture), so a strike group without a landing
      // can raid provinces but never resolve the war. Load, then move — same tick.
      const militia = base.garrison.find((s) => s.unit === 'militia' && s.count > 0);
      const hasLanding = (f.landing ?? []).some((s) => s.count > 0);
      if (!hasLanding && militia) {
        out.push(loadArmy(ai, f.id, 'militia', Math.min(2, militia.count)));
      }
    }
    const here = state.planets[f.location];
    if (!here) continue;
    let best: Planet | null = null;
    let bestD = Infinity;
    for (const p of Object.values(state.planets)) {
      if (p.owner === ai || !capturable(p)) continue;
      if (!canTraverse(state, ai, p.owner)) continue; // a peace-locked target — leave it be
      const dd = d(here.position, p.position);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
    }
    if (best) out.push(moveFleet(ai, f.id, best.id));
  }
  // War when the race is being LOST (self-play M4 finding): a passive bot loses the
  // score race to whoever expands faster — every bot-vs-bot match ended as a 2-day
  // race with zero battles, and the military (and combat factions) never played. So
  // a bot falling a planet's worth (≥ 50) behind the score leader — or merely behind
  // once no capturable neutral is left — declares war on that leader; the expansion
  // loop above then targets war territory (traversable/capturable) and contested
  // provinces swing back. A bot that IS ahead stays quiet — it wins by holding.
  // Declared only from a clean 'peace' stance: pacts/alliances are never betrayed,
  // and favour-driven war (botDiplomacyModule) keeps working on top unchanged.
  if (!defensive) {
    const scoreOf = (who: string): number =>
      Object.values(state.planets).reduce(
        (s, p) => (p.owner === who ? s + provinceScore(data, p) : s),
        0,
      );
    const mine = scoreOf(ai);
    let leader: string | null = null;
    let leaderScore = -1;
    for (const pid of Object.keys(state.players)) {
      if (pid === ai || state.players[pid]?.status !== 'active') continue;
      const sc = scoreOf(pid);
      if (sc > leaderScore) {
        leaderScore = sc;
        leader = pid;
      }
    }
    const neutralLeft = Object.values(state.planets).some((p) => p.owner === null && capturable(p));
    const losingRace = leaderScore - mine >= 50 || (!neutralLeft && leaderScore >= mine);
    if (leader && losingRace && getStance(state, ai, leader) === 'peace') {
      out.push(declareWar(ai, leader));
    }
  }
  // Build + launch from this AI's home base (its first developed owned world).
  const pl = state.players[ai];
  if (base && pl) {
    // Keep the lights on first: a bot whose energy/food NET flow is negative (or already
    // in arrears) raises a plant/farm before anything else — brownouts halve its economy.
    const flow = netIncome(state, ai);
    const has = (b: string): boolean =>
      Object.values(state.planets).some(
        (p) => p.owner === ai && p.buildings.some((x) => x.type === b),
      );
    for (const [need, b] of [
      ['energy', 'power_plant'],
      ['food', 'farm'],
    ] as const) {
      if ((flow[need] ?? 0) >= 0 && !(pl.arrears ?? []).includes(need)) continue;
      if (has(b)) continue;
      const cost = data.buildings[b]?.cost ?? {};
      if (Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60)) {
        out.push(buildBuilding(ai, base.id, b));
      }
    }
    // Economy chain (self-play M4: mine/refinery/tax office were DEAD content for the
    // bot — it bought all its metal on the market): raise the first missing credit
    // engine at the home base (refinery → tax office), and put a metal mine on each
    // captured PRIZE world — one link at a time, only when comfortably affordable,
    // and never over the same build already queued (no reject spam).
    const pendingBuild = (planetId: string, b: string): boolean =>
      state.scheduled.some((e) => {
        if (e.type !== 'construction.complete') return false;
        const q = e.payload as { kind?: string; planetId?: string; building?: string };
        return q.kind === 'building' && q.planetId === planetId && q.building === b;
      });
    const affordable = (b: string): boolean => {
      const cost = data.buildings[b]?.cost ?? {};
      return Object.keys(cost).every((r) => (pl.resources[r] ?? 0) >= (cost[r] ?? 0) + 60);
    };
    // ECON-7: fabricator joins the chain — microelectronics gates warships now
    // (cruiser/siege cost micro), so a bot without a fab eventually can't build a
    // fleet. Built once the credit/tax engine is up; keeps micro produced AND spent.
    for (const b of ['refinery', 'tax_office', 'fabricator'] as const) {
      if (has(b)) continue;
      if (affordable(b) && !pendingBuild(base.id, b)) out.push(buildBuilding(ai, base.id, b));
      break; // one link at a time — wait out the current one either way
    }
    for (const p of Object.values(state.planets)) {
      if (p.owner !== ai || p.kind !== 'planet' || p.id === base.id) continue;
      if (p.buildings.some((x) => x.type === 'mine') || pendingBuild(p.id, 'mine')) continue;
      if (!affordable('mine')) break;
      out.push(buildBuilding(ai, p.id, 'mine'));
      break; // spread the economy one world per tick
    }
    // Ship production is CAPPED by the fleet count (self-play M4: endless building
    // fed an ever-growing swarm — hundreds of fleets by mid-match). Enough fleets
    // out ⇒ the metal flows to economy/garrisons instead.
    const aiFleets = Object.values(state.fleets).filter((f) => f.owner === ai).length;
    if (
      aiFleets < (warFooting ? 8 : 4) &&
      (pl.resources.metal ?? 0) > 220 &&
      (pl.resources.credits ?? 0) > 120 &&
      (pl.resources.microelectronics ?? 0) >= 3 // ECON-7: warships need the hi-tech good
    ) {
      out.push(buildUnit(ai, base.id, 'cruiser', 1));
    }
    // Wartime posture (self-play M4: wars were free walk-in raids — the leader had no
    // garrisons, so whoever attacked always came back and won): at war the bot
    // (a) garrisons its undefended PRIZE worlds with militia — a garrisoned planet
    // can't be walk-in captured, it takes a ground assault; the 10-point provinces
    // stay an open raid zone by design; (b) adds fast scouts to the build mix
    // (capture runners for that raid zone); (c) fields more fleets — and a launched
    // fleet lifts home-built militia aboard as landing troops (fleet.launch), which
    // is exactly what lets it assault a garrisoned world back.
    if (warFooting) {
      let garrisonOrders = 0;
      for (const p of Object.values(state.planets)) {
        if (garrisonOrders >= 2 || (pl.resources.metal ?? 0) < 90) break;
        if (p.owner !== ai || p.kind !== 'planet') continue;
        if (p.garrison.some((s) => s.count > 0)) continue;
        out.push(buildUnit(ai, p.id, 'militia', 2));
        garrisonOrders += 1;
      }
      // A landing stock at home: strike groups lift militia on sortie (above), so
      // the base keeps a few spare beyond its seeded defenders.
      const baseMilitia = base.garrison
        .filter((s) => s.unit === 'militia')
        .reduce((n, s) => n + s.count, 0);
      if (baseMilitia < 4 && (pl.resources.metal ?? 0) > 120) {
        out.push(buildUnit(ai, base.id, 'militia', 2));
      }
      if (aiFleets < 8 && (pl.resources.metal ?? 0) > 140) {
        out.push(buildUnit(ai, base.id, 'scout', 1));
      }
    }
    // (marine retired: the AI no longer cheap-builds a ground trooper. Its home keeps its
    //  seeded infantry garrison + orbital-AA building for defence; mobile ground via divisions.)
    const baseHasShip = base.garrison.some((st) => isShipUnit(st.unit));
    if (aiFleets < (warFooting ? 4 : 2) && baseHasShip) out.push(launchFleet(ai, base.id));
  }
  // Trade on the session market: a passive bot liquidates the surplus goods it never
  // uses (food/energy/microelectronics) into the credits it always needs, and — when
  // flush — bids for the metal it burns fastest. One open lot per resource so it doesn't
  // spam. Embargo needs no check here: the book is anonymous and market.take rejects a
  // soured player from filling the bot's lots (botEmbargoes), so the bot simply won't
  // trade with anyone it has soured on.
  if (pl) {
    const lots = marketLots(state);
    const hasLot = (side: MarketSide, resource: string): boolean =>
      lots.some((l) => l.owner === ai && l.side === side && l.resource === resource);
    for (const good of ['food', 'energy', 'microelectronics']) {
      const have = pl.resources[good] ?? 0;
      const reserve = good === 'microelectronics' ? 40 : 120; // the working stock it keeps
      if (have >= reserve + 40 && !hasLot('sell', good))
        out.push(marketList(ai, 'sell', good, Math.floor((have - reserve) / 2), 2));
    }
    if (
      (pl.resources.metal ?? 0) < 80 &&
      (pl.resources.credits ?? 0) > 300 &&
      !hasLot('buy', 'metal')
    ) {
      out.push(marketList(ai, 'buy', 'metal', 30, 3));
    }
  }
  return out;
}
