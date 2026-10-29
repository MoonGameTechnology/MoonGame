/** Corporation battle read models. Server authority and clients share this contract. */
export type CorpBattleSide = 'challenger' | 'target';
export type CorpChallengeStatus =
  'pending' | 'accepted' | 'declined' | 'expired' | 'locked' | 'cancelled' | 'ended';
export interface CorpBattleChallenge {
  id: string;
  challengerCorp: string;
  targetCorp: string;
  format: number;
  cost: number;
  status: CorpChallengeStatus;
  createdAt: number;
  expiresAt: number;
  pauseEndsAt?: number;
}
export interface CorpBattleSeat {
  side: CorpBattleSide;
  accountId?: string;
  login: string | null;
  bot: boolean;
  score: number;
  provinces: number;
  out: boolean;
}
export interface CorpBattleReport {
  reason: 'domination' | 'elimination' | 'score' | 'timeout' | null;
  warAt?: number;
  provinces: number;
  sides: Record<CorpBattleSide, { score: number; provinces: number }>;
  seats: CorpBattleSeat[];
}
export interface CorpBattleResult {
  matchupId: string;
  challengerCorp: string;
  targetCorp: string;
  winnerCorp: string | null;
  at: number;
  format: number;
  side: CorpBattleSide;
  report?: CorpBattleReport;
}
export interface CorpBattleTally {
  opponent: string;
  format: number;
  wins: number;
  losses: number;
  draws: number;
}
export interface CorpBattlesView {
  corpId: string;
  ready: { corp: boolean; formats: number[]; player: boolean; players: string[] };
  challenges: CorpBattleChallenge[];
  results: CorpBattleResult[];
  tally: CorpBattleTally[];
  names: Record<string, string>;
}
export interface CorpWarView {
  matchupId: string;
  side: CorpBattleSide;
  phase: 'peace' | 'war' | 'ended';
  warAt?: number;
  score: number;
  scoreGoal: number;
  provinces: number;
  capturable: number;
  dominationPercent: number;
  mine: Array<{
    accountId: string | null;
    login: string | null;
    score: number;
    provinces: number;
    out: boolean;
  }>;
  /** Before war, only the count is visible. Never includes opponents' scores or land. */
  rivals: { count: number; seats?: Array<{ bot: boolean; login: string | null; out: boolean }> };
}
