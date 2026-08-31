/**
 * Match setup — seat/setup config types and `newGame`, the pure builder that
 * turns a `SetupConfig` into a playable `GameState`. Extracted from `game.ts`
 * (REFP-20): depends on `map.ts`/`formations.ts`/`botFavour.ts`/`heroes.ts`/
 * `ships.ts`/`economy.ts` (all already extracted) + `prototypeData.ts` + core
 * shared-core helpers. `player`/`fleet`/`ARCHETYPE_OF_GRADE` were private
 * `game.ts` helpers used only by `newGame` — moved here with it rather than
 * exported from `game.ts` for a single caller. `game.ts` imports the public
 * surface for internal use (`main.ts`'s menu flow, netserver seating) and
 * re-exports it unchanged.
 */
import {
  createInitialState,
  pairKey,
  type DiplomaticStance,
  type GameState,
  type Hero,
  type Planet,
  type Player,
  type Fleet,
} from '../../packages/shared-core/src/index';
import { data } from './prototypeData';
import { SECTOR_TYPES, MAP, START_CANDIDATES } from './map';
import { FAVOUR_BASE } from './botFavour';
import { DEFAULT_HEROES, type HeroGrade, type HeroLoadout } from './heroes';
import { DEFAULT_SHIP_LOADOUTS, type ShipLoadout } from './ships';
import { hpOfLevel } from './economy';

/** Menu grade → core hero archetype: the four default roster heroes ARE the four
 *  catalog archetypes (Командир/Разрушитель/Авангард/Страж), so the grade doubles as
 *  the archetype key when the roster rides into the match as core hero instances. */
const ARCHETYPE_OF_GRADE: Record<HeroGrade, string> = {
  main: 'commander',
  legendary: 'ravager',
  rare: 'vanguard',
  common: 'warden',
};

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
  /** The player's hero roster (up to 3 loadouts), composed in the main menu. Absent →
   *  DEFAULT_HEROES. In-match instances / capital / respawn land in a later phase. */
  heroes?: HeroLoadout[];
  /** The player's ship blueprints — a module loadout per hull class (the "Верфь"
   *  designer). Frozen at session start (GDD §2). Absent → DEFAULT_SHIP_LOADOUTS. */
  ships?: ShipLoadout[];
  /** Meta-progression grant for the HUMAN seat (prototype/src/meta.ts metaGrant),
   *  snapshotted at match start like scientists: hidden techs land as
   *  `completed`, the council starts higher, the treasury opens fatter. Earned by
   *  play only — never sold (main-menu.md §5). Absent = a fresh commander. */
  meta?: { tech: string[]; scientistLevel: number; resourceMult: number };
}

/** Default solo skirmish: you (p1) vs one AI (p2), at two of the start candidates. */
export const DEFAULT_SETUP: SetupConfig = {
  seats: [
    { id: 'p1', name: 'Azure Compact', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
    { id: 'p2', name: 'Crimson Hegemony', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
  ],
};

/**
 * Что раздаёт переменная `TEAMS` прото-хосту — РАСКЛАД КРЕСЕЛ, а не «правила партии».
 *
 * Пять командных форматов (PVE-1.1) описывают ЧИСЛО сторон и людей в них; `ffa` — стол
 * без сторон; `pve` — свой расклад, двое людей против одного сильного бота. Последний
 * назван по цели, а не по форме, и это единственная запись такого рода: волны Роя — это
 * НЕ здесь, а `modeId: 'pve_waves'` из `data/modes.json` (PVE-0.1/4). Две разные вещи с
 * похожим именем: тут «кто за столом», там «во что играем».
 */
export type NetworkMatchMode = 'ffa' | '1v1' | '2v2' | '3v3' | '4v4' | '5v5' | 'pve';

/** Форматы со сторонами: половина кресел за A, половина за B. */
const TEAM_MODES = ['1v1', '2v2', '3v3', '4v4', '5v5'] as const;
type TeamMatchMode = (typeof TEAM_MODES)[number];

/**
 * Стартовые миры по формату, индексами в `START_CANDIDATES`.
 *
 * Каталог обходит периметр ПО ЧАСОВОЙ СТРЕЛКЕ, поэтому соседние индексы — соседние
 * миры, а сдвиг на половину круга (+5 из десяти) — противоположная сторона доски.
 * Отсюда правило: сторона занимает дугу подряд, а вторая — диаметрально ей отвечающую.
 * Союзники стартуют рядом (иначе союз — только подпись, помогать некому), соперники
 * далеко. `2v2` и `5v5` оставлены ровно теми, что были: их расклад уже роздан игрокам.
 */
const TEAM_STARTS: Record<TeamMatchMode, number[]> = {
  '1v1': [9, 4],
  '2v2': [9, 8, 3, 4],
  '3v3': [9, 8, 7, 4, 3, 2],
  '4v4': [9, 8, 7, 6, 4, 3, 2, 1],
  '5v5': START_CANDIDATES.map((_, i) => i),
};

const NETWORK_HOUSES = [
  { name: 'Azure Compact', faction: 'azure' },
  { name: 'Crimson Hegemony', faction: 'crimson' },
  { name: 'Amber Concord', faction: 'amber' },
  { name: 'Violet Ascendancy', faction: 'violet' },
] as const;

const NETWORK_MODES: readonly NetworkMatchMode[] = ['ffa', ...TEAM_MODES, 'pve'];

export function parseNetworkMatchMode(value: string | undefined): NetworkMatchMode {
  // Пусто — это «не задано», а не «неизвестный режим»: в `.env` докер-компоуза
  // незаполненная переменная приезжает ПУСТОЙ СТРОКОЙ, и хост отказывался стартовать
  // там, где `deploy/README.md` обещает FFA. Незаданное значение никогда не должно
  // ронять процесс — падать положено на ОШИБОЧНОМ, а его видно по тексту.
  const raw = (value ?? '').trim();
  if (raw === '') return 'ffa';
  const mode = NETWORK_MODES.find((m) => m === raw);
  if (mode) return mode;
  throw new Error(`TEAMS must be one of ${NETWORK_MODES.join(', ')}, got: ${raw}`);
}

/** Claimable human chairs for the prototype host. Empty chairs are driven by server AI. */
export function networkSeats(mode: NetworkMatchMode = 'ffa'): SeatConfig[] {
  if (mode === 'pve') {
    // PvE: 2 human players (team A) vs 1 strong AI (team B).
    // Players start near each other in the centre; the AI starts at the edge.
    return [
      { id: 'p1', name: 'Azure Compact', faction: 'azure', start: START_CANDIDATES[0]!, ai: false, team: 'A' },
      { id: 'p2', name: 'Amber Concord', faction: 'amber', start: START_CANDIDATES[1]!, ai: false, team: 'A' },
      { id: 'p3', name: 'Crimson Hegemony', faction: 'crimson', start: START_CANDIDATES[2]!, ai: true, team: 'B' },
    ];
  }
  const teamStarts = (TEAM_STARTS as Partial<Record<NetworkMatchMode, number[]>>)[mode];
  const startIndexes = teamStarts ?? START_CANDIDATES.map((_, i) => i);
  // Половина мест — сторона A, половина — B; у `ffa` сторон нет вовсе.
  const half = startIndexes.length / 2;
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
      ...(teamStarts ? { team: i < half ? 'A' : 'B' } : {}),
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
    // so the homeworld isn't a free walk-in. Beyond it, ground forces are built like any
    // other unit and travel as a fleet's cargo (armyModule) — H4-REVERT.
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
        // Имя МЕСТА — только главному (позывной игрока / дом в соло). Ростерному
        // герою имя собирает рендер из архетипа: текст в состоянии не локализуется
        // (AUD-13), а `loadout.name` здесь и был ключом роты, уехавшим в состояние.
        ...(main ? { name: seat.name } : {}),
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
  const heroRoster: Record<string, HeroLoadout[]> = {};
  const shipLoadouts: Record<string, ShipLoadout[]> = {};
  const capital: Record<string, string> = {};
  for (const seat of setup.seats) {
    heroRoster[seat.id] = !seat.ai && setup.heroes ? setup.heroes : DEFAULT_HEROES;
    shipLoadouts[seat.id] = !seat.ai && setup.ships ? setup.ships : DEFAULT_SHIP_LOADOUTS;
    capital[seat.id] = seat.start; // capital defaults to the homeworld; re-designatable in-match
  }
  // `heroRoster` / `shipLoadouts` / `approval` are prototype-only state (preserved by
  // deepClone); cast past GameState's shape. The market's own keys are NOT seeded here
  // anymore: с CONV-9 книга — это ядерный `state.market`, и модуль заводит её сам при
  // первой заявке (`??= []`), как и до сведения делало ядро.
  return {
    ...base,
    players,
    planets,
    fleets,
    heroes,
    diplomacy,
    approval,
    heroRoster,
    shipLoadouts,
    capital,
  } as GameState;
}
