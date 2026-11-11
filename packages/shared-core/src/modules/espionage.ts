import { hoursToMs } from '../action/types';
import type { Action } from '../action/types';
import type { GameModule, HandlerContext } from '../kernel/module';
import { noteJourney, noteScouted, spyKnownOwner, unguardedBy } from '../state/spyKnowledge';
import { identifiedNodes } from '../state/visibility';
import { getStance } from '../state/diplomacy';
import { coalitionOf } from '../state/coalition';
import type { ResourceBag } from '../data/schemas';
import type { GameState, IntelGrant, Spy, SpyOp } from '../state/gameState';
import {
  aggressive,
  closeIntel,
  exposed,
  guardsAgainst,
  hostileOwner,
  postedOn,
  enlistTurned,
  finiteOr,
  findSpy,
  goHome,
  isFree,
  journeyMs,
  loseSpy,
  nextMission,
  onWorld,
  reachHome,
  recruited,
  rosterOf,
  setOff,
  settleHome,
  stepSpy,
  type SpyStep,
} from '../util/spyLife';
import { counterIntelOf, developmentShare } from '../state/spyWorld';
import { canAfford, payCost } from '../util/treasury';
import {
  DISRUPT_FACTOR,
  delayQueue,
  disrupt,
  sabotage,
  spyQuality,
  stealResearch,
  theft,
} from '../util/spyDeeds';
export { THEFT_CAP } from '../util/spyDeeds';
export { counterIntelOf, developmentShare } from '../state/spyWorld';

/**
 * Espionage: an agent is sent to ONE PLANET on an operation (SPY-8, owner's
 * resolution 2026-10-22 — a spy targets a world, not a player). `espionage.spy`
 * takes a free agent, pays the fee and schedules `espionage.resolve` at the end of
 * the mission (`MISSION_HOURS`); every roll happens THEN, against whoever owns the
 * planet at that moment. Operations:
 *
 *   - `recon` — intel that ACCUMULATES (SPY-13; `IntelGrant`): after a success the
 *     agent stays on the world (`posted`) until recalled (`espionage.recall` with
 *     `op: 'recon'`) or caught, and `visibleState` lets the spy (and only them) see
 *     the world as identified — its buildings, ground army and the fleets in its orbit.
 *     Every `RECON_LAYER_HOURS` on post the agent digs one layer deeper (2 — the
 *     owner's treasury, 3 — the world's build queue and the owner's research, 4 — the
 *     owner's pending diplomatic offers; `intel.deepened`), and every such step
 *     re-rolls detection and death as on arrival. A detected agent is out (`intel.lost`,
 *     public exposure as below) and every layer closes with it. A killed agent's
 *     success leaves a plain 24h window of the first layer (`espionage.duration`).
 *   - `sabotage` (SPY-9) — 3–5 random buildings of the world lose 10–20% of their
 *     max HP each; one already worn down can be destroyed. The damage itself is the
 *     construction module's (`building.damage` capability) — without it nothing breaks.
 *   - `delay` (SPY-14) — the world's order that finishes first is pushed back by
 *     6–12 h (`construction.delay` capability); nothing is built — a success with
 *     nothing delayed (`delayed: null`).
 *   - `disrupt` (SPY-15) — the world produces `DISRUPT_FACTOR` of its output for
 *     `DISRUPT_HOURS` (`Planet.disruptedUntil`, applied in `economy.production`; the
 *     treasury itself is untouched). A repeat extends the term, never deepens the cut.
 *   - `theft` (SPY-9) — a random resource the owner holds: 5–15% of the stock, at
 *     most `THEFT_CAP`, moves from the owner's treasury to the spy's (a world has no
 *     stockpile of its own; owner's resolution 2026-10-22). SPY-21: the share and the cap
 *     grow by the world's `developmentShare`, up to twice from its civilisation's most
 *     developed world.
 *   - `research` (SPY-10) — a random technology the owner has finished and the spy
 *     has not, prerequisites ignored: first among those the spy has not started, then
 *     among those in its labs. The grant is the technology module's
 *     (`technology.grant` capability). Nothing to take → the success reports that
 *     the target civilisation lags behind (`tech: null`).
 *
 *   - `counter` (SPY-11) — a counter-intelligence agent: after the 12h trip it stays
 *     on the world (`posted`) until recalled (`espionage.recall`) or caught. Any
 *     world with an owner, your own included. While posted it adds
 *     `COUNTER_DETECT_BONUS` / `COUNTER_KILL_BONUS` (on top of the bureau) against
 *     every AGGRESSIVE mission (all the others) there by a player who is neither its
 *     owner nor that owner's ally. Every `COUNTER_SWEEP_HOURS` it also hunts the
 *     counter-intelligence agents posted there by civilisations at WAR with its owner
 *     — on an enemy world that includes the enemy's own guard.
 *
 * No war on exposure (owner's resolution 2026-11-04): SPY-11 made a detected aggressive
 * mission declare war between the world's owner and the spy's owner; that is gone, a
 * caught spy changes no stance. The victim learns of it (`espionage.detected`), and
 * the exposure is public news (SPY-16): `espionage.exposed` names the world's owner
 * (`a`), the spy's owner (`b`) and the world, never the operation.
 * Agents in numbers (SPY-17): a player may hold at most `MAX_AGENTS_PER_WORLD` agents on
 * one world. Aggressive agents sent there while others are still on their way ride one
 * wave (`crew` in each `espionage.resolve`): each crewmate past the first adds `CREW_BONUS` to the base
 * success AND to the base detection — a crowd works faster and is noticed sooner.
 * Members of the same coalition cannot launch aggressive missions against each other;
 * a mission already in flight aborts if its target is a coalition member on arrival.
 * This protection lasts through the pending departure, without bypassing its timer.
 *
 * After a sabotage, a theft or a research theft the spy flies home to the capital, as after
 * a failure; `espionage.succeeded` tells the spy what was done.
 *
 * Price, success chance and window length are value pipelines with base
 * defaults (`espionage.cost` / `espionage.chance` / `espionage.duration`), so
 * tech, factions, buildings or counter-intelligence modules can bend them
 * without touching this module. Failure costs the fee too — spying is a
 * gamble; the failure event is addressed to the actor. A planet that has no
 * other active owner by the end of the mission (captured by the spy, abandoned)
 * aborts it: `espionage.aborted`, no rolls, the agent comes home.
 *
 * Counter-intelligence (SPY-2): every resolved mission also rolls DETECTION for
 * the victim (`espionage.detect` pipeline; base 0.5 after a failed attempt —
 * the agent left tracks — vs 0.25 after a clean success). A detected attempt
 * emits `espionage.detected` addressed to the VICTIM; the thief's identity is
 * included only when the attempt FAILED (an agent caught red-handed) — a
 * successful theft that gets noticed reveals THAT intel leaked, not by whom.
 * The spy is never told a clean theft was spotted; a KILLED agent is another
 * matter — see below.
 *
 * Named spies on the map (SPY-6/SPY-23, owner's resolution 2026-11-10): a player holds a
 * network of named spies (`state.spies`; `espionage.agents` pipeline, base 3), all resting
 * in the capital at the start. An order (`espionage.spy`, optionally naming `spyId`) takes a
 * free spy — resting at home, or waiting on a world — pays the fee up front and sends it
 * along the lanes to the world (`state/spyTravel.ts`: territory slows it). On arrival the
 * operation starts if it still can (target rules as at the order) and resolves
 * `MISSION_HOURS` later; otherwise the spy waits there for orders (`espionage.waiting`) —
 * `relocate` only ever waits. A waiting spy on a world it has reason to fear is checked
 * every `LURK_HOURS` at `LURK_FACTOR` of the odds. Done, failed, recalled or cancelled
 * (`espionage.cancel`), a spy flies home to the capital — and on to a new one if the capital
 * moved; with no capital at all it lies low (`hidden`): no orders, no risk, until there is
 * one. No free spy → `E_NO_AGENT`, nothing paid; a killed spy's slot is refilled in
 * `AGENT_RECRUIT_HOURS` by a new spy of the next generation.
 *
 * Counter-intelligence building (SPY-7): a building that declares `spyDetectBonus`
 * adds it to the victim's base detection odds. The victim's STRONGEST such building
 * counts (not a sum — spamming bureaus must not make detection a certainty), and it
 * guards every mission against its owner, not only against its own world.
 *
 * Death on exposure (SPY-7): a DETECTED agent also rolls death (`espionage.kill`
 * pipeline; base 0.5 plus the victim's strongest `spyKillBonus`, clamped to [0,1]).
 * A killed agent is lost even after a success (the stolen window stays open). A
 * detected agent that survives escapes like an undetected one. Success, detect and
 * kill are drawn for every resolved mission, so the RNG stream shape stays
 * independent of the outcome. Death cannot be hidden from the agent's owner
 * (`agentLost: true` on `espionage.failed` / `intel.stolen`); the victim's
 * `espionage.detected` says `killed: true`.
 *
 * Turning (SPY-18): an agent the victim's bureau kills may be turned instead (see
 * `turnAgent`). The spy loses it just like a dead one (`agentTurned: true` beside
 * `agentLost`); the victim's `espionage.detected` adds `turned: true` and the sender,
 * and the victim holds one agent over its network for `TURNED_HOURS`.
 */

const SPY_OPS: ReadonlySet<string> = new Set<SpyOp>([
  'relocate',
  'recon',
  'sabotage',
  'delay',
  'disrupt',
  'theft',
  'research',
  'counter',
]);

/** Base price of one mission by operation (SPY-12): guarding is cheap, attacking is
 *  dear, as in the genre (SWW3 counter-ops $250 a day against $4000 for sabotage). The
 *  `espionage.cost` hook may still bend it per match. */
export const SPY_OP_COST: Readonly<Record<SpyOp, number>> = {
  relocate: 0,
  counter: 50,
  recon: 150,
  sabotage: 300,
  delay: 300,
  disrupt: 300,
  theft: 300,
  research: 400,
};
/** Base success chance — the `espionage.chance` pipeline may bend it; the result
 *  is clamped so no stack of modifiers makes spying a certainty or an impossibility. */
export const BASE_CHANCE = 0.6;
export const CHANCE_MIN = 0.05;
export const CHANCE_MAX = 0.95;
/** How long every operation takes before it resolves, game-hours (owner, 2026-10-22). */
export const MISSION_HOURS = 12;
/** Base window length after a SUCCESS whose agent was killed, in game-hours
 *  (timeScale-compressed like every duration): the dead agent's last look. */
const BASE_DURATION_HOURS = 24;
/** SPY-13: how long a posted recon agent digs before the next layer, game-hours, and
 *  how many layers there are. Past the last one it keeps the watch (and the risk). */
const RECON_LAYER_HOURS = 12;
export const RECON_LAYERS = 4;
/** One recon layer's dig, ms: a better spy (`espionage.quality`) digs faster. */
const reconStepMs = (h: HandlerContext, owner: string, spyId: number): number =>
  hoursToMs(h.ctx, RECON_LAYER_HOURS) / spyQuality(h, owner, spyId, 'recon');
/** Base odds the VICTIM notices the attempt (`espionage.detect` pipeline bends them;
 *  the result is clamped to [0,1] — hooks may legitimately push to never/always). */
export const BASE_DETECT_FAILED = 0.5; // a blown attempt leaves tracks
export const BASE_DETECT_SUCCESS = 0.25; // a clean theft is noticed rarer
/** A beneficiary holds at most this many live grants — the oldest one is evicted
 *  first (fail-secure bound: state must not grow without limit). */
const MAX_GRANTS = 8;
export { BASE_SPY_AGENTS } from '../state/spyTravel';
/** SPY-23: how often a spy waiting on a world it has reason to fear is checked, game-hours,
 *  and how its odds of being noticed compare with a working spy's (owner, 2026-11-10). */
const LURK_HOURS = 12;
const LURK_FACTOR = 0.5;
/** Base odds a DETECTED agent dies (`espionage.kill` pipeline, clamped to [0,1]). */
const BASE_KILL = 0.5;
/** SPY-21: what the most developed world of its civilisation adds to the success of a theft
 *  or a research theft; a less developed one adds its share of it. */
export const DEVELOPMENT_CHANCE_BONUS = 0.2;
/** A posted counter-intelligence agent's `until`: it is away until recalled or caught.
 *  JSON-safe (unlike `Infinity`), and no world clock reaches it. */
export const COUNTER_POSTED = Number.MAX_SAFE_INTEGER;
/** What a posted counter-intelligence agent adds against aggressive missions on its world
 *  (stacks with the bureau). */
const COUNTER_DETECT_BONUS = 0.2;
const COUNTER_KILL_BONUS = 0.15;
/** How often a posted agent hunts hostile counter-intelligence on its world, game-hours,
 *  and its odds to catch one per sweep. */
const COUNTER_SWEEP_HOURS = 12;
const COUNTER_CATCH = 0.2;
/** SPY-17: at most this many of a player's agents on one world, and what each aggressive
 *  agent of a wave past the first adds to success and to detection. */
export const MAX_AGENTS_PER_WORLD = 3;
export const CREW_BONUS = 0.1;

/** The base odds of a resolving mission: SPY-17's wave bonus, and SPY-21's — a theft is
 *  likelier from a world developed against its own civilisation — and how well the spy
 *  does its deed (`espionage.quality`). */
function missionOdds(
  h: HandlerContext,
  owner: string,
  spy: Spy,
  crew: number,
): { crewBonus: number; development: number; baseChance: number; quality: number } {
  const op = spy.op!;
  const planetId = spy.location;
  const crewBonus = CREW_BONUS * (Math.min(MAX_AGENTS_PER_WORLD, crew) - 1);
  const development =
    op === 'theft' || op === 'research' ? developmentShare(h.ctx.data, h.state, planetId) : 0;
  return {
    crewBonus,
    development,
    quality: spyQuality(h, owner, spy.id, op),
    baseChance: BASE_CHANCE + crewBonus + DEVELOPMENT_CHANCE_BONUS * development,
  };
}

/** SPY-18: how long a turned agent serves its catcher, game-hours. */
export const TURNED_HOURS = 24;

/**
 * SPY-18: an agent the catcher's bureau would kill may be turned instead — the
 * `espionage.turn` pipeline over the catcher's strongest `spyTurnChance` (0 without a
 * bureau that turns). For the spy the agent is lost all the same; the catcher holds one
 * more spy for `TURNED_HOURS`. The roll is drawn only for a killed agent with a chance
 * above zero, so a match without such a bureau keeps its RNG stream.
 */
function turnAgent(h: HandlerContext, catcher: string, spy: string, kind: string): boolean {
  const base = counterIntelOf(h.ctx.data, h.state, catcher, 'spyTurnChance');
  const raw = h.hook<number>('espionage.turn', base, { playerId: spy, target: catcher, kind });
  const chance = Math.min(1, Math.max(0, finiteOr(raw, base)));
  if (chance <= 0 || h.rng.nextFloat() >= chance) return false;
  enlistTurned(h, catcher, TURNED_HOURS);
  return true;
}

interface SpyPayload {
  planetId?: string;
  op?: string;
  spyId?: number;
}

/** What `espionage.resolve` carries: whose spy does which deed where. */
interface ResolvePayload extends SpyStep {
  planetId: string;
  op: SpyOp;
  /** SPY-17: how many of the owner's aggressive spies worked the world alongside this one
   *  (absent = 1) — raised for the whole group whenever another one starts there. */
  crew?: number;
}

/** Why `owner` cannot aim `op` at a world held by `target` — `null` when nothing stands in
 *  the way: someone else's active world (a guard may stand on its owner's own), outside the
 *  owner's coalition for an aggressive op. Moving needs no target, and recon may look at a
 *  world nobody holds too (SPY-24). `target` is whoever the check believes holds the world:
 *  at the order, the owner the player knows (`spyKnownOwner`), on the spot the real one. */
function targetError(h: HandlerContext, owner: string, op: SpyOp, target: string | null): string | null {
  if (op === 'relocate') return null;
  if (op === 'recon' && unguardedBy(h.state, target)) return null;
  if (target === null || (target === owner && op !== 'counter')) return 'E_BAD_TARGET';
  if (h.state.players[target]?.status !== 'active') return 'E_NO_PLAYER';
  if (op !== 'counter' && coalitionOf(h.state, owner)?.members.includes(target))
    return 'E_BAD_TARGET';
  return null;
}

/** Is `planetId` too crowded for `self` to take up `op` there: one guard and one recon spy
 *  of a player per world (SPY-13), at most `MAX_AGENTS_PER_WORLD` of them in all (SPY-17). */
function crowded(
  h: HandlerContext,
  owner: string,
  op: SpyOp,
  planetId: string,
  self: Spy,
): boolean {
  const others = (h.state.spies?.[owner] ?? []).filter((s) => s !== self && onWorld(s, planetId));
  const twin = others.some((s) => s.op === op && (s.state === 'travel' || s.state === 'work'));
  return ((op === 'counter' || op === 'recon') && twin) || others.length >= MAX_AGENTS_PER_WORLD;
}

/** The detection and death rolls of a spy at risk on `planetId` (on arrival, at every
 *  recon layer, every `LURK_HOURS` of waiting): both always drawn, so the RNG stream's
 *  shape does not depend on the outcome; a turn roll only for a killed spy (SPY-18). The
 *  odds scale by `scale` (½ for a waiting spy) after the bureau and the guards are added. */
function rollExposure(
  h: HandlerContext,
  a: {
    spy: string;
    spyId: number;
    victim: string;
    planetId: string;
    kind: string;
    succeeded: boolean;
  },
  baseDetectOdds: number,
  scale = 1,
): {
  detected: boolean;
  killed: boolean;
  turned: boolean;
  guards: { owner: string; spyId: number }[];
} {
  const guards = guardsAgainst(h.state, a.planetId, a.spy);
  const watched = guards.length > 0;
  const args = {
    playerId: a.spy,
    spyId: a.spyId,
    target: a.victim,
    kind: a.kind,
    succeeded: a.succeeded,
  };
  const baseDetect =
    (baseDetectOdds +
      counterIntelOf(h.ctx.data, h.state, a.victim, 'spyDetectBonus') +
      (watched ? COUNTER_DETECT_BONUS : 0)) *
    scale;
  const rawDetect = h.hook<number>('espionage.detect', baseDetect, args);
  const detected = h.rng.nextFloat() < Math.min(1, Math.max(0, finiteOr(rawDetect, baseDetect)));
  const baseKill =
    BASE_KILL +
    counterIntelOf(h.ctx.data, h.state, a.victim, 'spyKillBonus') +
    (watched ? COUNTER_KILL_BONUS : 0);
  const rawKill = h.hook<number>('espionage.kill', baseKill, args);
  const killed =
    h.rng.nextFloat() < Math.min(1, Math.max(0, finiteOr(rawKill, baseKill))) && detected;
  const turned = killed && turnAgent(h, a.victim, a.spy, a.kind);
  return { detected, killed, turned, guards };
}

/** `owner`'s spy at the end of a journey: home → it rests; out on an order → it starts
 *  the deed if it still can, else waits there for orders. */
function arrive(h: HandlerContext, owner: string, spy: Spy): void {
  noteJourney(h.state, owner, spy, h.ctx.now);
  if (spy.state === 'return') {
    if (reachHome(h, owner, spy, arrive))
      h.emit('espionage.home', { owner, spyId: spy.id, planetId: spy.location });
    return;
  }
  const op = spy.op!;
  if (op === 'relocate') {
    waitThere(h, owner, spy);
    h.emit('espionage.arrived', { owner, spyId: spy.id, planetId: spy.location });
    return;
  }
  const holder = h.state.planets[spy.location]?.owner ?? null;
  if (
    targetError(h, owner, op, holder) !== null ||
    (!(op === 'recon' && unguardedBy(h.state, holder)) &&
      hostileOwner(h, owner, op, spy.location) === null) ||
    crowded(h, owner, op, spy.location, spy)
  ) {
    const planetId = spy.location;
    waitThere(h, owner, spy);
    h.emit('espionage.waiting', { owner, spyId: spy.id, planetId, kind: op });
    return;
  }
  spy.state = 'work';
  delete spy.from;
  spy.departedAt = h.ctx.now;
  spy.arrivesAt = h.ctx.now + hoursToMs(h.ctx, MISSION_HOURS);
  // SPY-17: the aggressive spies of the owner at work on the world form one crew; each of
  // them resolves with the crew's size, however they leave it.
  const fellows = aggressive(op)
    ? (h.state.spies?.[owner] ?? []).filter(
        (s) =>
          s !== spy &&
          s.state === 'work' &&
          !s.posted &&
          aggressive(s.op) &&
          s.location === spy.location,
      )
    : [];
  const crew = fellows.length + 1;
  if (crew > 1) {
    for (const e of h.state.scheduled) {
      const rp = e.payload as Partial<ResolvePayload>;
      if (
        e.type === 'espionage.resolve' &&
        rp.spy === owner &&
        fellows.some((f) => f.id === rp.spyId && f.mission === rp.mission)
      ) {
        rp.crew = Math.max(rp.crew ?? 1, crew);
      }
    }
  }
  h.schedule(spy.arrivesAt, 'espionage.resolve', {
    spy: owner,
    spyId: spy.id,
    mission: spy.mission!,
    planetId: spy.location,
    op,
    ...(crew > 1 ? { crew } : {}),
  } satisfies ResolvePayload);
  h.emit('espionage.started', {
    owner,
    spyId: spy.id,
    planetId: spy.location,
    kind: op,
    until: spy.arrivesAt,
  });
}

/** `spy` stays on its world, free for the next order. On a world it has reason to fear it
 *  is checked for every `LURK_HOURS` (owner's resolution 2026-11-10). */
function waitThere(h: HandlerContext, owner: string, spy: Spy): void {
  spy.state = 'wait';
  delete spy.from;
  delete spy.departedAt;
  delete spy.arrivesAt;
  delete spy.op;
  delete spy.posted;
  delete spy.postedAt;
  h.schedule(h.ctx.now + hoursToMs(h.ctx, LURK_HOURS), 'espionage.lurk', {
    spy: owner,
    spyId: spy.id,
    mission: spy.mission!,
  } satisfies SpyStep);
}

/** Call `spy` off whatever it does and send it home: a posted recon spy's intel closes, a
 *  spy on its way first turns back to where it set out from. */
function callOff(h: HandlerContext, owner: string, spy: Spy): void {
  if (spy.posted && spy.op === 'recon') closeIntel(h, owner, spy.mission);
  if (spy.state === 'travel') {
    const back = Math.max(0, h.ctx.now - (spy.departedAt ?? h.ctx.now));
    goHome(h, owner, spy, arrive, spy.from ?? spy.location, back);
    return;
  }
  goHome(h, owner, spy, arrive);
}

/** A caught or dead spy's way out: killed → lost (replaced in time); otherwise home. */
function outcome(h: HandlerContext, owner: string, spy: Spy, killed: boolean): void {
  if (spy.posted && spy.op === 'recon') closeIntel(h, owner, spy.mission);
  if (killed) loseSpy(h, owner, spy);
  else goHome(h, owner, spy, arrive);
}

/** `espionage.spy`: send a free spy — the one named, or else the closest — to a world on an
 *  operation, the fee paid up front (SPY-6/22/23). */
function orderSpy(action: Action, h: HandlerContext): void {
  const p = action.payload as SpyPayload;
  if (
    typeof p?.op !== 'string' ||
    !SPY_OPS.has(p.op) ||
    typeof p.planetId !== 'string' ||
    (p.spyId !== undefined && !Number.isInteger(p.spyId))
  ) {
    return h.reject('E_BAD_PAYLOAD');
  }
  const owner = action.playerId;
  const actor = h.state.players[owner];
  if (!actor || actor.status !== 'active') return h.reject('E_FORBIDDEN');
  const op = p.op as SpyOp;
  const planetId = p.planetId;
  const planet = h.state.planets[planetId];
  if (!planet) return h.reject('E_NO_PLANET');
  // SPY-24: the order is checked against the owner the player KNOWS (`spyKnownOwner`). A
  // world they do not see and no spy of theirs has been to takes only recon or a move:
  // refusing or taking anything else there would tell them its hidden owner. What is
  // really there, the spy meets on arrival.
  const known =
    op === 'relocate'
      ? undefined
      : spyKnownOwner(h.state, owner, planetId, identifiedNodes(h.state, owner, h.ctx.data));
  if (op !== 'relocate' && op !== 'recon' && known === undefined) return h.reject('E_UNSCOUTED');
  const target = known?.owner ?? null;
  const refused = targetError(h, owner, op, target);
  if (refused !== null) return h.reject(refused);

  // SPY-6/22: the order needs a free spy — the one named, or else the one closest to
  // the world (ties: the lowest id). Checked before the fee, so a refusal costs nothing.
  const free = rosterOf(h, owner).filter(
    (s) => isFree(s) && (p.spyId === undefined || s.id === p.spyId),
  );
  if (free.length === 0) return h.reject('E_NO_AGENT');
  let spy: Spy | null = null;
  let ms: number | null = null;
  for (const s of free) {
    const t = journeyMs(h, owner, s, s.location, planetId);
    if (t !== null && (ms === null || t < ms)) [spy, ms] = [s, t];
  }
  if (spy === null || ms === null) return h.reject('E_NO_ROUTE');
  if (crowded(h, owner, op, planetId, spy)) return h.reject('E_BAD_TARGET');

  if (op !== 'relocate') {
    const fee = h.hook<Record<string, number>>(
      'espionage.cost',
      { credits: SPY_OP_COST[op] },
      {
        playerId: owner,
        target,
        kind: op,
        spyId: spy.id,
      },
    );
    if (!canAfford(actor.resources, fee)) return h.reject('E_INSUFFICIENT');
    // Paid up front (owner's resolution 2026-11-10): what changes on the way is the
    // spy's problem, and a failure burns the fee too — spying is a gamble.
    payCost(actor.resources, fee);
  }

  const from = spy.location;
  spy.mission = nextMission(h.state, owner);
  spy.op = op;
  delete spy.posted;
  delete spy.postedAt;
  const arrivesAt = h.ctx.now + ms;
  h.emit('espionage.sent', {
    owner,
    spyId: spy.id,
    planetId,
    op,
    arrivesAt,
    ...(op === 'relocate' ? {} : { until: arrivesAt + hoursToMs(h.ctx, MISSION_HOURS) }),
  });
  setOff(h, owner, spy, from, planetId, 'travel', ms, arrive);
}

/** SPY-24: recon of a world nobody can catch a spy on (`unguardedBy`). Nothing is rolled: the
 *  spy takes a plain look of `BASE_DURATION_HOURS`, notes whose the world is and heads home.
 *  It does not stay on post — there is no owner to dig into, and a post without risk would
 *  be free experience. */
function lookUnguarded(h: HandlerContext, owner: string, spy: Spy, planetId: string): void {
  const until = h.ctx.now + hoursToMs(h.ctx, BASE_DURATION_HOURS);
  const mine = ((h.state.intel ??= {})[owner] ??= []);
  mine.push({ kind: 'planet', target: planetId, until });
  while (mine.length > MAX_GRANTS) mine.shift(); // oldest window evicted first
  noteScouted(h.state, owner, planetId, h.ctx.now);
  goHome(h, owner, spy, arrive);
  const target = h.state.planets[planetId]?.owner ?? null;
  h.emit('intel.stolen', { owner, spyId: spy.id, target, kind: 'recon', planetId, until });
}

export const espionageModule: GameModule = {
  id: 'espionage',
  // 1.1.0: саботаж и кража ресурсов (SPY-9). 1.2.0: кража исследований (SPY-10).
  // 1.4.0: coalition membership blocks hostile missions at launch and resolution.
  // 1.5.0: своя цена у операции (SPY-12). 1.6.0: срыв стройки (SPY-14).
  // 1.7.0: разведка копится слоями, агент стоит до отзыва (SPY-13).
  // 1.8.0: подрыв экономики (SPY-15). 1.9.0: раскрытие — новость для всех (SPY-16).
  // 1.10.0: до трёх агентов на мире, волна складывает шансы (SPY-17).
  // 1.13.0: кража вернее и богаче с развитого мира своей цивилизации (SPY-21).
  // 1.14.0: раскрытие шпиона больше не объявляет войну.
  // 2.0.0: именные шпионы летят до мира, ждут там приказа и возвращаются в столицу (SPY-23).
  // 2.1.0: приказ сверяется с тем, что игрок знает о мире; разведка и ничейных миров (SPY-24).
  version: '2.1.0',
  setup(api) {
    // SPY-15: a disrupted world produces `DISRUPT_FACTOR` of its output. A span never
    // runs across the end (it is a scheduled event), so «until ≥ now» at the span's end
    // means the whole span was disrupted.
    api.hook<ResourceBag>('economy.production', (bag, args, h) => {
      const planetId = (args as { planetId?: string } | undefined)?.planetId;
      const until = planetId ? h.state.planets[planetId]?.disruptedUntil : undefined;
      if (until === undefined || until < h.ctx.now) return bag;
      const out: Record<string, number> = {};
      for (const res of Object.keys(bag)) out[res] = (bag[res] ?? 0) * DISRUPT_FACTOR;
      return out;
    });

    api.on('espionage.disrupt.end', (event, h) => {
      const planet = h.state.planets[(event.payload as { planetId: string }).planetId];
      // An extended term leaves this end early: the cut stays until its own end fires.
      if (planet?.disruptedUntil !== undefined && planet.disruptedUntil <= h.ctx.now)
        delete planet.disruptedUntil;
    });

    api.onAction('espionage.spy', orderSpy);

    api.on('espionage.arrive', (event, h) => {
      const step = event.payload as SpyStep;
      const spy = stepSpy(h.state, step);
      if (!spy || (spy.state !== 'travel' && spy.state !== 'return')) return;
      arrive(h, step.spy, spy);
    });

    api.on('espionage.recruited', (event, h) => {
      const step = event.payload as SpyStep;
      const spy = stepSpy(h.state, step);
      if (spy?.state !== 'recruit') return;
      recruited(h, step.spy, spy);
      h.emit('espionage.recruited', { owner: step.spy, spyId: spy.id });
    });

    // A waiting spy on a world whose owner it has reason to fear is checked as a working
    // one, at half the odds of being noticed (owner's resolution 2026-11-10).
    api.on('espionage.lurk', (event, h) => {
      const step = event.payload as SpyStep;
      const spy = stepSpy(h.state, step);
      if (spy?.state !== 'wait') return;
      const owner = step.spy;
      const planetId = spy.location;
      const victim = hostileOwner(h, owner, 'recon', planetId);
      if (victim !== null && getStance(h.state, owner, victim) !== 'alliance') {
        const risk = { spy: owner, spyId: spy.id, victim, planetId, kind: 'wait', succeeded: true };
        const { detected, killed, turned, guards } = rollExposure(
          h,
          risk,
          BASE_DETECT_SUCCESS,
          LURK_FACTOR,
        );
        if (detected) {
          exposed(h, victim, owner, planetId);
          outcome(h, owner, spy, killed);
          h.emit('espionage.caught', {
            owner,
            spyId: spy.id,
            planetId,
            ...(killed ? { agentLost: true, ...(turned ? { agentTurned: true } : {}) } : {}),
          });
          h.emit('espionage.detected', {
            owner: victim,
            kind: 'wait',
            planetId,
            spy: owner,
            ...(guards.length > 0 ? { guards } : {}),
            ...(killed ? { killed: true, ...(turned ? { turned: true } : {}) } : {}),
          });
          return;
        }
      }
      h.schedule(h.ctx.now + hoursToMs(h.ctx, LURK_HOURS), 'espionage.lurk', step);
    });

    api.on('espionage.resolve', (event, h) => {
      const step = event.payload as ResolvePayload;
      const spy = stepSpy(h.state, step);
      if (spy?.state !== 'work' || spy.posted) return; // called off, or an older save's step
      const { spy: owner, planetId, op, crew = 1 } = step;
      const now = h.ctx.now;
      const holder = h.state.planets[planetId]?.owner ?? null;
      if (op === 'recon' && unguardedBy(h.state, holder) && h.state.players[owner]?.status === 'active')
        return lookUnguarded(h, owner, spy, planetId);
      const victim = hostileOwner(h, owner, op, planetId);
      if (victim === null) {
        // The world is no longer a target: no damage or RNG draws; the spy waits there.
        waitThere(h, owner, spy);
        h.emit('espionage.aborted', { owner, spyId: spy.id, planetId, kind: op });
        return;
      }
      if (op === 'counter') {
        spy.posted = true;
        spy.postedAt = now;
        delete spy.arrivesAt;
        h.schedule(now + hoursToMs(h.ctx, COUNTER_SWEEP_HOURS), 'espionage.sweep', {
          spy: owner,
          spyId: spy.id,
          mission: spy.mission!,
        } satisfies SpyStep);
        h.emit('espionage.posted', { owner, spyId: spy.id, planetId });
        return;
      }

      // SPY-17: every crewmate past the first raises both odds.
      const { crewBonus, development, baseChance, quality } = missionOdds(h, owner, spy, crew);
      const rawChance = h.hook<number>('espionage.chance', baseChance, {
        playerId: owner,
        spyId: spy.id,
        target: victim,
        kind: op,
      });
      const chance = Number.isFinite(rawChance)
        ? Math.min(CHANCE_MAX, Math.max(CHANCE_MIN, rawChance))
        : baseChance;
      const succeeded = h.rng.nextFloat() < chance;

      // Counter-intelligence (SPY-2): detection is drawn for EVERY resolved mission; a
      // blown attempt leaves tracks. SPY-11: posted guards add their share.
      const risk = { spy: owner, spyId: spy.id, victim, planetId, kind: op, succeeded };
      const { detected, killed, turned, guards } = rollExposure(
        h,
        risk,
        (succeeded ? BASE_DETECT_SUCCESS : BASE_DETECT_FAILED) + crewBonus,
      );
      const lostTags = killed ? { agentLost: true, ...(turned ? { agentTurned: true } : {}) } : {};
      const caughtTags = {
        ...(guards.length > 0 ? { guards } : {}),
        ...(killed ? { killed: true, ...(turned ? { turned: true, spy: owner } : {}) } : {}),
      };
      // Exposure is news, not war (owner's resolution 2026-11-04): stances stay as they are.
      if (detected) exposed(h, victim, owner, planetId);

      if (!succeeded) {
        outcome(h, owner, spy, killed);
        // Addressed to the actor (`owner` routes the event through the fog filter).
        h.emit('espionage.failed', {
          owner,
          spyId: spy.id,
          target: victim,
          kind: op,
          planetId,
          ...lostTags,
        });
        if (detected) {
          // Caught red-handed: the victim learns the operation AND who sent the agent.
          h.emit('espionage.detected', {
            owner: victim,
            kind: op,
            planetId,
            spy: owner,
            ...caughtTags,
          });
        }
        return;
      }

      if (op !== 'recon') {
        // Sabotage / theft / research theft: the deed is done at once, the spy heads home.
        const done =
          op === 'sabotage'
            ? { hits: sabotage(h, planetId, quality) }
            : op === 'delay'
              ? { delayed: delayQueue(h, planetId, quality) }
              : op === 'disrupt'
                ? { disrupted: disrupt(h, planetId) }
                : op === 'theft'
                  ? { loot: theft(h, owner, victim, development, quality) }
                  : { tech: stealResearch(h, owner, victim) };
        outcome(h, owner, spy, killed);
        h.emit('espionage.succeeded', {
          owner,
          spyId: spy.id,
          target: victim,
          kind: op,
          planetId,
          ...done,
          ...lostTags,
        });
        if (detected)
          h.emit('espionage.detected', { owner: victim, kind: op, planetId, ...caughtTags });
        return;
      }

      // SPY-13: a surviving spy stays on post and holds the first layer open until it is
      // recalled or caught; a killed one leaves only its last look, a plain window.
      let grant: IntelGrant;
      if (killed) {
        const rawHours = h.hook<number>('espionage.duration', BASE_DURATION_HOURS, {
          playerId: owner,
          spyId: spy.id,
          target: victim,
          kind: op,
        });
        const hours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : BASE_DURATION_HOURS;
        grant = { kind: 'planet', target: planetId, until: now + hoursToMs(h.ctx, hours) };
        loseSpy(h, owner, spy);
      } else {
        grant = {
          kind: 'planet',
          target: planetId,
          until: COUNTER_POSTED,
          layer: 1,
          mission: spy.mission!,
        };
        spy.posted = true;
        spy.postedAt = now;
        delete spy.arrivesAt;
        h.schedule(now + reconStepMs(h, owner, spy.id), 'espionage.deepen', {
          spy: owner,
          spyId: spy.id,
          mission: spy.mission!,
        } satisfies SpyStep);
      }
      const mine = ((h.state.intel ??= {})[owner] ??= []);
      mine.push(grant);
      while (mine.length > MAX_GRANTS) mine.shift(); // oldest window evicted first
      noteScouted(h.state, owner, planetId, now);
      h.emit('intel.stolen', {
        owner,
        spyId: spy.id,
        target: victim,
        kind: op,
        planetId,
        until: grant.until,
        ...(grant.layer ? { layer: grant.layer } : {}),
        ...lostTags,
      });
      // A noticed CLEAN theft: the victim learns the leak, not the thief.
      if (detected)
        h.emit('espionage.detected', { owner: victim, kind: op, planetId, ...caughtTags });
    });

    // SPY-13: a posted recon spy digs one layer deeper — and risks exposure — every
    // `RECON_LAYER_HOURS`. Recalled, caught or evicted → its watch is over.
    api.on('espionage.deepen', (event, h) => {
      const step = event.payload as SpyStep;
      const spy = stepSpy(h.state, step);
      if (!spy?.posted || spy.op !== 'recon') return;
      const owner = step.spy;
      const planetId = spy.location;
      const grant = (h.state.intel?.[owner] ?? []).find((g) => g.mission === spy.mission);
      const victim = hostileOwner(h, owner, 'recon', planetId);
      if (!grant || victim === null) {
        // No hostile owner to dig into any more (captured, abandoned, joined the spy's
        // coalition), or the grant was evicted: the spy comes home with nothing new.
        closeIntel(h, owner, spy.mission);
        goHome(h, owner, spy, arrive);
        h.emit('espionage.aborted', { owner, spyId: spy.id, planetId, kind: 'recon' });
        return;
      }
      const risk = { spy: owner, spyId: spy.id, victim, planetId, kind: 'recon', succeeded: true };
      const { detected, killed, turned, guards } = rollExposure(h, risk, BASE_DETECT_SUCCESS);
      if (detected) {
        exposed(h, victim, owner, planetId);
        outcome(h, owner, spy, killed);
        h.emit('intel.lost', {
          owner,
          spyId: spy.id,
          target: victim,
          planetId,
          ...(killed ? { agentLost: true, ...(turned ? { agentTurned: true } : {}) } : {}),
        });
        h.emit('espionage.detected', {
          owner: victim,
          kind: 'recon',
          planetId,
          ...(guards.length > 0 ? { guards } : {}),
          ...(killed ? { killed: true, ...(turned ? { turned: true, spy: owner } : {}) } : {}),
        });
        return;
      }
      const layer = grant.layer ?? 1;
      if (layer < RECON_LAYERS) {
        grant.layer = layer + 1;
        h.emit('intel.deepened', {
          owner,
          spyId: spy.id,
          target: victim,
          planetId,
          layer: grant.layer,
        });
      }
      h.schedule(h.ctx.now + reconStepMs(h, owner, spy.id), 'espionage.deepen', step);
    });

    // SPY-11: a posted counter-intelligence spy hunts hostile guards on its world.
    api.on('espionage.sweep', (event, h) => {
      const step = event.payload as SpyStep;
      const mine = stepSpy(h.state, step);
      if (!mine?.posted || mine.op !== 'counter') return; // recalled or caught — its watch is over
      const owner = step.spy;
      const planetId = mine.location;
      if (!h.state.planets[planetId]?.owner || h.state.players[owner]?.status !== 'active') {
        goHome(h, owner, mine, arrive);
        h.emit('espionage.aborted', { owner, spyId: mine.id, planetId, kind: 'counter' });
        return;
      }
      for (const { owner: rival, spy: guard } of postedOn(h.state, planetId)) {
        if (rival === owner || getStance(h.state, owner, rival) !== 'war') continue;
        const caught = h.rng.nextFloat() < COUNTER_CATCH * spyQuality(h, owner, mine.id, 'counter');
        const killed = h.rng.nextFloat() < BASE_KILL + COUNTER_KILL_BONUS && caught;
        if (!caught) continue;
        outcome(h, rival, guard, killed);
        h.emit('espionage.counter.caught', {
          owner,
          guardSpyId: mine.id,
          planetId,
          spy: rival,
          ...(killed ? { killed: true } : {}),
        });
        h.emit('espionage.counter.lost', {
          owner: rival,
          spyId: guard.id,
          planetId,
          ...(killed ? { agentLost: true } : {}),
        });
      }
      h.schedule(h.ctx.now + hoursToMs(h.ctx, COUNTER_SWEEP_HOURS), 'espionage.sweep', step);
    });

    // SPY-23: call a spy off whatever it does — on its way, waiting or at work — and home.
    api.onAction('espionage.cancel', (action, h) => {
      const { spyId } = action.payload as { spyId?: unknown };
      if (typeof spyId !== 'number' || !Number.isInteger(spyId)) return h.reject('E_BAD_PAYLOAD');
      const spy = findSpy(h.state, action.playerId, spyId);
      if (!spy || (spy.state !== 'travel' && spy.state !== 'wait' && spy.state !== 'work')) {
        return h.reject('E_BAD_TARGET');
      }
      const planetId = spy.location;
      callOff(h, action.playerId, spy);
      h.emit('espionage.cancelled', { owner: action.playerId, spyId, planetId });
    });

    // The older way to call off a guard (or a posted recon spy) — by the world it stands on.
    api.onAction('espionage.recall', (action, h) => {
      const { planetId, op } = action.payload as { planetId?: unknown; op?: unknown };
      if (typeof planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      if (op !== undefined && op !== 'counter' && op !== 'recon') return h.reject('E_BAD_PAYLOAD');
      const recon = op === 'recon';
      // A guard can be called off its way there too; a recon spy only once on post.
      const spy = (h.state.spies?.[action.playerId] ?? []).find(
        (s) =>
          s.op === (recon ? 'recon' : 'counter') &&
          s.location === planetId &&
          (s.state === 'travel' || s.state === 'work') &&
          (!recon || s.posted),
      );
      if (!spy) return h.reject('E_BAD_TARGET');
      callOff(h, action.playerId, spy);
      h.emit('espionage.recalled', {
        owner: action.playerId,
        spyId: spy.id,
        planetId,
        ...(recon ? { kind: 'recon' } : {}),
      });
    });

    // A new capital calls the idle spies over at once (owner's resolution 2026-11-10).
    api.on('capital.designated', (event, h) => {
      const owner = (event.payload as { owner?: unknown }).owner;
      if (typeof owner === 'string') settleHome(h, owner, arrive);
    });

    // Housekeeping as time advances: turned agents go back to their masters, expired windows
    // are dropped, idle spies follow the capital (a lost one sends them to ground). The
    // projection independently ignores expired grants — this is cleanup, not the security check.
    api.on('time.advanced', (event, h) => {
      const { to } = event.payload as { to: number };
      // Saves from before SPY-23 kept anonymous agents: they are all home at once, and the
      // posted recon windows they held open close with them.
      const legacy = h.state as GameState & { spyAgents?: unknown; spyTurned?: unknown };
      if (legacy.spyAgents !== undefined || legacy.spyTurned !== undefined) {
        delete legacy.spyAgents;
        delete legacy.spyTurned;
        for (const playerId of Object.keys(h.state.intel ?? {})) {
          const kept = h.state.intel![playerId]!.filter((g) => g.mission === undefined);
          if (kept.length > 0) h.state.intel![playerId] = kept;
          else delete h.state.intel![playerId];
        }
      }
      const spies = h.state.spies;
      if (spies) {
        for (const owner of Object.keys(spies).sort()) {
          for (const gone of spies[owner]!.filter(
            (s) => s.turnedUntil !== undefined && s.turnedUntil <= to,
          )) {
            if (gone.posted && gone.op === 'recon') closeIntel(h, owner, gone.mission);
          }
          spies[owner] = spies[owner]!.filter(
            (s) => s.turnedUntil === undefined || s.turnedUntil > to,
          );
          settleHome(h, owner, arrive);
        }
      }
      const intel = h.state.intel;
      if (!intel) return;
      for (const playerId of Object.keys(intel)) {
        const live = intel[playerId]!.filter((g) => g.until > to);
        if (live.length === 0) delete intel[playerId];
        else if (live.length !== intel[playerId]!.length) intel[playerId] = live;
      }
      if (Object.keys(intel).length === 0) delete h.state.intel;
    });
  },
};
