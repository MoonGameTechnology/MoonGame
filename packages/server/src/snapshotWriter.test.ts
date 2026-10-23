import { afterEach, expect, it, vi } from 'vitest';
import { createSnapshotWriter } from './snapshotWriter';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => { vi.useRealTimers(); });

it('drains a slow write, then saves the latest terminal state and settles before closing', async () => {
  vi.useFakeTimers();
  const first = deferred();
  const settlement = deferred();
  let state = { seq: 1, ended: false };
  const saved: typeof state[] = [];
  const events: string[] = [];
  const writer = createSnapshotWriter({
    async save() {
      const snapshot = state;
      saved.push(snapshot);
      if (snapshot.seq === 1) await first.promise;
      events.push(`saved:${snapshot.seq}`);
      if (snapshot.ended) {
        await settlement.promise;
        events.push('settled');
      }
    },
    onError: vi.fn(),
  });
  writer.schedule();
  await vi.advanceTimersByTimeAsync(500);
  state = { seq: 2, ended: true };
  writer.schedule();
  writer.stop();
  const shutdown = writer.flush().then(() => { events.push('pool closed'); });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(saved).toEqual([{ seq: 1, ended: false }]);
  expect(events).toEqual([]);
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(saved).toEqual([{ seq: 1, ended: false }, { seq: 2, ended: true }]);
  expect(events).toEqual(['saved:1', 'saved:2']);
  settlement.resolve();
  await shutdown;
  expect(events).toEqual(['saved:1', 'saved:2', 'settled', 'pool closed']);
  expect(vi.getTimerCount()).toBe(0);
});

it('coalesces background requests without overlapping or accumulating slow writes', async () => {
  vi.useFakeTimers();
  const blocked = deferred();
  const save = vi.fn(() => blocked.promise);
  const writer = createSnapshotWriter({ save, onError: vi.fn() });
  writer.schedule();
  await vi.advanceTimersByTimeAsync(500);
  for (let i = 0; i < 10; i++) {
    writer.schedule();
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(save).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  blocked.resolve();
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(2);
  writer.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('retries fresh after a failed active save and exposes final settlement failure', async () => {
  vi.useFakeTimers();
  const blocked = deferred();
  const backgroundError = new Error('background storage unavailable');
  const finalError = new Error('settlement unavailable');
  const save = vi.fn().mockImplementationOnce(() => blocked.promise)
    .mockRejectedValueOnce(finalError).mockResolvedValue(undefined);
  const onError = vi.fn();
  const writer = createSnapshotWriter({ save, onError });
  writer.schedule();
  await vi.advanceTimersByTimeAsync(500);
  writer.stop();
  const final = expect(writer.flush()).rejects.toBe(finalError);
  blocked.reject(backgroundError);
  await final;
  expect(onError).toHaveBeenCalledExactlyOnceWith(backgroundError);
  expect(save).toHaveBeenCalledTimes(2);
  await writer.flush();
  expect(save).toHaveBeenCalledTimes(3);
});

it('serializes overlapping explicit flushes and keeps normal scheduling after startup flush', async () => {
  vi.useFakeTimers();
  const blocked = deferred();
  const save = vi.fn().mockImplementationOnce(() => blocked.promise).mockResolvedValue(undefined);
  const writer = createSnapshotWriter({ save, onError: vi.fn() });
  const startup = writer.flush();
  const second = writer.flush();
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(1);
  blocked.resolve();
  await Promise.all([startup, second]);
  expect(save).toHaveBeenCalledTimes(2);
  writer.schedule();
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(3);
  writer.stop();
});
