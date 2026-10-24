/** Progress facts for the bot-free duel-1 lesson. Count hulls, not fleet records:
 * construction can join an existing fleet. Only the named destination counts. */
import { heroCooldownKey, type GameData, type GameState } from '../packages/shared-core/src/index';

export const GUIDE_TARGET = 'shale';
export const GUIDE_MAP = 'duel-1';
export const GUIDE_HULL = 'frigate';
export const GUIDE_TECH = 'frigate_design';

export function guideShipCount(s: GameState, me: string): number {
  return Object.values(s.fleets)
    .filter((f) => f.owner === me)
    .reduce(
      (n, f) => n + f.units.reduce((sum, u) => sum + (u.unit === GUIDE_HULL ? u.count : 0), 0),
      0,
    );
}

export function guideFleet(s: GameState, me: string) {
  return Object.values(s.fleets).find(
    (f) => f.owner === me && f.units.some((u) => u.unit === GUIDE_HULL && u.count > 0),
  );
}

export function guideMineLevel(s: GameState, home: string): number {
  return s.planets[home]?.buildings.find((b) => b.type === 'mine')?.level ?? 0;
}

export function guideCourseSet(s: GameState, me: string): boolean {
  const fleet = guideFleet(s, me);
  return (
    !!fleet &&
    (fleet.location === GUIDE_TARGET ||
      (fleet.movement?.destination ?? fleet.movement?.to) === GUIDE_TARGET)
  );
}

/* ---------------------------------------------------------------------------------------
 * The second half of the lesson: the operation against a garrisoned world.
 *
 * One chain teaches every tool it needs, in the order a real assault needs it: the hero
 * trades its engine for a cargo bay (the hero hull has no hold of its own, and both utility
 * bays start full, so the refit is a real swap), deploys, the
 * guild market is visited once each way, barracks train militia, a spaceport launches a
 * bomber, both go aboard the hero, and the hero flies to the world, strikes its garrison
 * from the hold, casts Rally and lands. Shuttles cannot reach the neighbouring worlds
 * from home (their strike radius is shorter than the lane), which is why the bomber rides
 * in the hold rather than striking from the spaceport.
 * ------------------------------------------------------------------------------------- */

/** The garrisoned world the operation takes. */
export const GUIDE_ASSAULT = 'world_1';
/** What the hero's two utility bays hold at the start, which of them leaves, and what
 *  replaces it. */
export const GUIDE_HERO_START_MODULES = ['ion_engine', 'repair_bay'] as const;
export const GUIDE_HERO_START_MODULE = 'ion_engine';
export const GUIDE_HERO_MODULE = 'cargo_bay';
export const GUIDE_TROOP = 'militia';
/** Militia to train and to load. Four take the garrison even without the strike and Rally,
 *  so a player who skipped a chapter still lands; the hold has room for them and the bomber. */
export const GUIDE_TROOPS = 4;
export const GUIDE_WING = 'bomber';
export const GUIDE_ABILITY = 'rally';
/** Technologies the lesson hands out so that every chapter is a task, not a research. */
export const GUIDE_LESSON_TECHS = [
  'signal_corps',
  'flagship_command',
  'militia_training',
  'spaceport_infrastructure',
  'interceptor_design',
  'bomber_design',
] as const;
/** The trade guild: the session market needs a second party, and the lesson has no rival. */
export const GUIDE_GUILD = 'npc-guild';
export const GUIDE_GUILD_NAME = 'Trade Guild';
/** One lot each way: buying from an ask and selling into a bid are both `market.take`. The
 *  bid is on metal, the tab the market opens on; the ask needs one tab switch. */
export const GUIDE_LOT_BUY = { resource: 'microelectronics', amount: 20, price: 5 } as const;
export const GUIDE_LOT_SELL = { resource: 'metal', amount: 30, price: 4 } as const;

/**
 * The lesson world: the bot-free duel-1 start plus what the operation needs. Pure — the
 * input state is not touched. The guild is an inhabitant that is already out of the race
 * (`defeated`): it never plays, never scores and never shows up as a rival, but it owns
 * the two lots, because a lot whose owner does not exist cannot be taken.
 */
export function guideScenario(s: GameState, me: string): GameState {
  const next = structuredClone(s);
  const player = next.players[me];
  if (!player) return next;
  const done = player.technologies?.completed ?? [];
  player.technologies = {
    ...player.technologies,
    completed: [...new Set([...done, ...GUIDE_LESSON_TECHS])],
  };
  const hero = guideHero(next, me);
  if (hero) hero.modules = [...GUIDE_HERO_START_MODULES];
  next.players[GUIDE_GUILD] = {
    id: GUIDE_GUILD,
    name: GUIDE_GUILD_NAME,
    faction: 'violet',
    status: 'defeated',
    npc: 'neutral',
    // Empty: the goods and credits of both lots are held by the lots themselves, as the
    // escrow of `market.list` would hold them.
    resources: { credits: 0, metal: 0, food: 0, energy: 0, microelectronics: 0 },
  };
  const seq = next.marketSeq ?? 0;
  next.market = [
    ...(next.market ?? []),
    { id: `market:${seq + 1}`, side: 'sell', owner: GUIDE_GUILD, ...GUIDE_LOT_BUY },
    { id: `market:${seq + 2}`, side: 'buy', owner: GUIDE_GUILD, ...GUIDE_LOT_SELL },
  ];
  next.marketSeq = seq + 2;
  return next;
}

/** The guild lot of the given side, while it is still on the book. */
export function guideLot(s: GameState, side: 'sell' | 'buy') {
  return (s.market ?? []).find((o) => o.owner === GUIDE_GUILD && o.side === side);
}

/** The main hero — the one the lesson refits, deploys and casts with. */
export function guideHero(s: GameState, me: string) {
  return Object.values(s.heroes ?? {}).find((h) => h.owner === me && h.grade === 'main');
}

export function guideHeroModules(s: GameState, me: string): readonly string[] {
  return guideHero(s, me)?.modules ?? [];
}

/** The hero's ship on the map, while it is deployed. */
export function guideHeroFleet(s: GameState, me: string) {
  const id = guideHero(s, me)?.fleetId;
  const fleet = id ? s.fleets[id] : undefined;
  return fleet?.owner === me ? fleet : undefined;
}

export function guideBuilt(s: GameState, home: string, building: string): boolean {
  return s.planets[home]?.buildings.some((b) => b.type === building) === true;
}

/** What the player ordered at home and is not finished yet: the waiting queue plus the
 *  running build (its completion event), as `{ building | unit, count }` entries. */
function pendingAt(s: GameState, home: string, me: string) {
  const queued = (s.planets[home]?.buildQueue ?? []).filter((q) => q.playerId === me);
  const running = s.scheduled
    .filter((e) => e.type === 'construction.complete')
    .map(
      (e) =>
        e.payload as {
          planetId?: string;
          playerId?: string;
          building?: string;
          unit?: string;
          count?: number;
        },
    )
    .filter((q) => q.planetId === home && q.playerId === me);
  return [...queued, ...running];
}

/** The building stands at home or is ordered there: the order step is done. */
export function guideBuildingOrdered(
  s: GameState,
  home: string,
  me: string,
  building: string,
): boolean {
  return (
    guideBuilt(s, home, building) || pendingAt(s, home, me).some((q) => q.building === building)
  );
}

/** Units of a kind on order at home, not yet out of the yard. */
export function guideUnitsOrdered(s: GameState, home: string, me: string, unit: string): number {
  return pendingAt(s, home, me).reduce((n, q) => n + (q.unit === unit ? (q.count ?? 1) : 0), 0);
}

/** Militia standing in the home garrison (troops already aboard do not count twice). */
export function guideTroopsHome(s: GameState, home: string): number {
  return (s.planets[home]?.garrison ?? []).reduce(
    (n, u) => n + (u.unit === GUIDE_TROOP ? u.count : 0),
    0,
  );
}

const wingsIn = (hangar: readonly { units: readonly { unit: string; count: number }[] }[] = []) =>
  hangar.reduce(
    (n, q) => n + q.units.reduce((m, u) => m + (u.unit === GUIDE_WING ? u.count : 0), 0),
    0,
  );

export function guideWingsHome(s: GameState, home: string): number {
  return wingsIn(s.planets[home]?.hangar);
}

export function guideWingsAboard(s: GameState, me: string): number {
  return wingsIn(guideHeroFleet(s, me)?.hangar);
}

/** Militia in the hero's hold; a lift still running (the claim) is not aboard yet. */
export function guideTroopsAboard(s: GameState, me: string): number {
  return (guideHeroFleet(s, me)?.landing ?? []).reduce(
    (n, u) => n + (u.unit === GUIDE_TROOP ? u.count : 0),
    0,
  );
}

/** Militia lifting into the hero's hold right now: the hour-long claims of `army.load`. */
export function guideTroopsLoading(s: GameState, me: string): number {
  return (guideHeroFleet(s, me)?.loading ?? []).reduce(
    (n, c) => n + (c.unit === GUIDE_TROOP ? c.count : 0),
    0,
  );
}

/** The hero ship is ordered to the assault world, or already orbits it. */
export function guideHeroCourseSet(s: GameState, me: string): boolean {
  const fleet = guideHeroFleet(s, me);
  return (
    !!fleet &&
    (fleet.location === GUIDE_ASSAULT ||
      (fleet.movement?.destination ?? fleet.movement?.to) === GUIDE_ASSAULT)
  );
}

export function guideHeroArrived(s: GameState, me: string): boolean {
  const fleet = guideHeroFleet(s, me);
  return !!fleet && fleet.location === GUIDE_ASSAULT && !fleet.movement;
}

/** The bomber has left the hold for the assault world (the flight is in the air). */
export function guideStrikeFlying(s: GameState, me: string): boolean {
  return (s.strikes ?? []).some(
    (st) => st.owner === me && st.target.kind === 'planet' && st.target.id === GUIDE_ASSAULT,
  );
}

/** The landing is under way: the hero ship descends, the ground battle is on, or the world
 *  is already taken. */
export function guideAssaultStarted(s: GameState, me: string): boolean {
  return (
    s.planets[GUIDE_ASSAULT]?.owner === me ||
    guideHeroFleet(s, me)?.assaultLanding?.planetId === GUIDE_ASSAULT ||
    Object.values(s.battles).some((b) => b.phase === 'ground' && b.location === GUIDE_ASSAULT)
  );
}

/** Rally is cooling down: it was cast. Read through the core's own ledger key. */
export function guideAbilityCast(s: GameState, me: string, data: GameData): boolean {
  const type = data.heroAbilities[GUIDE_ABILITY]?.type;
  const until = type ? guideHero(s, me)?.cooldowns[heroCooldownKey(type)] : undefined;
  return until !== undefined && until > s.time;
}
