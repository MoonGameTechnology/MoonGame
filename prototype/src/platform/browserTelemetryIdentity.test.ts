import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it('shares one page identity across sinks while keeping account tokens scoped to their receiver', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('navigator', { sendBeacon: () => true });
  const post = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', post);
  const { createBrowserTelemetrySink } = await import('./telemetrySink');
  const game = createBrowserTelemetrySink({ build: 'test',
    target: () => ({ base: 'wss://game.invalid', url: 'https://game.invalid/telemetry' }), token: () => 'game-token' });
  const diagnostics = createBrowserTelemetrySink({ build: 'test',
    target: () => ({ base: 'wss://diagnostics.invalid', url: 'https://diagnostics.invalid/telemetry' }), token: () => null });
  game.emit('session_started');
  diagnostics.emit('client_error', { source: 'vk_rewarded_preview', code: 'VK-3003' });
  await game.flush(); await diagnostics.flush();
  const calls = post.mock.calls as unknown as [string, RequestInit][];
  expect(calls).toHaveLength(2);
  const first = JSON.parse(calls[0]![1].body as string);
  const second = JSON.parse(calls[1]![1].body as string);
  expect(second.install).toBe(first.install);
  expect(second.session).toBe(first.session);
  expect(second.events[0].id).not.toBe(first.events[0].id);
  expect(calls[0]![1].headers).toMatchObject({ authorization: 'Bearer game-token' });
  expect(calls[1]![1].headers).not.toHaveProperty('authorization');
});
