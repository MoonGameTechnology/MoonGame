import type { GameModule, HandlerContext } from '../kernel/module';
import type { FogMemory, GameState, PlanetId, PlanetSnapshot } from '../state/gameState';
import { observedSwarm } from '../state/swarmIntel';
import { identifiedNodes } from '../state/visibility';

/**
 * Visibility — fog-of-war MEMORY (variant B). The security projection
 * (`visibleState`) hides what a player cannot currently see; this module is the
 * other half: it records the last-known snapshot of every world a player has
 * identified, so `visibleState` can show it greyed ("last known") once sight
 * lifts. Memory lives inside `GameState` (deterministic, persisted, JSON), is
 * updated only from the authoritative state, and degrades gracefully — without
 * this module there is simply no memory and unseen worlds read as unknown.
 */

function snapshot(state: GameState, planetId: PlanetId, now: number): PlanetSnapshot {
  const planet = state.planets[planetId]!;
  const snap: PlanetSnapshot = {
    owner: planet.owner,
    garrison: planet.garrison.map((s) => ({ ...s })),
    buildings: planet.buildings.map((b) => ({ ...b })),
    at: now,
  };
  if (planet.terrain !== undefined) snap.terrain = planet.terrain;
  if (planet.planetType !== undefined) snap.planetType = planet.planetType;
  if (planet.kind !== undefined) snap.kind = planet.kind;
  return snap;
}

/** Refresh every active player's memory with what they currently identify. */
function refreshMemory(h: HandlerContext): void {
  const state = h.state;
  const fog = (state.fog ??= {});
  for (const playerId of Object.keys(state.players)) {
    if (state.players[playerId]?.status !== 'active') continue;
    const memory: FogMemory = fog[playerId] ?? (fog[playerId] = {});
    const identified = identifiedNodes(state, playerId, h.ctx.data);
    const contacts = observedSwarm(state, playerId, identified, h.ctx.now);
    if (Object.keys(contacts).length) {
      const intel = (state.swarmIntel ??= {});
      intel[playerId] = { ...intel[playerId], ...contacts };
    }
    for (const nodeId of identified) {
      if (state.planets[nodeId]) memory[nodeId] = snapshot(state, nodeId, h.ctx.now);
    }
  }
}

/** Радиусы зрения режима — один раз, на первом шаге часов, как `pve` заводит свою волну:
 *  дальше матч живёт со своими числами, и правка баланса не переписывает идущий матч. У
 *  режима без раздела `sight` поле не появляется — действуют общие числа ядра. Матч,
 *  сохранённый до этого поля, получает числа своего режима на первом же шаге после загрузки. */
function pinSight(h: HandlerContext): void {
  if (h.state.sight !== undefined) return;
  const modeId = h.ctx.config?.modeId;
  const sight = modeId === undefined ? undefined : h.ctx.data.modes[modeId]?.sight;
  if (sight) h.state.sight = { ...sight };
}

export const visibilityModule: GameModule = {
  id: 'visibility',
  // 2.0.0 — зрение кругами вместо соседства по линиям (решение владельца 2026-09-24):
  // память тумана старых реплеев пишется иначе.
  version: '2.0.0',
  setup(api) {
    // Continuous time advances refresh memory; captures and arrivals refresh it
    // immediately so a just-scouted world is remembered at once.
    api.on('time.advanced', (_event, h) => {
      pinSight(h);
      refreshMemory(h);
    });
    api.on('planet.captured', (_event, h) => refreshMemory(h));
    api.on('fleet.arrived', (_event, h) => refreshMemory(h));
  },
};
