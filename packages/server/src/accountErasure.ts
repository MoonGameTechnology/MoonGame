import type { Pool, PoolClient } from 'pg';

/** Maintenance-only: both game and corporation processes must be stopped. The
 * caller persists this subject in the protected restore ledger BEFORE mutation. */
export interface ErasureSubject {
  accountId: string;
  login: string;
  email?: string;
  replacement: string;
}

const DISPLAY_FIELDS = new Set([
  'name',
  'login',
  'nick',
  'seller_login',
  'actor',
  'target',
  'detail',
  'text',
]);
export function scrubPersonalJson(
  value: unknown,
  subject: ErasureSubject,
  field = '',
  depth = 0,
): unknown {
  if (depth > 128) throw Error('E_ERASURE_DEPTH');
  if (typeof value === 'string') {
    let result = value.split(subject.accountId).join(subject.replacement);
    if (subject.email)
      result = result.replace(
        new RegExp(subject.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        '[deleted]',
      );
    // Never replace arbitrary enum/resource strings matching a short callsign.
    if (DISPLAY_FIELDS.has(field) && result.toLowerCase() === subject.login.toLowerCase())
      return '[deleted]';
    return result;
  }
  if (Array.isArray(value))
    return value.map((v) => scrubPersonalJson(v, subject, field, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key.split(subject.accountId).join(subject.replacement),
        scrubPersonalJson(v, subject, key, depth + 1),
      ]),
    );
  return value;
}

// Every statement is a fixed literal; account data is exclusively bound parameters.
const PERSONAL_ROWS = [
  'DELETE FROM player_activity_channels WHERE account_id=$1',
  'DELETE FROM player_activity_days WHERE account_id=$1',
  'DELETE FROM friend_edges WHERE lo_id=$1 OR hi_id=$1',
  'DELETE FROM friend_privacy WHERE account_id=$1',
  'DELETE FROM push_subscriptions WHERE account_id=$1',
  'DELETE FROM player_profiles WHERE account_id=$1',
  'DELETE FROM profile_progress WHERE account_id=$1',
  'DELETE FROM profile_career WHERE account_id=$1',
  'DELETE FROM profile_career_credits WHERE account_id=$1',
  'DELETE FROM profile_credits WHERE account_id=$1',
  'DELETE FROM registration_rewards WHERE account_id=$1',
  'DELETE FROM commander_xp WHERE account_id=$1',
  'DELETE FROM medals WHERE account_id=$1',
  'UPDATE player_medal_news SET account_id=NULL,login=NULL WHERE account_id=$1',
  'DELETE FROM player_ready WHERE account_id=$1',
  'DELETE FROM ava_roster WHERE account_id=$1',
  'DELETE FROM corp_arsenal_rent WHERE account_id=$1',
  'DELETE FROM meta_market_listings WHERE seller_id=$1',
  'DELETE FROM meta_material_listings WHERE seller_id=$1',
  'DELETE FROM arsenal WHERE account_id=$1',
  'DELETE FROM meta_wallets WHERE account_id=$1',
  'DELETE FROM meta_market_ledger WHERE account_id=$1',
  'DELETE FROM meta_economy_accounts WHERE account_id=$1',
  'DELETE FROM meta_market_receipts WHERE account_id=$1',
  'DELETE FROM meta_economy_receipts WHERE account_ids=ARRAY[$1]::text[]',
  'UPDATE meta_economy_receipts SET account_ids=array_remove(account_ids,$1) WHERE $1=ANY(account_ids)',
  'DELETE FROM drop_claims WHERE account_id=$1',
  'DELETE FROM drop_meta WHERE account_id=$1',
] as const;

// Traverse bounded batches, including JSON owned by counterparties. Keep world
// ids, balances, sequence numbers and third-party receipts intact.
const JSON_RECORDS = [
  [
    "SELECT id AS key, jsonb_build_object('state',state,'clock',clock,'economy_observations',economy_observations,'economy_activity',economy_activity,'career',career) AS value FROM matches WHERE id>$1 ORDER BY id LIMIT 100",
    "UPDATE matches SET state=$2::jsonb->'state',clock=NULLIF($2::jsonb->'clock','null'::jsonb),economy_observations=NULLIF($2::jsonb->'economy_observations','null'::jsonb),economy_activity=NULLIF($2::jsonb->'economy_activity','null'::jsonb),career=NULLIF($2::jsonb->'career','null'::jsonb) WHERE id=$1",
  ],
  [
    'SELECT id AS key,infrastructure AS value FROM corps WHERE id>$1 ORDER BY id LIMIT 100',
    'UPDATE corps SET infrastructure=$2::jsonb WHERE id=$1',
  ],
  [
    'SELECT match_id AS key,seats AS value FROM ava_sessions WHERE match_id>$1 ORDER BY match_id LIMIT 100',
    'UPDATE ava_sessions SET seats=$2::jsonb WHERE match_id=$1',
  ],
  [
    'SELECT matchup_id AS key,report AS value FROM ava_results WHERE matchup_id>$1 AND report IS NOT NULL ORDER BY matchup_id LIMIT 100',
    'UPDATE ava_results SET report=$2::jsonb WHERE matchup_id=$1',
  ],
  [
    'SELECT event_id AS key,entry AS value FROM corp_return_audit WHERE event_id>$1 ORDER BY event_id LIMIT 100',
    'UPDATE corp_return_audit SET entry=$2::jsonb WHERE event_id=$1',
  ],
  [
    'SELECT account_id AS key,state AS value FROM meta_economy_accounts WHERE account_id>$1 ORDER BY account_id LIMIT 100',
    'UPDATE meta_economy_accounts SET state=$2::jsonb WHERE account_id=$1',
  ],
  [
    'SELECT receipt_key AS key,response AS value FROM meta_economy_receipts WHERE receipt_key>$1 ORDER BY receipt_key LIMIT 100',
    'UPDATE meta_economy_receipts SET response=$2::jsonb WHERE receipt_key=$1',
  ],
  [
    'SELECT id AS key,reserved AS value FROM meta_material_listings WHERE id>$1 ORDER BY id LIMIT 100',
    'UPDATE meta_material_listings SET reserved=$2::jsonb WHERE id=$1',
  ],
] as const;

/** Refuse live clients, including idle pools. This is a guard in addition to the
 * host's deployment lock and stopped services, not a distributed maintenance lock. */
export async function requireOfflineDatabase(db: PoolClient): Promise<void> {
  const result = await db.query<{ n: string }>(`SELECT count(*) AS n FROM pg_stat_activity
    WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()`);
  if (result.rows[0]?.n !== '0') throw Error('E_ERASURE_DATABASE_ONLINE');
}

export async function eraseAccountDatabase(pool: Pool, subject: ErasureSubject): Promise<void> {
  if (
    !/^[0-9a-f-]{36}$/i.test(subject.accountId) ||
    !/^deleted:[0-9a-f-]{36}$/i.test(subject.replacement) ||
    !subject.login
  )
    throw Error('E_ERASURE_SUBJECT');
  const db = await pool.connect();
  try {
    await requireOfflineDatabase(db);
    const legacy = await db.query(
      'SELECT 1 FROM meta_economy_receipts WHERE account_ids IS NULL LIMIT 1',
    );
    if (legacy.rowCount) throw Error('E_ERASURE_LEGACY_RECEIPTS');
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='120s'");
    await db.query('SELECT pg_advisory_xact_lock(144731, 32)');
    // Preserve others' corporation membership. A departing head passes leadership
    // to the earliest accepted member, never to an unaccepted recruit.
    await db.query(
      `UPDATE corp_members SET role='head' WHERE account_id=(
      SELECT candidate.account_id FROM corp_members candidate JOIN corp_members departing
      ON candidate.corp_id=departing.corp_id WHERE departing.account_id=$1 AND departing.role='head'
      AND candidate.account_id<>$1 AND candidate.role<>'recruit'
      ORDER BY candidate.joined_at,candidate.account_id LIMIT 1)`,
      [subject.accountId],
    );
    // When no accepted members remain, disband the empty corporation. Historical
    // AvA results retain its opaque id, as with the ordinary disband operation.
    await db.query(
      `DELETE FROM corp_ready WHERE corp_id IN (SELECT corp_id FROM corp_members WHERE account_id=$1)
      AND NOT EXISTS(SELECT 1 FROM corp_members m WHERE m.corp_id=corp_ready.corp_id AND m.account_id<>$1 AND m.role<>'recruit')`,
      [subject.accountId],
    );
    await db.query(
      `DELETE FROM corps WHERE id IN (SELECT corp_id FROM corp_members WHERE account_id=$1)
      AND NOT EXISTS(SELECT 1 FROM corp_members m WHERE m.corp_id=corps.id AND m.account_id<>$1 AND m.role<>'recruit')`,
      [subject.accountId],
    );
    await db.query(
      'DELETE FROM corp_members WHERE account_id=$1 OR NOT EXISTS(SELECT 1 FROM corps WHERE corps.id=corp_members.corp_id)',
      [subject.accountId],
    );
    for (const sql of PERSONAL_ROWS) await db.query(sql, [subject.accountId]);
    // Hold the retired seat with an unregistrable identity: a new account cannot
    // inherit its empire by reusing the erased callsign. No ticket remains valid.
    await db.query(
      'UPDATE seats SET nick=$3,ticket_hash=NULL WHERE nick=$1 OR lower(nick)=lower($2)',
      [subject.accountId, subject.login, subject.replacement],
    );
    await db.query(
      `UPDATE corp_audit SET actor=CASE WHEN actor=$1 OR lower(actor)=lower($2) THEN $3 ELSE actor END,
      target=CASE WHEN target=$1 OR lower(target)=lower($2) THEN $3 ELSE target END, detail=NULL
      WHERE actor=$1 OR target=$1 OR lower(actor)=lower($2) OR lower(target)=lower($2)
        OR position($1 in coalesce(detail,''))>0`,
      [subject.accountId, subject.login, subject.replacement],
    );
    for (const [read, update] of JSON_RECORDS) {
      let after = '';
      for (;;) {
        const rows = await db.query<{ key: string; value: unknown }>(read, [after]);
        if (!rows.rows.length) break;
        for (const row of rows.rows) {
          const clean = scrubPersonalJson(row.value, subject);
          if (JSON.stringify(clean) !== JSON.stringify(row.value))
            await db.query(update, [row.key, JSON.stringify(clean)]);
          after = row.key;
        }
      }
    }
    // Compound PK: process other players' trade receipts separately.
    let afterAccount = '',
      afterTrade = '';
    for (;;) {
      const receipts = await db.query<{ account_id: string; trade_id: string; result: unknown }>(
        'SELECT account_id,trade_id,result FROM meta_market_receipts WHERE position($1 in result::text)>0 AND (account_id,trade_id)>($2,$3) ORDER BY account_id,trade_id LIMIT 100',
        [subject.accountId, afterAccount, afterTrade],
      );
      if (!receipts.rows.length) break;
      for (const row of receipts.rows) {
        await db.query(
          'UPDATE meta_market_receipts SET result=$3::jsonb WHERE account_id=$1 AND trade_id=$2',
          [row.account_id, row.trade_id, JSON.stringify(scrubPersonalJson(row.result, subject))],
        );
        afterAccount = row.account_id;
        afterTrade = row.trade_id;
      }
    }
    await db.query('DELETE FROM users WHERE id=$1', [subject.accountId]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}
