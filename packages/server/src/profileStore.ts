import type { Pool } from 'pg';
import type { PlayerCareer } from '@void/protocol';
import { mergeCareer, settleCareer } from './playerCareer';
import type { MatchSnapshot } from './store';
import {
  defaultAppearance,
  type ProfileAppearance,
  type ProfileProgress,
  type ProfileMetric,
} from '@void/protocol';

export interface ProfileCredit {
  accountId: string;
  progress: ProfileProgress;
}
export interface ProfileStore {
  career?(accountId: string): Promise<PlayerCareer | null>;
  creditCareer?(snapshot: MatchSnapshot): Promise<void>;
  appearance(accountId: string): Promise<ProfileAppearance>;
  save(accountId: string, appearance: ProfileAppearance): Promise<void>;
  progress(accountId: string): Promise<ProfileProgress>;
  /** Atomic per (match, account): retries and a restart cannot duplicate progress. */
  credit(matchId: string, rows: readonly ProfileCredit[]): Promise<void>;
}

export class MemoryProfileStore implements ProfileStore {
  private readonly careers = new Map<string, PlayerCareer>();
  private readonly careerCredits = new Set<string>();
  async career(id: string): Promise<PlayerCareer | null> {
    return structuredClone(this.careers.get(id) ?? null);
  }
  async creditCareer(snapshot: MatchSnapshot): Promise<void> {
    if (!snapshot.career) return;
    for (const row of settleCareer(snapshot.career, snapshot.state)) {
      const key = JSON.stringify([snapshot.matchId, row.accountId]);
      if (this.careerCredits.has(key)) continue;
      this.careers.set(
        row.accountId,
        mergeCareer(this.careers.get(row.accountId) ?? null, row.career),
      );
      this.careerCredits.add(key);
    }
  }
  private readonly looks = new Map<string, ProfileAppearance>();
  private readonly counters = new Map<string, ProfileProgress>();
  private readonly credited = new Set<string>();
  async appearance(id: string): Promise<ProfileAppearance> {
    return structuredClone(this.looks.get(id) ?? defaultAppearance());
  }
  async save(id: string, appearance: ProfileAppearance): Promise<void> {
    this.looks.set(id, structuredClone(appearance));
  }
  async progress(id: string): Promise<ProfileProgress> {
    return { ...this.counters.get(id) };
  }
  async credit(match: string, rows: readonly ProfileCredit[]): Promise<void> {
    for (const row of rows) {
      const key = JSON.stringify([match, row.accountId]);
      if (this.credited.has(key)) continue;
      const next = { ...this.counters.get(row.accountId) };
      for (const [metric, n] of Object.entries(row.progress)) {
        if (Number.isSafeInteger(n) && n > 0)
          next[metric as ProfileMetric] = (next[metric as ProfileMetric] ?? 0) + n;
      }
      this.counters.set(row.accountId, next);
      this.credited.add(key);
    }
  }
}

export class PostgresProfileStore implements ProfileStore {
  constructor(private readonly pool: Pool) {}
  async career(id: string): Promise<PlayerCareer | null> {
    const result = await this.pool.query<{ career: PlayerCareer }>(
      'SELECT career FROM profile_career WHERE account_id=$1',
      [id],
    );
    return result.rows[0]?.career ?? null;
  }
  async creditCareer(snapshot: MatchSnapshot): Promise<void> {
    if (!snapshot.career) return;
    const rows = settleCareer(snapshot.career, snapshot.state).sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const claimed = await client.query(
          'INSERT INTO profile_career_credits(match_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [snapshot.matchId, row.accountId],
        );
        if (!claimed.rowCount) continue;
        await client.query(
          'INSERT INTO profile_career(account_id,career) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',
          [
            row.accountId,
            JSON.stringify({
              ...row.career,
              matches: 0,
              wins: 0,
              pvp: { destroyed: 0, lost: 0, destroyedCost: {}, lostCost: {} },
              modes: {},
            }),
          ],
        );
        const current = await client.query<{ career: PlayerCareer }>(
          'SELECT career FROM profile_career WHERE account_id=$1 FOR UPDATE',
          [row.accountId],
        );
        await client.query('UPDATE profile_career SET career=$2::jsonb WHERE account_id=$1', [
          row.accountId,
          JSON.stringify(mergeCareer(current.rows[0]!.career, row.career)),
        ]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async appearance(id: string): Promise<ProfileAppearance> {
    const r = await this.pool.query<{ appearance: ProfileAppearance }>(
      'SELECT appearance FROM player_profiles WHERE account_id = $1',
      [id],
    );
    return r.rows[0]?.appearance ?? defaultAppearance();
  }
  async save(id: string, appearance: ProfileAppearance): Promise<void> {
    await this.pool.query(
      'INSERT INTO player_profiles (account_id, appearance) VALUES ($1, $2::jsonb) ON CONFLICT (account_id) DO UPDATE SET appearance = EXCLUDED.appearance',
      [id, JSON.stringify(appearance)],
    );
  }
  async progress(id: string): Promise<ProfileProgress> {
    const r = await this.pool.query<{ metric: ProfileMetric; value: string }>(
      'SELECT metric, value FROM profile_progress WHERE account_id = $1',
      [id],
    );
    return Object.fromEntries(r.rows.map((r) => [r.metric, Number(r.value)]));
  }
  async credit(match: string, rows: readonly ProfileCredit[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Stable lock order also permits two matches for the same accounts to settle concurrently.
      for (const row of [...rows].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
        const claim = await client.query(
          'INSERT INTO profile_credits (match_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [match, row.accountId],
        );
        if (!claim.rowCount) continue;
        for (const [metric, n] of Object.entries(row.progress).sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          if (!Number.isSafeInteger(n) || n <= 0) continue;
          await client.query(
            'INSERT INTO profile_progress (account_id, metric, value) VALUES ($1, $2, $3) ON CONFLICT (account_id, metric) DO UPDATE SET value = profile_progress.value + EXCLUDED.value',
            [row.accountId, metric, n],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
