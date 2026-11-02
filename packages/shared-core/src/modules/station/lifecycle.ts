import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { Planet, UnitStack } from '../../state/gameState';
import { hoursToMs, timeScaleOf } from '../../action/types';
import { MS_PER_HOUR } from '../../util/time';
import { addUnits } from '../../util/stacks';
import { effectiveStats } from '../../util/loadout';
import { matchCost, matchHours } from '../../util/pricing';
import { canAfford, payCost } from '../../util/treasury';
import { forkSiteInBattle } from '../../state/forkSite';
import { FORTRESS_BODY, FORTRESS_CORE, fortressFleetId, fortressRepairQuote,
  stationBerth, refreshFortressBody } from '../../state/fortress';

/** A single progressive body; new capacity preserves absolute wounds. */
export function syncModelGuns(h: HandlerContext, site: Planet, create = false): void {
  const model = site.fortress;
  const def = h.ctx.data.units[FORTRESS_BODY];
  if (!model || site.owner === null || !def) return;
  const id = fortressFleetId(site.id);
  let fleet = h.state.fleets[id];
  if (!fleet) {
    if (!create) return; // a building event must never resurrect a destroyed body
    const units: UnitStack[] = [];
    const arsenal = h.state.players[site.owner]?.arsenal;
    addUnits(units, FORTRESS_BODY, 1, model.modules, arsenal?.stars, arsenal?.rarity);
    units[0]!.stationScale = 0;
    fleet = h.state.fleets[id] = {
      id, owner: site.owner, ...stationBerth(h.state, site), movement: null,
      units, landing: [], traits: [], battleId: null,
    };
  }
  const body = fleet.units[0];
  if (!body || body.count <= 0) return;
  const assembly = model.assembly;
  const progress = assembly ? Math.max(0, Math.min(1,
    (h.ctx.now - assembly.startedAt) / Math.max(1, assembly.doneAt - assembly.startedAt))) : 1;
  const scale = assembly ? assembly.from + (assembly.to - assembly.from) * progress : model.level;
  refreshFortressBody(site, body, h.ctx.data, scale);
  if (create) {
    if (fleet.edge) h.emit('fleet.parked', { fleetId: id, edge: fleet.edge });
    else h.emit('fleet.arrived', { fleetId: id, at: fleet.location });
  }
}

export function registerFortressLifecycle(api: ModuleSetupApi): void {
  api.onAction('station.repair', (action, h) => {
    const p = action.payload as { planetId?: unknown };
    const site = typeof p.planetId === 'string' ? h.state.planets[p.planetId] : undefined;
    if (!site?.fortress || site.owner !== action.playerId) return h.reject('E_NO_STATION');
    if (forkSiteInBattle(h.state, site)) return h.reject('E_IN_BATTLE');
    if (site.fortress.repair) return h.reject('E_REPAIR_IN_PROGRESS');
    const quote = fortressRepairQuote(h.state, site, h.ctx.data);
    if (!(quote.missingHp > 0)) return h.reject('E_NOTHING_TO_REPAIR');
    const player = h.state.players[action.playerId];
    const cost = matchCost(h.state, quote.cost);
    if (!player || !canAfford(player.resources, cost)) return h.reject('E_INSUFFICIENT');
    payCost(player.resources, cost);
    const hours = matchHours(h.state, quote.hours);
    const doneAt = h.ctx.now + hoursToMs(h.ctx, hours);
    site.fortress.repair = { owner: action.playerId, remainingHp: quote.missingHp, hpPerHour: quote.missingHp / hours, doneAt };
    h.schedule(doneAt, 'station.repair.complete', { planetId: site.id });
    h.emit('station.repair.started', { planetId: site.id, owner: action.playerId, cost, doneAt });
  });

  api.on('station.complete', (event, h) => {
    const p = event.payload as { planetId?: string };
    const site = p.planetId ? h.state.planets[p.planetId] : undefined;
    const work = site?.fortress?.assembly;
    if (!site || !work || site.owner === null) return;
    if (h.ctx.now < work.doneAt || work.paused) {
      h.schedule(Math.max(work.doneAt, h.ctx.now + hoursToMs(h.ctx, 1)), 'station.complete', p);
      return;
    }
    delete site.fortress!.assembly;
    syncModelGuns(h, site);
    h.emit('station.completed', { planetId: site.id, owner: site.owner });
  });

  api.on('station.repair.complete', (event, h) => {
    const p = event.payload as { planetId?: string };
    const site = p.planetId ? h.state.planets[p.planetId] : undefined;
    const repair = site?.fortress?.repair;
    if (!site || !repair) return;
    if (repair.remainingHp > 1e-8) {
      h.schedule(Math.max(repair.doneAt, h.ctx.now + hoursToMs(h.ctx, repair.remainingHp / repair.hpPerHour)),
        'station.repair.complete', p);
      return;
    }
    delete site.fortress!.repair;
    h.emit('station.repaired', { planetId: site.id, owner: site.owner });
  });

  api.on('construction.started', (event, h) => {
    const p = event.payload as { planetId?: string; building?: string; kind?: string; level?: number };
    const site = p.planetId ? h.state.planets[p.planetId] : undefined;
    if (!site?.fortress || p.kind !== 'upgrade' || p.building !== FORTRESS_CORE || !p.level) return;
    const order = h.state.scheduled.find((e) => e.type === 'construction.complete' &&
      (e.payload as { planetId?: string; building?: string }).planetId === site.id &&
      (e.payload as { building?: string }).building === FORTRESS_CORE);
    if (!order) return;
    const body = h.state.fleets[fortressFleetId(site.id)]?.units[0];
    site.fortress.assembly = { from: body?.stationScale ?? site.fortress.level,
      to: p.level, startedAt: h.ctx.now, doneAt: order.at };
    site.fortress.level = p.level;
  });

  api.on('construction.cancelled', (event, h) => {
    const p = event.payload as { planetId?: string; seq?: number };
    const site = p.planetId ? h.state.planets[p.planetId] : undefined;
    if (site?.fortress?.assembly && site.pausedConstruction?.some((work) =>
      work.id === p.seq && work.kind === 'upgrade' && work.building === FORTRESS_CORE)) {
      site.fortress.assembly.paused = true;
    }
  });

  api.on('construction.resumed', (event, h) => {
    const p = event.payload as { planetId?: string; kind?: string };
    const site = p.planetId ? h.state.planets[p.planetId] : undefined;
    if (!site?.fortress?.assembly?.paused || p.kind !== 'upgrade') return;
    const order = h.state.scheduled.find((e) => e.type === 'construction.complete' &&
      (e.payload as { planetId?: string; building?: string }).planetId === site.id &&
      (e.payload as { building?: string }).building === FORTRESS_CORE);
    if (!order) return;
    const body = h.state.fleets[fortressFleetId(site.id)]?.units[0];
    site.fortress.assembly = { from: body?.stationScale ?? site.fortress.level - 1,
      to: site.fortress.level, startedAt: h.ctx.now, doneAt: order.at };
  });

  api.on('time.advanced', (event, h) => {
    const { from, to } = event.payload as { from: number; to: number };
    if (!(to > from)) return;
    const hours = ((to - from) / MS_PER_HOUR) * timeScaleOf(h.ctx);
    for (const id of Object.keys(h.state.planets).sort()) {
      const site = h.state.planets[id]!;
      const model = site.fortress;
      if (!model || site.owner === null) continue;
      const fighting = forkSiteInBattle(h.state, site);
      if (model.assembly && (fighting || model.assembly.paused)) {
        model.assembly.startedAt += to - from;
        model.assembly.doneAt += to - from;
      }
      syncModelGuns(h, site);
      const repair = model.repair;
      const body = h.state.fleets[fortressFleetId(id)]?.units[0];
      const def = body ? h.ctx.data.units[body.unit] : undefined;
      if (!repair || !body || !def) continue;
      if (fighting) { repair.doneAt += to - from; continue; }
      const full = effectiveStats(def, body, h.ctx.data).hp ?? 0;
      const hp = body.hp ?? full;
      const restored = Math.min(repair.remainingHp, repair.hpPerHour * hours, Math.max(0, full - hp));
      body.hp = hp + restored;
      repair.remainingHp = Math.max(0, repair.remainingHp - restored);
      if (body.hp >= full) { delete body.hp; repair.remainingHp = 0; }
    }
  });
}
