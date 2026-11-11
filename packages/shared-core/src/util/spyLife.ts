import { hoursToMs } from '../action/types';
import type { HandlerContext } from '../kernel/module';
import type { GameState, PlanetId, PlayerId, Spy, SpyOp } from '../state/gameState';
import { coalitionOf } from '../state/coalition';
import { getStance } from '../state/diplomacy';
import { spyHome, spyJourneyMs, spyPath, spyRoster, BASE_SPY_AGENTS } from '../state/spyTravel';

/**
 * The life of a named spy (SPY-23, owner's resolution 2026-11-10) — the espionage module's
 * own helpers, not a module: where a spy is, how it gets somewhere, how it comes home.
 *
 * Every order a spy takes gets a fresh `mission` id, and every scheduled step of it carries
 * that id: a step whose order was cancelled, or whose spy was replaced, finds nothing to do.
 */

/** What every scheduled step of a spy carries. */
export interface SpyStep {
  spy: PlayerId;
  spyId: number;
  mission: number;
}

/** How long finding a replacement for a killed agent takes, game-hours. */
export const AGENT_RECRUIT_HOURS = 24;
/** A cap on the network the `espionage.agents` pipeline may ask for (fail-secure: state
 *  must not grow without limit). */
const MAX_NETWORK = 8;

/** A hook result, or its base when the pipeline broke (non-finite) — a broken
 *  pipeline must not silently switch a rule off. */
export function finiteOr(raw: number, base: number): number {
  return Number.isFinite(raw) ? raw : base;
}

/** The size of `playerId`'s own network: the `espionage.agents` pipeline over the base,
 *  floored and clamped to [0, MAX_NETWORK]. Turned agents (SPY-18) come on top of it. */
export function networkSize(h: HandlerContext, playerId: PlayerId): number {
  const raw = h.hook<number>('espionage.agents', BASE_SPY_AGENTS, { playerId });
  return Number.isFinite(raw)
    ? Math.min(MAX_NETWORK, Math.max(0, Math.floor(raw)))
    : BASE_SPY_AGENTS;
}

/** `playerId`'s registry, created on first use from the starting network and grown to the
 *  network's current size (a new spy starts at home). A shrunk network keeps its spies. */
export function rosterOf(h: HandlerContext, playerId: PlayerId): Spy[] {
  const size = networkSize(h, playerId);
  const all = (h.state.spies ??= {});
  const list = (all[playerId] ??= spyRoster(h.state, playerId, size).map((s) => ({ ...s })));
  const home = spyHome(h.state, playerId);
  while (list.filter((s) => s.turnedUntil === undefined).length < size) {
    const id = Math.max(0, ...list.map((s) => s.id)) + 1;
    list.push({
      id,
      gen: 1,
      state: home ? 'rest' : 'hidden',
      location: home ?? list[0]?.location ?? '',
    });
  }
  return list;
}

/** The spy `spyId` of `playerId`, if their registry holds it. */
export function findSpy(state: GameState, playerId: PlayerId, spyId: number): Spy | undefined {
  return state.spies?.[playerId]?.find((s) => s.id === spyId);
}

/** The spy a scheduled step belongs to, if that step's order is still the spy's current one. */
export function stepSpy(state: GameState, step: Partial<SpyStep>): Spy | undefined {
  if (typeof step.spy !== 'string' || typeof step.spyId !== 'number') return undefined; // older saves
  const spy = findSpy(state, step.spy, step.spyId);
  return spy && spy.mission === step.mission ? spy : undefined;
}

/** A fresh order id among `playerId`'s spies. */
export function nextMission(state: GameState, playerId: PlayerId): number {
  return Math.max(0, ...(state.spies?.[playerId] ?? []).map((s) => s.mission ?? 0)) + 1;
}

/** Forget what a spy was doing: the journey, the deed, the post. */
function clearOrder(spy: Spy): void {
  delete spy.from;
  delete spy.departedAt;
  delete spy.arrivesAt;
  delete spy.op;
  delete spy.posted;
  delete spy.postedAt;
}

/** How long `spy` of `owner` flies `from` → `to` (ms), through the `espionage.speed` pipeline
 *  (a spy's level, technologies); `null` — no route. */
export function journeyMs(
  h: HandlerContext,
  owner: PlayerId,
  spy: Spy,
  from: PlanetId,
  to: PlanetId,
): number | null {
  const path = spyPath(h.state, owner, from, to);
  if (!path) return null;
  const factor = finiteOr(
    h.hook<number>('espionage.speed', 1, { playerId: owner, spyId: spy.id }),
    1,
  );
  return spyJourneyMs(h.ctx, path.length, factor);
}

/**
 * Put `spy` on the way to `to` (`kind` — out on an order, or home), `ms` from now. A journey
 * of no length ends at once — `arrive` runs before this returns — so a spy that already
 * stands where it is sent starts there without a scheduled step.
 */
export function setOff(
  h: HandlerContext,
  owner: PlayerId,
  spy: Spy,
  from: PlanetId,
  to: PlanetId,
  kind: 'travel' | 'return',
  ms: number,
  arrive: (h: HandlerContext, owner: PlayerId, spy: Spy) => void,
): void {
  const now = h.ctx.now;
  spy.state = kind;
  spy.from = from;
  spy.location = to;
  spy.departedAt = now;
  spy.arrivesAt = now + ms;
  if (ms <= 0) {
    arrive(h, owner, spy);
    return;
  }
  h.schedule(spy.arrivesAt, 'espionage.arrive', {
    spy: owner,
    spyId: spy.id,
    mission: spy.mission!,
  } satisfies SpyStep);
}

/** Send `spy` home to the capital from `from` (plus `extraMs` already owed on the way back —
 *  a spy called off mid-journey first turns back). No capital, or no way to it → it lies
 *  low where it is (`hidden`) until there is one. */
export function goHome(
  h: HandlerContext,
  owner: PlayerId,
  spy: Spy,
  arrive: (h: HandlerContext, owner: PlayerId, spy: Spy) => void,
  from: PlanetId = spy.location,
  extraMs = 0,
): void {
  clearOrder(spy);
  spy.mission = nextMission(h.state, owner);
  const home = spyHome(h.state, owner);
  const ms = home === null ? null : journeyMs(h, owner, spy, from, home);
  if (home === null || ms === null) {
    spy.state = 'hidden';
    spy.location = from;
    return;
  }
  setOff(h, owner, spy, from, home, 'return', ms + extraMs, arrive);
}

/** A spy at the end of its way home: in the capital it rests (→ `true`); the capital moved
 *  meanwhile → on to the new one; none left → it lies low. */
export function reachHome(
  h: HandlerContext,
  owner: PlayerId,
  spy: Spy,
  arrive: (h: HandlerContext, owner: PlayerId, spy: Spy) => void,
): boolean {
  if (spyHome(h.state, owner) === spy.location) {
    clearOrder(spy);
    spy.state = 'rest';
    return true;
  }
  goHome(h, owner, spy, arrive);
  return false;
}

/** A killed (or turned) spy: its own slot is refilled in `AGENT_RECRUIT_HOURS` by a new spy
 *  of the next generation; a turned enemy agent serving `owner` is simply gone. */
export function loseSpy(h: HandlerContext, owner: PlayerId, spy: Spy): void {
  const list = h.state.spies?.[owner];
  if (!list) return;
  if (spy.turnedUntil !== undefined) {
    h.state.spies![owner] = list.filter((s) => s !== spy);
    return;
  }
  clearOrder(spy);
  spy.mission = nextMission(h.state, owner);
  spy.state = 'recruit';
  spy.location = spyHome(h.state, owner) ?? spy.location;
  spy.departedAt = h.ctx.now;
  spy.arrivesAt = h.ctx.now + hoursToMs(h.ctx, AGENT_RECRUIT_HOURS);
  h.schedule(spy.arrivesAt, 'espionage.recruited', {
    spy: owner,
    spyId: spy.id,
    mission: spy.mission,
  } satisfies SpyStep);
}

/** The replacement of a lost spy reports: a fresh spy (next generation, no experience) in
 *  the capital — or lying low, if there is none. */
export function recruited(h: HandlerContext, owner: PlayerId, spy: Spy): void {
  clearOrder(spy);
  spy.gen += 1;
  delete spy.xp;
  const home = spyHome(h.state, owner);
  spy.state = home ? 'rest' : 'hidden';
  spy.location = home ?? spy.location;
}

/** A turned enemy agent joins `catcher` for `hours`: one more spy, at home (SPY-18). */
export function enlistTurned(h: HandlerContext, catcher: PlayerId, hours: number): void {
  const list = rosterOf(h, catcher);
  const home = spyHome(h.state, catcher);
  list.push({
    id: Math.max(0, ...list.map((s) => s.id)) + 1,
    gen: 1,
    state: home ? 'rest' : 'hidden',
    location: home ?? list[0]?.location ?? '',
    turnedUntil: h.ctx.now + hoursToMs(h.ctx, hours),
  });
}

/**
 * Bring `owner`'s idle spies in line with the capital (owner's resolution 2026-11-10): one
 * that lies low heads for a capital as soon as there is one; one resting in a former capital
 * moves to the new one; with no capital, those at rest lie low. Busy spies carry on — they
 * learn on their way home.
 */
export function settleHome(
  h: HandlerContext,
  owner: PlayerId,
  arrive: (h: HandlerContext, owner: PlayerId, spy: Spy) => void,
): void {
  const list = h.state.spies?.[owner];
  if (!list) return;
  const home = spyHome(h.state, owner);
  for (const spy of list) {
    if (spy.state === 'rest' && home === null) spy.state = 'hidden';
    else if (
      (spy.state === 'hidden' || spy.state === 'rest') &&
      home !== null &&
      spy.location !== home
    ) {
      goHome(h, owner, spy, arrive);
    } else if (spy.state === 'hidden' && home !== null) {
      spy.state = 'rest';
    }
  }
}

/** Is `spy` free for an order: at rest in the capital or waiting on a world. */
export function isFree(spy: Spy): boolean {
  return spy.state === 'rest' || spy.state === 'wait';
}

/** Is `spy` busy on `planetId` — on its way there, waiting there or working there. */
export function onWorld(spy: Spy, planetId: PlanetId): boolean {
  return (
    spy.location === planetId &&
    (spy.state === 'travel' || spy.state === 'wait' || spy.state === 'work')
  );
}

/** Is `op` an aggressive operation (everything but guarding and moving). */
export function aggressive(op: SpyOp | undefined): boolean {
  return op !== undefined && op !== 'counter' && op !== 'relocate';
}

/** Posted counter-intelligence spies on `planetId`, by owner — owners in sorted order and
 *  spies by id, so every walk over them is deterministic. A posted recon spy (SPY-13) is no
 *  guard. */
export function postedOn(state: GameState, planetId: string): { owner: string; spy: Spy }[] {
  const out: { owner: string; spy: Spy }[] = [];
  for (const owner of Object.keys(state.spies ?? {}).sort()) {
    for (const spy of [...state.spies![owner]!].sort((a, b) => a.id - b.id)) {
      if (spy.state === 'work' && spy.posted && spy.op === 'counter' && spy.location === planetId) {
        out.push({ owner, spy });
      }
    }
  }
  return out;
}

/** The counter-intelligence watching `spy`'s owner on `planetId`: posted guards whose owner
 *  is neither the spy's owner nor their ally. */
export function guardsAgainst(
  state: GameState,
  planetId: string,
  spy: string,
): { owner: string; spyId: number }[] {
  return postedOn(state, planetId)
    .filter(({ owner }) => owner !== spy && getStance(state, owner, spy) !== 'alliance')
    .map(({ owner, spy: guard }) => ({ owner, spyId: guard.id }));
}

/** SPY-16: an exposed aggressive mission is public news — who caught whose spy and where,
 *  nothing about the operation (`espionage.exposed`; the server broadcasts it to all). */
export function exposed(h: HandlerContext, victim: string, spy: string, planetId: string): void {
  h.emit('espionage.exposed', { a: victim, b: spy, planetId });
}

/** Close the intel a posted recon spy of `mission` held open (SPY-13). */
export function closeIntel(h: HandlerContext, spy: string, mission: number | undefined): void {
  const intel = h.state.intel;
  const mine = intel?.[spy];
  if (!intel || !mine || mission === undefined) return;
  const rest = mine.filter((g) => g.mission !== mission);
  if (rest.length > 0) intel[spy] = rest;
  else delete intel[spy];
  if (Object.keys(intel).length === 0) delete h.state.intel;
}

/** Is `planetId`'s owner a target `spy` can still work against with `op`: someone active,
 *  not the spy's coalition — and, for an aggressive op, not the spy itself. A guard may
 *  stand on its owner's own world, never on an empty one. */
export function hostileOwner(
  h: HandlerContext,
  spy: string,
  op: SpyOp,
  planetId: string,
): string | null {
  const owner = h.state.planets[planetId]?.owner ?? null;
  if (owner === null || h.state.players[spy]?.status !== 'active') return null;
  if (h.state.players[owner]?.status !== 'active') return null;
  if (op === 'counter') return owner;
  if (owner === spy || coalitionOf(h.state, spy)?.members.includes(owner)) return null;
  return owner;
}
