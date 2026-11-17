import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./native/vk-rewarded-bridge.js', import.meta.url), 'utf8');
afterEach(() => vi.useRealTimers());
function setup(nativePromise) {
  const window = nativePromise ? { Capacitor: { nativePromise } } : {};
  runInNewContext(source, { window, setTimeout, clearTimeout });
  return window.VoidRewardedAds;
}
const request = { placement: 'main.supply', requestId: 'request_12345678901234567890' };
const result = (outcome = 'earned') => ({ outcome, requestId: request.requestId,
  slotId: 2111707, serverVerifiedRewards: false });
it('is inert on startup and has no web fallback that simulates a completed view', async () => {
  const native = vi.fn();
  setup(native);
  expect(native).not.toHaveBeenCalled();
  expect((await setup().show(request)).outcome).toBe('unavailable');
});
it.each(['earned', 'cancelled', 'unavailable'])('reports the SDK observation %s without authorizing a reward', async outcome => {
  const native = vi.fn(async () => result(outcome));
  const ads = setup(native);
  expect(await ads.show({ ...request, slotId: 123, accountId: 'other' })).toEqual(result(outcome));
  expect(native).toHaveBeenCalledWith('VkRewardedAds', 'show', request);
  expect(Object.isFrozen(ads)).toBe(true);
});
it.each([null, {}, { ...request, placement: 'run.sovereigns' }, { ...request, requestId: 'short' }])(
  'rejects invalid/other-product requests before crossing the native bridge', async value => {
    const native = vi.fn();
    expect((await setup(native).show(value)).outcome).toBe('unavailable');
    expect(native).not.toHaveBeenCalled();
  },
);
it.each([null, { ...result(), requestId: 'other' }, { ...result(), slotId: 123 },
  { ...result(), serverVerifiedRewards: true }, { ...result(), outcome: 'ok' }])(
  'does not turn malformed or mismatched native replies into reward receipts', async value => {
    expect((await setup(async () => value).show(request)).outcome).toBe('unavailable');
  },
);
it('bounds an unresponsive native plugin and handles rejection', async () => {
  vi.useFakeTimers();
  const ads = setup(() => new Promise(() => {}));
  const pending = ads.show(request);
  await vi.advanceTimersByTimeAsync(330_000);
  expect((await pending).outcome).toBe('unavailable');
  expect((await setup(async () => { throw Error('native detail'); }).show(request)).outcome).toBe('unavailable');
});
