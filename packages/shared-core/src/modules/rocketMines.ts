import type { GameModule, HandlerContext } from '../kernel/module';
import { hoursToMs, travelSpeedFactorOf } from '../action/types';
import {
  emptyOrdnance,
  inRadius,
  missilePositionAt,
  rocketMinelayer,
  type RocketMine,
  type MineMissile,
} from '../state/ordnance';
import { fleetNodeAt, fleetPositionAt } from '../state/fleetPosition';
import { isCorridorEdge } from '../state/corridor';
import { laneRoad } from '../state/roads';
import { distance } from '../state/route';
import { getStance } from '../state/diplomacy';
import { sightCircles } from '../state/visibility';
import { detectSignals, fleetSignalStrength, type SignalEmitter } from '../state/radarSignals';
import { requireOwnedUnengagedFleet } from '../util/fleet';
import { applyDamageToSide, hookedDamage, removeIfWiped } from '../util/combat';
import {
  fleetPointDefense,
  fleetPDRange,
  planetPointDefense,
  PD_RANGE,
  PD_COOLDOWN_MINUTES,
} from '../util/pointDefense';
import { canAfford, payCost } from '../util/treasury';

/** Radar returns coordinates only. No hidden fleet ID is stored in a missile. */
function targetPoint(h: HandlerContext, mine: RocketMine): { x: number; y: number } | null {
  const def = h.ctx.data.modules[mine.moduleId]?.rocketMine;
  if (!def) return null;
  const circles = sightCircles(h.state, mine.owner, h.ctx.data);
  const identified = (at: { x: number; y: number }): boolean =>
    inRadius(at, mine.position, def.sightRange) || circles.some((c) => inRadius(at, c, c.identify));
  const emitters: SignalEmitter[] = [];
  const confirmed: { x: number; y: number; id: string }[] = [];
  for (const fleet of Object.values(h.state.fleets)) {
    // IFF for own/allied fleets. Other contacts' hidden owner is NOT a radar gate.
    const stance = getStance(h.state, mine.owner, fleet.owner);
    if (stance === 'alliance' || !fleet.units.some((u) => u.count > 0)) continue;
    const at = fleetPositionAt(h.state, fleet, h.ctx.now);
    const location = fleetNodeAt(h.state, fleet, h.ctx.now);
    if (!at || !location || !inRadius(at, mine.position, def.radarRange)) continue;
    const known = identified(at);
    if (known && stance !== 'war') continue;
    if (mine.mode === 'confirmed') {
      if (known) confirmed.push({ ...at, id: fleet.id });
    } else
      emitters.push({
        ...at,
        location,
        inTransit: true,
        strength: fleetSignalStrength(fleet, h.ctx.data),
      });
  }
  if (mine.mode === 'confirmed') {
    confirmed.sort(
      (a, b) => distance(a, mine.position) - distance(b, mine.position) || (a.id < b.id ? -1 : 1),
    );
    const p = confirmed[0];
    return p ? { x: p.x, y: p.y } : null;
  }
  // A false radar signal can lure the permissive mode; direct sight unmasks it.
  for (const hero of Object.values(h.state.heroes ?? {})) {
    if (!hero.alive || getStance(h.state, mine.owner, hero.owner) === 'alliance') continue;
    for (const decoy of hero.activeDecoys ?? []) {
      const at = h.state.planets[decoy.at]?.position;
      if (at && decoy.until > h.ctx.now && !identified(at)) {
        emitters.push({ ...at, location: decoy.at, strength: decoy.signature });
      }
    }
  }
  const contacts = detectSignals(emitters, [
    { ...mine.position, range: def.radarRange, level: def.radarLevel },
  ]);
  const points = contacts
    .flatMap((c) => {
      const p = c.position ?? h.state.planets[c.location]?.position;
      return p ? [p] : [];
    })
    .sort(
      (a, b) => distance(a, mine.position) - distance(b, mine.position) || a.x - b.x || a.y - b.y,
    );
  return points[0] ?? null;
}

function scan(h: HandlerContext, mine: RocketMine): void {
  const ord = h.state.ordnance;
  const def = h.ctx.data.modules[mine.moduleId]?.rocketMine;
  if (!ord || !def) return;
  const target = targetPoint(h, mine);
  if (target) {
    // Remove first: a repeated timer/mode action cannot fire this mine a second time.
    ord.mines = ord.mines.filter((m) => m.id !== mine.id);
    const travel = distance(mine.position, target) / (def.speed * travelSpeedFactorOf(h.ctx));
    const missile: MineMissile = {
      id: mine.id,
      owner: mine.owner,
      moduleId: mine.moduleId,
      from: { ...mine.position },
      to: { ...target },
      launchedAt: h.ctx.now,
      damage: mine.damage ?? def.damage,
      hp: def.hp,
      arrivesAt:
        h.ctx.now + Math.max(1, Math.ceil(hoursToMs(h.ctx, Math.max(def.minFlightHours, travel)))),
    };
    ord.missiles.push(missile);
    h.schedule(missile.arrivesAt, 'rocketMine.impact', { missileId: missile.id });
    scheduleFlight(h, missile);
    h.emit('rocketMine.launched', { owner: mine.owner, mineId: mine.id });
  } else {
    mine.nextScanAt = h.ctx.now + Math.max(1, Math.ceil(hoursToMs(h.ctx, def.scanHours)));
    h.schedule(mine.nextScanAt, 'rocketMine.scan', { mineId: mine.id, at: mine.nextScanAt });
  }
}

/** Finite volleys along the flight, with the same reload pool as shuttle PD. */
function intercepted(h: HandlerContext, m: MineMissile): boolean {
  const def = h.ctx.data.modules[m.moduleId]?.rocketMine;
  if (!def) return true;
  let hp = m.hp ?? def.hp;
  const position = missilePositionAt(m, h.ctx.now);
  for (const f of Object.values(h.state.fleets).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (
      f.battleId ||
      getStance(h.state, m.owner, f.owner) !== 'war' ||
      (f.pdCooldownUntil ?? 0) > h.ctx.now
    )
      continue;
    const at = fleetPositionAt(h.state, f, h.ctx.now);
    if (!at) continue;
    const power = inRadius(at, position, fleetPDRange(f, h.ctx.data))
      ? fleetPointDefense(f, h.ctx.data)
      : 0;
    if (power <= 0) continue;
    const dealt = hookedDamage(h, power, {
      phase: 'pointDefense',
      location: fleetNodeAt(h.state, f, h.ctx.now) ?? '',
      attacker: f.owner,
      defender: m.owner,
      attackerFleet: f.id,
    });
    hp -= dealt;
    f.pdCooldownUntil = h.ctx.now + hoursToMs(h.ctx, PD_COOLDOWN_MINUTES / 60);
    if (hp <= 0) {
      h.emit('rocketMine.intercepted', { owner: m.owner, playerId: f.owner, missileId: m.id });
      return true;
    }
  }
  m.hp = hp;
  // Planetary point defense guards the terminal approach, as for shuttles.
  if (h.ctx.now < m.arrivesAt) return false;
  for (const planet of Object.values(h.state.planets)) {
    if (
      !planet.owner ||
      getStance(h.state, m.owner, planet.owner) !== 'war' ||
      !inRadius(planet.position, m.to, PD_RANGE)
    )
      continue;
    const power = planetPointDefense(planet, h.ctx.data);
    hp -= hookedDamage(h, power, {
      phase: 'pointDefense',
      location: planet.id,
      attacker: planet.owner,
      defender: m.owner,
    });
    if (hp <= 0) {
      h.emit('rocketMine.intercepted', { owner: m.owner, playerId: planet.owner, missileId: m.id });
      return true;
    }
  }
  return false;
}

function scheduleFlight(h: HandlerContext, missile: MineMissile): void {
  const step = Math.max(1, Math.ceil(hoursToMs(h.ctx, 1 / 60)));
  if (h.ctx.now + step < missile.arrivesAt) {
    h.schedule(h.ctx.now + step, 'rocketMine.flight', { missileId: missile.id });
  }
}

export const rocketMinesModule: GameModule = {
  id: 'rocketMines',
  version: '1.0.0',
  setup(api) {
    api.onAction('fleet.deployRocketMine', (action, h) => {
      const p = action.payload as { fleetId?: string; mode?: string } | null;
      if (typeof p?.fleetId !== 'string' || (p.mode !== 'any' && p.mode !== 'confirmed'))
        return h.reject('E_BAD_PAYLOAD');
      const fleet = requireOwnedUnengagedFleet(h, p.fleetId, action.playerId);
      const layer = rocketMinelayer(fleet, h.ctx.data);
      if (!layer) return h.reject('E_NO_ROCKET_MINELAYER');
      const edge = fleet.edge;
      if (
        fleet.movement ||
        fleet.location !== null ||
        !edge ||
        !(edge.t > 0 && edge.t < 1) ||
        !laneRoad(h.state, edge.from, edge.to) ||
        !h.state.planets[edge.from]?.links?.includes(edge.to) ||
        isCorridorEdge(h.state, edge.from, edge.to)
      )
        return h.reject('E_MINE_ROAD_REQUIRED');
      const at = fleetPositionAt(h.state, fleet, h.ctx.now);
      const player = h.state.players[action.playerId];
      if (!at || !player) return h.reject('E_NO_FLEET');
      const ord = h.state.ordnance ?? emptyOrdnance();
      if (ord.installations.some((m) => m.fleetId === fleet.id))
        return h.reject('E_MINE_INSTALLING');
      if ((ord.cooldowns[action.playerId] ?? 0) > h.ctx.now) return h.reject('E_MINES_COOLDOWN');
      const active = [...ord.installations, ...ord.mines, ...ord.missiles].filter(
        (m) => m.owner === action.playerId,
      ).length;
      if (active >= layer.def.maxActive) return h.reject('E_MINE_LIMIT');
      if (!canAfford(player.resources, layer.def.cost)) return h.reject('E_INSUFFICIENT');
      payCost(player.resources, layer.def.cost);
      h.state.ordnance = ord;
      const seq = (ord.serials[action.playerId] ?? 0) + 1;
      ord.serials[action.playerId] = seq;
      const id = `rocketMine:${action.playerId}:${seq}`;
      const readyAt = h.ctx.now + Math.max(1, Math.ceil(hoursToMs(h.ctx, layer.def.armHours)));
      ord.installations.push({
        id,
        owner: action.playerId,
        moduleId: layer.id,
        position: { ...at },
        damage: layer.def.damage,
        fleetId: fleet.id,
        edge: { ...edge },
        mode: p.mode,
        startedAt: h.ctx.now,
        readyAt,
      });
      ord.cooldowns[action.playerId] = h.ctx.now + hoursToMs(h.ctx, layer.def.cooldownHours);
      h.schedule(readyAt, 'rocketMine.armed', { mineId: id });
      h.emit('rocketMine.installing', { owner: action.playerId, mineId: id });
    });
    api.onAction('rocketMine.mode', (action, h) => {
      const p = action.payload as { mineId?: string; mode?: string } | null;
      if (typeof p?.mineId !== 'string' || (p.mode !== 'any' && p.mode !== 'confirmed'))
        return h.reject('E_BAD_PAYLOAD');
      const mine = h.state.ordnance?.mines.find(
        (m) => m.id === p.mineId && m.owner === action.playerId,
      );
      if (!mine) return h.reject('E_NO_ROCKET_MINE');
      mine.mode = p.mode;
      scan(h, mine);
      h.emit('rocketMine.modeChanged', { owner: action.playerId, mineId: mine.id });
    });
    api.onAction('rocketMine.disarm', (action, h) => {
      const p = action.payload as { mineId?: string } | null;
      if (typeof p?.mineId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const ord = h.state.ordnance;
      const mine = [...(ord?.mines ?? []), ...(ord?.installations ?? [])].find(
        (m) => m.id === p.mineId && m.owner === action.playerId,
      );
      if (!ord || !mine) return h.reject('E_NO_ROCKET_MINE');
      ord.mines = ord.mines.filter((m) => m.id !== mine.id);
      ord.installations = ord.installations.filter((m) => m.id !== mine.id);
      h.emit('rocketMine.disarmed', { owner: action.playerId, mineId: mine.id });
    });
    api.on('rocketMine.armed', (event, h) => {
      const { mineId } = event.payload as { mineId: string };
      const ord = h.state.ordnance;
      const job = ord?.installations.find((m) => m.id === mineId && m.readyAt === h.ctx.now);
      if (!ord || !job) return;
      ord.installations = ord.installations.filter((m) => m.id !== mineId);
      const fleet = h.state.fleets[job.fleetId];
      const at = fleet && fleetPositionAt(h.state, fleet, h.ctx.now);
      if (
        !fleet ||
        fleet.owner !== job.owner ||
        fleet.movement ||
        fleet.battleId ||
        !at ||
        !inRadius(at, job.position, 0.001) ||
        rocketMinelayer(fleet, h.ctx.data)?.id !== job.moduleId
      ) {
        h.emit('rocketMine.cancelled', { owner: job.owner, mineId });
        return;
      }
      const mine: RocketMine = {
        id: job.id,
        owner: job.owner,
        moduleId: job.moduleId,
        position: job.position,
        mode: job.mode,
        damage: job.damage,
      };
      ord.mines.push(mine);
      h.emit('rocketMine.ready', { owner: job.owner, mineId });
      scan(h, mine);
    });
    api.on('rocketMine.scan', (event, h) => {
      const p = event.payload as { mineId: string; at: number };
      const mine = h.state.ordnance?.mines.find((m) => m.id === p.mineId && m.nextScanAt === p.at);
      if (mine && h.ctx.now === p.at) scan(h, mine);
    });
    api.on('rocketMine.flight', (event, h) => {
      const { missileId } = event.payload as { missileId: string };
      const ord = h.state.ordnance;
      const missile = ord?.missiles.find((m) => m.id === missileId);
      if (!ord || !missile) return;
      if (intercepted(h, missile)) ord.missiles = ord.missiles.filter((m) => m.id !== missileId);
      else scheduleFlight(h, missile);
    });
    api.on('rocketMine.impact', (event, h) => {
      const { missileId } = event.payload as { missileId: string };
      const ord = h.state.ordnance;
      const missile = ord?.missiles.find((m) => m.id === missileId && m.arrivesAt === h.ctx.now);
      if (!ord || !missile) return;
      ord.missiles = ord.missiles.filter((m) => m.id !== missileId);
      const def = h.ctx.data.modules[missile.moduleId]?.rocketMine;
      if (!def || intercepted(h, missile)) return;
      for (const fleet of Object.values(h.state.fleets).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (getStance(h.state, missile.owner, fleet.owner) !== 'war') continue;
        const at = fleetPositionAt(h.state, fleet, h.ctx.now);
        if (!at || !inRadius(at, missile.to, def.blastRadius)) continue;
        const damage = hookedDamage(h, missile.damage ?? def.damage, {
          phase: 'missile',
          location: fleetNodeAt(h.state, fleet, h.ctx.now) ?? '',
          attacker: missile.owner,
          defender: fleet.owner,
        });
        h.emit('rocketMine.hit', {
          owner: missile.owner,
          playerId: fleet.owner,
          missileId,
          damage,
        });
        applyDamageToSide(
          h,
          { kind: 'fleet', fleetId: fleet.id },
          damage,
          h.ctx.data,
          fleetNodeAt(h.state, fleet, h.ctx.now) ?? '',
          undefined,
          undefined,
          missile.owner,
        );
        removeIfWiped(h, fleet.id);
      }
      h.emit('rocketMine.detonated', { owner: missile.owner, missileId });
    });
    // Movement, loss or transfer invalidates installation permanently, even if the
    // carrier comes back to the same point before the old completion timer fires.
    for (const type of ['fleet.leg', 'fleet.destroyed', 'fleet.merged', 'battle.started'])
      api.on(type, (_event, h) => {
        const ord = h.state.ordnance;
        if (!ord) return;
        ord.installations = ord.installations.filter((job) => {
          const fleet = h.state.fleets[job.fleetId];
          const keep = fleet && fleet.owner === job.owner && !fleet.movement && !fleet.battleId;
          if (!keep) h.emit('rocketMine.cancelled', { owner: job.owner, mineId: job.id });
          return !!keep;
        });
      });
  },
};
