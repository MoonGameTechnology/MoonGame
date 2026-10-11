import { Pool } from 'pg';
import { migrateCorporations } from './corporateMigration';
const sourceUrl = process.env.CORPORATIONS_SOURCE_URL,
  destinationUrl = process.env.CORPORATIONS_DATABASE_URL;
if (!sourceUrl || !destinationUrl || sourceUrl === destinationUrl)
  throw Error('E_CORPORATIONS_MIGRATION_CONFIG');
const source = new Pool({ connectionString: sourceUrl }),
  destination = new Pool({ connectionString: destinationUrl });
try {
  const apply = process.argv.includes('--apply');
  process.stdout.write(
    `${JSON.stringify({ apply, counts: await migrateCorporations(source, destination, apply) })}\n`,
  );
} finally {
  await Promise.all([source.end(), destination.end()]);
}
