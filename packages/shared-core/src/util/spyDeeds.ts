import { hoursToMs } from '../action/types';
import { buildingLevel } from '../data/schemas';
import type { HandlerContext } from '../kernel/module';
import type {
  BuildingDamage,
  BuildingHit,
  ConstructionDelay,
  DelayedOrder,
} from '../modules/construction';
import type { TechnologyGrant } from '../modules/technology';
import { FORTRESS_CORE } from '../state/fortress';
import { payCost, refundCost } from './treasury';

/**
 * The deeds of a spy who succeeded (SPY-9/10/14/15) — the espionage module's own helpers,
 * not a module. The damage, the delay and the grant themselves are other modules'
 * capabilities; without them a deed does nothing, never crashes.
 */

/** Sabotage: how many buildings are hit (inclusive range) and the share of max HP each loses. */
const SABOTAGE_MIN = 3;
const SABOTAGE_MAX = 5;
const SABOTAGE_SHARE_MIN = 0.1;
const SABOTAGE_SHARE_MAX = 0.2;
/** Theft: the share of the chosen stock taken, and the most one theft can carry. */
/** Queue sabotage (SPY-14): the first order of the world slips by this many hours. */
const DELAY_MIN_HOURS = 6;
const DELAY_MAX_HOURS = 12;
/** Economic sabotage (SPY-15): how long the world produces how much of its output. */
const DISRUPT_HOURS = 24;
export const DISRUPT_FACTOR = 0.75;

const THEFT_SHARE_MIN = 0.05;
const THEFT_SHARE_MAX = 0.15;
export const THEFT_CAP = 500;

/** Sabotage: pick 3–5 distinct damageable buildings of the world and hand them to the
 *  `building.damage` capability. Fewer buildings than the roll → every one is hit. */
export function sabotage(
  h: HandlerContext,
  planetId: string,
): { building: string; destroyed: boolean }[] {
  const planet = h.state.planets[planetId]!;
  const pool: { index: number; maxHp: number }[] = [];
  planet.buildings.forEach((b, index) => {
    if (planet.fortress && b.type === FORTRESS_CORE) return;
    const def = h.ctx.data.buildings[b.type];
    const maxHp = def ? buildingLevel(def, b.level).hp : 0;
    if (maxHp > 0 && b.hp > 0) pool.push({ index, maxHp });
  });
  const count = Math.min(pool.length, h.rng.nextInt(SABOTAGE_MIN, SABOTAGE_MAX + 1));
  const hits: BuildingHit[] = [];
  for (let i = 0; i < count; i++) {
    // Partial Fisher–Yates: the i-th pick comes from the not-yet-picked tail.
    const j = h.rng.nextInt(i, pool.length);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    const share =
      SABOTAGE_SHARE_MIN + h.rng.nextFloat() * (SABOTAGE_SHARE_MAX - SABOTAGE_SHARE_MIN);
    hits.push({ index: pool[i]!.index, amount: Math.round(pool[i]!.maxHp * share) });
  }
  return h.capability<BuildingDamage>('building.damage')?.(h, planetId, hits) ?? [];
}

/** Queue sabotage: roll 6–12 h and hand them to the `construction.delay` capability. */
export function delayQueue(h: HandlerContext, planetId: string): DelayedOrder | null {
  const hours = h.rng.nextInt(DELAY_MIN_HOURS, DELAY_MAX_HOURS + 1);
  return h.capability<ConstructionDelay>('construction.delay')?.(h, planetId, hours) ?? null;
}

/** Economic sabotage: the world's output is cut until `disruptedUntil`; a repeat moves the
 *  end later, never earlier. The end is a scheduled event so that no production span runs
 *  across it — the cut covers exactly its term. Returns the end. */
export function disrupt(h: HandlerContext, planetId: string): number {
  const planet = h.state.planets[planetId]!;
  const until = Math.max(planet.disruptedUntil ?? 0, h.ctx.now + hoursToMs(h.ctx, DISRUPT_HOURS));
  planet.disruptedUntil = until;
  h.schedule(until, 'espionage.disrupt.end', { planetId });
  return until;
}

/** Theft: a random resource the victim holds at least one whole unit of, 5–15% of it
 *  (rounded down, at most `THEFT_CAP`), moved to the spy. Both the share and the cap grow
 *  by the world's `developmentShare` (SPY-21): up to twice from the civilisation's most
 *  developed world. `null` — nothing to take. */
export function theft(
  h: HandlerContext,
  spy: string,
  victim: string,
  development: number,
): { resource: string; amount: number } | null {
  const purse = h.state.players[victim]!.resources;
  const held = h.ctx.data.resources.filter((r) => (purse[r] ?? 0) >= 1);
  if (held.length === 0) return null;
  const resource = held[h.rng.nextInt(0, held.length)]!;
  const scale = 1 + development;
  const share = (THEFT_SHARE_MIN + h.rng.nextFloat() * (THEFT_SHARE_MAX - THEFT_SHARE_MIN)) * scale;
  const cap = Math.floor(THEFT_CAP * scale);
  const amount = Math.min(cap, purse[resource]!, Math.max(1, Math.floor(purse[resource]! * share)));
  payCost(purse, { [resource]: amount });
  refundCost(h.state.players[spy]!.resources, { [resource]: amount });
  return { resource, amount };
}

/** Research theft: a technology `victim` has finished and `spy` has not — first among
 *  those the spy has not started, then among those it researches now. `null` — the
 *  victim knows nothing new to the spy, or no technology module grants it. */
export function stealResearch(h: HandlerContext, spy: string, victim: string): string | null {
  const own = h.state.players[spy]!.technologies;
  const done = new Set(own?.completed ?? []);
  const inLab = new Set((own?.active ?? []).map((a) => a.technology));
  const lacking = (h.state.players[victim]!.technologies?.completed ?? []).filter(
    (t) => !done.has(t) && h.ctx.data.technologies[t] !== undefined,
  );
  const fresh = lacking.filter((t) => !inLab.has(t));
  const pool = fresh.length > 0 ? fresh : lacking;
  if (pool.length === 0) return null;
  const tech = pool[h.rng.nextInt(0, pool.length)]!;
  return h.capability<TechnologyGrant>('technology.grant')?.(h, spy, tech) ? tech : null;
}
