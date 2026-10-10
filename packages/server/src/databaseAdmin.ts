import { Pool } from 'pg';
import { migrateDatabase, provisionDatabase, retireDatabaseLogin } from './databaseSecurity';

// Separate executable: migration/admin credentials never enter the game process.
const command = process.argv[2];
const url = command === 'migrate' ? process.env.DB_MIGRATION_URL : process.env.DB_ADMIN_URL;
if (!url || !['provision', 'migrate', 'retire'].includes(command ?? '')) {
  process.stderr.write('E_DB_ADMIN_CONFIG\n');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: url, max: 1 });
  pool.on('error', () => {
    process.stderr.write('{"kind":"security.admin","ok":false,"code":"E_DB_CONNECTION"}\n');
    process.exitCode = 1;
  });
  try {
    if (command === 'provision') await provisionDatabase(pool, process.env);
    else if (command === 'retire') await retireDatabaseLogin(pool, process.env.DB_RETIRE_USER);
    else await migrateDatabase(pool);
    process.stdout.write(
      JSON.stringify({ kind: 'security.admin', operation: command, ok: true }) + '\n',
    );
  } catch {
    process.stderr.write(
      JSON.stringify({
        kind: 'security.admin',
        operation: command,
        ok: false,
        code: 'E_DB_ADMIN',
      }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
