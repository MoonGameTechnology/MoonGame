/**
 * Session market — a public per-match two-sided order book (sell lots / buy bids)
 * with escrow + a trade fee (ECON-4). Extracted from `game.ts` (REFP-12): depends
 * on `canAfford`/`payCost` (shared-core util) + `botEmbargoes` (REFP-6). `game.ts`
 * imports `marketModule` for `MODULES` and re-exports the public surface.
 */
import type { GameModule, GameState } from '../../packages/shared-core/src/index';
import { canAfford, payCost } from '../../packages/shared-core/src/util/treasury';
import { botEmbargoes } from './botFavour';

/** Minimal view of the prototype's state extension for the session market. */
interface MarketState extends GameState {
  sessionMarket?: MarketLot[];
  sessionMarketSeq?: number;
}

export const MARKET_GOODS = ['metal', 'food', 'energy', 'microelectronics']; // credits = currency
// ECON-4: рыночная комиссия — доля суммы сделки СГОРАЕТ (не переходит никому):
// первый настоящий сток кредитов в торговле + анти-спам книги. Платит получатель
// кредитов, симметрично для обеих сторон книги; эскроу-возврат при отмене без
// комиссии.
export const MARKET_FEE = 0.05;
export type MarketSide = 'sell' | 'buy';
export interface MarketLot {
  id: string;
  side: MarketSide;
  owner: string;
  resource: string;
  amount: number; // units remaining on offer (escrowed)
  price: number; // credits per unit
}

/** The live order book (a prototype-only own-key field, preserved by deepClone). */
export function marketLots(state: GameState): MarketLot[] {
  const s = state as MarketState;
  return (s.sessionMarket ??= []);
}
/** Add `n` of `res` to a player's treasury (mirrors payCost's subtract form). */
function creditTreasury(state: GameState, playerId: string, res: string, n: number): void {
  const t = state.players[playerId]?.resources;
  if (t) t[res] = (t[res] ?? 0) + n;
}

export const marketModule: GameModule = {
  id: 'market',
  version: '0.1.0',
  setup(api) {
    // Place a lot: a sell (ask) escrows goods; a buy (bid) escrows credits.
    api.onAction('market.list', (action, h) => {
      const p = action.payload as {
        side?: string;
        resource?: string;
        amount?: number;
        price?: number;
      };
      if (p?.side !== 'sell' && p?.side !== 'buy') return h.reject('E_BAD_PAYLOAD');
      if (typeof p.resource !== 'string' || !MARKET_GOODS.includes(p.resource))
        return h.reject('E_BAD_RESOURCE');
      // typeof first: a numeric STRING passes `>`/`>=` through coercion and would
      // otherwise reach the treasury math on the ungated path.
      if (typeof p.amount !== 'number' || typeof p.price !== 'number') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const amount = Math.floor(p.amount);
      const price = p.price;
      if (!(amount > 0) || !(price >= 0)) return h.reject('E_BAD_PAYLOAD');
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_NO_PLAYER');
      const escrow = p.side === 'sell' ? { [p.resource]: amount } : { credits: amount * price };
      if (!canAfford(player.resources, escrow)) return h.reject('E_NO_FUNDS');
      payCost(player.resources, escrow);
      const s = h.state as MarketState;
      const id = `mk:${action.playerId}:${(s.sessionMarketSeq = (s.sessionMarketSeq ?? 0) + 1)}`;
      marketLots(h.state).push({
        id,
        side: p.side,
        owner: action.playerId,
        resource: p.resource,
        amount,
        price,
      });
      h.emit('market.listed', {
        id,
        side: p.side,
        owner: action.playerId,
        resource: p.resource,
        amount,
        price,
      });
    });

    // Fill (partially) a lot from the other side. Buying from a sell lot pays credits
    // for the escrowed goods; selling into a buy lot gives goods for the escrowed credits.
    api.onAction('market.take', (action, h) => {
      const p = action.payload as { id?: string; amount?: number };
      if (typeof p?.id !== 'string') return h.reject('E_BAD_PAYLOAD');
      const lots = marketLots(h.state);
      const lot = lots.find((l) => l.id === p.id);
      if (!lot) return h.reject('E_NO_LOT');
      if (lot.owner === action.playerId) return h.reject('E_OWN_LOT');
      if (botEmbargoes(h.state, lot.owner, action.playerId)) return h.reject('E_EMBARGO');
      const taker = h.state.players[action.playerId];
      if (!taker || !h.state.players[lot.owner]) return h.reject('E_NO_PLAYER');
      const qty = Math.min(lot.amount, Math.floor(p.amount ?? lot.amount));
      if (!(qty > 0)) return h.reject('E_BAD_PAYLOAD');
      const credits = qty * lot.price;
      // ECON-4: получатель кредитов получает net, комиссия сгорает.
      const net = credits * (1 - MARKET_FEE);
      if (lot.side === 'sell') {
        if (!canAfford(taker.resources, { credits })) return h.reject('E_NO_FUNDS');
        payCost(taker.resources, { credits }); // taker buys the goods
        creditTreasury(h.state, action.playerId, lot.resource, qty);
        creditTreasury(h.state, lot.owner, 'credits', net);
      } else {
        if (!canAfford(taker.resources, { [lot.resource]: qty })) return h.reject('E_NO_FUNDS');
        payCost(taker.resources, { [lot.resource]: qty }); // taker sells the goods
        creditTreasury(h.state, action.playerId, 'credits', net); // from the escrow
        creditTreasury(h.state, lot.owner, lot.resource, qty);
      }
      lot.amount -= qty;
      if (lot.amount <= 0) lots.splice(lots.indexOf(lot), 1);
      h.emit('market.traded', {
        id: lot.id,
        taker: action.playerId,
        owner: lot.owner,
        side: lot.side,
        resource: lot.resource,
        amount: qty,
        price: lot.price,
        fee: credits - net,
      });
    });

    // The owner reclaims a lot, refunding its remaining escrow.
    api.onAction('market.cancel', (action, h) => {
      const p = action.payload as { id?: string };
      if (typeof p?.id !== 'string') return h.reject('E_BAD_PAYLOAD');
      const lots = marketLots(h.state);
      const lot = lots.find((l) => l.id === p.id);
      if (!lot) return h.reject('E_NO_LOT');
      if (lot.owner !== action.playerId) return h.reject('E_FORBIDDEN');
      if (lot.side === 'sell') creditTreasury(h.state, lot.owner, lot.resource, lot.amount);
      else creditTreasury(h.state, lot.owner, 'credits', lot.amount * lot.price);
      lots.splice(lots.indexOf(lot), 1);
      h.emit('market.cancelled', { id: lot.id, owner: lot.owner });
    });
  },
};