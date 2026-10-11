import { describe, expect, it } from 'vitest';
import { DependencyGuard } from './dependencyGuard';

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe('dependency fault isolation', () => {
  it('rejects excess concurrency without queuing or running the operation; releases failed slots', async () => {
    const guard = new DependencyGuard({ maxConcurrent: 1 });
    const held = pending<number>();
    const first = guard.run(() => held.promise);
    let called = false;
    await expect(
      guard.run(async () => {
        called = true;
        return 2;
      }),
    ).rejects.toThrow('E_DEPENDENCY_BUSY');
    expect(called).toBe(false);
    held.reject(Error('down'));
    await expect(first).rejects.toThrow('down');
    expect(await guard.run(async () => 3)).toBe(3);
    expect(guard.snapshot().inFlight).toBe(0);
  });
  it('opens after failures, allows exactly one recovery probe, and reopens on a failed probe', async () => {
    let now = 0;
    const guard = new DependencyGuard({ failureThreshold: 2, cooldownMs: 10, now: () => now });
    const fail = () =>
      guard.run(async () => {
        throw Error('down');
      });
    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toThrow('down');
    await expect(guard.run(async () => 1)).rejects.toThrow('E_DEPENDENCY_OPEN');
    now = 10;
    const held = pending<number>();
    const probe = guard.run(() => held.promise);
    await expect(guard.run(async () => 1)).rejects.toThrow('E_DEPENDENCY_OPEN');
    held.reject(Error('down'));
    await expect(probe).rejects.toThrow('down');
    now = 19;
    await expect(guard.run(async () => 1)).rejects.toThrow('E_DEPENDENCY_OPEN');
    now = 20;
    expect(await guard.run(async () => 7)).toBe(7);
    expect(guard.snapshot().state).toBe('closed');
  });
  it('does not let old in-flight completions close or reopen a newer circuit generation', async () => {
    let now = 0;
    const guard = new DependencyGuard({ failureThreshold: 1, cooldownMs: 10, now: () => now });
    const old = pending<number>(),
      later = pending<number>();
    const success = guard.run(() => old.promise),
      failure = guard.run(() => later.promise);
    await expect(
      guard.run(async () => {
        throw Error('down');
      }),
    ).rejects.toThrow();
    old.resolve(1);
    await success;
    expect(guard.snapshot().state).toBe('open');
    now = 10;
    await guard.run(async () => 1);
    later.reject(Error('late'));
    await expect(failure).rejects.toThrow('late');
    expect(guard.snapshot().state).toBe('closed');
  });
  it('counts unavailable responses, keeps domains independent, and resets after a healthy response', async () => {
    const bad = new DependencyGuard({ failureThreshold: 2 }),
      healthy = new DependencyGuard();
    const send = (status: number) =>
      bad.run(
        async () => status,
        (value) => value >= 500,
      );
    await send(503);
    await send(403);
    await send(503);
    expect(bad.snapshot().state).toBe('closed');
    await send(503);
    expect(bad.snapshot().state).toBe('open');
    expect(await healthy.run(async () => 'match')).toBe('match');
  });
  it('rejects invalid limits at construction', () => {
    for (const options of [{ maxConcurrent: 0 }, { failureThreshold: 0 }, { cooldownMs: -1 }])
      expect(() => new DependencyGuard(options)).toThrow('E_DEPENDENCY_CONFIG');
  });
});
