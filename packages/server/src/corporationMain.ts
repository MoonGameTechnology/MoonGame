import { tlsFromEnv } from './wsServer';
import { Pool } from 'pg';
import { prepareRuntimeDatabase } from './databaseSecurity';
import { createCorporationServer } from './corporationServer';

const url = process.env.DATABASE_URL,
  key = process.env.CORPORATIONS_KEY;
if (!url || !key || key.length < 32) throw Error('E_CORPORATIONS_CONFIG');
const pool = new Pool({
  connectionString: url,
  max: 8,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
await prepareRuntimeDatabase(pool, process.env);
const app = createCorporationServer(pool, key, tlsFromEnv(process.env));
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8789) });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .catch(() => {
        process.exitCode = 1;
      });
  });
