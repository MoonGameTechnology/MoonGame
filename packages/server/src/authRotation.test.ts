import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyJoinToken } from './auth';
import { configFromEnv } from './serverConfig';

const oldSecret = 'a'.repeat(64);
const newSecret = 'b'.repeat(64);
afterEach(() => vi.useRealTimers());

describe('JWT rotation with a bounded verification-only overlap', () => {
  it('keeps old join/session/reset tokens usable, signs only with the new key, then retires the old key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    const old = configFromEnv({ AUTH_JWT_SECRET: oldSecret });
    const deadline = Date.now() / 1000 + 120;
    const next = configFromEnv({
      AUTH_JWT_SECRET: newSecret,
      AUTH_JWT_PREVIOUS_SECRET: oldSecret,
      AUTH_JWT_PREVIOUS_UNTIL: String(deadline),
    });
    const join = await old.signToken!('m', 'p1');
    const session = await old.signSession!('account', 'login', 'fp');
    const reset = await old.signReset!('account', 'fp');
    expect(await verifyJoinToken(join, next.auth!)).toMatchObject({ ok: true });
    expect(await next.verifySession!(session)).toMatchObject({ ok: true });
    expect(await next.verifyReset!(reset)).toEqual({ accountId: 'account', pwfp: 'fp' });
    expect(await verifyJoinToken(await next.signToken!('m', 'p1'), old.auth!)).toEqual({
      ok: false,
      code: 'E_AUTH',
    });
    // Purpose separation still holds during the overlap.
    expect(await verifyJoinToken(session, next.auth!)).toEqual({ ok: false, code: 'E_AUTH' });
    expect(await next.verifySession!(join)).toEqual({ ok: false, code: 'E_AUTH' });
    expect(await next.verifyReset!(session)).toBeNull();
    vi.setSystemTime(deadline * 1000);
    expect(await verifyJoinToken(join, next.auth!)).toEqual({ ok: false, code: 'E_AUTH' });
    expect(await next.verifySession!(session)).toEqual({ ok: false, code: 'E_AUTH' });
    expect(await next.verifyReset!(reset)).toBeNull();
    expect(await verifyJoinToken(await next.signToken!('m', 'p1'), next.auth!)).toMatchObject({
      ok: true,
    });
  });

  it('supports immediate revocation by omitting the old key', async () => {
    const old = configFromEnv({ AUTH_JWT_SECRET: oldSecret });
    const next = configFromEnv({ AUTH_JWT_SECRET: newSecret });
    expect(await next.verifySession!(await old.signSession!('a', 'l', 'fp'))).toEqual({
      ok: false,
      code: 'E_AUTH',
    });
  });

  it.each([
    { AUTH_JWT_PREVIOUS_SECRET: oldSecret },
    { AUTH_JWT_PREVIOUS_UNTIL: '123' },
    { AUTH_JWT_PREVIOUS_SECRET: 'short', AUTH_JWT_PREVIOUS_UNTIL: '123' },
    { AUTH_JWT_PREVIOUS_SECRET: oldSecret, AUTH_JWT_PREVIOUS_UNTIL: 'garbage' },
    {
      AUTH_JWT_PREVIOUS_SECRET: oldSecret,
      AUTH_JWT_PREVIOUS_UNTIL: String(Math.floor(Date.now() / 1000) + 8 * 86400),
    },
    { AUTH_JWT_PREVIOUS_SECRET: newSecret, AUTH_JWT_PREVIOUS_UNTIL: '123' },
  ])('refuses invalid/infinite overlap config without leaking it', (extra) => {
    expect(() => configFromEnv({ AUTH_JWT_SECRET: newSecret, ...extra })).toThrow(
      'E_AUTH_ROTATION_CONFIG',
    );
  });
});
