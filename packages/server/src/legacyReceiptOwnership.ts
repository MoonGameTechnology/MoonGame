import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { metaEconomyFingerprint, metaSettlementReceiptKey, type MatchRewardFacts } from './metaEconomy';
import { requireOfflineDatabase } from './accountErasure';

type Json = Record<string, unknown>;
export interface LegacyReceiptRow {
  receipt_key: string;
  fingerprint: string;
  response: unknown;
  account_ids: string[] | null;
}
const object = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const rawHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(): never { throw Error('E_ERASURE_LEGACY_RECEIPTS'); }

/** Recover only server-generated single-account receipts whose ORIGINAL key and
 * payload digest can both be reproduced. Never infer ownership from a name,
 * response substring or time proximity; unsupported/ambiguous rows fail closed.
 * No response, fingerprint, key, balance or reward is changed. */
export function legacyReceiptOwnership(rows: LegacyReceiptRow[], accountIds: string[]): Map<string, string> {
  if (rows.length > 10000 || accountIds.length > 100000) fail();
  const accounts = new Set(accountIds);
  const proved = new Map<string, string>();
  const facts: MatchRewardFacts[] = [];
  for (const row of rows) {
    if (!row.receipt_key.startsWith('reward-facts:')) continue;
    const source = object(row.response), metrics = object(source?.seasonFacts);
    if (!source || !metrics || typeof source.accountId !== 'string' || !accounts.has(source.accountId) ||
        typeof source.matchId !== 'string' || !['stage', 'final'].includes(String(source.kind)) ||
        source.participation !== true || !Number.isSafeInteger(source.occurredAt) ||
        ['recon', 'logistics', 'defense', 'objectives'].some(key => !Number.isSafeInteger(metrics[key]) || Number(metrics[key]) < 0)) continue;
    if (source.kind === 'stage' ? !Number.isSafeInteger(source.stage) || Number(source.stage) < 1 :
      !Number.isSafeInteger(source.place) || Number(source.place) < 1) continue;
    // Delivery uses JSON.stringify in this exact insertion order, not canonical
    // JSON. JSONB has reordered the stored object; rebuild the original envelope.
    const restored = {
      matchId: source.matchId, accountId: source.accountId, kind: source.kind,
      ...(source.kind === 'stage' ? { stage: source.stage } : { place: source.place }),
      participation: true,
      seasonFacts: { recon: metrics.recon, logistics: metrics.logistics, defense: metrics.defense, objectives: metrics.objectives },
      occurredAt: source.occurredAt,
    };
    const key = `reward-facts:${JSON.stringify([source.matchId, source.accountId])}:${source.kind === 'stage' ? `stage:${source.stage}` : 'final'}`;
    if (key !== row.receipt_key || rawHash(restored) !== row.fingerprint ||
        metaEconomyFingerprint(restored) !== metaEconomyFingerprint(source)) continue;
    proved.set(key, source.accountId);
    facts.push(restored as MatchRewardFacts);
  }
  const dayCache = new Map<string, number | undefined>();
  for (const row of rows) {
    if (row.account_ids !== null || proved.has(row.receipt_key)) continue;
    const response = object(row.response), receipt = object(response?.receipt);
    if (!receipt || response?.ok !== true || receipt.id !== row.receipt_key || !Number.isSafeInteger(receipt.at)) fail();
    if (row.receipt_key.startsWith('meta:settlement:') && receipt.kind === 'settlement') {
      const matches = facts.filter(fact => metaSettlementReceiptKey(fact) === row.receipt_key && metaEconomyFingerprint(fact) === row.fingerprint);
      if (matches.length !== 1) fail();
      proved.set(row.receipt_key, matches[0]!.accountId);
    } else if (row.receipt_key.startsWith('meta:season-day:') && receipt.kind === 'season-day') {
      // Day is bounded by the receipt's issuance time. Test every possible UTC day
      // since epoch, but accept ONLY an exact match of the stored payload digest.
      const lastDay = Math.floor(Number(receipt.at) / 86400000);
      if (lastDay < 0 || lastDay > 100000) fail();
      const cacheKey = `${row.fingerprint}:${lastDay}`;
      if (!dayCache.has(cacheKey)) {
        let found: number | undefined;
        for (let day = 0; day <= lastDay; day++) {
          if (metaEconomyFingerprint({ day }) === row.fingerprint) { found = day; break; }
        }
        dayCache.set(cacheKey, found);
      }
      const day = dayCache.get(cacheKey);
      if (day === undefined) fail();
      const request = metaEconomyFingerprint(['active-day', day]);
      const matches = [...accounts].filter(id => `meta:season-day:${metaEconomyFingerprint([id, request])}` === row.receipt_key);
      if (matches.length !== 1) fail();
      proved.set(row.receipt_key, matches[0]!);
    } else fail();
  }
  const legacy = rows.filter(row => row.account_ids === null);
  if (legacy.some(row => !proved.has(row.receipt_key))) fail();
  return new Map(legacy.map(row => [row.receipt_key, proved.get(row.receipt_key)!]));
}

async function plan(db: Pool | PoolClient): Promise<Map<string, string>> {
  const count = await db.query('SELECT 1 FROM meta_economy_receipts WHERE account_ids IS NULL LIMIT 1');
  if (!count.rowCount) return new Map();
  const rows = await db.query<LegacyReceiptRow>(
    "SELECT receipt_key,fingerprint,response,account_ids FROM meta_economy_receipts WHERE account_ids IS NULL OR receipt_key LIKE 'reward-facts:%' LIMIT 10001",
  );
  const accounts = await db.query<{ id: string }>('SELECT id FROM users LIMIT 100001');
  return legacyReceiptOwnership(rows.rows, accounts.rows.map(row => row.id));
}

/** Read-only readiness probe. A changed DB must be rechecked under the offline lock. */
export async function auditLegacyReceiptOwnership(pool: Pool): Promise<number> {
  return (await plan(pool)).size;
}

export async function backfillLegacyReceiptOwnership(pool: Pool): Promise<number> {
  const db = await pool.connect();
  try {
    await requireOfflineDatabase(db);
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='120s'");
    await db.query('LOCK TABLE meta_economy_receipts IN SHARE ROW EXCLUSIVE MODE');
    const mapping = await plan(db);
    for (const [key, accountId] of mapping) {
      const changed = await db.query('UPDATE meta_economy_receipts SET account_ids=$2 WHERE receipt_key=$1 AND account_ids IS NULL', [key, [accountId]]);
      if (changed.rowCount !== 1) fail();
    }
    await db.query('COMMIT');
    return mapping.size;
  } catch (error) {
    await db.query('ROLLBACK'); throw error;
  } finally { db.release(); }
}
