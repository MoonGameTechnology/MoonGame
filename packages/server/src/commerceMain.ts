import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { PostgresCommerceStore, verifyCommerceDatabase } from './commercePostgres';
import { CommerceService } from './commerceService';
import { commerceGatewayIdentity, createCommerceServer } from './commerceServer';
import { createCommerceEntitlementClient } from './commerceTransport';

// This entrypoint never reads DATABASE_URL, AUTH_JWT_SECRET or Game migration code.
const databaseUrl = process.env.COMMERCE_DATABASE_URL;
const metaUrl = process.env.COMMERCE_META_URL;
const keyId = process.env.COMMERCE_META_KEY_ID;
const key = process.env.COMMERCE_META_KEY;
const gatewayKeyId = process.env.COMMERCE_GATEWAY_KEY_ID;
const gatewayKey = process.env.COMMERCE_GATEWAY_KEY;
if (!databaseUrl || !metaUrl || !keyId || !key || !gatewayKeyId || !gatewayKey)
  throw Error('E_COMMERCE_CONFIG');
const target = new URL(metaUrl);
if (
  target.protocol !== 'https:' &&
  !(target.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname))
)
  throw Error('E_COMMERCE_CONFIG');
const pool = new Pool({
  connectionString: databaseUrl,
  max: 8,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});
try {
  await verifyCommerceDatabase(pool);
} catch {
  await pool.end();
  throw Error('E_COMMERCE_DATABASE');
}
const store = new PostgresCommerceStore(pool);
const service = new CommerceService(
  store,
  createCommerceEntitlementClient({ url: metaUrl, keyId, key }),
);
const certPath = process.env.COMMERCE_TLS_CERT;
const keyPath = process.env.COMMERCE_TLS_KEY;
if (Boolean(certPath) !== Boolean(keyPath)) throw Error('E_COMMERCE_CONFIG');
const app = createCommerceServer({
  service,
  logger: true,
  identify: commerceGatewayIdentity({
    keys: { [gatewayKeyId]: gatewayKey },
    claimNonce: (nonce, expires) => store.claimNonce(nonce, expires),
  }),
  ...(certPath && keyPath
    ? { tls: { cert: readFileSync(certPath), key: readFileSync(keyPath) } }
    : {}),
});
// Local readiness depends only on Commerce DB. Meta outage preserves pending deliveries.
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let current: Promise<void> = Promise.resolve();
const tick = () => {
  current = service
    .deliver()
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (!stopping) timer = setTimeout(tick, 1000);
    });
};
await app.listen({
  host: process.env.COMMERCE_HOST ?? '127.0.0.1',
  port: Number(process.env.COMMERCE_PORT ?? 8790),
});
tick();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    void app
      .close()
      .then(() => current)
      .then(() => pool.end())
      .catch(() => {
        process.exitCode = 1;
      });
  });
