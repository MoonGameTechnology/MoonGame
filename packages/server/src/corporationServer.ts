import Fastify from 'fastify';
import type { Pool } from 'pg';
import { corporateIdentity } from './corporateTransport';
import { TLS_POLICY } from './wsServer';
import { createCorporateServices } from './corporateTransactions';
import { registerCorpApi } from './corpApi';
import { registerAvaApi } from './avaApi';
import { registerMedalApi } from './medalApi';
import { CORPORATE_METHODS } from './corporateRemote';
import {
  PostgresCorpStore,
  PostgresAvaChallengeStore,
  PostgresAvaRosterStore,
  PostgresAvaResultStore,
  PostgresAvaFeedStore,
} from './store';

export function createCorporationServer(
  pool: Pool,
  key: string,
  tls?: { key: Buffer; cert: Buffer },
) {
  if (key.length < 32) throw Error('E_CORPORATIONS_CONFIG');
  const app = Fastify({
    logger: true,
    bodyLimit: 1_048_576,
    ...(tls ? { https: { ...TLS_POLICY, ...tls } } : {}),
  });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });
  app.setErrorHandler((error, request, reply) => {
    // A client error (bad body, size, rate) is not an outage: answered as 5xx it would
    // count toward the gateway's shared circuit, so one user could close corporations
    // for everyone. Same mapping as the game server's handler; details stay private.
    const status = (error as { statusCode?: number }).statusCode;
    if (status && Number.isInteger(status) && status >= 400 && status < 500) {
      void reply.code(status).send({ error: status === 429 ? 'E_RATE_LIMIT' : 'E_BAD_REQUEST' });
      return;
    }
    request.log.error(error);
    void reply.code(503).send({ error: 'E_CORPORATIONS_UNAVAILABLE' });
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  const identify = corporateIdentity(app, key, async (nonce, expires) => {
    await pool.query('DELETE FROM corp_gateway_nonces WHERE expires_at<$1', [Date.now()]);
    const inserted = await pool.query(
      'INSERT INTO corp_gateway_nonces(nonce,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce',
      [nonce, expires],
    );
    return inserted.rowCount === 1;
  });
  const services = createCorporateServices(pool);
  registerCorpApi(app, { service: services.corp, identify });
  registerAvaApi(app, { service: services.ava, identify });
  registerMedalApi(app, { service: services.medals, identify });
  const targets = {
    corpStore: new PostgresCorpStore(pool),
    challengeStore: new PostgresAvaChallengeStore(pool),
    rosterStore: new PostgresAvaRosterStore(pool),
    resultStore: new PostgresAvaResultStore(pool),
    feedStore: new PostgresAvaFeedStore(pool),
    ava: services.ava,
  };
  for (const [name, methods] of Object.entries(CORPORATE_METHODS)) {
    const target = targets[name as keyof typeof targets];
    for (const method of methods)
      app.post(`/internal/${name}/${method}`, async (request, reply) => {
        const args = (request.body as { args?: unknown } | null)?.args;
        if (!Array.isArray(args) || args.length > 8)
          return reply.code(400).send({ error: 'E_BAD_MESSAGE' });
        const value: unknown = await Reflect.apply(
          Reflect.get(target, method) as (...args: unknown[]) => unknown,
          target,
          args,
        );
        return { value: value ?? null };
      });
  }
  return app;
}
