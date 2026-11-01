import { hoursToMs } from '../action/types';
import type { GameModule, HandlerContext } from '../kernel/module';
import type { BuildingDamage, BuildingHit, ConstructionDelay, DelayedOrder } from './construction';
import type { TechnologyGrant } from './technology';
import { getStance, type DiplomacyCapability } from '../state/diplomacy';
import { coalitionOf } from '../state/coalition';
import { buildingLevel, type GameData, type ResourceBag } from '../data/schemas';
import type { AgentAway, GameState, IntelGrant, SpyOp } from '../state/gameState';
import { recordValues } from '../util/records';
import { canAfford, payCost, refundCost } from '../util/treasury';

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
 *     war on exposure as below) and every layer closes with it. A killed agent's
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
 *     stockpile of its own; owner's resolution 2026-10-22).
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
 * War on exposure (SPY-11, owner's resolution 2026-10-22): an aggressive mission that
 * is DETECTED (a killed agent is always detected) declares war between the world's
 * owner and the spy's owner — through the `diplomacy` capability's `declareWar`, so an
 * alliance or a pact breaks too. A caught counter-intelligence agent declares nothing:
 * both sides are at war already, and a third party's world is not party to it.
 * Members of the same coalition cannot launch aggressive missions against each other;
 * a mission already in flight aborts if its target is a coalition member on arrival.
 * This protection lasts through the pending departure, without bypassing its timer.
 *
 * After a sabotage, a theft or a research theft the agent comes home (`AGENT_RETURN_HOURS`), as after
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
 * Agent network (SPY-6): every mission needs a free agent out of a small network
 * (`espionage.agents` pipeline, base 3). No free agent → `E_NO_AGENT`, nothing
 * paid, nothing scheduled. A sent agent is away (`state.spyAgents`): on the mission
 * itself, then — after a recon success — on post until recalled or caught; after a
 * failure `AGENT_RETURN_HOURS`; a killed agent is LOST and a replacement is found in
 * `AGENT_RECRUIT_HOURS`.
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
 */

const SPY_OPS: ReadonlySet<string> = new Set<SpyOp>([
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
const BASE_CHANCE = 0.6;
const CHANCE_MIN = 0.05;
const CHANCE_MAX = 0.95;
/** How long every operation takes before it resolves, game-hours (owner, 2026-10-22). */
export const MISSION_HOURS = 12;
/** Base window length after a SUCCESS whose agent was killed, in game-hours
 *  (timeScale-compressed like every duration): the dead agent's last look. */
const BASE_DURATION_HOURS = 24;
/** SPY-13: how long a posted recon agent digs before the next layer, game-hours, and
 *  how many layers there are. Past the last one it keeps the watch (and the risk). */
const RECON_LAYER_HOURS = 12;
export const RECON_LAYERS = 4;
/** Base odds the VICTIM notices the attempt (`espionage.detect` pipeline bends them;
 *  the result is clamped to [0,1] — hooks may legitimately push to never/always). */
const BASE_DETECT_FAILED = 0.5; // a blown attempt leaves tracks
const BASE_DETECT_SUCCESS = 0.25; // a clean theft is noticed rarer
/** A beneficiary holds at most this many live grants — the oldest one is evicted
 *  first (fail-secure bound: state must not grow without limit). */
const MAX_GRANTS = 8;
/** Base size of a player's agent network (SPY-6) — the `espionage.agents` pipeline
 *  may bend it; the result is floored and clamped to [0, MAX_GRANTS]. */
export const BASE_SPY_AGENTS = 3;
/** How long an agent is away after a failed or aborted mission, game-hours. */
const AGENT_RETURN_HOURS = 6;
/** How long finding a replacement for a killed agent takes, game-hours. */
const AGENT_RECRUIT_HOURS = 24;
/** Base odds a DETECTED agent dies (`espionage.kill` pipeline, clamped to [0,1]). */
const BASE_KILL = 0.5;
/** Sabotage: how many buildings are hit (inclusive range) and the share of max HP each loses. */
const SABOTAGE_MIN = 3;
const SABOTAGE_MAX = 5;
const SABOTAGE_SHARE_MIN = 0.1;
const SABOTAGE_SHARE_MAX = 0.2;
/** Theft: the share of the chosen stock taken, and the most one theft can carry. */
/** Queue sabotage (SPY-14): the first order of the world slips by this many hours. */
const DELAY_MIN_HOURS = 6;
const DELAY_MAX_HOURS = 12;
/** Economic sabotage (SPY-15): how long the world produces how much of its output. */
const DISRUPT_HOURS = 24;
const DISRUPT_FACTOR = 0.75;

const THEFT_SHARE_MIN = 0.05;
const THEFT_SHARE_MAX = 0.15;
export const THEFT_CAP = 500;
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

/** The victim's counter-intelligence: the largest `field` bonus among the buildings
 *  on the worlds they own (SPY-7). 0 without such a building. */
export function counterIntelOf(
  data: GameData,
  state: GameState,
  playerId: string,
  field: 'spyDetectBonus' | 'spyKillBonus',
): number {
  let best = 0;
  for (const planet of recordValues(state.planets)) {
    if (planet.owner !== playerId) continue;
    for (const b of planet.buildings) {
      const def = data.buildings[b.type];
      if (def) best = Math.max(best, buildingLevel(def, b.level)[field]);
    }
  }
  return best;
}

interface SpyPayload {
  planetId?: string;
  op?: string;
}

/** What `espionage.resolve` carries: who sent which mission where. */
interface ResolvePayload {
  spy: string;
  planetId: string;
  op: SpyOp;
  mission: number;
}

/** A hook result, or its base when the pipeline broke (non-finite) — a broken
 *  pipeline must not silently switch a rule off. */
function finiteOr(raw: number, base: number): number {
  return Number.isFinite(raw) ? raw : base;
}

/** Sabotage: pick 3–5 distinct damageable buildings of the world and hand them to the
 *  `building.damage` capability. Fewer buildings than the roll → every one is hit. */
function sabotage(h: HandlerContext, planetId: string): { building: string; destroyed: boolean }[] {
  const planet = h.state.planets[planetId]!;
  const pool: { index: number; maxHp: number }[] = [];
  planet.buildings.forEach((b, index) => {
    const def = h.ctx.data.buildings[b.type];
    const maxHp = def ? buildingLevel(def, b.level).hp : 0;
    if (maxHp > 0 && b.hp > 0) pool.push({ index, maxHp });
  });
  const count = Math.min(pool.length, h.rng.nextInt(SABOTAGE_MIN, SABOTAGE_MAX + 1));
  const hits: BuildingHit[] = [];
  for (let i = 0; i < count; i++) {
    // Partial Fisher–Yates: the i-th pick comes from the not-yet-picked tail.
    const j = h.rng.nextInt(i, pool.length);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    const share = SABOTAGE_SHARE_MIN + h.rng.nextFloat() * (SABOTAGE_SHARE_MAX - SABOTAGE_SHARE_MIN);
    hits.push({ index: pool[i]!.index, amount: Math.round(pool[i]!.maxHp * share) });
  }
  return h.capability<BuildingDamage>('building.damage')?.(h, planetId, hits) ?? [];
}

/** Queue sabotage: roll 6–12 h and hand them to the `construction.delay` capability. */
function delayQueue(h: HandlerContext, planetId: string): DelayedOrder | null {
  const hours = h.rng.nextInt(DELAY_MIN_HOURS, DELAY_MAX_HOURS + 1);
  return h.capability<ConstructionDelay>('construction.delay')?.(h, planetId, hours) ?? null;
}

/** Economic sabotage: the world's output is cut until `disruptedUntil`; a repeat moves the
 *  end later, never earlier. The end is a scheduled event so that no production span runs
 *  across it — the cut covers exactly its term. Returns the end. */
function disrupt(h: HandlerContext, planetId: string): number {
  const planet = h.state.planets[planetId]!;
  const until = Math.max(planet.disruptedUntil ?? 0, h.ctx.now + hoursToMs(h.ctx, DISRUPT_HOURS));
  planet.disruptedUntil = until;
  h.schedule(until, 'espionage.disrupt.end', { planetId });
  return until;
}

/** Theft: a random resource the victim holds at least one whole unit of, 5–15% of it
 *  (rounded down, at most `THEFT_CAP`), moved to the spy. `null` — nothing to take. */
function theft(h: HandlerContext, spy: string, victim: string): { resource: string; amount: number } | null {
  const purse = h.state.players[victim]!.resources;
  const held = h.ctx.data.resources.filter((r) => (purse[r] ?? 0) >= 1);
  if (held.length === 0) return null;
  const resource = held[h.rng.nextInt(0, held.length)]!;
  const share = THEFT_SHARE_MIN + h.rng.nextFloat() * (THEFT_SHARE_MAX - THEFT_SHARE_MIN);
  const amount = Math.min(THEFT_CAP, Math.max(1, Math.floor(purse[resource]! * share)));
  payCost(purse, { [resource]: amount });
  refundCost(h.state.players[spy]!.resources, { [resource]: amount });
  return { resource, amount };
}

/** Research theft: a technology `victim` has finished and `spy` has not — first among
 *  those the spy has not started, then among those it researches now. `null` — the
 *  victim knows nothing new to the spy, or no technology module grants it. */
function stealResearch(h: HandlerContext, spy: string, victim: string): string | null {
  const own = h.state.players[spy]!.technologies;
  const done = new Set(own?.completed ?? []);
  const inLab = new Set((own?.active ?? []).map((a) => a.technology));
  const lacking = (h.state.players[victim]!.technologies?.completed ?? []).filter(
    (t) => !done.has(t) && h.ctx.data.technologies[t] !== undefined,
  );
  const fresh = lacking.filter((t) => !inLab.has(t));
  const pool = fresh.length > 0 ? fresh : lacking;
  if (pool.length === 0) return null;
  const tech = pool[h.rng.nextInt(0, pool.length)]!;
  return h.capability<TechnologyGrant>('technology.grant')?.(h, spy, tech) ? tech : null;
}

/** Posted counter-intelligence agents on `planetId`, by owner — owners in sorted order so
 *  every walk over them is deterministic. A posted recon agent (SPY-13) is no guard. */
function postedOn(state: GameState, planetId: string): { owner: string; agent: AgentAway }[] {
  const out: { owner: string; agent: AgentAway }[] = [];
  for (const owner of Object.keys(state.spyAgents ?? {}).sort()) {
    for (const agent of state.spyAgents![owner]!) {
      if (agent.posted && agent.op === 'counter' && agent.planetId === planetId) out.push({ owner, agent });
    }
  }
  return out;
}

/** Is an aggressive mission by `spy` on `planetId` watched by someone's counter-intelligence:
 *  a posted agent whose owner is neither the spy nor the spy's ally? */
function guarded(state: GameState, planetId: string, spy: string): boolean {
  return postedOn(state, planetId).some(
    ({ owner }) => owner !== spy && getStance(state, owner, spy) !== 'alliance',
  );
}

/** Close the intel a posted recon agent of `mission` held open (SPY-13). */
function closeIntel(h: HandlerContext, spy: string, mission: number): void {
  const intel = h.state.intel;
  const mine = intel?.[spy];
  if (!intel || !mine) return;
  const rest = mine.filter((g) => g.mission !== mission);
  if (rest.length > 0) intel[spy] = rest;
  else delete intel[spy];
  if (Object.keys(intel).length === 0) delete h.state.intel;
}

/** Replace the agent of `mission` with what it does next (`next`). */
function reassign(h: HandlerContext, spy: string, mission: number, next: AgentAway): void {
  const agents = (h.state.spyAgents ??= {});
  agents[spy] = [...(agents[spy] ?? []).filter((a) => a.mission !== mission), next];
}

export const espionageModule: GameModule = {
  id: 'espionage',
  // 1.1.0: саботаж и кража ресурсов (SPY-9). 1.2.0: кража исследований (SPY-10).
  // 1.4.0: coalition membership blocks hostile missions at launch and resolution.
  // 1.5.0: своя цена у операции (SPY-12). 1.6.0: срыв стройки (SPY-14).
  // 1.7.0: разведка копится слоями, агент стоит до отзыва (SPY-13).
  // 1.8.0: подрыв экономики (SPY-15).
  version: '1.8.0',
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
      if (planet?.disruptedUntil !== undefined && planet.disruptedUntil <= h.ctx.now) delete planet.disruptedUntil;
    });

    api.onAction('espionage.spy', (action, h) => {
      const p = action.payload as SpyPayload;
      if (typeof p?.op !== 'string' || !SPY_OPS.has(p.op) || typeof p.planetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const actor = h.state.players[action.playerId];
      if (!actor || actor.status !== 'active') {
        return h.reject('E_FORBIDDEN');
      }
      const planet = h.state.planets[p.planetId];
      if (!planet) {
        return h.reject('E_NO_PLANET');
      }
      // Someone else's world: your own or an unclaimed one has nobody to spy on. A
      // counter-intelligence agent may guard your own world too, but never an empty one.
      const counter = p.op === 'counter';
      if (planet.owner === null || (planet.owner === action.playerId && !counter)) {
        return h.reject('E_BAD_TARGET');
      }
      if (h.state.players[planet.owner]?.status !== 'active') {
        return h.reject('E_NO_PLAYER');
      }
      if (!counter && coalitionOf(h.state, action.playerId)?.members.includes(planet.owner)) {
        return h.reject('E_BAD_TARGET');
      }
      // One guard, and one recon agent (SPY-13), per world is all a network spares.
      const mineHere = (h.state.spyAgents?.[action.playerId] ?? []).some(
        (a) => a.op === p.op && a.planetId === p.planetId && a.until > h.ctx.now,
      );
      if ((counter || p.op === 'recon') && mineHere) {
        return h.reject('E_BAD_TARGET');
      }

      // SPY-6: a mission needs a free agent — checked before the fee, so a refusal
      // costs nothing.
      const rawAgents = h.hook<number>('espionage.agents', BASE_SPY_AGENTS, {
        playerId: action.playerId,
      });
      const agents = Number.isFinite(rawAgents)
        ? Math.min(MAX_GRANTS, Math.max(0, Math.floor(rawAgents)))
        : BASE_SPY_AGENTS;
      const away = (h.state.spyAgents?.[action.playerId] ?? []).filter((a) => a.until > h.ctx.now);
      if (away.length >= agents) {
        return h.reject('E_NO_AGENT');
      }

      const fee = h.hook<Record<string, number>>('espionage.cost', { credits: SPY_OP_COST[p.op as SpyOp] }, {
        playerId: action.playerId,
        target: planet.owner,
        kind: p.op,
      });
      if (!canAfford(actor.resources, fee)) {
        return h.reject('E_INSUFFICIENT');
      }
      payCost(actor.resources, fee); // the fee burns on failure too — spying is a gamble

      // Unique among the player's live missions — that is all `espionage.resolve` needs to
      // find its agent; a private per-player id leaks nothing (a global counter would).
      const mission = Math.max(0, ...away.map((a) => a.mission ?? 0)) + 1;
      const resolvesAt = h.ctx.now + hoursToMs(h.ctx, MISSION_HOURS);
      const op = p.op as SpyOp;
      // A counter-intelligence agent is away until recalled, from the start: housekeeping
      // must not drop it on arrival, and a recall on the way must find it.
      away.push({ until: counter ? COUNTER_POSTED : resolvesAt, mission, op, planetId: p.planetId });
      (h.state.spyAgents ??= {})[action.playerId] = away;
      h.schedule(resolvesAt, 'espionage.resolve', {
        spy: action.playerId,
        planetId: p.planetId,
        op,
        mission,
      } satisfies ResolvePayload);
      h.emit('espionage.sent', { owner: action.playerId, planetId: p.planetId, op, until: resolvesAt });
    });

    api.on('espionage.resolve', (event, h) => {
      const { spy, planetId, op, mission } = event.payload as ResolvePayload;
      const now = h.ctx.now;
      const victim = h.state.planets[planetId]?.owner ?? null;
      const comeHome: AgentAway = { until: now + hoursToMs(h.ctx, AGENT_RETURN_HOURS) };
      if (op === 'counter') {
        // Recalled on the way: its slot is already a homecoming, nothing to post.
        if (!(h.state.spyAgents?.[spy] ?? []).some((a) => a.mission === mission)) return;
        if (victim === null || h.state.players[spy]?.status !== 'active') {
          reassign(h, spy, mission, comeHome);
          h.emit('espionage.aborted', { owner: spy, planetId, kind: op });
          return;
        }
        reassign(h, spy, mission, { until: COUNTER_POSTED, mission, op, planetId, posted: true });
        h.schedule(now + hoursToMs(h.ctx, COUNTER_SWEEP_HOURS), 'espionage.sweep', {
          spy,
          planetId,
          mission,
        });
        h.emit('espionage.posted', { owner: spy, planetId });
        return;
      }
      if (
        victim === null ||
        victim === spy ||
        h.state.players[victim]?.status !== 'active' ||
        h.state.players[spy]?.status !== 'active' ||
        coalitionOf(h.state, spy)?.members.includes(victim)
      ) {
        // The current owner is no longer a hostile target: no damage or RNG draws.
        reassign(h, spy, mission, comeHome);
        h.emit('espionage.aborted', { owner: spy, planetId, kind: op });
        return;
      }

      const rawChance = h.hook<number>('espionage.chance', BASE_CHANCE, {
        playerId: spy,
        target: victim,
        kind: op,
      });
      const chance = Number.isFinite(rawChance)
        ? Math.min(CHANCE_MAX, Math.max(CHANCE_MIN, rawChance))
        : BASE_CHANCE;
      const succeeded = h.rng.nextFloat() < chance;

      // Counter-intelligence (SPY-2): the detect roll is drawn for EVERY resolved
      // mission — success or failure — so the RNG stream shape does not depend on
      // the outcome (or on what hooks did to the odds).
      // SPY-11: a counter-intelligence agent posted on the world adds its share.
      const watched = guarded(h.state, planetId, spy);
      const baseDetect =
        (succeeded ? BASE_DETECT_SUCCESS : BASE_DETECT_FAILED) +
        counterIntelOf(h.ctx.data, h.state, victim, 'spyDetectBonus') +
        (watched ? COUNTER_DETECT_BONUS : 0);
      const rawDetect = h.hook<number>('espionage.detect', baseDetect, {
        playerId: spy,
        target: victim,
        kind: op,
        succeeded,
      });
      const detectChance = Math.min(1, Math.max(0, finiteOr(rawDetect, baseDetect)));
      const detected = h.rng.nextFloat() < detectChance;

      // Death on exposure: drawn for every resolved mission too; it only bites when detected.
      const baseKill =
        BASE_KILL +
        counterIntelOf(h.ctx.data, h.state, victim, 'spyKillBonus') +
        (watched ? COUNTER_KILL_BONUS : 0);
      const rawKill = h.hook<number>('espionage.kill', baseKill, {
        playerId: spy,
        target: victim,
        kind: op,
        succeeded,
      });
      const killChance = Math.min(1, Math.max(0, finiteOr(rawKill, baseKill)));
      const killed = h.rng.nextFloat() < killChance && detected;
      const recruit: AgentAway = { until: now + hoursToMs(h.ctx, AGENT_RECRUIT_HOURS), lost: true };
      // War on exposure (SPY-11): even an ally or a pact partner caught spying is an enemy now.
      if (detected) {
        h.capability<DiplomacyCapability>('diplomacy')?.declareWar?.(h, victim, spy, 'espionage');
      }

      if (!succeeded) {
        reassign(h, spy, mission, killed ? recruit : comeHome);
        // Addressed to the actor (`owner` routes the event through the fog filter).
        h.emit('espionage.failed', {
          owner: spy,
          target: victim,
          kind: op,
          planetId,
          ...(killed ? { agentLost: true } : {}),
        });
        if (detected) {
          // Caught red-handed: the victim learns the operation AND who sent the agent.
          h.emit('espionage.detected', {
            owner: victim,
            kind: op,
            planetId,
            spy,
            ...(killed ? { killed: true } : {}),
          });
        }
        return;
      }

      if (op !== 'recon') {
        // Sabotage / theft / research theft: the deed is done at once, the agent heads home.
        const done =
          op === 'sabotage'
            ? { hits: sabotage(h, planetId) }
            : op === 'delay'
              ? { delayed: delayQueue(h, planetId) }
              : op === 'disrupt'
                ? { disrupted: disrupt(h, planetId) }
                : op === 'theft'
                ? { loot: theft(h, spy, victim) }
                : { tech: stealResearch(h, spy, victim) };
        reassign(h, spy, mission, killed ? recruit : comeHome);
        h.emit('espionage.succeeded', {
          owner: spy,
          target: victim,
          kind: op,
          planetId,
          ...done,
          ...(killed ? { agentLost: true } : {}),
        });
        if (detected) {
          h.emit('espionage.detected', {
            owner: victim,
            kind: op,
            planetId,
            ...(killed ? { killed: true } : {}),
          });
        }
        return;
      }

      // SPY-13: a surviving agent stays on post and holds the first layer open until it is
      // recalled or caught; a killed one leaves only its last look, a plain window.
      let grant: IntelGrant;
      if (killed) {
        const rawHours = h.hook<number>('espionage.duration', BASE_DURATION_HOURS, {
          playerId: spy,
          target: victim,
          kind: op,
        });
        const hours =
          Number.isFinite(rawHours) && rawHours > 0 ? rawHours : BASE_DURATION_HOURS;
        grant = { kind: 'planet', target: planetId, until: now + hoursToMs(h.ctx, hours) };
        reassign(h, spy, mission, recruit);
      } else {
        grant = { kind: 'planet', target: planetId, until: COUNTER_POSTED, layer: 1, mission };
        reassign(h, spy, mission, { until: COUNTER_POSTED, mission, op, planetId, posted: true });
        h.schedule(now + hoursToMs(h.ctx, RECON_LAYER_HOURS), 'espionage.deepen', {
          spy,
          planetId,
          mission,
        });
      }
      const mine = ((h.state.intel ??= {})[spy] ??= []);
      mine.push(grant);
      while (mine.length > MAX_GRANTS) mine.shift(); // oldest window evicted first
      h.emit('intel.stolen', {
        owner: spy,
        target: victim,
        kind: op,
        planetId,
        until: grant.until,
        ...(grant.layer ? { layer: grant.layer } : {}),
        ...(killed ? { agentLost: true } : {}),
      });
      if (detected) {
        // A noticed CLEAN theft: the victim learns the leak, not the thief.
        h.emit('espionage.detected', {
          owner: victim,
          kind: op,
          planetId,
          ...(killed ? { killed: true } : {}),
        });
      }
    });

    // SPY-13: a posted recon agent digs one layer deeper — and risks exposure — every
    // `RECON_LAYER_HOURS`. Recalled, caught or evicted → its watch is over.
    api.on('espionage.deepen', (event, h) => {
      const { spy, planetId, mission } = event.payload as { spy: string; planetId: string; mission: number };
      const agent = (h.state.spyAgents?.[spy] ?? []).find(
        (a) => a.posted && a.op === 'recon' && a.mission === mission,
      );
      if (!agent) return;
      const now = h.ctx.now;
      const comeHome: AgentAway = { until: now + hoursToMs(h.ctx, AGENT_RETURN_HOURS) };
      const grant = (h.state.intel?.[spy] ?? []).find((g) => g.mission === mission);
      const victim = h.state.planets[planetId]?.owner ?? null;
      if (
        !grant ||
        victim === null ||
        victim === spy ||
        h.state.players[victim]?.status !== 'active' ||
        h.state.players[spy]?.status !== 'active' ||
        coalitionOf(h.state, spy)?.members.includes(victim)
      ) {
        // No hostile owner to dig into any more (captured, abandoned, joined the spy's
        // coalition), or the grant was evicted: the agent comes home with nothing new.
        closeIntel(h, spy, mission);
        reassign(h, spy, mission, comeHome);
        h.emit('espionage.aborted', { owner: spy, planetId, kind: 'recon' });
        return;
      }
      // Detection and death are drawn at every step, both of them, as on arrival.
      const watched = guarded(h.state, planetId, spy);
      const baseDetect =
        BASE_DETECT_SUCCESS +
        counterIntelOf(h.ctx.data, h.state, victim, 'spyDetectBonus') +
        (watched ? COUNTER_DETECT_BONUS : 0);
      const rawDetect = h.hook<number>('espionage.detect', baseDetect, {
        playerId: spy,
        target: victim,
        kind: 'recon',
        succeeded: true,
      });
      const detected = h.rng.nextFloat() < Math.min(1, Math.max(0, finiteOr(rawDetect, baseDetect)));
      const baseKill =
        BASE_KILL +
        counterIntelOf(h.ctx.data, h.state, victim, 'spyKillBonus') +
        (watched ? COUNTER_KILL_BONUS : 0);
      const rawKill = h.hook<number>('espionage.kill', baseKill, {
        playerId: spy,
        target: victim,
        kind: 'recon',
        succeeded: true,
      });
      const killed = h.rng.nextFloat() < Math.min(1, Math.max(0, finiteOr(rawKill, baseKill))) && detected;
      if (detected) {
        h.capability<DiplomacyCapability>('diplomacy')?.declareWar?.(h, victim, spy, 'espionage');
        closeIntel(h, spy, mission);
        reassign(
          h,
          spy,
          mission,
          killed ? { until: now + hoursToMs(h.ctx, AGENT_RECRUIT_HOURS), lost: true } : comeHome,
        );
        h.emit('intel.lost', { owner: spy, target: victim, planetId, ...(killed ? { agentLost: true } : {}) });
        h.emit('espionage.detected', {
          owner: victim,
          kind: 'recon',
          planetId,
          ...(killed ? { killed: true } : {}),
        });
        return;
      }
      const layer = grant.layer ?? 1;
      if (layer < RECON_LAYERS) {
        grant.layer = layer + 1;
        h.emit('intel.deepened', { owner: spy, target: victim, planetId, layer: grant.layer });
      }
      h.schedule(now + hoursToMs(h.ctx, RECON_LAYER_HOURS), 'espionage.deepen', { spy, planetId, mission });
    });

    // SPY-11: a posted counter-intelligence agent hunts hostile guards on its world.
    api.on('espionage.sweep', (event, h) => {
      const { spy, planetId, mission } = event.payload as { spy: string; planetId: string; mission: number };
      const mine = (h.state.spyAgents?.[spy] ?? []).find((a) => a.posted && a.mission === mission);
      if (!mine) return; // recalled or caught — its watch is over
      const now = h.ctx.now;
      const comeHome: AgentAway = { until: now + hoursToMs(h.ctx, AGENT_RETURN_HOURS) };
      if (!h.state.planets[planetId]?.owner || h.state.players[spy]?.status !== 'active') {
        reassign(h, spy, mission, comeHome);
        h.emit('espionage.aborted', { owner: spy, planetId, kind: 'counter' });
        return;
      }
      for (const { owner, agent } of postedOn(h.state, planetId)) {
        if (owner === spy || getStance(h.state, spy, owner) !== 'war') continue;
        const caught = h.rng.nextFloat() < COUNTER_CATCH;
        const killed = h.rng.nextFloat() < BASE_KILL + COUNTER_KILL_BONUS && caught;
        if (!caught) continue;
        reassign(
          h,
          owner,
          agent.mission!,
          killed ? { until: now + hoursToMs(h.ctx, AGENT_RECRUIT_HOURS), lost: true } : comeHome,
        );
        h.emit('espionage.counter.caught', { owner: spy, planetId, spy: owner, ...(killed ? { killed: true } : {}) });
        h.emit('espionage.counter.lost', { owner, planetId, ...(killed ? { agentLost: true } : {}) });
      }
      h.schedule(now + hoursToMs(h.ctx, COUNTER_SWEEP_HOURS), 'espionage.sweep', { spy, planetId, mission });
    });

    api.onAction('espionage.recall', (action, h) => {
      const { planetId, op } = action.payload as { planetId?: unknown; op?: unknown };
      if (typeof planetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      if (op !== undefined && op !== 'counter' && op !== 'recon') return h.reject('E_BAD_PAYLOAD');
      const recon = op === 'recon';
      // A guard can be called off its way there too; a recon agent only once on post.
      const agent = (h.state.spyAgents?.[action.playerId] ?? []).find(
        (a) =>
          a.op === (recon ? 'recon' : 'counter') &&
          a.planetId === planetId &&
          a.until > h.ctx.now &&
          (!recon || a.posted),
      );
      if (!agent || agent.mission === undefined) return h.reject('E_BAD_TARGET');
      if (recon) closeIntel(h, action.playerId, agent.mission); // every layer closes with it
      reassign(h, action.playerId, agent.mission, {
        until: h.ctx.now + hoursToMs(h.ctx, AGENT_RETURN_HOURS),
      });
      h.emit('espionage.recalled', { owner: action.playerId, planetId, ...(recon ? { kind: 'recon' } : {}) });
    });

    // Housekeeping: expired windows and returned agents are dropped as time
    // advances, so persisted state stays small. The projection independently
    // ignores expired grants — this is cleanup, not the security check.
    api.on('time.advanced', (event, h) => {
      const { to } = event.payload as { to: number };
      const agents = h.state.spyAgents;
      if (agents) {
        for (const playerId of Object.keys(agents)) {
          const still = agents[playerId]!.filter((a) => a.until > to);
          if (still.length === 0) delete agents[playerId];
          else if (still.length !== agents[playerId]!.length) agents[playerId] = still;
        }
        if (Object.keys(agents).length === 0) delete h.state.spyAgents;
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
