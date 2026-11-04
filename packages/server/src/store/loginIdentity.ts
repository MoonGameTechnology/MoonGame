import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { loginSkeletons } from '@void/protocol';
import { reservedBotLogin } from '../botNicknames';

/** Backfill without renaming or rejecting pre-existing colliding identities. The
 * migration lock/transaction is owned by migrate(). The nullable-key index bounds
 * subsequent boots to newly imported legacy rows. Deploy all account writers
 * together; an old binary does not enforce the new registration policy. */
export async function backfillLoginSkeletons(db: PoolClient): Promise<void> {
  for (;;) {
    const batch = await db.query<{ id: string; login: string }>(
      'SELECT id,login FROM users WHERE login_skeletons IS NULL ORDER BY id LIMIT 500',
    );
    if (!batch.rows.length) return;
    await db.query(
      `UPDATE users SET login_skeletons=ARRAY(SELECT jsonb_array_elements_text(keys.skeletons))
       FROM jsonb_to_recordset($1::jsonb) AS keys(id text,skeletons jsonb)
       WHERE users.id=keys.id AND users.login_skeletons IS NULL`,
      [JSON.stringify(batch.rows.map((r) => ({ id: r.id, skeletons: loginSkeletons(r.login) })))],
    );
  }
}

/** The same skeleton's check+claim is serialized across server processes. The
 * index is deliberately non-unique: legacy collisions must retain their logins. */
export async function createIdentity(
  pool: Pool,
  login: string,
  passHash: string,
  email?: string,
): Promise<{ ok: true; userId: string } | { ok: false; code: 'E_LOGIN_TAKEN' | 'E_EMAIL_TAKEN' }> {
  if (reservedBotLogin(login)) return { ok: false, code: 'E_LOGIN_TAKEN' };
  const skeletons = loginSkeletons(login);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const key of skeletons) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('user_login_skeleton'),hashtext($1))", [
        key,
      ]);
    }
    const collision = await db.query(
      'SELECT 1 FROM users WHERE login_skeletons && $1::text[] LIMIT 1',
      [skeletons],
    );
    const reserved = await db.query(
      "SELECT 1 FROM account_deletions WHERE login_hash=encode(sha256(convert_to(lower($1::text),'UTF8')),'hex') LIMIT 1",
      [login],
    );
    if (collision.rowCount || reserved.rowCount) {
      await db.query('ROLLBACK');
      return { ok: false, code: 'E_LOGIN_TAKEN' };
    }
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id,login,pass_hash,email,registration_reward,login_skeletons)
       VALUES ($1,$2,$3,$4,true,$5)`,
      [userId, login, passHash, email?.toLowerCase() ?? null, skeletons],
    );
    await db.query('COMMIT');
    return { ok: true, userId };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code !== '23505') throw error;
    return {
      ok: false,
      code:
        (error as { constraint?: string }).constraint === 'users_email_idx'
          ? 'E_EMAIL_TAKEN'
          : 'E_LOGIN_TAKEN',
    };
  } finally {
    db.release();
  }
}
