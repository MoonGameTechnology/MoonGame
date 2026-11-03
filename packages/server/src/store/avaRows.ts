import type { AvaBattleReport, AvaChallenge, AvaChallengeStatus, AvaResult } from './types';

/** Row shapes and mappers of the Postgres AvA challenge and result stores (`postgres.ts`). */

export interface ChallengeRow {
  id: string;
  challenger_corp: string;
  target_corp: string;
  format: number;
  cost: string;
  status: string;
  created_at: string;
  expires_at: string;
  pause_ends_at: string | null;
  challenger_rating: number | null;
  target_rating: number | null;
}

export function challengeOf(row: ChallengeRow): AvaChallenge {
  return {
    id: row.id,
    challengerCorp: row.challenger_corp,
    targetCorp: row.target_corp,
    format: Number(row.format),
    cost: Number(row.cost),
    status: row.status as AvaChallengeStatus,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    ...(row.pause_ends_at === null ? {} : { pauseEndsAt: Number(row.pause_ends_at) }),
    ...(row.challenger_rating === null || row.target_rating === null
      ? {}
      : {
          ratings: { challenger: Number(row.challenger_rating), target: Number(row.target_rating) },
        }),
  };
}

export interface ResultRow {
  matchup_id: string;
  challenger_corp: string;
  target_corp: string;
  winner_corp: string | null;
  at: string;
  format: number | null;
  report: AvaBattleReport | null;
  bonus: string | null;
}

export function resultOf(row: ResultRow): AvaResult {
  return {
    matchupId: row.matchup_id,
    challengerCorp: row.challenger_corp,
    targetCorp: row.target_corp,
    winnerCorp: row.winner_corp,
    at: Number(row.at),
    ...(row.format === null ? {} : { format: Number(row.format) }),
    ...(row.report === null ? {} : { report: row.report }),
    ...(row.bonus === null ? {} : { bonus: Number(row.bonus) }),
  };
}
