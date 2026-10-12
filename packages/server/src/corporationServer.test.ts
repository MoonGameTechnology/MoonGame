import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { expect, it } from 'vitest';
import { createCorporationServer } from './corporationServer';

// The gateway's circuit counts every 5xx as an outage, so a client error must keep its
// 4xx here — otherwise a single caller's malformed or oversized request reads as the
// corporate service being down for everyone.
it('answers client errors as 4xx, never as a service outage', async () => {
  const pool = {
    query: () => Promise.reject(new Error('no database in this test')),
  } as unknown as Pool;
  const app = createCorporationServer(pool, randomBytes(32).toString('hex'));
  try {
    const malformed = await app.inject({
      method: 'POST',
      url: '/corps',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: 'E_BAD_REQUEST' });

    const oversized = await app.inject({
      method: 'POST',
      url: '/corps',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
  } finally {
    await app.close();
  }
});
