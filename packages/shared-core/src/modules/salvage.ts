/**
 * Salvage (EVT-2) — the victor strips the battlefield.
 *
 * A resolved battle pays its winners a share of what DIED there: both sides' losses,
 * priced by the `cost` of the units in `data.units`. The loser gets nothing (owner's
 * decision, 2026-09-22). Paying for your OWN dead too is deliberate: a pyrrhic victory
 * refunds more than a cheap one, which is the only part of this rule that pushes back
 * against the snowball it otherwise feeds.
 *
 * **Why a module and not a branch inside `combat.ts`.** The reducer decides who won;
 * what that is WORTH is a separate mechanic, and the bus is the seam (invariant #3).
 * Combat contributes exactly one thing here: it stamps `battleId` on the `unit.died`
 * it emits, so this module can tell a battle casualty from an AA burst or an orbital
 * bombardment — those kill units too and must not pay.
 *
 * **Why the pool lives in state.** Events drain AFTER the step's mutations, and a
 * battle spans many rounds in many steps: by the time `battle.resolved` reaches a
 * listener the battle is already deleted, and the deaths it is meant to price happened
 * in earlier steps entirely. So losses accrue into `state.salvage[location].pool` as
 * they happen and are claimed at resolution. The slice is stripped from `visibleState`
 * — it names losses on nodes a viewer may not see.
 *
 * **The fortress.** Its guns are `issued` (cost 0) — pricing a destroyed fortress by
 * its dead units would pay nothing at all. What was actually spent sits in the
 * BUILDINGS on the node, so `station.destroyed` prices those instead, at what they
 * cost to raise (base + every upgrade paid up to the instance's level). That event
 * drains after `battle.resolved`, which is why the winners are remembered on the entry
 * rather than consumed with the pool.
 *
 * The share is a hook (`salvage.share`, base 5%) rather than a constant, because a
 * hero passive raises it for the battles its bearer fought (EVT-3) — the extension
 * point exists so that mechanic needs no edit here.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { BuildingInstance } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { refundCost } from '../util/treasury';

/** Base fraction of the battlefield's value the winner claims (owner's decision:
 *  5%, to be re-checked by self-play — this rule feeds the snowball). */
export const SALVAGE_SHARE = 0.05;

type Pool = Record<string, number>;

/** Add `bag`'s entries into `pool`, ignoring anything that is not a finite number. */
function addBag(pool: Pool, bag: Readonly<Record<string, unknown>> | undefined, times = 1): void {
  for (const [resource, amount] of Object.entries(bag ?? {})) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    pool[resource] = (pool[resource] ?? 0) + amount * times;
  }
}

/** What raising this building actually cost: its base price plus every upgrade paid
 *  for up to its current level (level 1 = base only). */
function addInvested(pool: Pool, data: GameData, b: BuildingInstance): void {
  const def = data.buildings[b.type];
  if (!def) return;
  addBag(pool, def.cost);
  const paidUpgrades = Math.max(0, Math.floor(b.level) - 1);
  for (const up of (def.upgrades ?? []).slice(0, paidUpgrades)) addBag(pool, up.cost);
}

/** Hand `pool × share` to each winner, split between them. Splitting (rather than
 *  paying each in full) is the rule MSB-4 already names for a joint assault: help has
 *  to be worth giving, but two allies must not conjure twice the wreckage. */
function payOut(h: HandlerContext, pool: Pool, winners: readonly string[], location: string): void {
  for (const playerId of winners) {
    const player = h.state.players[playerId];
    if (!player) continue;
    const share = h.hook<number>('salvage.share', SALVAGE_SHARE, { playerId, location });
    if (!(share > 0)) continue;
    const bag: Record<string, number> = {};
    for (const [resource, total] of Object.entries(pool)) {
      // Floor keeps the treasury in whole units and can only ever pay LESS than the
      // rule promises — never more, which is the safe direction for a snowball rule.
      const amount = Math.floor((total * share) / winners.length);
      if (amount > 0) bag[resource] = amount;
    }
    if (Object.keys(bag).length === 0) continue;
    refundCost(player.resources, bag);
    h.emit('salvage.paid', { playerId, location, resources: bag });
  }
}

/** The entry for `location`, created empty on first use. */
function entryAt(h: HandlerContext, location: string): { pool: Pool; winners?: string[] } {
  const slice = (h.state.salvage ??= {});
  return (slice[location] ??= { pool: {} });
}

export const salvageModule: GameModule = {
  id: 'salvage',
  version: '1.0.0',
  setup(api) {
    api.on('unit.died', (event, h) => {
      const p = event.payload as Record<string, unknown>;
      // No `battleId` ⇒ this death was not a battle casualty (orbital AA, bombardment,
      // a shuttle strike). Those are not a battlefield and pay nobody.
      if (typeof p['battleId'] !== 'string') return;
      const at = p['at'];
      const unit = p['unit'];
      const count = p['count'];
      if (typeof at !== 'string' || typeof unit !== 'string') return;
      if (typeof count !== 'number' || !(count > 0)) return;
      addBag(entryAt(h, at).pool, h.ctx.data.units[unit]?.cost, count);
    });

    api.on('battle.resolved', (event, h) => {
      const p = event.payload as Record<string, unknown>;
      const location = p['location'];
      if (typeof location !== 'string') return;
      const raw = p['winners'];
      const winners = Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : [];
      const entry = entryAt(h, location);
      // A stalemate has no winner, so the wreckage goes unclaimed — dropped, not held:
      // the next battle here is a different battle and must not inherit this one's dead.
      if (winners.length === 0) {
        entry.pool = {};
        delete entry.winners;
        return;
      }
      payOut(h, entry.pool, winners, location);
      entry.pool = {};
      // Remembered for `station.destroyed`, which drains later in this same pass.
      entry.winners = winners;
    });

    api.on('station.destroyed', (event, h) => {
      const p = event.payload as Record<string, unknown>;
      const planetId = p['planetId'];
      if (typeof planetId !== 'string') return;
      const winners = h.state.salvage?.[planetId]?.winners ?? [];
      if (winners.length === 0) return; // fell outside a battle — nobody to pay
      const planet = h.state.planets[planetId];
      if (!planet) return;
      // Read BEFORE the construction module clears them on this same event: that
      // ordering is this module's position in the module array, which is the one
      // kind of order-dependence invariant #6 allows (and `salvage` sits directly
      // before `construction` in both kernels for exactly this reason).
      const pool: Pool = {};
      for (const b of planet.buildings) addInvested(pool, h.ctx.data, b);
      payOut(h, pool, winners, planetId);
    });

    api.on('time.advanced', (_event, h) => {
      const slice = h.state.salvage;
      if (!slice) return;
      // Garbage-collect (the `standingOrders` pattern): an entry is only meaningful
      // while a battle is running on that node. A retreat dissolves a battle without
      // ever resolving it, so its pool would otherwise sit in the state forever.
      for (const location of Object.keys(slice)) {
        if (!Object.values(h.state.battles).some((b) => b.location === location)) {
          delete slice[location];
        }
      }
      if (Object.keys(slice).length === 0) delete h.state.salvage;
    });
  },
};
