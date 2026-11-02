import type { Fleet, GameState, Planet, ResourceBag, UnitStack } from './gameState';
import type { GameData, UnitDef } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { forkSiteEdge } from './forkSite';
import { effectiveStats, loadoutCost } from '../util/loadout';

export const FORTRESS_CORE = 'starfort';
export const FORTRESS_BODY = 'fortress_guns';
export const FORTRESS_FLEET_PREFIX = 'fleet:station:';
export const FORTRESS_INTERNAL_SHARE = 0.2;
export const FORTRESS_DEPLOY_COST: ResourceBag = { metal: 120 };

/** Reserve one weapon and one defense bay for the installed battery/shield buildings. */
export function fortressLoadoutHull(data: GameData): UnitDef | undefined {
  const body = data.units[FORTRESS_BODY];
  return body ? { ...body, slots: { ...body.slots,
    weapon: Math.max(0, (body.slots.weapon ?? 0) - 1),
    defense: Math.max(0, (body.slots.defense ?? 0) - 1),
  } } : undefined;
}

export function issuedFortressModule(id: string): boolean {
  return /^void_shield_(i|ii|iii)$/.test(id) || id.startsWith('station_battery_');
}

/** Current paid readiness, including partial upgrades rebased by a delay/resume. */
export function fortressAssemblyScale(site: Planet, now: number): number {
  const model = site.fortress;
  if (!model) return 0;
  const work = model.assembly;
  if (!work) return model.level;
  const progress = Math.max(0, Math.min(1,
    (now - work.startedAt) / Math.max(1, work.doneAt - work.startedAt)));
  return work.from + (work.to - work.from) * progress;
}

/** Equipment and readiness share one calculation in the live game and forecasts.
 *  Changes add capacity while preserving absolute hull wounds and spent shields. */
export function refreshFortressBody(site: Planet, body: UnitStack, data: GameData, scale = body.stationScale): void {
  const def = data.units[body.unit];
  if (!site.fortress || !def) return;
  const previousMax = effectiveStats(def, body, data).hp ?? 0;
  const wounds = Math.max(0, previousMax - (body.hp ?? previousMax));
  body.stationScale = scale ?? site.fortress.level;
  // Enemy projections retain visible fittings on the body, but hide the owner's
  // saved loadout plan. A forecast must not erase those known manual fittings.
  body.modules = [...(site.fortress.modules ?? body.modules?.filter((id) => !issuedFortressModule(id)) ?? [])];
  const shield = site.buildings.find((b) => (b.type === 'station_shield' || b.type === 'void_shield') && b.hp > 0);
  if (shield) body.modules.push(['void_shield_i', 'void_shield_ii', 'void_shield_iii'][Math.min(3, shield.level) - 1]!);
  const battery = site.buildings.find((b) => b.type === 'station_defense' && b.hp > 0);
  if (battery) body.modules.push(`station_battery_${Math.min(3, battery.level)}`);
  const stats = effectiveStats(def, body, data);
  body.hp = Math.max(0, (stats.hp ?? 0) - wounds);
  if (wounds === 0) delete body.hp;
  if (body.shieldHp !== undefined) body.shieldHp = Math.min(body.shieldHp, stats.shield ?? 0);
}

export function stationSiteId(province: string): string {
  return `station-${province}`;
}

export function fortressFleetId(site: string): string {
  return FORTRESS_FLEET_PREFIX + site;
}

export function fortressSiteOf(state: GameState, fleetId: string): Planet | undefined {
  if (!fleetId.startsWith(FORTRESS_FLEET_PREFIX)) return undefined;
  const site = state.planets[fleetId.slice(FORTRESS_FLEET_PREFIX.length)];
  return site?.fortress ? site : undefined;
}

/** Physical berth of a site: ships never spawn or travel to its bookkeeping node. */
export function stationBerth(state: GameState, site: Planet): Pick<Fleet, 'location' | 'edge'> {
  const edge = site.fork ? forkSiteEdge(state, site.fork) : null;
  return edge ? { location: null, edge } : { location: site.stationHost ?? site.id };
}

export function fleetAtStation(state: GameState, fleet: Fleet, site: Planet): boolean {
  if (fleet.movement) return false;
  const berth = stationBerth(state, site);
  if (berth.location !== null) return fleet.location === berth.location;
  const a = berth.edge;
  const b = fleet.edge;
  if (!a || !b) return false;
  return (a.from === b.from && a.to === b.to && Math.abs(a.t - b.t) < 1e-9) ||
    (a.from === b.to && a.to === b.from && Math.abs(a.t - (1 - b.t)) < 1e-9);
}

/** Construction sites provide services at their real berth, not at the off-graph id. */
export interface ServiceSiteIndex {
  nodes: ReadonlyMap<string, readonly Planet[]>;
  lanes: ReadonlyMap<string, readonly Planet[]>;
}

function serviceLaneKey(from: string, to: string): string {
  return JSON.stringify(from < to ? [from, to] : [to, from]);
}

/** Per-step index; never cached across state mutations or world-clock steps. */
export function indexServiceSites(state: GameState): ServiceSiteIndex {
  const nodes = new Map<string, Planet[]>();
  const lanes = new Map<string, Planet[]>();
  for (const site of Object.values(state.planets)) {
    if (!site.fortress) continue;
    const berth = stationBerth(state, site);
    const map = berth.location !== null ? nodes : lanes;
    const key = berth.location ?? (berth.edge ? serviceLaneKey(berth.edge.from, berth.edge.to) : undefined);
    if (key === undefined) continue;
    const bucket = map.get(key) ?? [];
    bucket.push(site);
    map.set(key, bucket);
  }
  return { nodes, lanes };
}

export function serviceSitesForFleet(
  state: GameState, fleet: Fleet, allied: (a: string, b: string) => boolean = () => false,
  index?: ServiceSiteIndex,
): Planet[] {
  if (fleet.movement) return [];
  const allowed = (site: Planet): boolean => site.owner !== null &&
    (site.owner === fleet.owner || allied(fleet.owner, site.owner));
  const sites: Planet[] = [];
  const host = fleet.location ? state.planets[fleet.location] : undefined;
  if (host && allowed(host)) sites.push(host);
  const lookup = index ?? indexServiceSites(state);
  const candidates = fleet.location !== null ? lookup.nodes.get(fleet.location) : fleet.edge
    ? lookup.lanes.get(serviceLaneKey(fleet.edge.from, fleet.edge.to)) : undefined;
  for (const site of candidates ?? []) {
    if (site !== host && allowed(site) && fleetAtStation(state, fleet, site)) sites.push(site);
  }
  return sites;
}

export interface RepairQuote {
  missingHp: number;
  cost: ResourceBag;
  hours: number;
}

export function repairQuote(maxHp: number, hp: number, fullCost: ResourceBag, fullHours: number): RepairQuote {
  const missingHp = Math.max(0, maxHp - hp);
  const share = maxHp > 0 ? Math.min(1, missingHp / maxHp) : 0;
  const cost: ResourceBag = {};
  for (const [key, value] of Object.entries(fullCost)) {
    if (value > 0 && share > 0) cost[key] = Math.ceil(value * share);
  }
  return { missingHp, cost, hours: Math.max(1, fullHours) * share };
}

export function buildingRepairQuote(building: Planet['buildings'][number], data: GameData): RepairQuote {
  const def = data.buildings[building.type];
  if (!def) return { missingHp: 0, cost: {}, hours: 0 };
  const cost: ResourceBag = {};
  let hours = 0;
  for (let level = 1; level <= building.level; level++) {
    const step = buildingLevel(def, level);
    hours += step.buildTimeHours;
    for (const [key, value] of Object.entries(step.cost)) cost[key] = (cost[key] ?? 0) + value;
  }
  return repairQuote(buildingLevel(def, building.level).hp, building.hp, cost, hours);
}

export function fortressRepairQuote(state: GameState, site: Planet, data: GameData): RepairQuote {
  const body = state.fleets[fortressFleetId(site.id)]?.units[0];
  const def = data.units[FORTRESS_BODY];
  const core = data.buildings[FORTRESS_CORE];
  if (!body || !def || !core || !site.fortress) return { missingHp: 0, cost: {}, hours: 0 };
  const full = effectiveStats(def, { ...body, stationScale: site.fortress.level }, data).hp ?? 0;
  const available = effectiveStats(def, body, data).hp ?? 0;
  const missing = Math.max(0, available - (body.hp ?? available));
  const cost: ResourceBag = { ...FORTRESS_DEPLOY_COST };
  for (const [key, value] of Object.entries(loadoutCost(site.fortress.modules ?? [], data))) {
    cost[key] = (cost[key] ?? 0) + value;
  }
  let hours = buildingLevel(core, 1).buildTimeHours;
  for (let level = 2; level <= site.fortress.level; level++) {
    const step = buildingLevel(core, level);
    hours += step.buildTimeHours;
    for (const [key, value] of Object.entries(step.cost)) cost[key] = (cost[key] ?? 0) + value;
  }
  return repairQuote(full, full - missing, cost, hours);
}
