import { Pool } from 'pg';
import { migrateCommerceDatabase } from './commercePostgres';

// Only the migration job receives these credentials; runtime has no DDL path.
const url = process.env.COMMERCE_DATABASE_MIGRATION_URL;
if (!url) throw Error('E_COMMERCE_CONFIG');
const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrateCommerceDatabase(pool);
  process.stdout.write('commerce schema migrated\n');
} catch {
  process.stderr.write('E_COMMERCE_DATABASE\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
