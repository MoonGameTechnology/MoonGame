import { describe, expect, it, vi } from 'vitest';
import { boundedReadiness } from './readiness';

describe('bounded dependency readiness', () => {
  it('fails closed during a stalled dependency without queuing more checks, then recovers', async () => {
    let release!: (value: boolean) => void;
    const dependency = new Promise<boolean>((resolve) => { release = resolve; });
    const check = vi.fn(() => dependency);
    const ready = boundedReadiness(check, 10);
    expect(await Promise.all(Array.from({ length: 40 }, () => ready()))).toEqual(Array(40).fill(false));
    expect(await ready()).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    release(true);
    await dependency;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await ready()).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it('contains synchronous and asynchronous dependency failures', async () => {
    expect(await boundedReadiness(() => { throw new Error('private dependency detail'); })()).toBe(false);
    expect(await boundedReadiness(() => Promise.reject(new Error('private dependency detail')))()).toBe(false);
  });
});
