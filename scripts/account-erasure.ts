import { Pool } from 'pg';
import { runAccountErasure, validateErasureConfiguration } from '../packages/server/src/accountErasureWorker';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw Error('E_ERASURE_CONFIG');
  return value;
};
async function main(): Promise<void> {
  // Billing records need a separate approved retention/erasure policy. This
  // release profile must explicitly attest that no Commerce store is in use.
  if (required('ERASURE_COMMERCE_MODE') !== 'disabled' || process.env.COMMERCE_DATABASE_URL || process.env.ERASURE_COMMERCE_DATABASE_URL)
    throw Error('E_ERASURE_COMMERCE_REVIEW_REQUIRED');
  const game = new Pool({ connectionString: required('ERASURE_GAME_DATABASE_URL'), max: 1 });
  const corporations = new Pool({
    connectionString: required('ERASURE_CORP_DATABASE_URL'),
    max: 1,
  });
  try {
    const config = {
      ledger: required('ERASURE_LEDGER'),
      logDir: required('ERASURE_LOG_DIR'),
      analyticsSalts: JSON.parse(required('ERASURE_ANALYTICS_SALTS')) as string[],
    };
    if (process.argv.includes('--pending')) {
      await validateErasureConfiguration(config);
      for (const pool of [game, corporations]) {
        const unknown = await pool.query('SELECT 1 FROM meta_economy_receipts WHERE account_ids IS NULL LIMIT 1');
        if (unknown.rowCount) throw Error('E_ERASURE_LEGACY_RECEIPTS');
      }
      const result = await game.query('SELECT 1 FROM account_deletions WHERE completed_at IS NULL LIMIT 1');
      const guards = await Promise.all([game, corporations].map(pool => pool.query<{ required: boolean }>('SELECT required FROM account_erasure_guard WHERE id=1')));
      if (guards.some(g => typeof g.rows[0]?.required !== 'boolean')) throw Error('E_ERASURE_GUARD');
      process.exitCode = result.rowCount || guards.some(g => g.rows[0]!.required) ? 0 : 3;
      return;
    }
    const count = await runAccountErasure({
      game,
      corporations,
      ...config,
      replay: process.argv.includes('--replay'),
    });
    console.log(`Account erasure completed: ${count}`);
  } finally {
    await Promise.all([game.end(), corporations.end()]);
  }
}
main().catch((error: unknown) => {
  const code = error instanceof Error && /^E_[A-Z_]+$/.test(error.message) ? error.message : 'E_ERASURE_FAILED';
  console.error(`${code}: maintenance required; no completion acknowledged.`);
  process.exitCode = 1;
});
