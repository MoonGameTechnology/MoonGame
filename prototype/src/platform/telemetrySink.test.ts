import { describe, expect, it } from 'vitest';
import { parseTelemetryBatch, TELEMETRY_BODY_MAX } from '../../../packages/protocol/src/telemetry';
import { createTelemetrySink, TELEMETRY_QUEUE_MAX, type TelemetrySinkDeps } from './telemetrySink';

function harness(over: Partial<TelemetrySinkDeps> = {}) {
  const posts: { url: string; body: string; token: string | null }[] = [];
  const beacons: { url: string; body: string }[] = [];
  const timers: (() => void)[] = [];
  let id = 0;
  let answers: boolean[] = [];
  const sink = createTelemetrySink({
    target: () => ({ url: 'https://play.example/telemetry', token: 'tok' }),
    install: 'install-0001',
    session: 'session-0001',
    build: 'abc1234',
    now: () => 1000,
    newId: () => `ev-${String(++id).padStart(8, '0')}`,
    post: (url, body, token) => {
      posts.push({ url, body, token });
      return Promise.resolve(answers.shift() ?? true);
    },
    beacon: (url, body) => {
      beacons.push({ url, body });
      return true;
    },
    later: (fn) => timers.push(fn),
    ...over,
  });
  const tick = async () => {
    const due = timers.splice(0);
    due.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sink, posts, beacons, timers, tick, setAnswers: (a: boolean[]) => (answers = a) };
}

describe('telemetry sink', () => {
  it('batches events into one request the server accepts', async () => {
    const h = harness();
    h.sink.emit('session_started', { entry: 'main' });
    h.sink.emit('pve_started');
    expect(h.posts).toHaveLength(0); // ждёт таймера, а не шлёт по событию
    expect(h.timers).toHaveLength(1);
    await h.tick();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]?.token).toBe('tok');
    const parsed = parseTelemetryBatch(JSON.parse(h.posts[0]!.body));
    expect(parsed.ok && parsed.batch.events.map((e) => e.e)).toEqual(['session_started', 'pve_started']);
    expect(parsed.ok && parsed.dropped).toBe(0);
  });

  it('splits a long queue into batches of twenty', async () => {
    const h = harness();
    for (let i = 0; i < 45; i += 1) h.sink.emit('onboarding_step');
    await h.tick();
    expect(h.posts.map((p) => JSON.parse(p.body).events.length)).toEqual([20, 20, 5]);
  });

  it('retries a failed batch once, then lets it go', async () => {
    const h = harness();
    h.setAnswers([false, false]);
    h.sink.emit('pve_started');
    await h.tick();
    expect(h.posts).toHaveLength(2);
    h.sink.emit('pve_completed');
    await h.tick();
    expect(JSON.parse(h.posts[2]!.body).events.map((e: { e: string }) => e.e)).toEqual(['pve_completed']);
  });

  it('a throwing network never reaches the game', async () => {
    const h = harness({ post: () => Promise.reject(new Error('offline')) });
    expect(() => h.sink.emit('pve_started')).not.toThrow();
    await expect(h.tick()).resolves.toBeUndefined();
  });

  it('closing the tab sends what is left by beacon, without the session token', async () => {
    const h = harness();
    h.sink.emit('pve_started');
    h.sink.pageHide();
    expect(h.beacons).toHaveLength(1);
    expect(h.beacons[0]?.body).not.toContain('tok');
    expect(parseTelemetryBatch(JSON.parse(h.beacons[0]!.body)).ok).toBe(true);
    await h.tick();
    expect(h.posts).toHaveLength(0); // ушло маяком — второй раз не шлём
  });

  it('the queue is bounded while offline', async () => {
    const h = harness({ post: () => Promise.resolve(false) });
    for (let i = 0; i < TELEMETRY_QUEUE_MAX + 50; i += 1) h.sink.emit('onboarding_step');
    h.sink.pageHide();
    const sent = h.beacons.reduce((n, b) => n + JSON.parse(b.body).events.length, 0);
    expect(sent).toBe(TELEMETRY_QUEUE_MAX);
  });

  it('no server address → nothing is sent and nothing piles up', async () => {
    const h = harness({ target: () => null });
    h.sink.emit('pve_started');
    await h.tick();
    h.sink.pageHide();
    expect(h.posts).toHaveLength(0);
    expect(h.beacons).toHaveLength(0);
  });

  it('a retry goes to the same server with the same session, even after a switch', async () => {
    let server = 'a';
    const sent: { url: string; token: string | null }[] = [];
    let first = true;
    const h = harness({
      target: () => ({ url: `https://${server}.example/telemetry`, token: `tok-${server}` }),
      post: (url, _body, token) => {
        sent.push({ url, token });
        server = 'b'; // игрок сменил сервер, пока пакет был в пути
        const ok = !first;
        first = false;
        return Promise.resolve(ok);
      },
    });
    h.sink.emit('pve_started');
    await h.tick();
    expect(sent).toEqual([
      { url: 'https://a.example/telemetry', token: 'tok-a' },
      { url: 'https://a.example/telemetry', token: 'tok-a' },
    ]);
  });

  it('cuts batches by body size, not only by count', async () => {
    const h = harness();
    const fat = { a: '中'.repeat(120), b: '中'.repeat(120), c: '中'.repeat(120), d: '中'.repeat(120) };
    for (let i = 0; i < 20; i += 1) h.sink.emit('onboarding_step', fat);
    await h.tick();
    expect(h.posts.length).toBeGreaterThan(1);
    for (const p of h.posts) expect(new TextEncoder().encode(p.body).length).toBeLessThanOrEqual(TELEMETRY_BODY_MAX);
    expect(h.posts.reduce((n, p) => n + JSON.parse(p.body).events.length, 0)).toBe(20);
  });

  it('an event too big to send alone is dropped, the rest still go', async () => {
    const h = harness();
    const huge = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, '中'.repeat(120)]));
    h.sink.emit('onboarding_step', huge);
    h.sink.emit('pve_started');
    await h.tick();
    expect(h.posts.flatMap((p) => JSON.parse(p.body).events.map((e: { e: string }) => e.e))).toEqual(['pve_started']);
  });

  it('closing the tab mid-request sends the in-flight batch by beacon and does not retry it', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    let calls = 0;
    const h = harness({
      post: () => {
        calls += 1;
        return new Promise((r) => (answer = r));
      },
    });
    h.sink.emit('pve_started');
    const flushing = h.sink.flush();
    h.sink.emit('pve_completed');
    h.sink.pageHide();
    expect(h.beacons.flatMap((b) => JSON.parse(b.body).events.map((e: { e: string }) => e.e))).toEqual([
      'pve_started',
      'pve_completed',
    ]);
    answer(false); // запрос оборвался вместе со страницей
    await flushing;
    expect(calls).toBe(1); // ушедший маяком пакет второй раз не шлётся
  });
});
