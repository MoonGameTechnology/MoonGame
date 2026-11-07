import type { MatchSnapshot } from './types';

export interface MatchRow {
  id: string;
  data_version: string;
  seq: number;
  status: string;
  state: MatchSnapshot['state'];
  ruleset: MatchSnapshot['ruleset'] | null;
  clock: MatchSnapshot['clock'] | null;
  economy_observations: MatchSnapshot['economyObservations'] | null;
  economy_activity: MatchSnapshot['economyActivity'] | null;
  career: MatchSnapshot['career'] | null;
  match_reward_progress: MatchSnapshot['matchRewardProgress'] | null;
  created_at: Date;
  ended_at: Date | null;
}
