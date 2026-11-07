/** Restricted operator CLI, intentionally not exposed through HTTP. */
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresMatchStore } from '../store/postgres';
import { createMatchRulesets } from './service';
import { planLegacyBinding, type LegacyRulesWitness } from './legacy';
import { RULESET_ID } from './signing';

async function main(): Promise<void> {
  const [matchId, id, witnessPath, mode] = process.argv.slice(2);
  if (!matchId || !id || !RULESET_ID.test(id) || !witnessPath || !['--dry-run', '--apply'].includes(mode ?? '') || !process.env.DATABASE_URL)
    throw Error('E_RULESET_ARGUMENTS');
  const raw = await readFile(witnessPath, 'utf8');
  if (Buffer.byteLength(raw) > 131072) throw Error('E_RULESET_ARGUMENTS');
  const witness = JSON.parse(raw) as LegacyRulesWitness;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const store = new PostgresMatchStore(pool);
    const snapshot = await store.load(matchId);
    if (!snapshot) throw Error('E_NO_MATCH');
    const rules = await createMatchRulesets(store, { ...process.env, RULESET_KEY_REQUIRED: '1' });
    const pinned = await planLegacyBinding(rules, snapshot, id, witness);
    if (mode === '--apply') {
      const result = await pool.query(
        `UPDATE matches SET ruleset=$2::jsonb, state=jsonb_set(state, '{version}', $3::jsonb)
         WHERE id=$1 AND ruleset IS NULL AND seq=$4 AND state=$5::jsonb
           AND data_version=$6 AND clock IS NOT DISTINCT FROM $7::jsonb`,
        [matchId, JSON.stringify(pinned.ruleset), JSON.stringify(pinned.state.version), snapshot.seq,
          JSON.stringify(snapshot.state), snapshot.dataVersion, snapshot.clock ? JSON.stringify(snapshot.clock) : null],
      );
      if (result.rowCount !== 1) throw Error('E_RULESET_COMMIT_STALE');
    }
    process.stdout.write(`${JSON.stringify({ mode, matchId, ruleset: id, source: witness.source,
      originalVersion: snapshot.state.version, dataVersion: pinned.state.version.data, seq: pinned.seq })}\n`);
  } finally { await pool.end(); }
}
void main().catch(() => { process.stderr.write('E_RULESET_LEGACY_BIND\n'); process.exitCode = 1; });
