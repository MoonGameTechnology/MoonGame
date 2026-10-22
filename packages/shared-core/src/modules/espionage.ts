import { hoursToMs } from '../action/types';
import type { GameModule, HandlerContext } from '../kernel/module';
import { buildingLevel, type GameData } from '../data/schemas';
import type { AgentAway, GameState, IntelGrant, SpyOp } from '../state/gameState';
import { recordValues } from '../util/records';
import { canAfford, payCost } from '../util/treasury';

/**
 * Espionage: an agent is sent to ONE PLANET on an operation (SPY-8, owner's
 * resolution 2026-10-22 — a spy targets a world, not a player). `espionage.spy`
 * takes a free agent, pays the fee and schedules `espionage.resolve` at the end of
 * the mission (`MISSION_HOURS`); every roll happens THEN, against whoever owns the
 * planet at that moment. Operations:
 *
 *   - `recon` — a time-boxed WINDOW of intel (`IntelGrant`): `visibleState` lets
 *     the spy (and only them) see the world as identified — its buildings, ground
 *     army and the fleets in its orbit — until the window closes.
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
 * itself, then — after a success — as long as the stolen window stays open; after a
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

const SPY_OPS: ReadonlySet<string> = new Set<SpyOp>(['recon']);

/** Base price of one mission — overridden per-match via the `espionage.cost` hook. */
const BASE_COST = { credits: 150 } as const;
/** Base success chance — the `espionage.chance` pipeline may bend it; the result
 *  is clamped so no stack of modifiers makes spying a certainty or an impossibility. */
const BASE_CHANCE = 0.6;
const CHANCE_MIN = 0.05;
const CHANCE_MAX = 0.95;
/** How long every operation takes before it resolves, game-hours (owner, 2026-10-22). */
export const MISSION_HOURS = 12;
/** Base window length, in game-hours (timeScale-compressed like every duration). */
const BASE_DURATION_HOURS = 24;
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

/** Replace the agent of `mission` with what it does next (`next`). */
function reassign(h: HandlerContext, spy: string, mission: number, next: AgentAway): void {
  const agents = (h.state.spyAgents ??= {});
  agents[spy] = [...(agents[spy] ?? []).filter((a) => a.mission !== mission), next];
}

export const espionageModule: GameModule = {
  id: 'espionage',
  version: '1.0.0',
  setup(api) {
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
      // Someone else's world: your own or an unclaimed one has nobody to spy on.
      if (planet.owner === null || planet.owner === action.playerId) {
        return h.reject('E_BAD_TARGET');
      }
      if (h.state.players[planet.owner]?.status !== 'active') {
        return h.reject('E_NO_PLAYER');
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

      const fee = h.hook<Record<string, number>>('espionage.cost', { ...BASE_COST }, {
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
      away.push({ until: resolvesAt, mission, op, planetId: p.planetId });
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
      if (
        victim === null ||
        victim === spy ||
        h.state.players[victim]?.status !== 'active' ||
        h.state.players[spy]?.status !== 'active'
      ) {
        // Nobody else holds the world any more: nothing to steal, nothing rolled.
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
      const baseDetect =
        (succeeded ? BASE_DETECT_SUCCESS : BASE_DETECT_FAILED) +
        counterIntelOf(h.ctx.data, h.state, victim, 'spyDetectBonus');
      const rawDetect = h.hook<number>('espionage.detect', baseDetect, {
        playerId: spy,
        target: victim,
        kind: op,
        succeeded,
      });
      const detectChance = Math.min(1, Math.max(0, finiteOr(rawDetect, baseDetect)));
      const detected = h.rng.nextFloat() < detectChance;

      // Death on exposure: drawn for every resolved mission too; it only bites when detected.
      const baseKill = BASE_KILL + counterIntelOf(h.ctx.data, h.state, victim, 'spyKillBonus');
      const rawKill = h.hook<number>('espionage.kill', baseKill, {
        playerId: spy,
        target: victim,
        kind: op,
        succeeded,
      });
      const killChance = Math.min(1, Math.max(0, finiteOr(rawKill, baseKill)));
      const killed = h.rng.nextFloat() < killChance && detected;
      const recruit: AgentAway = { until: now + hoursToMs(h.ctx, AGENT_RECRUIT_HOURS), lost: true };

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

      const rawHours = h.hook<number>('espionage.duration', BASE_DURATION_HOURS, {
        playerId: spy,
        target: victim,
        kind: op,
      });
      const hours =
        Number.isFinite(rawHours) && rawHours > 0 ? rawHours : BASE_DURATION_HOURS;
      const grant: IntelGrant = { kind: 'planet', target: planetId, until: now + hoursToMs(h.ctx, hours) };
      const mine = ((h.state.intel ??= {})[spy] ??= []);
      mine.push(grant);
      while (mine.length > MAX_GRANTS) mine.shift(); // oldest window evicted first
      // The agent works the window while it is open — unless it was killed.
      reassign(h, spy, mission, killed ? recruit : { until: grant.until });
      h.emit('intel.stolen', {
        owner: spy,
        target: victim,
        kind: op,
        planetId,
        until: grant.until,
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
