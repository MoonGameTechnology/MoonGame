import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActivityReporter, type ActivityTarget } from './playerActivity';
afterEach(() => vi.useRealTimers());
describe('foreground reporter', () => {
  it('reports one ephemeral channel, closes old identities and ignores missing sessions', async () => {
    let target: ActivityTarget | null = null;
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const report = createActivityReporter({
      target: () => target,
      request,
      channel: 'a'.repeat(32),
    });
    await report(true);
    expect(request).not.toHaveBeenCalled();
    target = { base: 'https://game.example', token: 'private' };
    await report(true);
    await report(true);
    await report(false);
    expect(request.mock.calls.map((c) => JSON.parse(c[1]!.body as string))).toEqual([
      { channel: 'a'.repeat(32), sequence: 1, active: true },
      { channel: 'a'.repeat(32), sequence: 2, active: true },
      { channel: 'a'.repeat(32), sequence: 3, active: false },
    ]);
    expect(request.mock.calls[0]![0]).toBe('https://game.example/activity/pulse');
    expect(request.mock.calls[0]![1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      keepalive: true,
    });
    await report(true);
    target = { base: 'https://other.example', token: 'other' };
    await report(true);
    expect(JSON.parse(request.mock.calls.at(-2)![1]!.body as string).active).toBe(false);
    expect(request.mock.calls.at(-1)![0]).toBe('https://other.example/activity/pulse');
  });
  it('marks an entry immediately without tagging later heartbeats or missing identities', async () => {
    let target: ActivityTarget | null = { base: 'https://game.example', token: 'private' };
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const report = createActivityReporter({ target: () => target, request, channel: 'a'.repeat(32) });
    await report(true, true);
    await report(true);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string).sectorZero).toBe(true);
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string).sectorZero).toBeUndefined();
    target = null;
    await report(true, true);
    expect(JSON.parse(request.mock.calls.at(-1)![1]!.body as string)).toMatchObject({ active: false });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('bounds offline requests and absorbs fetch/storage errors', async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(Error('offline')));
        }),
    );
    const report = createActivityReporter({
      target: () => ({ base: 'https://game.example', token: 'private' }),
      request,
      channel: 'a'.repeat(32),
    });
    const promise = report(true);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toBeUndefined();
    await expect(
      createActivityReporter({
        target: () => {
          throw Error('storage');
        },
        request,
        channel: 'x',
      })(true),
    ).resolves.toBeUndefined();
  });
});
