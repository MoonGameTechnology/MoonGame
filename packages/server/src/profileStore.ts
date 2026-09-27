import type { Pool } from 'pg';
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
  appearance(accountId: string): Promise<ProfileAppearance>;
  save(accountId: string, appearance: ProfileAppearance): Promise<void>;
  progress(accountId: string): Promise<ProfileProgress>;
  /** Atomic per (match, account): retries and a restart cannot duplicate progress. */
  credit(matchId: string, rows: readonly ProfileCredit[]): Promise<void>;
}

export class MemoryProfileStore implements ProfileStore {
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
