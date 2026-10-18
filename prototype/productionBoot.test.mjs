import { beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
beforeAll(async () => {
  await run(process.execPath, ['prototype/bundle-netserver.mjs']);
}, 30_000);

it.each([undefined, 'unreachable'])('the actual production entry refuses incomplete configuration before touching storage: %s', async (database) => {
  const env = {
    ...process.env, PROD: '1', GATE: '1', SEAT_LOCK: '1', TRUST_PROXY: '1',
    AUTH_JWT_SECRET: 'a'.repeat(64), ALLOWED_ORIGINS: 'https://play.example',
    DB_AUTO_MIGRATE: '0', DB_REQUIRE_LEAST_PRIVILEGE: '1',
    BACKUP_READINESS_VERIFIED: '0',
  };
  if (database) env.DATABASE_URL = ['postgres:', '//vd_app_test:', 'fake-password', '@127.0.0.1:1/test'].join('');
  else delete env.DATABASE_URL;
  try {
    await run(process.execPath, ['packages/server/dist/proto-server.mjs'], { env, timeout: 5000 });
    throw new Error('Production unexpectedly started');
  } catch (error) {
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('BACKUP_READINESS_VERIFIED=1');
    if (!database) expect(error.stderr).toContain('DATABASE_URL (durable production storage)');
    expect(error.stderr).not.toMatch(/fake-password|ECONNREFUSED/);
  }
});
