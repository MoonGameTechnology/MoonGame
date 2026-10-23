import { BOT_PROFILE_HISTORY_LIMIT } from '@void/protocol';
import type { Pool, PoolClient } from 'pg';
import { SYSTEM_BOT_NICKNAMES } from './botNicknames';

export interface BotIdentity {
  id: string;
  login: string;
  portrait: number;
  seed: number;
  xp: number;
}

export interface BotAssignment {
  botId: string;
  login: string;
  playerId: string;
  matchId: string;
}

export interface BotMatchResult {
  botId: string;
  playerId: string;
  mapId: string;
  /** Actual UTC epoch milliseconds, not elapsed simulation time. */
  endedAt: number;
  outcome: 'win' | 'draw' | 'loss';
  xp: number;
  place: number | null;
}

export interface BotMatchHistory extends BotMatchResult {
  matchId: string;
}

export interface BotRosterStore {
  ensureRoster(): Promise<void>;
  findByLogin(login: string): Promise<BotIdentity | null>;
  /** Historical ownership survives completion and rotation to another match. */
  assignments(matchId: string): Promise<BotAssignment[]>;
  /** Returns all assignments of this match; never evicts an existing participant. */
  assign(
    matchId: string,
    playerIds: readonly string[],
    activeLimit: number,
    now: number,
  ): Promise<BotAssignment[]>;
  /** Caller has proved this bot never acquired the account-store seat. */
  cancelUnclaimedAssignment(matchId: string, botId: string): Promise<void>;
  activeMatchIds(): Promise<string[]>;
  /** Every assignment needs a result or an explicit unplayed declaration from a
   *  durable terminal snapshot. Unplayed identities earn no XP/history. XP, history
   *  and release commit together; the caller credits ProfileStore first. */
  finishMatch(
    matchId: string,
    results: readonly BotMatchResult[],
    now: number,
    unplayedBotIds?: readonly string[],
  ): Promise<void>;
  /** Only for a host that has proved this match has no durable snapshot. No time-based expiry. */
  abandonMatch(matchId: string): Promise<void>;
  recentMatches(botId: string, limit?: number): Promise<BotMatchHistory[]>;
}

export const BOT_ROSTER_SIZE = 100;
const MAX_HISTORY_LIMIT = 50;
const MAX_TIMESTAMP = 8.64e15;

// Previous public logins are kept only to migrate existing seats by stable identity.
// Never reorder: each position identifies the same persistent bot.
const LEGACY_CALLSIGNS = [
  'Orion',
  'Vega',
  'Altair',
  'Sirius',
  'Deneb',
  'Rigel',
  'Antares',
  'Arcturus',
  'Capella',
  'Procyon',
  'Polaris',
  'Regulus',
  'Spica',
  'Aldebaran',
  'Castor',
  'Pollux',
  'Alhena',
  'Mirach',
  'Almach',
  'Algol',
  'Cygni',
  'Lyra',
  'Draco',
  'Perseus',
  'Andromeda',
  'Cassiopeia',
  'Cepheus',
  'Aquila',
  'Corvus',
  'Hydra',
  'Phoenix',
  'Pegasus',
  'Centaurus',
  'Carina',
  'Vela',
  'Puppis',
  'Volans',
  'Indus',
  'Pavo',
  'Apus',
  'Lacerta',
  'Delphinus',
  'Sagitta',
  'Vulpecula',
  'Monoceros',
  'Columba',
  'Caelum',
  'Fornax',
  'Reticulum',
  'Dorado',
  'Mensa',
  'Octans',
  'Tucana',
  'Sculptor',
  'Sextans',
  'Pyxis',
  'Antlia',
  'Horologium',
  'Pictor',
  'Circinus',
  'Norma',
  'Triangulum',
  'Auriga',
  'Lepus',
  'Lynx',
  'Camelopardalis',
  'Coma',
  'Canopus',
  'Achernar',
  'Fomalhaut',
  'Bellatrix',
  'Saiph',
  'Alnitak',
  'Alnilam',
  'Mintaka',
  'Merak',
  'Dubhe',
  'Alioth',
  'Mizar',
  'Alkaid',
  'Alcor',
  'Kochab',
  'Pherkad',
  'Elnath',
  'Menkalinan',
  'Hamal',
  'Sheratan',
  'Markab',
  'Scheat',
  'Enif',
  'Alpheratz',
  'Rasalhague',
  'Rastaban',
  'Altais',
  'Izar',
  'Unukalhai',
  'Sabik',
  'Sadr',
  'Albireo',
  'Tarazed',
] as const;

export const SYSTEM_BOT_ROSTER: readonly Readonly<BotIdentity>[] = Object.freeze(
  SYSTEM_BOT_NICKNAMES.map((name, index) =>
    Object.freeze({
      id: `system-bot:${String(index + 1).padStart(3, '0')}`,
      login: name,
      portrait: (index % 40) + 1,
      seed: ((index + 1) * 2654435761) >>> 0,
      xp: 0,
    }),
  ),
);

type MatchStatus = 'active' | 'ended' | 'abandoned';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validId(value: string): boolean {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('\0')
  );
}

function checkTimestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP)
    throw new Error('E_BOT_ROSTER_INPUT');
}

function allocationInput(
  matchId: string,
  playerIds: readonly string[],
  activeLimit: number,
  now: number,
): {
  seats: string[];
  limit: number;
} {
  if (!validId(matchId) || !Number.isFinite(activeLimit) || playerIds.some((id) => !validId(id)))
    throw new Error('E_BOT_ROSTER_INPUT');
  checkTimestamp(now);
  return {
    seats: [...new Set(playerIds)].slice(0, BOT_ROSTER_SIZE),
    limit: Math.min(BOT_ROSTER_SIZE, Math.max(0, Math.floor(activeLimit))),
  };
}

function checkResults(
  assignments: readonly BotAssignment[],
  results: readonly BotMatchResult[],
  unplayedBotIds: readonly string[],
): void {
  const owners = new Map(assignments.map((a) => [a.botId, a.playerId]));
  const completed = [...results.map((r) => r.botId), ...unplayedBotIds];
  if (
    completed.length !== owners.size ||
    new Set(completed).size !== owners.size ||
    unplayedBotIds.some((id) => !owners.has(id)) ||
    results.some((r) => !owners.has(r.botId) || owners.get(r.botId) !== r.playerId)
  )
    throw new Error('E_BOT_RESULT_MISMATCH');
  for (const result of results) {
    checkTimestamp(result.endedAt);
    if (
      !validId(result.mapId) ||
      !Number.isSafeInteger(result.xp) ||
      result.xp < 0 ||
      !['win', 'draw', 'loss'].includes(result.outcome) ||
      (result.place !== null && (!Number.isSafeInteger(result.place) || result.place < 1))
    )
      throw new Error('E_BOT_ROSTER_INPUT');
  }
}

function historyLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(MAX_HISTORY_LIMIT, Math.max(0, Math.floor(limit))) : 0;
}

/** Development/test adapter. All mutations happen without an await boundary, so a
 *  pair of concurrent calls cannot allocate the same identity in one JS process.
 *  Persistent profiles across process restarts require PostgresBotRosterStore. */
export class MemoryBotRosterStore implements BotRosterStore {
  private readonly identities = new Map<
    string,
    { bot: BotIdentity; lastAssignedAt: number | null }
  >();
  private readonly matches = new Map<string, MatchStatus>();
  private readonly seats = new Map<string, BotAssignment[]>();
  private readonly history = new Map<string, BotMatchHistory[]>();

  async ensureRoster(): Promise<void> {
    for (const bot of SYSTEM_BOT_ROSTER)
      if (!this.identities.has(bot.id))
        this.identities.set(bot.id, { bot: { ...bot }, lastAssignedAt: null });
  }

  async findByLogin(login: string): Promise<BotIdentity | null> {
    for (const { bot } of this.identities.values())
      if (bot.login.toLowerCase() === login.toLowerCase()) return { ...bot };
    return null;
  }

  async assignments(matchId: string): Promise<BotAssignment[]> {
    return this.seatsOf(matchId);
  }

  async assign(
    matchId: string,
    playerIds: readonly string[],
    activeLimit: number,
    now: number,
  ): Promise<BotAssignment[]> {
    const input = allocationInput(matchId, playerIds, activeLimit, now);
    const status = this.matches.get(matchId);
    if (status && status !== 'active') return this.seatsOf(matchId);
    const existing = this.seats.get(matchId) ?? [];
    const occupied = new Set<string>();
    for (const [match, status] of this.matches)
      if (status === 'active')
        for (const seat of this.seats.get(match) ?? []) occupied.add(seat.botId);
    const currentSeats = new Set(existing.map((a) => a.playerId));
    const wanted = input.seats.filter((seat) => !currentSeats.has(seat));
    const free = [...this.identities.values()]
      .filter(({ bot }) => !occupied.has(bot.id))
      .sort(
        (a, b) =>
          (a.lastAssignedAt ?? -1) - (b.lastAssignedAt ?? -1) || compare(a.bot.id, b.bot.id),
      )
      .slice(0, Math.min(wanted.length, Math.max(0, input.limit - occupied.size)));
    for (const [index, record] of free.entries()) {
      existing.push({
        botId: record.bot.id,
        login: record.bot.login,
        playerId: wanted[index]!,
        matchId,
      });
      record.lastAssignedAt = now;
    }
    if (free.length) {
      this.matches.set(matchId, 'active');
      this.seats.set(matchId, existing);
    }
    return this.seatsOf(matchId);
  }

  async cancelUnclaimedAssignment(matchId: string, botId: string): Promise<void> {
    if (this.matches.get(matchId) !== 'active') return;
    const remaining = (this.seats.get(matchId) ?? []).filter((a) => a.botId !== botId);
    if (remaining.length) this.seats.set(matchId, remaining);
    else {
      this.seats.delete(matchId);
      this.matches.delete(matchId);
    }
  }

  async activeMatchIds(): Promise<string[]> {
    return [...this.matches]
      .filter(([, status]) => status === 'active')
      .map(([id]) => id)
      .sort(compare);
  }

  async finishMatch(
    matchId: string,
    results: readonly BotMatchResult[],
    now: number,
    unplayedBotIds: readonly string[] = [],
  ): Promise<void> {
    if (!validId(matchId)) throw new Error('E_BOT_ROSTER_INPUT');
    checkTimestamp(now);
    const status = this.matches.get(matchId);
    if (status && status !== 'active') return;
    checkResults(this.seats.get(matchId) ?? [], results, unplayedBotIds);
    for (const result of results)
      if (!Number.isSafeInteger(this.identities.get(result.botId)!.bot.xp + result.xp))
        throw new Error('E_BOT_XP_OVERFLOW');
    for (const result of results) this.identities.get(result.botId)!.bot.xp += result.xp;
    this.history.set(
      matchId,
      results.map((r) => ({ ...r, matchId })),
    );
    this.matches.set(matchId, 'ended');
  }

  async abandonMatch(matchId: string): Promise<void> {
    if (!validId(matchId)) throw new Error('E_BOT_ROSTER_INPUT');
    if (!this.matches.has(matchId) || this.matches.get(matchId) === 'active')
      this.matches.set(matchId, 'abandoned');
  }

  async recentMatches(
    botId: string,
    limit = BOT_PROFILE_HISTORY_LIMIT,
  ): Promise<BotMatchHistory[]> {
    return [...this.history.values()]
      .flat()
      .filter((r) => r.botId === botId)
      .sort((a, b) => b.endedAt - a.endedAt || compare(b.matchId, a.matchId))
      .slice(0, historyLimit(limit))
      .map((r) => ({ ...r }));
  }

  private seatsOf(matchId: string): BotAssignment[] {
    return (this.seats.get(matchId) ?? [])
      .map((a) => ({ ...a }))
      .sort((a, b) => compare(a.playerId, b.playerId));
  }
}

interface IdentityRow {
  id: string;
  login: string;
  portrait: number;
  seed: string;
  xp: string;
}

interface AssignmentRow {
  bot_id: string;
  login: string;
  player_id: string;
  match_id: string;
}

interface ResultRow {
  bot_id: string;
  player_id: string;
  match_id: string;
  map_id: string;
  ended_at: string;
  outcome: BotMatchResult['outcome'];
  xp: string;
  place: string | null;
}

/** Only one tiny roster lock is needed: the pool has exactly 100 identities. It
 *  protects the GLOBAL active cap, not merely individual rows, across rooms and hosts.
 *  Assignments never expire; a process heartbeat cannot release a live participant. */
export class PostgresBotRosterStore implements BotRosterStore {
  constructor(private readonly pool: Pool) {}

  async ensureRoster(): Promise<void> {
    await this.withLock(async (client) => {
      // Registration and seat claims cannot race the cosmetic rename. Lock before
      // reading identities, and change roster + all exact owned seats atomically.
      await client.query('LOCK TABLE users, seats IN SHARE ROW EXCLUSIVE MODE');
      for (const [index, bot] of SYSTEM_BOT_ROSTER.entries()) {
        const legacy = `~${LEGACY_CALLSIGNS[index]}`;
        const existing = await client.query<{ login: string }>(
          'SELECT login FROM bot_roster_identities WHERE id=$1',
          [bot.id],
        );
        // Respect an already migrated/custom name, including after a restart.
        if (existing.rows[0] && existing.rows[0].login !== legacy) continue;
        const conflict = await client.query(
          `SELECT 1 WHERE
           EXISTS (SELECT 1 FROM users WHERE lower(login)=lower($1)) OR
           EXISTS (SELECT 1 FROM account_deletions
             WHERE login_hash=encode(sha256(convert_to(lower($1::text),'UTF8')),'hex')) OR
           EXISTS (SELECT 1 FROM bot_roster_identities WHERE lower(login)=lower($1) AND id<>$2) OR
           EXISTS (SELECT 1 FROM seats s WHERE lower(s.nick)=lower($1)
             AND NOT EXISTS (SELECT 1 FROM bot_roster_assignments a
               WHERE a.bot_id=$2 AND a.match_id=s.room AND a.player_id=s.player_id))`,
          [bot.login, bot.id],
        );
        // A pre-existing human/tombstone wins. Keep that bot's old reserved login
        // instead of blocking startup or taking another person's identity.
        const login = conflict.rowCount ? legacy : bot.login;
        if (existing.rows[0]) {
          if (login === legacy) continue;
          await client.query(
            `UPDATE seats s SET nick=$1 FROM bot_roster_assignments a
             WHERE a.bot_id=$2 AND a.match_id=s.room AND a.player_id=s.player_id AND s.nick=$3`,
            [login, bot.id, legacy],
          );
          await client.query('UPDATE bot_roster_identities SET login=$1 WHERE id=$2 AND login=$3', [
            login,
            bot.id,
            legacy,
          ]);
        } else {
          await client.query(
            'INSERT INTO bot_roster_identities (id,login,portrait,seed) VALUES($1,$2,$3,$4)',
            [bot.id, login, bot.portrait, bot.seed],
          );
        }
      }
    });
  }

  async findByLogin(login: string): Promise<BotIdentity | null> {
    const result = await this.pool.query<IdentityRow>(
      'SELECT id, login, portrait, seed, xp FROM bot_roster_identities WHERE lower(login) = lower($1)',
      [login],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          login: row.login,
          portrait: row.portrait,
          seed: Number(row.seed),
          xp: Number(row.xp),
        }
      : null;
  }

  async assignments(matchId: string): Promise<BotAssignment[]> {
    return this.readAssignments(this.pool, matchId);
  }

  async assign(
    matchId: string,
    playerIds: readonly string[],
    activeLimit: number,
    now: number,
  ): Promise<BotAssignment[]> {
    const input = allocationInput(matchId, playerIds, activeLimit, now);
    return this.withLock(async (client) => {
      const status = await this.matchStatus(client, matchId);
      const existing = await this.readAssignments(client, matchId);
      if (status && status !== 'active') return existing;
      const currentSeats = new Set(existing.map((a) => a.playerId));
      const wanted = input.seats.filter((seat) => !currentSeats.has(seat));
      const active = await client.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM bot_roster_assignments WHERE active',
      );
      const count = Math.min(wanted.length, Math.max(0, input.limit - active.rows[0]!.count));
      if (count === 0) return existing;
      const free = await client.query<{ id: string }>(
        `SELECT b.id FROM bot_roster_identities b
         WHERE NOT EXISTS (SELECT 1 FROM bot_roster_assignments a WHERE a.bot_id = b.id AND a.active)
         ORDER BY b.last_assigned_at ASC NULLS FIRST, b.id ASC LIMIT $1`,
        [count],
      );
      if (free.rows.length === 0) return existing;
      const ids = free.rows.map((r) => r.id);
      await client.query(
        "INSERT INTO bot_roster_matches (match_id, status) VALUES ($1, 'active') ON CONFLICT (match_id) DO NOTHING",
        [matchId],
      );
      await client.query(
        `INSERT INTO bot_roster_assignments (match_id, player_id, bot_id, assigned_at)
         SELECT $1, slots.player_id, slots.bot_id, $4
         FROM unnest($2::text[], $3::text[]) AS slots(player_id, bot_id)`,
        [matchId, wanted.slice(0, ids.length), ids, now],
      );
      await client.query(
        'UPDATE bot_roster_identities SET last_assigned_at = $2 WHERE id = ANY($1::text[])',
        [ids, now],
      );
      return this.readAssignments(client, matchId);
    });
  }

  async cancelUnclaimedAssignment(matchId: string, botId: string): Promise<void> {
    await this.withLock(async (client) => {
      if ((await this.matchStatus(client, matchId)) !== 'active') return;
      await client.query(
        'DELETE FROM bot_roster_assignments WHERE match_id = $1 AND bot_id = $2 AND active',
        [matchId, botId],
      );
      await client.query(
        `DELETE FROM bot_roster_matches WHERE match_id = $1 AND status = 'active'
         AND NOT EXISTS (SELECT 1 FROM bot_roster_assignments WHERE match_id = $1)`,
        [matchId],
      );
    });
  }

  async activeMatchIds(): Promise<string[]> {
    const result = await this.pool.query<{ match_id: string }>(
      "SELECT match_id FROM bot_roster_matches WHERE status = 'active' ORDER BY match_id ASC",
    );
    return result.rows.map((r) => r.match_id);
  }

  async finishMatch(
    matchId: string,
    results: readonly BotMatchResult[],
    now: number,
    unplayedBotIds: readonly string[] = [],
  ): Promise<void> {
    if (!validId(matchId)) throw new Error('E_BOT_ROSTER_INPUT');
    checkTimestamp(now);
    await this.withLock(async (client) => {
      const status = await this.matchStatus(client, matchId);
      if (status && status !== 'active') return;
      checkResults(await this.readAssignments(client, matchId), results, unplayedBotIds);
      if (results.length) {
        const identities = await client.query<{ id: string; xp: string }>(
          'SELECT id, xp FROM bot_roster_identities WHERE id = ANY($1::text[])',
          [results.map((r) => r.botId)],
        );
        const xpById = new Map(identities.rows.map((r) => [r.id, Number(r.xp)]));
        for (const result of results)
          if (!Number.isSafeInteger(xpById.get(result.botId)! + result.xp))
            throw new Error('E_BOT_XP_OVERFLOW');
        await client.query(
          `WITH recorded AS (
             INSERT INTO bot_roster_results (match_id, bot_id, player_id, map_id, ended_at, outcome, xp, place)
             SELECT $1, rows.bot_id, rows.player_id, rows.map_id, rows.ended_at, rows.outcome, rows.xp, rows.place
             FROM unnest($2::text[], $3::text[], $4::text[], $5::bigint[], $6::text[], $7::bigint[], $8::bigint[])
               AS rows(bot_id, player_id, map_id, ended_at, outcome, xp, place)
             ON CONFLICT (match_id, bot_id) DO NOTHING RETURNING bot_id, xp
           ) UPDATE bot_roster_identities b SET xp = b.xp + recorded.xp FROM recorded WHERE b.id = recorded.bot_id`,
          [
            matchId,
            results.map((r) => r.botId),
            results.map((r) => r.playerId),
            results.map((r) => r.mapId),
            results.map((r) => r.endedAt),
            results.map((r) => r.outcome),
            results.map((r) => r.xp),
            results.map((r) => r.place),
          ],
        );
      }
      await client.query(
        'UPDATE bot_roster_assignments SET active = false WHERE match_id = $1 AND active',
        [matchId],
      );
      await client.query(
        `INSERT INTO bot_roster_matches (match_id, status, finished_at) VALUES ($1, 'ended', $2)
         ON CONFLICT (match_id) DO UPDATE SET status = 'ended', finished_at = EXCLUDED.finished_at`,
        [matchId, now],
      );
    });
  }

  async abandonMatch(matchId: string): Promise<void> {
    if (!validId(matchId)) throw new Error('E_BOT_ROSTER_INPUT');
    await this.withLock(async (client) => {
      const status = await this.matchStatus(client, matchId);
      if (status && status !== 'active') return;
      await client.query(
        'UPDATE bot_roster_assignments SET active = false WHERE match_id = $1 AND active',
        [matchId],
      );
      await client.query(
        `INSERT INTO bot_roster_matches (match_id, status) VALUES ($1, 'abandoned')
         ON CONFLICT (match_id) DO UPDATE SET status = 'abandoned'`,
        [matchId],
      );
    });
  }

  async recentMatches(
    botId: string,
    limit = BOT_PROFILE_HISTORY_LIMIT,
  ): Promise<BotMatchHistory[]> {
    const count = historyLimit(limit);
    if (count === 0) return [];
    const result = await this.pool.query<ResultRow>(
      `SELECT match_id, bot_id, player_id, map_id, ended_at, outcome, xp, place
       FROM bot_roster_results WHERE bot_id = $1 ORDER BY ended_at DESC, match_id DESC LIMIT $2`,
      [botId, count],
    );
    return result.rows.map((r) => ({
      matchId: r.match_id,
      botId: r.bot_id,
      playerId: r.player_id,
      mapId: r.map_id,
      endedAt: Number(r.ended_at),
      outcome: r.outcome,
      xp: Number(r.xp),
      place: r.place === null ? null : Number(r.place),
    }));
  }

  private async readAssignments(
    client: Pool | PoolClient,
    matchId: string,
  ): Promise<BotAssignment[]> {
    const result = await client.query<AssignmentRow>(
      `SELECT a.match_id, a.player_id, a.bot_id, b.login FROM bot_roster_assignments a
       JOIN bot_roster_identities b ON b.id = a.bot_id WHERE a.match_id = $1 ORDER BY a.player_id ASC`,
      [matchId],
    );
    return result.rows.map((r) => ({
      matchId: r.match_id,
      playerId: r.player_id,
      botId: r.bot_id,
      login: r.login,
    }));
  }

  private async matchStatus(client: PoolClient, matchId: string): Promise<MatchStatus | null> {
    const result = await client.query<{ status: MatchStatus }>(
      'SELECT status FROM bot_roster_matches WHERE match_id = $1',
      [matchId],
    );
    return result.rows[0]?.status ?? null;
  }

  private async withLock<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(144731, 100)');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
