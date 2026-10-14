import { describe, expect, it } from 'vitest';
import { parseTelemetryBatch } from '../../../packages/protocol/src/telemetry';
import { createTelemetrySink, TELEMETRY_QUEUE_MAX, type TelemetrySinkDeps } from './telemetrySink';

function harness(over: Partial<TelemetrySinkDeps> = {}) {
  const posts: { url: string; body: string; token: string | null }[] = [];
  const beacons: { url: string; body: string }[] = [];
  const timers: (() => void)[] = [];
  let id = 0;
  let answers: boolean[] = [];
  const sink = createTelemetrySink({
    endpoint: () => 'https://play.example/telemetry',
    token: () => 'tok',
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
    const h = harness({ endpoint: () => null });
    h.sink.emit('pve_started');
    await h.tick();
    h.sink.pageHide();
    expect(h.posts).toHaveLength(0);
    expect(h.beacons).toHaveLength(0);
  });
});
