import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { Hero, PlanetId } from '../../state/gameState';
import { hoursToMs } from '../../action/types';
import { bossFallen } from '../../state/heroes';
import { activeHeroCount, heroActiveCap } from '../../state/heroDeployment';
import { isForkSite } from '../../state/forkSite';
import { getStance, stanceToRelation } from '../../state/diplomacy';
import { fleetForOrder } from '../../util/fleet';
import { mobilizationBusy, mobilizationHead, queuedHeroCount } from '../../state/mobilization';
import { orderLane } from '../../state/buildLane';
import { battleAt } from '../../state/battle';
import { isBombarded } from '../../state/orbit';
import { matchUnitHours } from '../../util/pricing';

type Destination = { at: string; beside?: string } | { code: string };
interface DeploymentBodies {
  formHeroShip(h: HandlerContext, hero: Hero, at: PlanetId): string;
  heroShipUnit(h: HandlerContext, hero: Hero): string;
}

/** Resolve again at completion: a conquered world or moving/lost carrier is not a spawn site. */
function destination(h: HandlerContext, hero: Hero, target: string): Destination {
  const carries = (type: string): boolean =>
    (hero.abilities ?? []).some(
      (id) => typeof id === 'string' && h.ctx.data.heroAbilities[id]?.type === type,
    );
  const planet = h.state.planets[target];
  const host =
    planet === undefined ? fleetForOrder(h.state, target, hero.owner, h.ctx.data) : undefined;
  if (!planet && !host) return { code: 'E_NO_PLANET' };
  if (planet) {
    if (isForkSite(planet)) return { code: 'E_BAD_SPAWN' };
    const own = planet.owner === hero.owner;
    const allied =
      !own &&
      planet.owner !== null &&
      carries('spawn_allied') &&
      stanceToRelation(getStance(h.state, hero.owner, planet.owner)) === 'ally';
    return own || allied ? { at: target } : { code: 'E_BAD_SPAWN' };
  }
  if (!host || host.owner !== hero.owner || !carries('spawn_fleet')) return { code: 'E_BAD_SPAWN' };
  if (host.movement || typeof host.location !== 'string') return { code: 'E_HOST_IN_TRANSIT' };
  return { at: host.location, beside: host.id };
}

/** A fragment of the hero module's registrations; ship creation/loadouts retain one implementation. */
export function registerHeroDeployment(api: ModuleSetupApi, bodies: DeploymentBodies): void {
  const requirement = (h: HandlerContext, hero: Hero): { allowed: boolean; code?: string } =>
    h.hook(
      'construction.requirement',
      { allowed: true },
      { playerId: hero.owner, kind: 'unit', id: bodies.heroShipUnit(h, hero) },
    );
  const deploy = (h: HandlerContext, hero: Hero, target: { at: string; beside?: string }): void => {
    const fleetId = bodies.formHeroShip(h, hero, target.at);
    h.emit('hero.spawned', {
      owner: hero.owner,
      heroId: hero.id,
      fleetId,
      at: target.at,
      ...(target.beside !== undefined ? { beside: target.beside } : {}),
    });
  };

  // Death already serves its own 24-hour timer. A blocked respawn remains a reserve.
  api.on('hero.respawn', (event, h) => {
    const { heroId } = (event.payload ?? {}) as { heroId?: string };
    if (typeof heroId !== 'string') return;
    const hero = h.state.heroes?.[heroId];
    if (!hero || hero.alive || hero.mobilization) return;
    if (!requirement(h, hero).allowed) return;
    const owner = hero.owner;
    if (activeHeroCount(h.state, owner) >= heroActiveCap(h.state, owner, h.ctx.data)) return;
    const owned = (id: PlanetId | undefined): id is PlanetId =>
      id !== undefined && h.state.planets[id]?.owner === owner && !isForkSite(h.state.planets[id]);
    const at =
      [hero.home, hero.location].find(owned) ?? Object.keys(h.state.planets).sort().find(owned);
    if (at === undefined) return;
    const fleetId = bodies.formHeroShip(h, hero, at);
    h.emit('hero.respawned', { owner, heroId, fleetId, at });
  });

  api.onAction('hero.spawn', (action, h) => {
    const { heroId, at } = action.payload as { heroId?: string; at?: string };
    if (typeof heroId !== 'string' || typeof at !== 'string') return h.reject('E_BAD_PAYLOAD');
    const hero = h.state.heroes?.[heroId];
    if (!hero) return h.reject('E_NO_HERO');
    if (hero.owner !== action.playerId) return h.reject('E_FORBIDDEN');
    if (bossFallen(hero, h.ctx.data)) return h.reject('E_HERO_FALLEN');
    if (hero.mobilization) return h.reject('E_HERO_MOBILIZING');
    if (hero.alive === true || (hero.fleetId !== undefined && h.state.fleets[hero.fleetId]))
      return h.reject('E_HERO_ALIVE');
    if ((hero.cooldowns.respawn ?? 0) > h.ctx.now) return h.reject('E_RESPAWN_COOLDOWN');
    const required = requirement(h, hero);
    if (!required.allowed) return h.reject(required.code ?? 'E_TECH_LOCKED');
    const target = destination(h, hero, at);
    if ('code' in target) return h.reject(target.code);
    if (activeHeroCount(h.state, hero.owner) >= heroActiveCap(h.state, hero.owner, h.ctx.data))
      return h.reject('E_HERO_CAP');
    if (h.state.techRules?.ruleset !== 'main' || h.state.players[hero.owner]?.npc) {
      deploy(h, hero, target);
      return;
    }
    if (h.state.planets[at]) {
      const waiting =
        (h.state.planets[at]!.buildQueue ?? []).filter(
          (q) => orderLane(h.ctx.data, q) === 'mobilization',
        ).length + queuedHeroCount(h.state, at);
      if (waiting >= 5) return h.reject('E_QUEUE_FULL');
      hero.mobilization = {
        target: at,
        startedAt: h.ctx.now,
        readyAt: 0,
        queued: true,
        orderId: h.state.scheduleSeq++,
      };
      pump(h, at);
    } else start(h, hero, at); // spawn_fleet retains its existing destination contract
  });

  function start(h: HandlerContext, hero: Hero, at: string): void {
    const hours = h.ctx.data.units[bodies.heroShipUnit(h, hero)]?.buildTimeHours || 10;
    const readyAt = h.ctx.now + hoursToMs(h.ctx, matchUnitHours(h.state, hours));
    hero.mobilization = { target: at, startedAt: h.ctx.now, readyAt };
    h.schedule(readyAt, 'hero.mobilization.complete', { heroId: hero.id, readyAt });
    h.emit('hero.mobilization.started', { owner: hero.owner, heroId: hero.id, at, readyAt });
  }
  function retry(h: HandlerContext, planetId: string): void {
    if (
      !h.state.scheduled.some(
        (e) =>
          e.type === 'hero.mobilization.pump' &&
          (e.payload as { planetId?: string }).planetId === planetId,
      )
    )
      h.schedule(h.ctx.now + hoursToMs(h.ctx, 1), 'hero.mobilization.pump', { planetId });
  }
  function pump(h: HandlerContext, planetId: string): void {
    const head = mobilizationHead(h.state, planetId, h.ctx.data);
    if (!head) return;
    if (mobilizationBusy(h.state, planetId, h.ctx.data)) {
      retry(h, planetId);
      return;
    }
    if (!head.heroId) {
      h.emit('construction.queue.pump', { planetId, lane: 'mobilization' });
      return;
    }
    const hero = h.state.heroes?.[head.heroId];
    if (!hero?.mobilization?.queued) return;
    const target = destination(h, hero, planetId);
    if (
      'code' in target ||
      !requirement(h, hero).allowed ||
      hero.alive === true ||
      activeHeroCount(h.state, hero.owner) > heroActiveCap(h.state, hero.owner, h.ctx.data)
    ) {
      delete hero.mobilization;
      h.emit('hero.mobilization.cancelled', { owner: hero.owner, heroId: hero.id });
      pump(h, planetId);
      return;
    }
    if (battleAt(h.state, planetId) || isBombarded(h.state, planetId, h.ctx.data)) {
      retry(h, planetId);
      return;
    }
    start(h, hero, planetId);
  }
  api.on('hero.mobilization.pump', (event, h) => {
    const planetId = (event.payload as { planetId?: string })?.planetId;
    if (typeof planetId === 'string') pump(h, planetId);
  });
  api.on('planet.captured', (event, h) => {
    const planetId = (event.payload as { planetId?: string })?.planetId;
    if (typeof planetId !== 'string') return;
    for (const hero of Object.values(h.state.heroes ?? {})) {
      if (hero.mobilization?.target !== planetId || !('code' in destination(h, hero, planetId)))
        continue;
      delete hero.mobilization;
      h.state.scheduled = h.state.scheduled.filter(
        (e) =>
          e.type !== 'hero.mobilization.complete' ||
          (e.payload as { heroId?: string }).heroId !== hero.id,
      );
      h.emit('hero.mobilization.cancelled', { owner: hero.owner, heroId: hero.id });
    }
    pump(h, planetId);
  });
  api.onAction('hero.mobilization.cancel', (action, h) => {
    const heroId = (action.payload as { heroId?: string })?.heroId;
    if (typeof heroId !== 'string') return h.reject('E_BAD_PAYLOAD');
    const hero = h.state.heroes?.[heroId];
    if (!hero || hero.owner !== action.playerId) return h.reject('E_FORBIDDEN');
    if (!hero.mobilization?.queued) return h.reject('E_FORBIDDEN');
    const at = hero.mobilization.target;
    delete hero.mobilization;
    h.emit('hero.mobilization.cancelled', { owner: hero.owner, heroId });
    pump(h, at);
  });

  api.on('hero.mobilization.complete', (event, h) => {
    const { heroId, readyAt } = (event.payload ?? {}) as { heroId?: string; readyAt?: number };
    if (typeof heroId !== 'string') return;
    const hero = h.state.heroes?.[heroId];
    const pending = hero?.mobilization;
    if (
      !hero ||
      !pending ||
      pending.queued ||
      pending.readyAt !== readyAt ||
      h.ctx.now < pending.readyAt
    )
      return;
    if (
      h.state.planets[pending.target] &&
      !('code' in destination(h, hero, pending.target)) &&
      (battleAt(h.state, pending.target) || isBombarded(h.state, pending.target, h.ctx.data))
    ) {
      h.schedule(h.ctx.now + hoursToMs(h.ctx, 1), 'hero.mobilization.complete', {
        heroId,
        readyAt,
      });
      return;
    }
    delete hero.mobilization;
    const target = destination(h, hero, pending.target);
    const required = requirement(h, hero);
    const occupied =
      hero.alive === true || (hero.fleetId !== undefined && h.state.fleets[hero.fleetId]);
    if (
      occupied ||
      !required.allowed ||
      'code' in target ||
      activeHeroCount(h.state, hero.owner) >= heroActiveCap(h.state, hero.owner, h.ctx.data)
    ) {
      h.emit('hero.mobilization.cancelled', { owner: hero.owner, heroId });
      pump(h, pending.target);
      return;
    }
    deploy(h, hero, target);
    pump(h, pending.target);
  });
}
