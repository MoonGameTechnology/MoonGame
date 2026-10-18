import { Pool } from 'pg';
import { runAccountErasure, validateErasureConfiguration } from '../packages/server/src/accountErasureWorker';
import { auditLegacyReceiptOwnership } from '../packages/server/src/legacyReceiptOwnership';

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
  const gameUrl = required('ERASURE_GAME_DATABASE_URL');
  const corpUrl = required('ERASURE_CORP_DATABASE_URL');
  const game = new Pool({ connectionString: gameUrl, max: 1 });
  // The playable host can keep both domains in one database. A second idle
  // maintenance connection would correctly trip the offline-client guard.
  // Use the exact same URL for this topology; aliases still fail closed.
  const corporations = corpUrl === gameUrl ? game : new Pool({ connectionString: corpUrl, max: 1 });
  const pools = [...new Set([game, corporations])];
  try {
    const config = {
      ledger: required('ERASURE_LEDGER'),
      logDir: required('ERASURE_LOG_DIR'),
      analyticsSalts: JSON.parse(required('ERASURE_ANALYTICS_SALTS')) as string[],
    };
    if (process.argv.includes('--pending')) {
      await validateErasureConfiguration(config);
      let legacy = 0;
      for (const pool of pools) {
        legacy += await auditLegacyReceiptOwnership(pool);
      }
      const result = await game.query('SELECT 1 FROM account_deletions WHERE completed_at IS NULL LIMIT 1');
      const guards = await Promise.all(pools.map(pool => pool.query<{ required: boolean }>('SELECT required FROM account_erasure_guard WHERE id=1')));
      if (guards.some(g => typeof g.rows[0]?.required !== 'boolean')) throw Error('E_ERASURE_GUARD');
      process.exitCode = legacy || result.rowCount || guards.some(g => g.rows[0]!.required) ? 0 : 3;
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
    await Promise.all(pools.map(pool => pool.end()));
  }
}
main().catch((error: unknown) => {
  const code = error instanceof Error && /^E_[A-Z_]+$/.test(error.message) ? error.message : 'E_ERASURE_FAILED';
  console.error(`${code}: maintenance required; no completion acknowledged.`);
  process.exitCode = 1;
});
