/** Postgres: аккаунты, командиры и учётки игроков (SLIM-5). */
import { createIdentity } from '../loginIdentity';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PlayerId } from '@void/shared-core';
import type { AccountStore, CommanderStore, SeatAssignment, UserRecord, UserStore } from '../types';

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async archivedMatches(nick: string, rooms: readonly string[]): Promise<string[]> {
    const result = await this.pool.query<{ room: string }>(
      'SELECT room FROM seats WHERE nick = $1 AND archived AND room = ANY($2::text[])', [nick, rooms],
    );
    return result.rows.map(row => row.room);
  }

  async setMatchArchived(room: string, nick: string, archived: boolean): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE seats SET archived = $3 WHERE room = $1 AND nick = $2 RETURNING room',
      [room, nick, archived],
    );
    return result.rows.length > 0;
  }

  async resolveSeat(
    room: string,
    nick: string,
    seats: readonly PlayerId[],
    preferred?: PlayerId,
  ): Promise<SeatAssignment | null> {
    const existing = await this.pool.query<{ player_id: string }>(
      `SELECT player_id FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    const seat = existing.rows[0];
    if (seat) return { playerId: seat.player_id, isNew: false };

    // Assign a free seat. The unique (room, player_id) index makes the INSERT the
    // atomic claim — a concurrent claim of the same seat raises a unique violation,
    // and we fall through to the next free seat.
    const takenR = await this.pool.query<{ player_id: string }>(
      `SELECT player_id FROM seats WHERE room = $1`,
      [room],
    );
    const taken = new Set(takenR.rows.map((r) => r.player_id));
    // Preferred slot first (REL-7 seat selection): try it before the default order.
    const order =
      preferred && seats.includes(preferred) && !taken.has(preferred)
        ? [preferred, ...seats.filter((s) => s !== preferred)]
        : seats;
    for (const candidate of order) {
      if (taken.has(candidate)) continue;
      try {
        await this.pool.query(`INSERT INTO seats (room, nick, player_id) VALUES ($1, $2, $3)`, [
          room,
          nick,
          candidate,
        ]);
        return { playerId: candidate, isNew: true };
      } catch {
        // (room, nick) or (room, player_id) was claimed concurrently — try the next.
        const reread = await this.pool.query<{ player_id: string }>(
          `SELECT player_id FROM seats WHERE room = $1 AND nick = $2`,
          [room, nick],
        );
        const now = reread.rows[0];
        if (now) return { playerId: now.player_id, isNew: false };
        taken.add(candidate);
      }
    }
    return null; // every seat taken
  }

  async seatOf(room: string, nick: string): Promise<PlayerId | null> {
    const r = await this.pool.query<{ player_id: string }>(
      `SELECT player_id FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    return r.rows[0]?.player_id ?? null;
  }

  async bindSeatTicket(room: string, nick: string, ticketHash: string): Promise<string | null> {
    // First bind wins atomically: the UPDATE only lands on a NULL hash, then the
    // SELECT reads back whichever hash is durably bound (ours, or a concurrent
    // winner's). No row (nick holds no seat) → null → the caller refuses.
    await this.pool.query(
      `UPDATE seats SET ticket_hash = $3
       WHERE room = $1 AND nick = $2 AND ticket_hash IS NULL`,
      [room, nick, ticketHash],
    );
    const r = await this.pool.query<{ ticket_hash: string | null }>(
      `SELECT ticket_hash FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    return r.rows[0]?.ticket_hash ?? null;
  }

  async seatTicket(room: string, nick: string): Promise<string | null> {
    const r = await this.pool.query<{ ticket_hash: string | null }>(
      `SELECT ticket_hash FROM seats WHERE room = $1 AND nick = $2`,
      [room, nick],
    );
    return r.rows[0]?.ticket_hash ?? null;
  }

  async resetSeatTicket(room: string, nick: string): Promise<void> {
    await this.pool.query(`UPDATE seats SET ticket_hash = NULL WHERE room = $1 AND nick = $2`, [
      room,
      nick,
    ]);
  }

  async releaseSeat(room: string, nick: string): Promise<PlayerId | null> {
    // Одним запросом: DELETE ... RETURNING — читать место отдельным SELECT значило бы
    // окно, в котором соседний вход успел бы занять его между чтением и удалением, и
    // администратор увидел бы «снят» про уже другого человека. Билет лежит в той же
    // строке, поэтому уходит вместе с ней.
    const r = await this.pool.query<{ player_id: string }>(
      `DELETE FROM seats WHERE room = $1 AND nick = $2 RETURNING player_id`,
      [room, nick],
    );
    return (r.rows[0]?.player_id as PlayerId | undefined) ?? null;
  }

  async occupiedSeats(room: string): Promise<number> {
    const r = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM seats WHERE room = $1`,
      [room],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async seatedNicks(room: string): Promise<Array<{ playerId: PlayerId; nick: string }>> {
    const r = await this.pool.query<{ player_id: string; nick: string }>(
      `SELECT player_id, nick FROM seats WHERE room = $1`,
      [room],
    );
    return r.rows.map((row) => ({ playerId: row.player_id as PlayerId, nick: row.nick }));
  }
}

/** Durable commander XP (EC-*). `creditMatch` runs mark-then-increment in one
 *  transaction; the `commander_credits` PK makes the mark the atomic idempotency
 *  gate — a re-observed match end credits nothing a second time. */
export class PostgresCommanderStore implements CommanderStore {
  constructor(private readonly pool: Pool) {}

  async creditMatch(
    matchId: string,
    rows: ReadonlyArray<{ accountId: string; xp: number }>,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claim = await client.query(
        `INSERT INTO commander_credits (match_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [matchId],
      );
      if (claim.rowCount === 0) {
        await client.query('ROLLBACK'); // already credited — a restart re-observed the end
        return false;
      }
      for (const { accountId, xp } of rows) {
        if (xp > 0)
          await client.query(
            `INSERT INTO commander_xp (account_id, xp) VALUES ($1, $2)
             ON CONFLICT (account_id) DO UPDATE SET xp = commander_xp.xp + $2`,
            [accountId, xp],
          );
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async xpOf(accountId: string): Promise<number> {
    const r = await this.pool.query<{ xp: string }>(
      `SELECT xp FROM commander_xp WHERE account_id = $1`,
      [accountId],
    );
    return Number(r.rows[0]?.xp ?? 0);
  }

  async topXp(limit: number): Promise<Array<{ accountId: string; xp: number }>> {
    // account_id is the second ORDER BY key so equal XP keeps one stable order —
    // rows that shuffle between refreshes read as a broken board.
    const r = await this.pool.query<{ account_id: string; xp: string }>(
      `SELECT account_id, xp FROM commander_xp ORDER BY xp DESC, account_id ASC LIMIT $1`,
      [Math.max(0, limit)],
    );
    return r.rows.map((row) => ({ accountId: row.account_id, xp: Number(row.xp) }));
  }

  async standingOf(accountId: string): Promise<{ rank: number | null; xp: number; total: number }> {
    // Ties SHARE a rank: «сколько аккаунтов строго выше меня» + 1. Counting rows
    // before mine instead would make the number depend on the tiebreaker.
    const r = await this.pool.query<{ xp: string | null; above: string; total: string }>(
      `SELECT (SELECT xp FROM commander_xp WHERE account_id = $1)              AS xp,
              (SELECT count(*) FROM commander_xp
                WHERE xp > (SELECT xp FROM commander_xp WHERE account_id = $1)) AS above,
              (SELECT count(*) FROM commander_xp)                              AS total`,
      [accountId],
    );
    const row = r.rows[0];
    const xp = row?.xp === null || row?.xp === undefined ? null : Number(row.xp);
    return {
      rank: xp === null ? null : Number(row?.above ?? 0) + 1,
      xp: xp ?? 0,
      total: Number(row?.total ?? 0),
    };
  }
}

export class PostgresUserStore implements UserStore {
  constructor(private readonly pool: Pool) {}

  async deletionStatus(accountId: string, requestId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM account_deletions WHERE account_id=$1 AND request_id=$2',
      [accountId, requestId],
    );
    return Boolean(result.rowCount);
  }
  async requestDeletion(
    user: UserRecord,
    requestId: string = randomUUID(),
  ): Promise<string | null> {
    const result = await this.pool.query<{ request_id: string }>(
      `
      WITH disabled AS (
        UPDATE users SET deletion_requested_at = now(), session_nonce = $4
        WHERE id = $1 AND pass_hash = $2 AND session_nonce = $3
          AND deletion_requested_at IS NULL RETURNING id,login
      ) INSERT INTO account_deletions(account_id, request_id, login_hash)
        SELECT id, $4, encode(sha256(convert_to(lower(login),'UTF8')),'hex') FROM disabled RETURNING request_id
    `,
      [user.userId, user.passHash, user.sessionNonce ?? '', requestId],
    );
    return result.rows[0]?.request_id ?? null;
  }

  async createUser(
    login: string,
    passHash: string,
    email?: string,
  ): Promise<
    { ok: true; userId: string } | { ok: false; code: 'E_LOGIN_TAKEN' | 'E_EMAIL_TAKEN' }
  > {
    return createIdentity(this.pool, login, passHash, email);
  }

  // Each lookup is a FULLY-LITERAL query (no string interpolation into SQL — the WHERE
  // clauses differ only by column, and are hardcoded here rather than passed in, so the
  // `no-sql-string-interpolation` guard stays satisfied). All three share `rowToUser`.
  async findUser(login: string): Promise<UserRecord | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT id, login, pass_hash, email, session_nonce, registration_reward FROM users WHERE lower(login) = lower($1) AND deletion_requested_at IS NULL`,
      [login],
    );
    return rowToUser(r.rows[0]);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT id, login, pass_hash, email, session_nonce, registration_reward FROM users WHERE email IS NOT NULL AND lower(email) = lower($1) AND deletion_requested_at IS NULL`,
      [email],
    );
    return rowToUser(r.rows[0]);
  }

  async findById(userId: string): Promise<UserRecord | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT id, login, pass_hash, email, session_nonce, registration_reward FROM users WHERE id = $1 AND deletion_requested_at IS NULL`,
      [userId],
    );
    return rowToUser(r.rows[0]);
  }

  async loginsOf(userIds: readonly string[]): Promise<Record<string, string>> {
    if (userIds.length === 0) return {};
    const r = await this.pool.query<{ id: string; login: string }>(
      `SELECT id, login FROM users WHERE id = ANY($1::text[]) AND deletion_requested_at IS NULL`,
      [[...userIds]],
    );
    const out: Record<string, string> = {};
    for (const row of r.rows) out[row.id] = row.login;
    return out;
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.pool.query('UPDATE users SET session_nonce = $2 WHERE id = $1', [
      userId,
      randomUUID(),
    ]);
  }

  async setPassword(userId: string, passHash: string): Promise<void> {
    await this.pool.query(`UPDATE users SET pass_hash = $2 WHERE id = $1`, [userId, passHash]);
  }
  async setPasswordIfCurrent(
    userId: string,
    expectedHash: string,
    passHash: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE users SET pass_hash = $3 WHERE id = $1 AND pass_hash = $2 AND deletion_requested_at IS NULL`,
      [userId, expectedHash, passHash],
    );
    return result.rowCount === 1;
  }
}

interface UserRow {
  id: string;
  login: string;
  pass_hash: string;
  session_nonce: string;
  email: string | null;
  registration_reward: boolean;
}

function rowToUser(row: UserRow | undefined): UserRecord | null {
  if (!row) return null;
  return {
    userId: row.id,
    login: row.login,
    passHash: row.pass_hash,
    ...(row.session_nonce ? { sessionNonce: row.session_nonce } : {}),
    registrationReward: row.registration_reward,
    ...(row.email ? { email: row.email } : {}),
  };
}
