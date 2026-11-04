import type {
  MatchStatus,
  PlayerId,
  PlanetId,
  MatchEndReason,
  MatchScore,
  PlayerReward,
} from './gameState';

export interface MatchState {
  status: MatchStatus;
  winner: PlayerId | null;
  /** Every winner of a coalition (alliance) score win, sorted (GDD §3.3). Present
   *  only when a coalition won together; `winner` then holds its top scorer. */
  winners?: PlayerId[];
  endedAt?: number;
  reason?: MatchEndReason;
  scores: Record<PlayerId, MatchScore>;
  /** Pinned at creation. Absent in legacy snapshots means the original unscaled scoring. */
  buildingScoreDivisor?: number;
  /** Pinned at creation: may players use actions paid in Sovereigns (account premium
   *  currency) in this match. Absent = allowed, as before the setting existed. */
  goldActions?: boolean;
  /** Public capture targets and holders; no intelligence about the garrison is included. */
  capitalObjectives?: Record<PlayerId, { planetId: PlanetId; owner: PlayerId | null }>;
  /** Battle points accrued so far (BAL-16): +20 per battle won against a player, −4 per
   *  battle lost to one. Cumulative, unlike the territory snapshot; added into each
   *  `scores[id].total`. Absent until the first such battle. */
  battlePoints?: Record<PlayerId, number>;
  /** Session-end reward table (GDD §3.4), written once when the match ends —
   *  every seated player gets a row (participation pays even in defeat). */
  rewards?: Record<PlayerId, PlayerReward>;
}
