import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerTelemetryApi } from './telemetryApi';

it('records a native SDK 3003 diagnostic through the existing native-origin receiver', async () => {
  const records: Record<string, unknown>[] = [];
  const app = Fastify();
  registerTelemetryApi(app, { allowedOrigins: ['http://localhost'], log: { write: record => records.push(record) }, now: () => 100 });
  try {
    const requestId = 'preview_12345678-1234-1234-1234-123456789abc';
    const props = { source: 'vk_rewarded_preview', phase: 'unavailable', diagnostic: true,
      requestId, slotId: 2111707, serverVerifiedRewards: false, code: 'VK-3003', sdkCode: 3003, elapsedMs: 20 };
    const response = await app.inject({ method: 'POST', url: '/telemetry', headers: { origin: 'http://localhost' },
      payload: { v: 1, install: 'install01', session: 'session01', build: 'apk-12345678',
        events: [{ id: 'event0001', e: 'client_error', t: 90, p: props }] } });
    expect(response.statusCode).toBe(204);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'client', e: 'client_error', p: { source: 'vk_rewarded_preview', code: 'VK-3003', serverVerifiedRewards: false } });
    expect(JSON.stringify(records)).not.toContain('private token');
  } finally { await app.close(); }
});
