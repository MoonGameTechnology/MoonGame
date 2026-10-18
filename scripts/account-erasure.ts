import { Pool } from 'pg';
import { runAccountErasure } from '../packages/server/src/accountErasureWorker';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw Error('E_ERASURE_CONFIG');
  return value;
};
async function main(): Promise<void> {
  const game = new Pool({ connectionString: required('ERASURE_GAME_DATABASE_URL'), max: 1 });
  const corporations = new Pool({
    connectionString: required('ERASURE_CORP_DATABASE_URL'),
    max: 1,
  });
  try {
    if (process.argv.includes('--pending')) {
      const result = await game.query('SELECT 1 FROM account_deletions WHERE completed_at IS NULL LIMIT 1');
      const guards = await Promise.all([game, corporations].map(pool => pool.query<{ required: boolean }>('SELECT required FROM account_erasure_guard WHERE id=1')));
      if (guards.some(g => typeof g.rows[0]?.required !== 'boolean')) throw Error('E_ERASURE_GUARD');
      process.exitCode = result.rowCount || guards.some(g => g.rows[0]!.required) ? 0 : 3;
      return;
    }
    const count = await runAccountErasure({
      game,
      corporations,
      ledger: required('ERASURE_LEDGER'),
      logDir: required('ERASURE_LOG_DIR'),
      analyticsSalts: JSON.parse(required('ERASURE_ANALYTICS_SALTS')) as string[],
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
