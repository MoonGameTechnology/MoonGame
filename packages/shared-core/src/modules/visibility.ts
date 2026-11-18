import type { GameModule, HandlerContext } from '../kernel/module';
import type {
  Fleet,
  FogMemory,
  GameState,
  Planet,
  PlanetId,
  PlanetSnapshot,
  PlayerId,
} from '../state/gameState';
import { sensorEntry, sensorExit } from '../state/sensorEntry';
import { crossingT, laneRoad, subPolyline } from '../state/roads';
import { sightCircles } from '../state/visibility';
import { fleetPositionAt, legT } from '../state/fleetPosition';
import { fleetNodeAt } from '../state/fleetPosition';
import { isMineFleet, isMissileFleet } from '../state/minefields';
import { observedSwarm, swarmFleetIds } from '../state/swarmIntel';
import { sensorCoverageOf } from '../state/visibility';
import { coverageInCircles, type SightCircle } from '../state/sensorView';
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
    buildings: planet.buildings.map((b) => {
      const visible = { ...b };
      delete visible.repair;
      return visible;
    }),
    at: now,
  };
  if (planet.terrain !== undefined) snap.terrain = planet.terrain;
  if (planet.planetType !== undefined) snap.planetType = planet.planetType;
  if (planet.kind !== undefined) snap.kind = planet.kind;
  return snap;
}

/** Refresh every active player's memory with what they currently identify. Sensors are
 *  read for all of them in one pass (`sensorCoverageOf`): nothing below changes what any
 *  player identifies, so the sets match a per-player `identifiedNodes` exactly. `since` is
 *  the start of the span being closed (`now` for a step at an instant). */
function refreshMemory(h: HandlerContext, since: number = h.ctx.now): void {
  const state = h.state;
  const fog = (state.fog ??= {});
  const active = Object.keys(state.players).filter((id) => state.players[id]?.status === 'active');
  // During time.advanced, state.time is committed after handlers finish.
  // Sensors must observe the end of this span, where the ships actually are now.
  const coverage = sensorCoverageOf({ ...state, time: h.ctx.now }, active, h.ctx.data);
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
  survey(h, active, since);
  // Optional movement capability: reconcile only after real sensor discovery.
  // Keep this internal; an extra broadcast on a hidden capture would leak activity.
  h.capability<(ctx: HandlerContext) => void>('fleet.reconcileVisibility')?.(h);
}

/** The last whole millisecond, at or before `at`, at which the fleet's circle still
 *  identifies `planet` — judged by the coverage rule itself at the fleet's own position
 *  then, so a rim the geometry puts a float's width outside is stepped back from rather
 *  than stopped on (the memory refreshed there would not see the world). */
function lastSeen(
  h: HandlerContext,
  fleet: Fleet,
  eye: SightCircle,
  planet: Planet,
  at: number,
): number {
  for (let t = at; t > at - 3; t--) {
    const pos = fleetPositionAt(h.state, fleet, t);
    if (
      pos &&
      coverageInCircles([planet], [{ ...eye, x: pos.x, y: pos.y }]).identify.has(planet.id)
    )
      return t;
  }
  return at - 3;
}

/** Whether a world stays in sight of the owner's bloc through a FIXED circle — a world's
 *  own sensors, a mine's eye or a fleet at rest — so one moving fleet losing it changes
 *  nothing. Moving, shared and time-boxed circles are not counted: at worst the world is
 *  stopped once more than it needed. */
function stillSeen(
  h: HandlerContext,
  circles: ReturnType<typeof sightCircles>,
  fleetId: string,
  at: { x: number; y: number },
): boolean {
  return circles.some((c) => {
    if (c.source.id === fleetId || !(c.identify > 0)) return false;
    const fixed =
      c.source.kind === 'world' ||
      c.source.kind === 'mine' ||
      (c.source.kind === 'fleet' && !h.state.fleets[c.source.id]?.movement);
    const dx = c.x - at.x,
      dy = c.y - at.y;
    return fixed && dx * dx + dy * dy < c.identify * c.identify;
  });
}

/** Record the type of the province each ship of an active player is in, so a province
 *  shows its type the moment a ship crosses its border (owner 2026-10-23), before any
 *  sensor identifies it. «In» is the core's own rule (`fleetNodeAt`): the border crossing
 *  splits the lane. A mine stays where it was laid and a missile observes nothing, so
 *  neither surveys. A record is rewritten only when the type differs: the projection
 *  ships it, and a time stamp refreshed every step would resend it with every step. */
function survey(h: HandlerContext, active: readonly PlayerId[], since: number): void {
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
    if (
      known &&
      known.kind === planet.kind &&
      known.terrain === planet.terrain &&
      known.planetType === planet.planetType
    )
      continue;
    const record = ((state.surveyed ??= {})[fleet.owner] ??= {});
    record[planet.id] = {
      ...(planet.kind !== undefined ? { kind: planet.kind } : {}),
      ...(planet.terrain !== undefined ? { terrain: planet.terrain } : {}),
      ...(planet.planetType !== undefined ? { planetType: planet.planetType } : {}),
      at: crossedAt(state, fleet, planet.id, since, h.ctx.now),
    };
  }
}

/** When `fleet` was first in province `nodeId` within the span `(since, now]`: on a lane
 *  into it, the instant its leg passed the border (`crossingT`); otherwise the span's
 *  start — a fleet at rest, or still short of the border, was there all span long (rest
 *  and departure change only at a span's edges). Either way the same however the world's
 *  time is cut. */
function crossedAt(
  state: GameState,
  fleet: Fleet,
  nodeId: PlanetId,
  since: number,
  now: number,
): number {
  const mv = fleet.movement;
  if (!mv || nodeId !== mv.to) return since;
  const startT = mv.startT ?? 0;
  const endT = mv.endT ?? 1;
  if (endT === startT) return since;
  const share = (crossingT(state, mv.from, mv.to) - startT) / (endT - startT);
  const at = mv.departedAt + Math.min(1, Math.max(0, share)) * (mv.arrivesAt - mv.departedAt);
  return Math.min(now, at);
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
  // 2.6.0 — круг висящего патруля — радар (SHU-6.18): опознаёт ближнюю долю, и миры под
  // дальним кольцом память больше не пишет. 2.7.0 — память тумана снимается в миг потери из
  // виду, а `surveyed.at` — миг пересечения границы, а не конец отрезка: нарезка не меняет итог.
  version: '2.7.0',
  setup(api) {
    // Continuous time advances refresh memory; captures and arrivals refresh it
    // immediately so a just-scouted world is remembered at once.
    // Split offline advances at real discoveries, so a long jump and live ticks
    // stop a fleet at the same sensor contact, rather than at different endpoints.
    api.hook<number>('time.stop', (value, args, h) => {
      const { from, to } = args as { from: number; to: number };
      let stop = value;
      const eyes = new Map<string, ReturnType<typeof sightCircles>>();
      for (const fleet of peekValues(h.state.fleets)) {
        const mv = fleet.movement;
        if (!mv || h.state.players[fleet.owner]?.status !== 'active') continue;
        let circles = eyes.get(fleet.owner);
        if (!circles) {
          circles = sightCircles(h.state, fleet.owner, h.ctx.data);
          eyes.set(fleet.owner, circles);
        }
        const eye = circles.find((c) => c.source.kind === 'fleet' && c.source.id === fleet.id);
        if (!eye || eye.identify <= 0) continue;
        const until = Math.min(to, mv.arrivesAt, stop);
        if (until <= from) continue;
        const road = laneRoad(h.state, mv.from, mv.to);
        if (!road) continue;
        const segment = subPolyline(road, legT(mv, from), legT(mv, until));
        for (const planet of peekValues(h.state.planets)) {
          const seen = h.state.fog?.[fleet.owner]?.[planet.id];
          if (planet.owner === fleet.owner || (seen && seen.owner === planet.owner)) continue;
          const entry = sensorEntry(segment, planet.position, eye.identify);
          if (entry === null) continue;
          const at = Math.max(from + 1, Math.ceil(from + entry * (until - from)));
          if (at <= until) stop = Math.min(stop, at);
        }
        // PE-2.2: and where a world passes OUT of this fleet's sight, so memory keeps it as
        // it stood the last instant it was seen — a long jump and live ticks remember the
        // same moment, and nothing that happened to it after sight was lost. The stop is the
        // last whole millisecond up to the exit — the rim itself still identifies, as at a
        // span's end. A world that stays in a fixed circle of the same bloc does not leave
        // sight at all.
        // Only a world near this stretch of road can leave its circle: a box round the
        // stretch, widened by the radius, rejects the rest of the map cheaply.
        const r = eye.identify;
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const p of segment) {
          minX = Math.min(minX, p.x - r);
          minY = Math.min(minY, p.y - r);
          maxX = Math.max(maxX, p.x + r);
          maxY = Math.max(maxY, p.y + r);
        }
        for (const planet of peekValues(h.state.planets)) {
          if (planet.owner === fleet.owner) continue;
          const { x, y } = planet.position;
          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          const exit = sensorExit(segment, planet.position, eye.identify);
          if (exit === null) continue;
          const at = lastSeen(h, fleet, eye, planet, Math.floor(from + exit * (until - from)));
          if (at <= from || at >= until || at >= stop) continue;
          if (stillSeen(h, circles, fleet.id, planet.position)) continue;
          stop = at;
        }
      }
      return stop;
    });
    api.on('fleet.leg', (_event, h) => {
      pinSight(h);
      refreshMemory(h);
    });
    api.on('time.advanced', (event, h) => {
      pinSight(h);
      refreshMemory(h, (event.payload as { from: number }).from);
    });
    api.on('planet.captured', (_event, h) => refreshMemory(h));
    api.on('fleet.arrived', (_event, h) => refreshMemory(h));
  },
};
