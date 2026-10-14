import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { analyticsActor } from './analyticsActor';
import { registerTelemetryApi, type TelemetryApiOptions } from './telemetryApi';

const ev = (n = 1, e = 'session_started') => ({ id: `ev-0000000${n}`, e, t: 1000 + n });
const batch = (over: Record<string, unknown> = {}) => ({
  v: 1,
  install: 'install-0001',
  session: 'session-0001',
  build: 'abc1234',
  events: [ev()],
  ...over,
});
const actorOf = analyticsActor('s'.repeat(32));

function setup(over: Partial<TelemetryApiOptions> = {}) {
  const lines: Record<string, unknown>[] = [];
  const app = Fastify();
  const stats = registerTelemetryApi(app, {
    log: { write: (r) => lines.push(r) },
    now: () => 5000,
    ...over,
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/telemetry',
      headers: { 'content-type': 'application/json', ...headers },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, lines, stats, post };
}

describe('POST /telemetry', () => {
  it('writes one line per event with the server time, and answers 204', async () => {
    const { lines, post, stats } = setup();
    const res = await post(batch({ events: [ev(1), { ...ev(2, 'pve_started'), p: { mode: 'sz' } }] }));
    expect(res.statusCode).toBe(204);
    expect(lines).toEqual([
      { t: 5000, kind: 'client', e: 'session_started', id: 'ev-00000001', ct: 1001, install: 'install-0001', session: 'session-0001', build: 'abc1234' },
      { t: 5000, kind: 'client', e: 'pve_started', id: 'ev-00000002', ct: 1002, install: 'install-0001', session: 'session-0001', build: 'abc1234', p: { mode: 'sz' } },
    ]);
    expect(stats()).toMatchObject({ batches: 1, events: 2, droppedEvents: 0 });
  });

  it('accepts the text/plain body of a sendBeacon', async () => {
    const { lines, post } = setup();
    const res = await post(JSON.stringify(batch()), { 'content-type': 'text/plain;charset=UTF-8' });
    expect(res.statusCode).toBe(204);
    expect(lines).toHaveLength(1);
  });

  it('a junk name is dropped and counted, the rest of the batch lands', async () => {
    const { lines, post, stats } = setup();
    await post(batch({ events: [ev(1), ev(2, 'drop_table')] }));
    expect(lines.map((l) => l.e)).toEqual(['session_started']);
    expect(stats().droppedEvents).toBe(1);
  });

  it('a bad envelope, an extra field or broken JSON is refused whole', async () => {
    const { lines, post, stats } = setup();
    expect((await post(batch({ v: 9 }))).statusCode).toBe(400);
    expect((await post(batch({ actor: 'forged' }))).statusCode).toBe(400);
    expect((await post('{nope', { 'content-type': 'text/plain' })).statusCode).toBe(400);
    expect(lines).toEqual([]);
    expect(stats().rejected).toBe(3);
  });

  it('an oversized body is refused before parsing', async () => {
    const { lines, post } = setup();
    const res = await post(batch({ build: 'x', pad: 'y'.repeat(9000) }));
    expect(res.statusCode).toBe(413);
    expect(lines).toEqual([]);
  });

  it('a flood from one install is cut off', async () => {
    const { post, stats } = setup();
    const codes: number[] = [];
    for (let i = 0; i < 20; i += 1) codes.push((await post(batch())).statusCode);
    expect(codes.filter((c) => c === 204)).toHaveLength(15);
    expect(codes.filter((c) => c === 429)).toHaveLength(5);
    expect(stats().limited).toBe(5);
  });

  it('a flood from one address is cut off even with fresh install ids', async () => {
    const { post } = setup();
    const codes: number[] = [];
    for (let i = 0; i < 40; i += 1)
      codes.push((await post(batch({ install: `install-${1000 + i}` }))).statusCode);
    expect(codes.filter((c) => c === 429)).toHaveLength(10);
  });

  it('a live session adds the pseudonym; the account id never lands', async () => {
    const { lines, post } = setup({
      actorOf,
      identify: async (req) =>
        req.headers.authorization === 'Bearer good' ? { accountId: 'acc-1', login: 'neo' } : null,
    });
    await post(batch(), { authorization: 'Bearer good' });
    await post(batch({ session: 'session-0002' }), { authorization: 'Bearer stale' });
    await post(batch({ session: 'session-0003' }));
    expect(lines.map((l) => l.actor)).toEqual([actorOf('acc-1'), undefined, undefined]);
    expect(JSON.stringify(lines)).not.toContain('acc-1');
  });

  it('a failing session check leaves the events anonymous instead of losing them', async () => {
    const { lines, post } = setup({
      actorOf,
      identify: () => Promise.reject(new Error('store down')),
    });
    expect((await post(batch(), { authorization: 'Bearer x' })).statusCode).toBe(204);
    expect(lines[0]?.actor).toBeUndefined();
  });

  it('with an origin allowlist a foreign site is refused, our page and curl are not', async () => {
    const { post } = setup({ allowedOrigins: ['https://play.example'] });
    expect((await post(batch(), { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post(batch(), { origin: 'https://play.example' })).statusCode).toBe(204);
    expect((await post(batch({ session: 'session-0009' }))).statusCode).toBe(204);
  });
});
