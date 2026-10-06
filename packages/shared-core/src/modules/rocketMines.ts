import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameData, RocketMineDef } from '../data/schemas';
import type { Fleet } from '../state/gameState';
import { hoursToMs, travelSpeedFactorOf } from '../action/types';
import {
  emptyOrdnance,
  inRadius,
  isMissileFleet,
  isOrdnanceFleet,
  isRocketMineFleet,
  missileModule,
  MISSILE_TRAIT,
  MISSILE_UNIT,
  rocketMinelayer,
  rocketMineModule,
  ROCKET_MINE_TRAIT,
  ROCKET_MINE_UNIT,
  type RocketMineMode,
} from '../state/ordnance';
import { MINE_TRAIT } from '../state/minefields';
import { defHasTrait } from '../data/traits';
import { flightPointAt, fleetNodeAt, fleetPositionAt } from '../state/fleetPosition';
import { isCorridorEdge } from '../state/corridor';
import { laneRoad } from '../state/roads';
import { distance } from '../state/route';
import { getStance } from '../state/diplomacy';
import { sightCircles } from '../state/visibility';
import { detectSignals, fleetSignalStrength, type SignalEmitter } from '../state/radarSignals';
import { nextFleetSeq, requireOwnedUnengagedFleet } from '../util/fleet';
import { effectiveStats } from '../util/loadout';
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
function targetPoint(
  h: HandlerContext,
  mine: Fleet,
  position: { x: number; y: number },
  def: RocketMineDef,
  mode: RocketMineMode,
): { x: number; y: number } | null {
  const circles = sightCircles(h.state, mine.owner, h.ctx.data);
  const identified = (at: { x: number; y: number }): boolean =>
    inRadius(at, position, def.sightRange) || circles.some((c) => inRadius(at, c, c.identify));
  const emitters: SignalEmitter[] = [];
  const confirmed: { x: number; y: number; id: string }[] = [];
  for (const fleet of Object.values(h.state.fleets)) {
    // IFF for own/allied fleets. Other contacts' hidden owner is NOT a radar gate.
    const stance = getStance(h.state, mine.owner, fleet.owner);
    if (stance === 'alliance' || !fleet.units.some((u) => u.count > 0)) continue;
    // A mine (SM-3.7a) or a missile (SM-3.7b) is not a target: the warhead is for ships, and
    // a missile is shot down by point defense and shuttles only (owner's resolution 2026-10-06).
    if (isOrdnanceFleet(fleet, h.ctx.data)) continue;
    const at = fleetPositionAt(h.state, fleet, h.ctx.now);
    const location = fleetNodeAt(h.state, fleet, h.ctx.now);
    if (!at || !location || !inRadius(at, position, def.radarRange)) continue;
    const known = identified(at);
    if (known && stance !== 'war') continue;
    if (mode === 'confirmed') {
      if (known) confirmed.push({ ...at, id: fleet.id });
    } else
      emitters.push({
        ...at,
        location,
        inTransit: true,
        strength: fleetSignalStrength(fleet, h.ctx.data),
      });
  }
  if (mode === 'confirmed') {
    confirmed.sort(
      (a, b) => distance(a, position) - distance(b, position) || (a.id < b.id ? -1 : 1),
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
    { ...position, range: def.radarRange, level: def.radarLevel },
  ]);
  const points = contacts
    .flatMap((c) => {
      const p = c.position ?? h.state.planets[c.location]?.position;
      return p ? [p] : [];
    })
    .sort(
      (a, b) => distance(a, position) - distance(b, position) || a.x - b.x || a.y - b.y,
    );
  return points[0] ?? null;
}

/** The hull of the missile this layer would launch. Zero means point defense has nothing
 *  to shoot at: the missile would vanish with neither a hit nor an interception (Codex,
 *  #1503) — so the deployment is refused instead. */
function missileHull(data: GameData, layerId: string): number {
  const unit = data.units[MISSILE_UNIT];
  if (!unit) return 0;
  return effectiveStats(unit, { modules: [layerId] }, data).hp ?? 0;
}

/** A standing rocket mine of `owner` under `id` — its own fleet, never a prototype key. */
function ownMine(h: HandlerContext, id: string, owner: string): Fleet | null {
  const fleet = Object.prototype.hasOwnProperty.call(h.state.fleets, id) ? h.state.fleets[id] : undefined;
  return fleet && fleet.owner === owner && isRocketMineFleet(fleet, h.ctx.data) ? fleet : null;
}

/** A flying missile under `id` — a fleet of the missile unit, never a prototype key. */
function missileFleet(h: HandlerContext, id: string): Fleet | null {
  const fleet = Object.prototype.hasOwnProperty.call(h.state.fleets, id) ? h.state.fleets[id] : undefined;
  return fleet && fleet.flight && isMissileFleet(fleet, h.ctx.data) ? fleet : null;
}

/** The missile leaves the map — it struck or was shot down. Not a lost fleet (`spent`): the
 *  launch and the outcome are announced by their own events. */
function endMissile(h: HandlerContext, missile: Fleet): void {
  delete h.state.fleets[missile.id];
  if (h.state.ordnance?.warheads) delete h.state.ordnance.warheads[missile.id];
  h.emit('fleet.destroyed', { fleetId: missile.id, owner: missile.owner, spent: true });
}

/** The mine leaves the map — launched or disarmed. Not a loss (`spent`, as for a contact
 *  mine that used its last charge): the journal does not announce a destroyed fleet. */
function liftMine(h: HandlerContext, mine: Fleet): void {
  delete h.state.fleets[mine.id];
  if (h.state.ordnance?.controls) delete h.state.ordnance.controls[mine.id];
  h.emit('fleet.destroyed', { fleetId: mine.id, owner: mine.owner, spent: true });
}

function scan(h: HandlerContext, mine: Fleet): void {
  const ord = h.state.ordnance;
  const control = ord?.controls?.[mine.id];
  const layer = rocketMineModule(mine, h.ctx.data);
  const position = fleetPositionAt(h.state, mine, h.ctx.now);
  if (!ord || !control || !layer || !position) return;
  const def = layer.def;
  const target = targetPoint(h, mine, position, def, control.mode);
  if (target) {
    // Remove first: a repeated timer/mode action cannot fire this mine a second time.
    liftMine(h, mine);
    const travel = distance(position, target) / (def.speed * travelSpeedFactorOf(h.ctx));
    const arrivesAt =
      h.ctx.now + Math.max(1, Math.ceil(hoursToMs(h.ctx, Math.max(def.minFlightHours, travel))));
    // The missile is a fleet without orders (SM-3.7b): it flies straight to the signal's point
    // and passes the ordinary fog. Its id names no owner; its warhead stays with the owner.
    const missile: Fleet = {
      id: `fleet:missile:${h.ctx.now}:${nextFleetSeq(h.state)}`,
      owner: mine.owner,
      location: null,
      movement: null,
      edge: null,
      flight: { from: { ...position }, to: { ...target }, departedAt: h.ctx.now, arrivesAt },
      units: [{ unit: MISSILE_UNIT, count: 1, modules: [layer.id] }],
      landing: [],
      traits: [],
      battleId: null,
    };
    h.state.fleets[missile.id] = missile;
    (ord.warheads ??= {})[missile.id] = control.damage;
    h.schedule(arrivesAt, 'rocketMine.impact', { missileId: missile.id });
    scheduleFlight(h, missile);
    h.emit('rocketMine.launched', { owner: mine.owner, mineId: mine.id, missileId: missile.id });
  } else {
    control.nextScanAt = h.ctx.now + Math.max(1, Math.ceil(hoursToMs(h.ctx, def.scanHours)));
    h.schedule(control.nextScanAt, 'rocketMine.scan', { mineId: mine.id, at: control.nextScanAt });
  }
}

/** Finite volleys along the flight, with the same reload pool as shuttle PD. They wear down
 *  the missile's hull (its unit, SM-3.7b) — the same hull shuttles hit. */
function intercepted(h: HandlerContext, m: Fleet): boolean {
  const flight = m.flight;
  const stack = m.units.find((st) => st.count > 0);
  const unit = stack && h.ctx.data.units[stack.unit];
  const full = unit && stack ? (effectiveStats(unit, stack, h.ctx.data).hp ?? 0) * stack.count : 0;
  if (!flight || !stack || !(full > 0) || !missileModule(m, h.ctx.data)) return true;
  let hp = stack.hp ?? full;
  const position = flightPointAt(flight, h.ctx.now);
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
  if (hp < full) stack.hp = hp;
  // Planetary point defense guards the terminal approach, as for shuttles.
  if (h.ctx.now < flight.arrivesAt) return false;
  for (const planet of Object.values(h.state.planets)) {
    if (
      !planet.owner ||
      getStance(h.state, m.owner, planet.owner) !== 'war' ||
      !inRadius(planet.position, flight.to, PD_RANGE)
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

function scheduleFlight(h: HandlerContext, missile: Fleet): void {
  const step = Math.max(1, Math.ceil(hoursToMs(h.ctx, 1 / 60)));
  if (missile.flight && h.ctx.now + step < missile.flight.arrivesAt) {
    h.schedule(h.ctx.now + step, 'rocketMine.flight', { missileId: missile.id });
  }
}

export const rocketMinesModule: GameModule = {
  id: 'rocketMines',
  // 2.0.0: стоящая мина — отряд во `fleets` (юнит `rocket_mine`, SM-3.7a); её режим и боевая
  // часть — в `ordnance.controls`; мина не целится в мины, и взрыв их не задевает.
  // 3.0.0: ракета — отряд во `fleets` (юнит `missile`, полёт по прямой, SM-3.7b); её боевая
  // часть — в `ordnance.warheads`; мина не целится в ракеты, и взрыв их не задевает.
  version: '3.0.0',
  setup(api) {
    api.onAction('fleet.deployRocketMine', (action, h) => {
      const p = action.payload as { fleetId?: string; mode?: string } | null;
      if (typeof p?.fleetId !== 'string' || (p.mode !== 'any' && p.mode !== 'confirmed'))
        return h.reject('E_BAD_PAYLOAD');
      const fleet = requireOwnedUnengagedFleet(h, p.fleetId, action.playerId);
      const layer = rocketMinelayer(fleet, h.ctx.data);
      // Без юнита мины в данных мине негде стоять, а без общего трейта `mine` отряд не был бы
      // миной: воевал бы, мешал захвату и сам ставил мины. Ошибка данных отклоняет установку,
      // а не меняет правила (fail-secure, замечание Codex на #1499).
      // То же для ракеты (SM-3.7b): без юнита с трейтом `missile` ей не стать отрядом, а без
      // корпуса её нечем сбить.
      const unit = h.ctx.data.units[ROCKET_MINE_UNIT];
      if (
        !layer ||
        !defHasTrait(unit, ROCKET_MINE_TRAIT) ||
        !defHasTrait(unit, MINE_TRAIT) ||
        !defHasTrait(h.ctx.data.units[MISSILE_UNIT], MISSILE_TRAIT) ||
        !(missileHull(h.ctx.data, layer.id) > 0)
      )
        return h.reject('E_NO_ROCKET_MINELAYER');
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
      // Standing mines and flying missiles are fleets now (SM-3.7a/b); only installations
      // still live in `ordnance`.
      const standing = Object.values(h.state.fleets).filter(
        (f) =>
          f.owner === action.playerId &&
          (isRocketMineFleet(f, h.ctx.data) || isMissileFleet(f, h.ctx.data)),
      ).length;
      const active =
        standing + ord.installations.filter((m) => m.owner === action.playerId).length;
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
      const mine = ownMine(h, p.mineId, action.playerId);
      const control = mine && h.state.ordnance?.controls?.[mine.id];
      if (!mine || !control) return h.reject('E_NO_ROCKET_MINE');
      control.mode = p.mode;
      h.emit('rocketMine.modeChanged', { owner: action.playerId, mineId: mine.id });
      scan(h, mine);
    });
    api.onAction('rocketMine.disarm', (action, h) => {
      const p = action.payload as { mineId?: string } | null;
      if (typeof p?.mineId !== 'string') return h.reject('E_BAD_PAYLOAD');
      const ord = h.state.ordnance;
      const mine = ownMine(h, p.mineId, action.playerId);
      const job = ord?.installations.find((m) => m.id === p.mineId && m.owner === action.playerId);
      if (!ord || (!mine && !job)) return h.reject('E_NO_ROCKET_MINE');
      if (mine) liftMine(h, mine);
      else ord.installations = ord.installations.filter((m) => m.id !== p.mineId);
      h.emit('rocketMine.disarmed', { owner: action.playerId, mineId: p.mineId });
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
      // Мина встаёт отрядом в точке дороги носителя (SM-3.7a): выделение, карточка, туман
      // «только вблизи» и удар челноков достаются ей от общих правил мины-отряда (SM-3.6).
      const mine: Fleet = {
        id: job.id,
        owner: job.owner,
        location: null,
        movement: null,
        edge: { ...job.edge },
        units: [{ unit: ROCKET_MINE_UNIT, count: 1, modules: [job.moduleId] }],
        landing: [],
        traits: [],
        battleId: null,
      };
      h.state.fleets[mine.id] = mine;
      (ord.controls ??= {})[mine.id] = { mode: job.mode, damage: job.damage };
      h.emit('rocketMine.ready', { owner: job.owner, mineId });
      scan(h, mine);
    });
    api.on('rocketMine.scan', (event, h) => {
      const p = event.payload as { mineId: string; at: number };
      const mine = h.state.fleets[p.mineId];
      const control = h.state.ordnance?.controls?.[p.mineId];
      if (mine && control?.nextScanAt === p.at && h.ctx.now === p.at) scan(h, mine);
    });
    api.on('rocketMine.flight', (event, h) => {
      const { missileId } = event.payload as { missileId: string };
      const missile = missileFleet(h, missileId);
      if (!missile) return;
      if (intercepted(h, missile)) endMissile(h, missile);
      else scheduleFlight(h, missile);
    });
    api.on('rocketMine.impact', (event, h) => {
      const { missileId } = event.payload as { missileId: string };
      const missile = missileFleet(h, missileId);
      if (!missile || missile.flight!.arrivesAt !== h.ctx.now) return;
      const to = missile.flight!.to;
      const def = missileModule(missile, h.ctx.data)?.def;
      const warhead = h.state.ordnance?.warheads?.[missile.id];
      // Off the map first: the terminal point defense below hits a missile that is gone.
      endMissile(h, missile);
      if (!def || intercepted(h, missile)) return;
      for (const fleet of Object.values(h.state.fleets).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        // Мина и ракета взрывом не ранятся, как и прицелом не выбираются: мину снимают
        // челноки (SM-3.6), ракету — ПРО и челноки (SM-3.7b).
        if (isOrdnanceFleet(fleet, h.ctx.data)) continue;
        if (getStance(h.state, missile.owner, fleet.owner) !== 'war') continue;
        const at = fleetPositionAt(h.state, fleet, h.ctx.now);
        if (!at || !inRadius(at, to, def.blastRadius)) continue;
        const damage = hookedDamage(h, warhead ?? def.damage, {
          phase: 'missile',
          location: fleetNodeAt(h.state, fleet, h.ctx.now) ?? '',
          attacker: missile.owner,
          defender: fleet.owner,
          defenderFleet: fleet.id,
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
        // A mine or a missile destroyed by shuttles leaves its controls or warhead behind —
        // the private record of a fleet that is gone must not outlive it in the state.
        for (const id of Object.keys(ord.controls ?? {})) if (!h.state.fleets[id]) delete ord.controls![id];
        for (const id of Object.keys(ord.warheads ?? {})) if (!h.state.fleets[id]) delete ord.warheads![id];
      });
  },
};
