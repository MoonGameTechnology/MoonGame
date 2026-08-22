/**
 * PvE — a common NPC enemy that attacks in scheduled waves (docs/game-modes-roadmap.md
 * GM-4.6, план реализации `docs/pve-team-modes-roadmap.md` Фаза 3).
 *
 * The whole mechanic is switched on by DATA, not by a flag: the match's mode
 * (`ctx.config.modeId` → `data.modes[id].pve`, PVE-0.2) either carries a `pve` section
 * or it doesn't. A match whose mode has none never grows `state.pve` and never
 * schedules anything, so a PvP match carries no trace of this module — which is what
 * "нет модуля → база, а не падение" has to mean for a module that IS present.
 *
 * Two design points worth stating, because both differ from the roadmap's first sketch:
 *
 * 1. **A wave is a scheduled EVENT, not a player action.** The roadmap wrote
 *    `onAction('pve.spawnWave')`. That would be wrong on purpose-built grounds: an
 *    action type is a client-submittable intent, so a player could summon (or delay)
 *    the wave that is supposed to be attacking them. `h.schedule` + `api.on` keeps the
 *    timeline server-owned and replayable — the wave lives in `state.scheduled`, in
 *    `(at, seq)` order, exactly like a fleet arrival.
 * 2. **The NPC is found by FACTION, not by an `ai` flag.** `Player.ai` also marks the
 *    stand-in bot that takes an abandoned human seat (SES-2.2), so keying off it would
 *    make a disconnected player's chair start spawning the Swarm. The mode names its
 *    `npcFaction`; the seat playing that faction is the enemy. No seat plays it ⇒ the
 *    module stays inert rather than inventing one.
 *
 * Wave composition is deliberately the crudest thing that is data-driven and
 * deterministic: the NPC faction's own `startingLoadout.fleet`, scaled by the wave
 * number, so wave N is N times the opening force. Every number lives in content
 * (`data/modes.json` — count and spacing; `data/factions.json` — composition), so
 * balancing waves is a JSON edit, never a code change.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, GameState, PlayerId } from '../state/gameState';
import type { ModePve } from '../data/schemas';
import { hoursToMs } from '../action/types';

/** The scheduled event a due wave fires. Internal: it has no payload schema, so the
 *  action gate treats it as non-submittable — a player cannot call a wave down. */
const WAVE_EVENT = 'pve.wave';

/** The PvE section of the match's mode, or undefined if this match isn't PvE. */
function pveOf(h: HandlerContext): ModePve | undefined {
  const modeId = h.ctx.config?.modeId;
  return modeId === undefined ? undefined : h.ctx.data.modes[modeId]?.pve;
}

/** The seat playing the mode's NPC faction. Deterministic despite `Object.entries`:
 *  ids are compared, so insertion order can't pick a different seat on a replay. */
function npcSeat(state: GameState, npcFaction: string): PlayerId | undefined {
  let found: PlayerId | undefined;
  for (const [id, player] of Object.entries(state.players)) {
    if (player.faction !== npcFaction) continue;
    if (found === undefined || id < found) found = id;
  }
  return found;
}

/** Where a wave materialises: a world the NPC holds. Lowest id wins — a stable choice
 *  that survives replay. No world ⇒ nowhere to spawn, and the wave is skipped rather
 *  than dropped into the void. */
function npcStagingWorld(state: GameState, npcId: PlayerId): string | undefined {
  let found: string | undefined;
  for (const [id, planet] of Object.entries(state.planets)) {
    if (planet.owner !== npcId) continue;
    if (found === undefined || id < found) found = id;
  }
  return found;
}

/**
 * Arm the next wave `waveIntervalHours` after `since`, and echo its time for the HUD.
 * Past the last wave nothing is scheduled and `nextWaveAt` is cleared — the assault
 * is over.
 *
 * `since` is a parameter rather than always `h.ctx.now` because the two callers anchor
 * differently, and getting it wrong is silently wrong: seeding runs inside a
 * `time.advanced` span whose `ctx.now` is the span's END, so anchoring the FIRST wave
 * there would make it land `interval` after whenever the host happened to advance the
 * clock — a restored match that catches up a week in one call would push its opening
 * wave a week out. Anchoring on the span's `from` keeps "N hours into the match"
 * meaning what it says. Later waves anchor on `ctx.now`, which inside a wave's own
 * handler IS that wave's instant.
 */
function armNextWave(
  h: HandlerContext,
  pve: NonNullable<GameState['pve']>,
  cfg: ModePve,
  since: number,
): void {
  if (pve.waveNumber >= pve.totalWaves) {
    delete pve.nextWaveAt;
    return;
  }
  const at = since + hoursToMs(h.ctx, cfg.waveIntervalHours);
  pve.nextWaveAt = at;
  h.schedule(at, WAVE_EVENT, { wave: pve.waveNumber + 1 });
}

export const pveModule: GameModule = {
  id: 'pve',
  version: '1.0.0',
  setup(api) {
    // Seeding rides on `time.advanced` rather than a match-start event: the kernel
    // emits it for the first continuous span of every match, so a PvE match arms its
    // opening wave the first time its world clock moves — including a match restored
    // from a snapshot taken before this module existed.
    api.on('time.advanced', (event, h) => {
      const cfg = pveOf(h);
      if (!cfg) return; // not a PvE match — this module is inert here
      if (h.state.pve) return; // already seeded; waves ride the schedule from now on
      const npcPlayerId = npcSeat(h.state, cfg.npcFaction);
      if (npcPlayerId === undefined) return; // no seat plays the enemy — stay inert
      const pve = { waveNumber: 0, totalWaves: cfg.waves, npcPlayerId };
      h.state.pve = pve;
      const { from } = event.payload as { from: number };
      armNextWave(h, pve, cfg, from);
      h.emit('pve.started', { owner: npcPlayerId, waves: cfg.waves });
    });

    api.on(WAVE_EVENT, (_event, h) => {
      // Tolerant of a world that moved on (invariant: a scheduled handler must never
      // wedge the timeline). Every early return here is a wave that quietly doesn't
      // happen, never a throw.
      const cfg = pveOf(h);
      const pve = h.state.pve;
      if (!cfg || !pve) return;
      if (pve.waveNumber >= pve.totalWaves) return; // the assault already finished
      pve.waveNumber += 1;

      const at = npcStagingWorld(h.state, pve.npcPlayerId);
      const loadout = h.ctx.data.factions[cfg.npcFaction]?.startingLoadout.fleet;
      if (at !== undefined && loadout && loadout.length > 0) {
        const fleetId = `pve:wave:${pve.waveNumber}`;
        const fleet: Fleet = {
          id: fleetId,
          owner: pve.npcPlayerId,
          location: at,
          movement: null,
          // Wave N fields N times the faction's opening force — the crudest ramp that
          // is deterministic and lives entirely in content.
          units: loadout.map((stack) => ({ unit: stack.unit, count: stack.count * pve.waveNumber })),
          traits: [],
          orbit: 'near',
        };
        h.state.fleets[fleetId] = fleet;
        h.emit('pve.wave.spawned', {
          owner: pve.npcPlayerId,
          fleetId,
          location: at,
          wave: pve.waveNumber,
        });
      }
      armNextWave(h, pve, cfg, h.ctx.now);
    });
  },
};
