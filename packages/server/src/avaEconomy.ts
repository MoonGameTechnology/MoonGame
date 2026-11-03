import type { AvaEconomy } from './avaFormats';
import type { AvaBattleReport, AvaSide } from './store/types';

/**
 * CORP-19 — the influence economy of a settled corporations battle, as a pure function.
 *
 * Strength is a battle rating (Elo), apart from the influence balance: spending on
 * buildings no longer makes a corporation look weak, and a rating moves only by battles.
 * Only the challenger stakes (`cost`); the settlement pays:
 *
 *   challenger wins → the stake back + bonus = cost × k
 *   target wins     → bonus = cost × k × targetShare; the stake burns
 *   draw            → drawRefund of the stake back, no bonus
 *
 * k = clamp(1 + (R_loser − R_winner) / ratingSpread, bonusMin, bonusMax): beating a
 * stronger corporation pays more, beating a weaker one less. The bonus then shrinks for a
 * pair that fought recently (`pairBonus`, the collusion guard), for bots in the losing
 * side's seats (its share of live players) and stops at the daily cap. The ratings are the
 * ones stamped when the challenge was accepted, so a corp can't game k after the fact.
 */

export interface AvaSettlementInput {
  /** The challenger's stake. */
  cost: number;
  /** null: a draw. */
  winner: AvaSide | null;
  /** Battle ratings of both sides, as stamped at accept. */
  ratings: Record<AvaSide, number>;
  /** Battles this pair already fought inside `pairWindowMs` (this one not counted). */
  pairBattles: number;
  /** Bonus the winner already received from battles in the last day. */
  bonusToday: number;
  /** Share of the losing side's seats held by players, not bots (1 without a report). */
  liveShare: number;
}

export interface AvaSettlement {
  /** Influence returned to the challenger. */
  refund: number;
  /** Influence minted for the winner (0 on a draw). */
  bonus: number;
  /** Rating change of each side; they sum to zero. */
  rating: Record<AvaSide, number>;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The strength factor k of a win by a side rated `winner` over one rated `loser`. */
export function strengthFactor(e: AvaEconomy, winner: number, loser: number): number {
  return clamp(1 + (loser - winner) / e.ratingSpread, e.bonusMin, e.bonusMax);
}

/** Elo: the rating change of side A against B for score 1 (win), 0.5 (draw) or 0 (loss). */
export function eloDelta(e: AvaEconomy, a: number, b: number, score: number): number {
  const expected = 1 / (1 + 10 ** ((b - a) / e.ratingSpread));
  return Math.round(e.ratingK * (score - expected));
}

export function settleBattle(e: AvaEconomy, x: AvaSettlementInput): AvaSettlement {
  const challengerScore = x.winner === null ? 0.5 : x.winner === 'challenger' ? 1 : 0;
  const delta = eloDelta(e, x.ratings.challenger, x.ratings.target, challengerScore);
  const rating = { challenger: delta, target: -delta };
  if (x.winner === null) {
    return { refund: Math.floor(x.cost * e.drawRefund), bonus: 0, rating };
  }
  const loser: AvaSide = x.winner === 'challenger' ? 'target' : 'challenger';
  const k = strengthFactor(e, x.ratings[x.winner], x.ratings[loser]);
  const side = x.winner === 'challenger' ? 1 : e.targetShare;
  const repeat = e.pairBonus[Math.min(Math.max(0, x.pairBattles), e.pairBonus.length - 1)]!;
  const earned = Math.round(x.cost * k * side * repeat * clamp(x.liveShare, 0, 1));
  const bonus = clamp(earned, 0, Math.max(0, e.dailyBonusCap - x.bonusToday));
  return { refund: x.winner === 'challenger' ? x.cost : 0, bonus, rating };
}

/** Share of `side`'s seats a player held (bots aside); 1 when the report has no seats. */
export function liveShare(report: AvaBattleReport | null | undefined, side: AvaSide): number {
  const seats = report?.seats.filter((s) => s.side === side) ?? [];
  if (seats.length === 0) return 1;
  return seats.filter((s) => s.accountId !== null).length / seats.length;
}
