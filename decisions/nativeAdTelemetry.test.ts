import { describe, expect, it } from 'vitest';
import { parseTelemetryBatch } from '../packages/protocol/src/telemetry';
import { nativeAdTelemetry } from './nativeAdTelemetry';

const requestId = 'preview_12345678-1234-1234-1234-123456789abc';
const reply = { slotId: 2111707, requestId, serverVerifiedRewards: false };
describe('native ad diagnostic events on the existing receiver', () => {
  it.each(['requested', 'earned', 'cancelled', 'unavailable'] as const)('accepts the %s observation without a new backend event type', phase => {
    const entry = nativeAdTelemetry(requestId, phase === 'requested' ? undefined : { ...reply, outcome: phase }, 123);
    expect(entry).not.toBeNull();
    const parsed = parseTelemetryBatch({ v: 1, install: 'install01', session: 'session01', build: 'apk-12345678',
      events: [{ id: 'event0001', e: entry!.event, t: 100, p: entry!.props }] });
    expect(parsed.ok && parsed.dropped).toBe(0);
    expect(entry!.props).toMatchObject({ diagnostic: true, phase, requestId, slotId: 2111707, serverVerifiedRewards: false });
    if (phase !== 'earned') expect(entry!.event).not.toBe('rewarded_ad_completed');
  });
  it('reports SDK 3003 as a failure, drops raw messages, URLs, tokens and supplied attribution', () => {
    const entry = nativeAdTelemetry(requestId, { ...reply, outcome: 'unavailable', errorCode: 'E_AD_SDK', sdkCode: 3003,
      message: 'private-token https://secret.invalid', actor: 'other', install: 'other' }, 321);
    expect(entry).toMatchObject({ event: 'client_error', props: { kind: 'native_ad', name: 'VK-3003', code: 'VK-3003', elapsedMs: 321 } });
    expect(JSON.stringify(entry)).not.toMatch(/private|secret|other/);
  });
  it('does not trust mismatched or falsely verified replies', () => {
    for (const value of [{ ...reply, requestId: 'other' }, { ...reply, serverVerifiedRewards: true }]) {
      expect(nativeAdTelemetry(requestId, { ...value, outcome: 'earned' }, 0))
        .toMatchObject({ event: 'client_error', props: { phase: 'unavailable', code: 'E_AD_REPLY' } });
    }
  });
  it.each([-1, NaN, Infinity, 1e20])('bounds elapsed time %j', elapsed => {
    const value = nativeAdTelemetry(requestId, undefined, elapsed)!.props.elapsedMs as number;
    expect(Number.isInteger(value) && value >= 0 && value <= 330_000).toBe(true);
  });
  it.each(['', 'short', '<script>private</script>'])('drops invalid correlation ids: %s', id => {
    expect(nativeAdTelemetry(id, undefined, 0)).toBeNull();
  });
});
