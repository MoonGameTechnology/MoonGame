/** Postgres: битвы альянсов (AvA) — вызовы, составы, итоги, медали, лента, сессии (SLIM-5). */
import type { Pool } from 'pg';
import {
  type AvaBattleReport,
  type AvaChallenge,
  type AvaChallengeStatus,
  type AvaChallengeStore,
  type AvaFeedStore,
  type AvaResult,
  type AvaResultStore,
  type AvaRosterEntry,
  type AvaRosterStore,
  type AvaSession,
  type AvaSessionStore,
  type AvaSide,
  type AvaTally,
  type FeedEntry,
  type FeedKind,
  type Medal,
  type MedalStore,
  isAvaFeedEntry,
  DEFAULT_FEED_LIMIT,
  DEFAULT_CHALLENGES_LIMIT,
  DEFAULT_LOCKED_MATCHUPS_LIMIT,
  DEFAULT_RESULTS_LIMIT,
} from '../types';

interface ChallengeRow {
  id: string;
  challenger_corp: string;
  target_corp: string;
  format: number;
  cost: string;
  status: string;
  created_at: string;
  expires_at: string;
  pause_ends_at: string | null;
}

function challengeOf(row: ChallengeRow): AvaChallenge {
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
  };
}

/** Postgres AvA challenge store (AVA-4). The partial unique index enforces one pending
 *  per pair; the conditional UPDATE makes pending→terminal an exactly-once transition. */
export class PostgresAvaChallengeStore implements AvaChallengeStore {
  constructor(private readonly pool: Pool) {}

  async createChallenge(
    challenge: AvaChallenge,
  ): Promise<{ ok: true } | { ok: false; code: 'E_ALREADY_CHALLENGED' }> {
    const inserted = await this.pool.query(
      `INSERT INTO ava_challenges
         (id, challenger_corp, target_corp, cost, status, created_at, expires_at, format)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
      [
        challenge.id,
        challenge.challengerCorp,
        challenge.targetCorp,
        challenge.cost,
        challenge.status,
        challenge.createdAt,
        challenge.expiresAt,
        challenge.format,
      ],
    );
    return inserted.rowCount ? { ok: true } : { ok: false, code: 'E_ALREADY_CHALLENGED' };
  }

  async getChallenge(id: string): Promise<AvaChallenge | null> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? challengeOf(r.rows[0]) : null;
  }

  async challengesOf(corpId: string, limit = DEFAULT_CHALLENGES_LIMIT): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE challenger_corp = $1 OR target_corp = $1
       ORDER BY created_at DESC, id LIMIT $2`,
      [corpId, limit],
    );
    return r.rows.map(challengeOf);
  }

  async closeChallenge(id: string, status: 'accepted' | 'declined' | 'expired'): Promise<boolean> {
    // Only a still-pending row transitions — so a lost double-accept race changes
    // nothing and the caller (which keys the refund off this) can't double-refund.
    const r = await this.pool.query(
      `UPDATE ava_challenges SET status = $2 WHERE id = $1 AND status = 'pending'`,
      [id, status],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async duePending(now: number): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE status = 'pending' AND expires_at <= $1
       ORDER BY expires_at, id`,
      [now],
    );
    return r.rows.map(challengeOf);
  }

  async openRosterWindow(id: string, pauseEndsAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE ava_challenges SET pause_ends_at = $2 WHERE id = $1 AND status = 'accepted'`,
      [id, pauseEndsAt],
    );
  }

  async closeMatchup(id: string, status: 'locked' | 'cancelled'): Promise<boolean> {
    // Same exactly-once contract as closeChallenge, over the accepted state: only a
    // still-accepted matchup transitions, so the sweep can't cancel-and-refund twice.
    const r = await this.pool.query(
      `UPDATE ava_challenges SET status = $2 WHERE id = $1 AND status = 'accepted'`,
      [id, status],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async dueRosters(now: number): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE status = 'accepted' AND pause_ends_at IS NOT NULL AND pause_ends_at <= $1
       ORDER BY pause_ends_at, id`,
      [now],
    );
    return r.rows.map(challengeOf);
  }

  async lockedMatchups(limit = DEFAULT_LOCKED_MATCHUPS_LIMIT): Promise<AvaChallenge[]> {
    const r = await this.pool.query<ChallengeRow>(
      `SELECT id, challenger_corp, target_corp, format, cost, status, created_at, expires_at, pause_ends_at
       FROM ava_challenges
       WHERE status = 'locked'
       ORDER BY created_at DESC, id LIMIT $1`,
      [limit],
    );
    return r.rows.map(challengeOf);
  }

  async endMatchup(id: string, status: 'ended' | 'cancelled' = 'ended'): Promise<boolean> {
    // Same exactly-once contract as closeMatchup, over the locked state: only a
    // still-locked matchup transitions, so settlement can't award influence twice.
    const r = await this.pool.query(
      `UPDATE ava_challenges SET status = $2 WHERE id = $1 AND status = 'locked'`,
      [id, status],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

interface RosterRow {
  matchup_id: string;
  account_id: string;
  side: string;
  source: string;
  at: string;
}

function rosterEntryOf(row: RosterRow): AvaRosterEntry {
  return {
    matchupId: row.matchup_id,
    accountId: row.account_id,
    side: row.side as AvaSide,
    source: row.source as AvaRosterEntry['source'],
    at: Number(row.at),
  };
}

/** Postgres AvA roster store (AVA-6). The PK is the one-entry-per-account invariant;
 *  the per-side cap is guarded by serializing racing inserts of one matchup — the
 *  transaction takes FOR UPDATE on the matchup row before counting, so two joins for
 *  the last slot cannot both pass the count. */
export class PostgresAvaRosterStore implements AvaRosterStore {
  constructor(private readonly pool: Pool) {}

  async addEntry(
    entry: AvaRosterEntry,
    capPerSide: number,
  ): Promise<{ ok: true } | { ok: false; code: 'E_ALREADY_ROSTERED' | 'E_ROSTER_FULL' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize concurrent roster writes of this matchup (the cap guard's atomicity).
      await client.query(`SELECT id FROM ava_challenges WHERE id = $1 FOR UPDATE`, [
        entry.matchupId,
      ]);
      const dup = await client.query(
        `SELECT 1 FROM ava_roster WHERE matchup_id = $1 AND account_id = $2`,
        [entry.matchupId, entry.accountId],
      );
      if ((dup.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_ALREADY_ROSTERED' };
      }
      const onSide = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ava_roster WHERE matchup_id = $1 AND side = $2`,
        [entry.matchupId, entry.side],
      );
      if (Number(onSide.rows[0]?.n ?? 0) >= capPerSide) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'E_ROSTER_FULL' };
      }
      await client.query(
        `INSERT INTO ava_roster (matchup_id, account_id, side, source, at)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.matchupId, entry.accountId, entry.side, entry.source, entry.at],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async replaceSide(matchupId: string, side: AvaSide, entries: AvaRosterEntry[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM ava_challenges WHERE id = $1 FOR UPDATE`, [matchupId]);
      await client.query(`DELETE FROM ava_roster WHERE matchup_id = $1 AND side = $2`, [
        matchupId,
        side,
      ]);
      for (const entry of entries) {
        await client.query(
          `INSERT INTO ava_roster (matchup_id, account_id, side, source, at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (matchup_id, account_id) DO NOTHING`,
          [entry.matchupId, entry.accountId, entry.side, entry.source, entry.at],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async rosterOf(matchupId: string): Promise<AvaRosterEntry[]> {
    const r = await this.pool.query<RosterRow>(
      `SELECT matchup_id, account_id, side, source, at
       FROM ava_roster WHERE matchup_id = $1
       ORDER BY side, account_id`,
      [matchupId],
    );
    return r.rows.map(rosterEntryOf);
  }
}

interface ResultRow {
  matchup_id: string;
  challenger_corp: string;
  target_corp: string;
  winner_corp: string | null;
  at: string;
  format: number | null;
  report: AvaBattleReport | null;
}

function resultOf(row: ResultRow): AvaResult {
  return {
    matchupId: row.matchup_id,
    challengerCorp: row.challenger_corp,
    targetCorp: row.target_corp,
    winnerCorp: row.winner_corp,
    at: Number(row.at),
    ...(row.format === null ? {} : { format: Number(row.format) }),
    ...(row.report === null ? {} : { report: row.report }),
  };
}

/** Postgres AvA result store (AVA-8). `record` is idempotent via the matchup_id PK
 *  (ON CONFLICT DO NOTHING) — belt-and-braces behind the locked→ended gate. */
export class PostgresAvaResultStore implements AvaResultStore {
  constructor(private readonly pool: Pool) {}

  async record(result: AvaResult): Promise<void> {
    await this.pool.query(
      `INSERT INTO ava_results
         (matchup_id, challenger_corp, target_corp, winner_corp, at, format, report)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (matchup_id) DO NOTHING`,
      [
        result.matchupId,
        result.challengerCorp,
        result.targetCorp,
        result.winnerCorp,
        result.at,
        result.format ?? null,
        result.report ? JSON.stringify(result.report) : null,
      ],
    );
  }

  async get(matchupId: string): Promise<AvaResult | null> {
    const r = await this.pool.query<ResultRow>(
      `SELECT matchup_id, challenger_corp, target_corp, winner_corp, at, format, report
       FROM ava_results WHERE matchup_id = $1`,
      [matchupId],
    );
    return r.rows[0] ? resultOf(r.rows[0]) : null;
  }

  async recent(limit = DEFAULT_RESULTS_LIMIT): Promise<AvaResult[]> {
    const r = await this.pool.query<ResultRow>(
      `SELECT matchup_id, challenger_corp, target_corp, winner_corp, at, format, report
       FROM ava_results ORDER BY at DESC, matchup_id LIMIT $1`,
      [limit],
    );
    return r.rows.map(resultOf);
  }

  async resultsOf(
    corpId: string,
    limit = DEFAULT_RESULTS_LIMIT,
  ): Promise<Array<AvaResult & { format: number }>> {
    const r = await this.pool.query<ResultRow>(
      `SELECT matchup_id, challenger_corp, target_corp, winner_corp, at, format, report
       FROM ava_results WHERE challenger_corp = $1 OR target_corp = $1
       ORDER BY at DESC, matchup_id LIMIT $2`,
      [corpId, limit],
    );
    return r.rows.map((row) => ({ ...resultOf(row), format: Number(row.format ?? 2) }));
  }

  async tallyOf(corpId: string): Promise<AvaTally[]> {
    const r = await this.pool.query<{
      opponent: string;
      format: number;
      wins: string;
      losses: string;
      draws: string;
    }>(
      `SELECT
         CASE WHEN challenger_corp = $1 THEN target_corp ELSE challenger_corp END AS opponent,
         COALESCE(format, 2) AS format,
         count(*) FILTER (WHERE winner_corp = $1)::text AS wins,
         count(*) FILTER (WHERE winner_corp IS NOT NULL AND winner_corp <> $1)::text AS losses,
         count(*) FILTER (WHERE winner_corp IS NULL)::text AS draws
       FROM ava_results
       WHERE challenger_corp = $1 OR target_corp = $1
       GROUP BY 1, 2`,
      [corpId],
    );
    // Sorted here, not by the database collation: the same order as the memory store.
    return r.rows
      .map((row) => ({
        opponent: row.opponent,
        format: Number(row.format),
        wins: Number(row.wins),
        losses: Number(row.losses),
        draws: Number(row.draws),
      }))
      .sort((x, y) =>
        x.opponent < y.opponent ? -1 : x.opponent > y.opponent ? 1 : x.format - y.format,
      );
  }

  async statsForCorp(corpId: string): Promise<{ matches: number; wins: number }> {
    const r = await this.pool.query<{ matches: string; wins: string }>(
      `SELECT
         count(*) FILTER (WHERE challenger_corp = $1 OR target_corp = $1)::text AS matches,
         count(*) FILTER (WHERE winner_corp = $1)::text AS wins
       FROM ava_results`,
      [corpId],
    );
    return { matches: Number(r.rows[0]?.matches ?? 0), wins: Number(r.rows[0]?.wins ?? 0) };
  }
}

interface MedalRow {
  account_id: string;
  medal_id: string;
  corp_id: string | null;
  at: string;
}

/** Postgres medal store (MED-1) — PK (account, medal) makes `grant` idempotent (ON CONFLICT
 *  DO NOTHING; the affected-row count says whether it was newly earned). */
export class PostgresMedalStore implements MedalStore {
  constructor(private readonly pool: Pool) {}

  async grant(medal: Medal): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO medals (account_id, medal_id, corp_id, at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, medal_id) DO NOTHING`,
      [medal.accountId, medal.medalId, medal.corpId, medal.at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async has(accountId: string, medalId: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM medals WHERE account_id = $1 AND medal_id = $2`,
      [accountId, medalId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async medalsOf(accountId: string): Promise<Medal[]> {
    const r = await this.pool.query<MedalRow>(
      `SELECT account_id, medal_id, corp_id, at FROM medals
       WHERE account_id = $1 ORDER BY at DESC, medal_id`,
      [accountId],
    );
    return r.rows.map((row) => ({
      accountId: row.account_id,
      medalId: row.medal_id,
      corpId: row.corp_id,
      at: Number(row.at),
    }));
  }
}

interface FeedRow {
  id: string;
  at: string;
  kind: string;
  challenger_corp: string;
  challenger_name: string;
  target_corp: string | null;
  target_name: string | null;
  winner_corp: string | null;
  detail: { level?: unknown; medalId?: unknown } | null;
}

/** One feed row, whatever its kind (AVA-9 + CORP-1). `ON CONFLICT (id) DO NOTHING` is the
 *  idempotency the feed promises: a corp fact's id is derived from the fact. */
export const FEED_INSERT = `INSERT INTO ava_feed
     (id, at, kind, challenger_corp, challenger_name, target_corp, target_name, winner_corp, detail)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
   ON CONFLICT (id) DO NOTHING`;

export function feedValues(entry: FeedEntry): unknown[] {
  if (isAvaFeedEntry(entry)) {
    return [
      entry.id,
      entry.at,
      entry.kind,
      entry.challengerCorp,
      entry.challengerName,
      entry.targetCorp,
      entry.targetName,
      entry.winnerCorp ?? null,
      null,
    ];
  }
  const detail =
    entry.kind === 'level'
      ? { level: entry.level }
      : entry.kind === 'medal'
        ? { medalId: entry.medalId }
        : null;
  return [
    entry.id,
    entry.at,
    entry.kind,
    entry.corpId,
    entry.corpName,
    null,
    null,
    null,
    detail === null ? null : JSON.stringify(detail),
  ];
}

/** A stored row back to its entry; null for a kind or detail this build cannot read. */
function feedEntryOf(row: FeedRow): FeedEntry | null {
  const at = Number(row.at);
  switch (row.kind) {
    case 'matchup':
    case 'result':
      return {
        id: row.id,
        at,
        kind: row.kind,
        challengerCorp: row.challenger_corp,
        challengerName: row.challenger_name,
        targetCorp: row.target_corp ?? '',
        targetName: row.target_name ?? '',
        // A matchup entry has no winner concept; a result carries one (null = draw).
        ...(row.kind === 'result' ? { winnerCorp: row.winner_corp } : {}),
      };
    case 'founded':
      return {
        id: row.id,
        at,
        kind: 'founded',
        corpId: row.challenger_corp,
        corpName: row.challenger_name,
      };
    case 'level': {
      const level = row.detail?.level;
      return typeof level === 'number' && Number.isSafeInteger(level)
        ? {
            id: row.id,
            at,
            kind: 'level',
            corpId: row.challenger_corp,
            corpName: row.challenger_name,
            level,
          }
        : null;
    }
    case 'medal': {
      const medalId = row.detail?.medalId;
      return typeof medalId === 'string'
        ? {
            id: row.id,
            at,
            kind: 'medal',
            corpId: row.challenger_corp,
            corpName: row.challenger_name,
            medalId,
          }
        : null;
    }
    default:
      return null;
  }
}

/** Postgres public corporation feed store (AVA-9, CORP-1) — append-only, newest-first
 *  with an `at` cursor. */
export class PostgresAvaFeedStore implements AvaFeedStore {
  constructor(private readonly pool: Pool) {}

  async append(entry: FeedEntry): Promise<void> {
    await this.pool.query(FEED_INSERT, feedValues(entry));
  }

  async recent(
    limit = DEFAULT_FEED_LIMIT,
    before?: number,
    kinds?: readonly FeedKind[],
  ): Promise<FeedEntry[]> {
    const r = await this.pool.query<FeedRow>(
      `SELECT id, at, kind, challenger_corp, challenger_name, target_corp, target_name, winner_corp, detail
       FROM ava_feed
       WHERE ($2::bigint IS NULL OR at < $2) AND ($3::text[] IS NULL OR kind = ANY($3))
       ORDER BY at DESC, id DESC LIMIT $1`,
      [limit, before ?? null, kinds ? [...kinds] : null],
    );
    return r.rows.flatMap((row) => feedEntryOf(row) ?? []);
  }
}

interface SessionRow {
  match_id: string;
  matchup_id: string;
  map_id: string;
  seats: Record<string, string>;
  at: string;
  war_at: string | null;
  war_declared_at: string | null;
}

function sessionOf(row: SessionRow): AvaSession {
  return {
    matchId: row.match_id,
    matchupId: row.matchup_id,
    mapId: row.map_id,
    seats: row.seats,
    at: Number(row.at),
    ...(row.war_at === null ? {} : { warAt: Number(row.war_at) }),
    ...(row.war_declared_at === null ? {} : { warDeclaredAt: Number(row.war_declared_at) }),
  };
}

/** The full session column list every SELECT shares (one place to extend). */
const SESSION_COLS = 'match_id, matchup_id, map_id, seats, at, war_at, war_declared_at';

/** Postgres AvA session store (AVA-7). The PK (match_id) + UNIQUE (matchup_id) make
 *  `create` atomically one-per-matchup and one-per-instance; a duplicate raises the
 *  insert conflict → `E_SESSION_EXISTS` (the orchestrator treats that as "already built"). */
export class PostgresAvaSessionStore implements AvaSessionStore {
  async pendingResults(
    limit = 100,
  ): Promise<Array<{ matchId: string; matchupId: string; winner: string | null }>> {
    const result = await this.pool.query<{
      match_id: string;
      matchup_id: string;
      winner: string | null;
    }>(
      `SELECT s.match_id,s.matchup_id,m.state->'match'->>'winner' AS winner
       FROM ava_sessions s JOIN matches m ON m.id=s.match_id
       LEFT JOIN ava_result_delivery d ON d.match_id=s.match_id
       WHERE m.status='ended' AND (d.match_id IS NULL OR (NOT d.delivered AND d.retry_at<=$2)) ORDER BY COALESCE(d.attempts,0),s.at,s.match_id LIMIT $1`,
      [limit, Date.now()],
    );
    return result.rows.map((r) => ({
      matchId: r.match_id,
      matchupId: r.matchup_id,
      winner: r.winner,
    }));
  }
  async markResultRetry(matchId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO ava_result_delivery(match_id,attempts,retry_at) VALUES($1,1,$2) ON CONFLICT(match_id) DO UPDATE SET attempts=ava_result_delivery.attempts+1,retry_at=$2',
      [matchId, Date.now() + 5000],
    );
  }
  async markResultDelivered(matchId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO ava_result_delivery(match_id,delivered) VALUES($1,true) ON CONFLICT(match_id) DO UPDATE SET delivered=true',
      [matchId],
    );
  }

  constructor(private readonly pool: Pool) {}

  async create(
    session: AvaSession,
  ): Promise<{ ok: true } | { ok: false; code: 'E_SESSION_EXISTS' }> {
    try {
      await this.pool.query(
        `INSERT INTO ava_sessions (match_id, matchup_id, map_id, seats, at, war_at, war_declared_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.matchId,
          session.matchupId,
          session.mapId,
          JSON.stringify(session.seats),
          session.at,
          session.warAt ?? null,
          session.warDeclaredAt ?? null,
        ],
      );
      return { ok: true };
    } catch {
      // PK (match_id) or UNIQUE (matchup_id) collision — a session already exists.
      return { ok: false, code: 'E_SESSION_EXISTS' };
    }
  }

  async byMatch(matchId: string): Promise<AvaSession | null> {
    const r = await this.pool.query<SessionRow>( // nosemgrep: no-sql-string-interpolation -- SESSION_COLS is a fixed column-list constant, not user input
      `SELECT ${SESSION_COLS} FROM ava_sessions WHERE match_id = $1`,
      [matchId],
    );
    return r.rows[0] ? sessionOf(r.rows[0]) : null;
  }

  async byMatchup(matchupId: string): Promise<AvaSession | null> {
    const r = await this.pool.query<SessionRow>( // nosemgrep: no-sql-string-interpolation -- SESSION_COLS is a fixed column-list constant, not user input
      `SELECT ${SESSION_COLS} FROM ava_sessions WHERE matchup_id = $1`,
      [matchupId],
    );
    return r.rows[0] ? sessionOf(r.rows[0]) : null;
  }

  async dueWar(now: number): Promise<AvaSession[]> {
    const r = await this.pool.query<SessionRow>( // nosemgrep: no-sql-string-interpolation -- SESSION_COLS is a fixed column-list constant, not user input
      `SELECT ${SESSION_COLS} FROM ava_sessions
       WHERE war_at IS NOT NULL AND war_at <= $1 AND war_declared_at IS NULL
       ORDER BY war_at, match_id`,
      [now],
    );
    return r.rows.map(sessionOf);
  }

  async markWarDeclared(matchId: string, at: number): Promise<boolean> {
    // Exactly-once: only an undeclared, war-scheduled session takes the stamp — two
    // racing sweep passes cannot both "win" and neither re-declares a declared war.
    const r = await this.pool.query(
      `UPDATE ava_sessions SET war_declared_at = $2
       WHERE match_id = $1 AND war_at IS NOT NULL AND war_declared_at IS NULL`,
      [matchId, at],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
