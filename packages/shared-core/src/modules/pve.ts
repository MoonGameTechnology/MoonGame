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
 * deterministic: one declared force, fielded N times over on wave N. The mode's own
 * `waveFleet` says what that force is; a mode that omits it falls back to the NPC
 * faction's `startingLoadout.fleet` (the pre-existing behaviour). The fallback is the
 * compatible default, not the intended knob — `startingLoadout` answers "what does a
 * PLAYER of this faction open with", and the Swarm is playable, so balancing the
 * assault through it would re-balance every match someone picks the Swarm (PVR-1.3).
 * Either way every number lives in content (`data/modes.json`), so balancing waves is
 * a JSON edit, never a code change.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, GameState, PlayerId, UnitStack } from '../state/gameState';
import type { ModePve } from '../data/schemas';
import { hoursToMs } from '../action/types';
import { setStance } from '../state/diplomacy';
import { mergeStacks } from '../util/stacks';
import { producedForcesAt, waveStagingWorld } from '../util/pveStaging';

/** The scheduled event a due wave fires. Internal: it has no payload schema, so the
 *  action gate treats it as non-submittable — a player cannot call a wave down. */
const WAVE_EVENT = 'pve.wave';

/** The beat at the end of the hold-out (PVR-2.5). It carries no rule of its own: it only
 *  splits the timeline AT the deadline, so `victoryModule` (subscribed to it by name —
 *  modules meet on the bus, never by import) judges the run at that instant rather than
 *  wherever the host's next advance happens to end. Internal, like the wave event. */
const HOLD_EVENT = 'pve.hold';

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

/** Where a wave materialises when the hive is lost: a world the NPC holds. Lowest id
 *  wins — a stable choice that survives replay. No world ⇒ nowhere to spawn, and the
 *  wave is skipped rather than dropped into the void. The hive itself (`PveState.home`)
 *  is picked by this same rule at seeding. */
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

/**
 * Start the hold-out that clears the run (PVR-2.5, «победа — выстоять»): the humans must
 * still hold a world `holdHours` from now. Once per match — a deadline already set is
 * never pushed back — and only under a mode that declares one. The beat at the deadline
 * splits the timeline there, so `victoryModule` judges the run AT that instant.
 */
function startHoldOut(
  h: HandlerContext,
  pve: NonNullable<GameState['pve']>,
  cfg: ModePve,
): void {
  if (cfg.holdHours === undefined || pve.holdUntil !== undefined) return;
  pve.holdUntil = h.ctx.now + hoursToMs(h.ctx, cfg.holdHours);
  h.schedule(pve.holdUntil, HOLD_EVENT, {});
}

/**
 * Declare the NPC at war with every other seat (PVR-1.5).
 *
 * Without this the mechanic was inert in the only way that matters: waves spawned on
 * schedule and then SAT in the hive. A map that declares plain players seeds every pair
 * at `peace` (the free-for-all convention — the engine's bare default is war, but the
 * loader overrides it), and a bot never opens a war on its own. So a PvE match ran to
 * its last wave without a single battle, and the player met the assault as a growing
 * pile of parked fleets.
 *
 * Declared HERE because this module is the only place that knows who the enemy is: the
 * mode names `npcFaction`, `npcSeat` resolves it. Done at seeding, once, so the stance
 * is set before the first wave is even armed.
 *
 * Only pairs INVOLVING the NPC are touched — an alliance between the human seats is
 * theirs to keep, and co-op PvE is exactly the case where rewriting it would be wrong.
 */
function declareWarOnEveryone(h: HandlerContext, npcPlayerId: PlayerId): void {
  // Ids are compared, not insertion order, so a replay sets the same stances in the
  // same order (determinism, invariant #1).
  for (const id of Object.keys(h.state.players).sort()) {
    if (id === npcPlayerId) continue;
    setStance(h.state, npcPlayerId, id, 'war');
    h.emit('diplomacy.changed', { a: npcPlayerId, b: id, stance: 'war' });
  }
}

/**
 * Owe every surviving human seat one boon pick, for the wave that just landed (PVR-1.4).
 *
 * The beat is the wave's ARRIVAL, not its destruction, and that is deliberate. "Repelled"
 * has no crisp moment on this timeline: waves are six hours apart and take far longer to
 * cross the map, so several are in flight at once, and the seat AI MERGES them — the
 * fleet that dies is rarely the fleet that spawned, so counting dead `pve:wave:N` ids
 * would pay out at the mercy of a merge. "You were still standing when the next one
 * arrived" is the same promise, stated in a way the timeline can actually keep.
 *
 * A seat holding no world is skipped: it is losing, not surviving. Iteration is over
 * sorted ids so a replay owes the same seats in the same order (invariant #1).
 */
function oweBoons(h: HandlerContext, pve: NonNullable<GameState['pve']>, cfg: ModePve): void {
  if (!cfg.boons || cfg.boons.length === 0) return; // режим усилений не объявлял
  const holds = new Set<PlayerId>();
  for (const planet of Object.values(h.state.planets)) {
    if (planet.owner !== null && planet.owner !== pve.npcPlayerId) holds.add(planet.owner);
  }
  for (const id of Object.keys(h.state.players).sort()) {
    if (id === pve.npcPlayerId || h.state.players[id]!.npc || !holds.has(id)) continue;
    pve.boons = pve.boons ?? {};
    pve.boons[id] = (pve.boons[id] ?? 0) + 1;
  }
}

export const pveModule: GameModule = {
  id: 'pve',
  version: '1.2.0',
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
      const home = npcStagingWorld(h.state, npcPlayerId);
      const pve = {
        waveNumber: 0,
        totalWaves: cfg.waves,
        npcPlayerId,
        ...(home !== undefined ? { home } : {}),
      };
      h.state.pve = pve;
      declareWarOnEveryone(h, npcPlayerId);
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
      if (pve.waveNumber >= pve.totalWaves) {
        // The assault already finished — yet a beat is still due. That is a world restored
        // PAST its last wave: a portable save (YAG-2.1) rebuilds a freshly seeded match and
        // sets the counter, so the fresh schedule's beat outlives it while the save carries
        // no deadline. This beat is where the hold-out starts; for a live match it is a
        // no-op, the deadline having been set when the last wave actually landed.
        startHoldOut(h, pve, cfg);
        return;
      }
      pve.waveNumber += 1;

      // Волна рождается в улье, пока он в руках NPC; пал — в самом дальнем от игроков мире
      // (решение владельца 2026-09-24, `util/pveStaging.ts`).
      const at = waveStagingWorld(h.state);
      const loadout = cfg.waveFleet ?? h.ctx.data.factions[cfg.npcFaction]?.startingLoadout.fleet;
      if (at !== undefined && loadout && loadout.length > 0) {
        const fleetId = `pve:wave:${pve.waveNumber}`;
        // Wave N fields N times the declared force — the crudest ramp that is
        // deterministic and lives entirely in content.
        const scaled = (
          stacks: readonly { unit: string; count: number; modules?: string[] }[],
        ): UnitStack[] =>
          stacks.map((stack) => ({
            unit: stack.unit,
            count: stack.count * pve.waveNumber,
            ...(stack.modules?.length ? { modules: [...stack.modules] } : {}),
          }));
        const landing = scaled(cfg.waveLanding ?? []);
        // Несомое по одному — без роста с номером волны (малый ретранслятор Роя).
        const fixed: UnitStack[] = (cfg.waveFixed ?? []).map((stack) => ({
          unit: stack.unit,
          count: stack.count,
          ...(stack.modules?.length ? { modules: [...stack.modules] } : {}),
        }));
        const fleet: Fleet = {
          id: fleetId,
          owner: pve.npcPlayerId,
          location: at,
          movement: null,
          units: [...scaled(loadout), ...fixed],
          traits: [],
          orbit: 'near',
          // Omitted rather than empty when the mode declares no landing party: a mode
          // without one keeps producing exactly the fleet shape it produced before.
          ...(landing.length > 0 ? { landing } : {}),
        };
        h.state.fleets[fleetId] = fleet;
        // Построенное Роем уходит с волной (решение владельца 2026-09-24): флоты сбора,
        // ждущие в улье, вливаются в неё вместе с трюмом. Стартовые флоты карты — нет.
        for (const produced of producedForcesAt(h.state, h.ctx.data, pve.npcPlayerId, at)) {
          const from = h.state.fleets[produced]!;
          fleet.units = mergeStacks(fleet.units, from.units);
          const hold = mergeStacks(fleet.landing ?? [], from.landing ?? []);
          if (hold.length > 0) fleet.landing = hold;
          delete h.state.fleets[produced];
          h.emit('fleet.merged', { from: produced, into: fleetId, owner: pve.npcPlayerId, at });
        }
        h.emit('pve.wave.spawned', {
          owner: pve.npcPlayerId,
          fleetId,
          location: at,
          wave: pve.waveNumber,
        });
      }
      oweBoons(h, pve, cfg);
      // The last wave has landed: start the hold-out (PVR-2.5). Keyed on the COUNTER,
      // not on a spawn — a wave skipped for want of a staging world still ends the
      // assault, so a run that wiped the hive early gets its deadline all the same.
      if (pve.waveNumber >= pve.totalWaves) startHoldOut(h, pve, cfg);
      armNextWave(h, pve, cfg, h.ctx.now);
    });

    // Забрать усиление. ИНТЕНТ игрока, а не событие: выбор делает человек, и сервер
    // обязан его проверить (инвариант №5). Всё, что не сошлось, — отказ со стабильным
    // кодом, а не тихая выдача (инвариант №4).
    api.onAction('pve.boon', (action, h) => {
      const cfg = pveOf(h);
      const pve = h.state.pve;
      if (!cfg || !pve) return h.reject('E_NOT_PVE');
      const tech = (action.payload as { tech?: unknown })?.tech;
      if (typeof tech !== 'string') return h.reject('E_BAD_PAYLOAD');
      if ((pve.boons?.[action.playerId] ?? 0) <= 0) return h.reject('E_NO_BOON');
      if (!(cfg.boons ?? []).includes(tech)) return h.reject('E_UNKNOWN_BOON');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_FORBIDDEN');
      const completed = player.technologies?.completed ?? [];
      if (completed.includes(tech)) return h.reject('E_ALREADY_TAKEN');
      player.technologies = { ...player.technologies, completed: [...completed, tech] };
      pve.boons![action.playerId] = (pve.boons![action.playerId] ?? 0) - 1;
      h.emit('pve.boon.taken', { owner: action.playerId, tech });
    });

    // Пакет снабжения (решение владельца 2026-09-24). Платят за него Сувернами — валютой
    // АККАУНТА, которой в матче нет: хост сперва проверяет, что профиль может заплатить,
    // потом зовёт это действие и списывает, только если оно прошло. Действие хостовое по
    // построению, как `fleet.premiumRepair`: в `actionPayloadSchemas` его нет, и гейт
    // действий не примет его от клиента — бесплатного снабжения в онлайне не бывает.
    api.onAction('pve.supply', (action, h) => {
      const cfg = pveOf(h);
      const pve = h.state.pve;
      if (!cfg || !pve) return h.reject('E_NOT_PVE');
      const supply = cfg.supply;
      if (!supply || supply.perRun <= 0) return h.reject('E_NO_SUPPLY');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_FORBIDDEN');
      const bought = pve.supplies?.[action.playerId] ?? 0;
      if (bought >= supply.perRun) return h.reject('E_SUPPLY_EXHAUSTED');
      for (const [res, n] of Object.entries(supply.pack))
        player.resources[res] = (player.resources[res] ?? 0) + n;
      pve.supplies = { ...pve.supplies, [action.playerId]: bought + 1 };
      h.emit('pve.supply.delivered', { owner: action.playerId, pack: { ...supply.pack } });
    });
  },
};
