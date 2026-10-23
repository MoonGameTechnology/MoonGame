import type { GameModule, HandlerContext } from '../kernel/module';
import type { FogMemory, GameState, PlanetId, PlanetSnapshot, PlayerId } from '../state/gameState';
import { fleetNodeAt } from '../state/fleetPosition';
import { isMineFleet, isMissileFleet } from '../state/minefields';
import { observedSwarm, swarmFleetIds } from '../state/swarmIntel';
import { sensorCoverageOf } from '../state/visibility';
import { peek, peekValues } from '../util/draft';

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

/** Refresh every active player's memory with what they currently identify. Sensors are
 *  read for all of them in one pass (`sensorCoverageOf`): nothing below changes what any
 *  player identifies, so the sets match a per-player `identifiedNodes` exactly. */
function refreshMemory(h: HandlerContext): void {
  const state = h.state;
  const fog = (state.fog ??= {});
  const active = Object.keys(state.players).filter((id) => state.players[id]?.status === 'active');
  const coverage = sensorCoverageOf(state, active, h.ctx.data);
  const swarm = swarmFleetIds(state);
  for (const playerId of active) {
    const memory: FogMemory = fog[playerId] ?? (fog[playerId] = {});
    const identified = coverage.get(playerId)!.identify;
    const contacts = observedSwarm(state, playerId, identified, h.ctx.now, swarm);
    if (Object.keys(contacts).length) {
      const intel = (state.swarmIntel ??= {});
      intel[playerId] = { ...intel[playerId], ...contacts };
    }
    for (const nodeId of identified) {
      if (state.planets[nodeId]) memory[nodeId] = snapshot(state, nodeId, h.ctx.now);
    }
  }
  survey(h, active);
}

/** Record the type of the province each ship of an active player is in, so a province
 *  shows its type the moment a ship crosses its border (owner 2026-10-23), before any
 *  sensor identifies it. «In» is the core's own rule (`fleetNodeAt`): the border crossing
 *  splits the lane. A mine stays where it was laid and a missile observes nothing, so
 *  neither surveys. A record is rewritten only when the type differs: the projection
 *  ships it, and a time stamp refreshed every step would resend it with every step. */
function survey(h: HandlerContext, active: readonly PlayerId[]): void {
  const state = h.state;
  const players = new Set(active);
  for (const fleet of peekValues(state.fleets)) {
    if (!players.has(fleet.owner)) continue;
    if (isMineFleet(fleet, h.ctx.data) || isMissileFleet(fleet, h.ctx.data)) continue;
    // Read through `peek`: a step writes a record only where the type is new to its owner.
    const nodeId = fleetNodeAt(state, fleet, h.ctx.now);
    const planet = nodeId === null ? undefined : peek(state.planets, nodeId);
    if (!planet) continue;
    const known = state.surveyed && peek(state.surveyed, fleet.owner)?.[planet.id];
    if (known && known.kind === planet.kind && known.terrain === planet.terrain &&
      known.planetType === planet.planetType) continue;
    const record = ((state.surveyed ??= {})[fleet.owner] ??= {});
    record[planet.id] = {
      ...(planet.kind !== undefined ? { kind: planet.kind } : {}),
      ...(planet.terrain !== undefined ? { terrain: planet.terrain } : {}),
      ...(planet.planetType !== undefined ? { planetType: planet.planetType } : {}),
      at: h.ctx.now,
    };
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
  // Таблица по видам копируется отдельно: состояние не делит объекты с данными.
  if (sight) h.state.sight = { ...sight, ...(sight.byKind ? { byKind: { ...sight.byKind } } : {}) };
}

export const visibilityModule: GameModule = {
  id: 'visibility',
  // 2.0.0 — зрение кругами вместо соседства по линиям (решение владельца 2026-09-24):
  // память тумана старых реплеев пишется иначе. 2.1.0 — обзор мира по виду провинции
  // (`sight.byKind`, решение владельца 2026-09-25). 2.2.0 — висящий патруль шаттлов
  // видит свой круг (SHU-6.7): память пишет и миры под ним. 2.3.0 — корабль, пересёкший
  // границу провинции, узнаёт её тип (`surveyed`, решение владельца 2026-10-23).
  version: '2.3.0',
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
