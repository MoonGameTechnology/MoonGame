import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameData } from '../data/schemas';
import type { GameState, MarketOrder, MarketSide } from '../state/gameState';
import { canAfford, payCost } from '../util/treasury';

/**
 * Session resource market — the bourse (in-match, NOT the meta auction in
 * economy-roadmap). A public, per-match TWO-SIDED order book in `GameState.market`:
 *
 *   - `market.list {side, resource, amount, price}` — place an order. Both sides
 *     ESCROW up front: a `sell` locks away the goods, a `buy` locks away
 *     `amount × price` credits. Nothing on the book can be double-spent.
 *   - `market.take {id, amount?}` — fill (partially) from the other side. Taking a
 *     `sell` pays credits for the escrowed goods; taking a `buy` delivers goods for
 *     the escrowed credits. `amount` omitted = take all that is left.
 *   - `market.cancel {id}` — the owner reclaims the remaining escrow, fee-free.
 *
 * The book was implemented TWICE — sell-only here, two-sided in the prototype — and
 * the two answered the same `market.list` differently (CONV-9). This is the merged
 * one: the prototype's richer shape, the core's stricter money rules.
 *
 * 1. **Commission is 15% and it BURNS.** The receiver of credits gets 85%; the rest
 *    leaves the economy. It is the session's main credit sink against inflation, so
 *    the number is game balance, not an implementation detail — it was 15% here and
 *    5% in the copy, and the owner picked 15% when the two were merged. Symmetric
 *    for both sides of the book: whoever receives credits pays it. A cancel refunds
 *    escrow WITHOUT a fee — parking an order must not cost anything, or the book
 *    stops being usable for price discovery.
 * 2. **What is tradable comes from DATA** (`data.market.goods`), not from a constant
 *    in this file. An empty list means "no whitelist" — every declared resource is
 *    tradable, which is what this module did before the merge. The prototype's copy
 *    hard-coded four goods, which made adding a tradable resource a code change and
 *    left the currency tradable-for-itself here.
 * 3. **Price must be ≥ 1.** A zero price is a free transfer — the documented wash-
 *    trade vehicle once alt accounts exist (SEC-A06-5). The gate schema says the
 *    same, and this handler re-checks: it does not assume the gate ran. The copy
 *    accepted `price >= 0`, so on the ungated prototype host the hole was open.
 * 4. **An embargo blocks the fill, not the listing.** Asked through the
 *    `market.embargo` capability, with the base default "nobody embargoes anybody" —
 *    a host with no provider degrades gracefully (invariant #3). The copy called the
 *    prototype's `botEmbargoes` directly, which is exactly why this rule could not
 *    travel to the canonical server: a module reaching into another module's state
 *    has nowhere to travel to.
 *
 * Pure, deterministic, fail-secure; lives entirely in state — no kernel change. The
 * order book is public (an exchange), so it is NOT stripped by the fog projection.
 */

const MONEY = 'credits';
/** Share of every trade that BURNS (rule 1). Balance number — see the header. */
export const MARKET_COMMISSION = 0.15;
/** Max simultaneously-open orders per player. The book is public and replicated to
 *  every client, so an unbounded owner could inflate shared state by splitting a
 *  stockpile into many tiny listings (A06 — resource-consumption by design). */
const MAX_OPEN_ORDERS = 20;

/** May `resource` be listed at all (rule 2)? Empty whitelist = everything declared. */
export function isTradable(data: GameData, resource: string): boolean {
  const goods = data.market.goods;
  return goods.length > 0 ? goods.includes(resource) : data.resources.includes(resource);
}

function findOrder(state: GameState, id: string): MarketOrder | undefined {
  return state.market?.find((o) => o.id === id);
}

/** What the placer must lock away (rule: both sides escrow). */
function escrowOf(side: MarketSide, resource: string, amount: number, price: number) {
  return side === 'sell' ? { [resource]: amount } : { [MONEY]: amount * price };
}

/** Add `n` of `res` to a player's treasury (the mirror of `payCost`). */
function credit(state: GameState, playerId: string, res: string, n: number): void {
  const t = state.players[playerId]?.resources;
  if (t) t[res] = (t[res] ?? 0) + n;
}

/** Answers "does `a` refuse to trade with `b`" — the shape a host provides under the
 *  `market.embargo` capability. `a` is the order's owner, `b` the would-be taker. */
export interface MarketEmbargoCapability {
  embargoed(state: GameState, a: string, b: string): boolean;
}

/** Is trade between these two blocked (rule 4)? No provider → nobody is embargoed. */
function embargoed(h: HandlerContext, a: string, b: string): boolean {
  const cap = h.capability<MarketEmbargoCapability>('market.embargo');
  return cap ? cap.embargoed(h.state, a, b) : false;
}

export const marketModule: GameModule = {
  id: 'market',
  version: '2.0.0',
  setup(api) {
    api.onAction('market.list', (action, h) => {
      const p = action.payload as {
        side?: unknown;
        resource?: unknown;
        amount?: unknown;
        price?: unknown;
      };
      if (p?.side !== 'sell' && p?.side !== 'buy') return h.reject('E_BAD_PAYLOAD');
      // typeof first: a numeric STRING passes `>`/`>=` through coercion and would
      // otherwise reach the treasury math on the ungated path.
      if (typeof p.resource !== 'string' || typeof p.amount !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      if (typeof p.price !== 'number') return h.reject('E_BAD_PAYLOAD');
      const amount = Math.floor(p.amount);
      if (!(amount > 0) || !(p.price >= 1)) return h.reject('E_BAD_PAYLOAD'); // rule 3
      if (!isTradable(h.ctx.data, p.resource)) return h.reject('E_UNKNOWN_RESOURCE'); // rule 2

      const owner = h.state.players[action.playerId];
      if (!owner) return h.reject('E_FORBIDDEN');
      const open = (h.state.market ?? []).reduce(
        (n, o) => (o.owner === action.playerId ? n + 1 : n),
        0,
      );
      if (open >= MAX_OPEN_ORDERS) return h.reject('E_ORDER_LIMIT');
      const escrow = escrowOf(p.side, p.resource, amount, p.price);
      if (!canAfford(owner.resources, escrow)) return h.reject('E_INSUFFICIENT');
      payCost(owner.resources, escrow);

      const seq = (h.state.marketSeq ?? 0) + 1;
      h.state.marketSeq = seq;
      const o: MarketOrder = {
        id: `market:${seq}`,
        side: p.side,
        owner: action.playerId,
        resource: p.resource,
        amount,
        price: p.price,
      };
      (h.state.market ??= []).push(o);
      h.emit('market.listed', {
        id: o.id,
        side: o.side,
        owner: o.owner,
        resource: o.resource,
        amount,
        price: o.price,
      });
    });

    api.onAction('market.take', (action, h) => {
      const p = action.payload as { id?: unknown; amount?: unknown };
      if (typeof p?.id !== 'string') return h.reject('E_BAD_PAYLOAD');
      if (p.amount !== undefined && typeof p.amount !== 'number') return h.reject('E_BAD_PAYLOAD');
      const o = findOrder(h.state, p.id);
      if (!o) return h.reject('E_NO_ORDER');
      if (o.owner === action.playerId) return h.reject('E_OWN_ORDER'); // can't fill your own
      if (embargoed(h, o.owner, action.playerId)) return h.reject('E_EMBARGO'); // rule 4
      const taker = h.state.players[action.playerId];
      if (!taker || !h.state.players[o.owner]) return h.reject('E_FORBIDDEN');
      const qty = Math.min(o.amount, Math.floor(p.amount ?? o.amount));
      if (!(qty > 0)) return h.reject('E_BAD_PAYLOAD');

      const credits = qty * o.price;
      const net = credits * (1 - MARKET_COMMISSION); // rule 1 — the rest burns
      if (o.side === 'sell') {
        // The goods are already escrowed; the taker pays for them.
        if (!canAfford(taker.resources, { [MONEY]: credits })) return h.reject('E_INSUFFICIENT');
        payCost(taker.resources, { [MONEY]: credits });
        credit(h.state, action.playerId, o.resource, qty);
        credit(h.state, o.owner, MONEY, net);
      } else {
        // The credits are already escrowed; the taker delivers the goods.
        if (!canAfford(taker.resources, { [o.resource]: qty })) return h.reject('E_INSUFFICIENT');
        payCost(taker.resources, { [o.resource]: qty });
        credit(h.state, action.playerId, MONEY, net);
        credit(h.state, o.owner, o.resource, qty);
      }
      o.amount -= qty;
      if (o.amount <= 0) h.state.market = (h.state.market ?? []).filter((x) => x.id !== o.id);
      h.emit('market.traded', {
        id: o.id,
        taker: action.playerId,
        owner: o.owner,
        side: o.side,
        resource: o.resource,
        amount: qty,
        price: o.price,
        fee: credits - net,
      });
    });

    api.onAction('market.cancel', (action, h) => {
      const p = action.payload as { id?: unknown };
      if (typeof p?.id !== 'string') return h.reject('E_BAD_PAYLOAD');
      const o = findOrder(h.state, p.id);
      if (!o) return h.reject('E_NO_ORDER');
      if (o.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      // Fail-secure: no owner row → reject, never burn the escrow silently.
      if (!h.state.players[action.playerId]) return h.reject('E_FORBIDDEN');
      // Refund the untouched escrow, fee-free (rule 1).
      if (o.side === 'sell') credit(h.state, o.owner, o.resource, o.amount);
      else credit(h.state, o.owner, MONEY, o.amount * o.price);
      h.state.market = (h.state.market ?? []).filter((x) => x.id !== o.id);
      h.emit('market.cancelled', {
        id: o.id,
        owner: o.owner,
        side: o.side,
        resource: o.resource,
        amount: o.amount,
      });
    });
  },
};
