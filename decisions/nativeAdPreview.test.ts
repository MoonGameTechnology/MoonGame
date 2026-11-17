import { describe, expect, it } from 'vitest';
import { nativeAdPreviewError, nativeAdPreviewOutcome } from './nativeAdPreview';

const requestId = 'preview_2111707_test';
const reply = { slotId: 2111707, requestId, serverVerifiedRewards: false };

describe('native ad preview observations', () => {
  it.each(['earned', 'cancelled', 'unavailable'] as const)('reports %s for the matching view', outcome => {
    expect(nativeAdPreviewOutcome({ ...reply, outcome }, requestId)).toBe(outcome);
  });
  it.each([
    null, undefined, true, 'earned', {}, { ...reply, outcome: 'ok' },
    { ...reply, outcome: 'earned', serverVerifiedRewards: true },
    { ...reply, outcome: 'earned', serverVerifiedRewards: undefined },
    { ...reply, outcome: 'earned', slotId: 1 },
    { ...reply, outcome: 'earned', requestId: 'other_view_2111707' },
    { ...reply, outcome: '<img src=x onerror=alert(1)>' },
  ])('rejects unknown, mismatched or falsely verified results: %j', value => {
    expect(nativeAdPreviewOutcome(value, requestId)).toBe('unavailable');
  });
});

describe('phone-readable ad diagnostics', () => {
  it.each([
    [3003, 'no-ads'], [1000, 'connection'], [1002, 'connection'],
    [1003, 'timeout'], [1403, 'rejected'], [1404, 'rejected'],
    [1500, 'provider'], [2002, 'provider'], [6000, 'provider'],
  ])('classifies actual VK SDK error %i without exposing provider text', (sdkCode, category) => {
    const issue = nativeAdPreviewError({ ...reply, outcome: 'unavailable', errorCode: 'E_AD_SDK', sdkCode,
      message: '<img src=x onerror=alert(1)>', token: 'private' }, requestId);
    expect(issue).toEqual({ key: `hub.ad-preview.error.${category}`, code: `VK-${sdkCode}` });
  });
  it.each(['E_AD_INIT', 'E_AD_BRIDGE', 'E_AD_ORIGIN', 'E_AD_REQUEST', 'E_AD_REPLY'])('identifies an app/bridge failure: %s', errorCode => {
    expect(nativeAdPreviewError({ ...reply, outcome: 'unavailable', errorCode }, requestId))
      .toEqual({ key: 'hub.ad-preview.error.app', code: errorCode });
  });
  it.each(['E_AD_LOAD_TIMEOUT', 'E_AD_SHOW_TIMEOUT', 'E_AD_BRIDGE_TIMEOUT'])('identifies the timeout boundary: %s', errorCode => {
    expect(nativeAdPreviewError({ ...reply, outcome: 'unavailable', errorCode }, requestId))
      .toEqual({ key: 'hub.ad-preview.error.timeout', code: errorCode });
  });
  it.each([null, {}, { ...reply, outcome: 'unavailable', requestId: 'other', sdkCode: 3003 },
    { ...reply, outcome: 'unavailable', errorCode: '<script>alert(1)</script>' },
    { ...reply, outcome: 'earned', errorCode: 'E_AD_INIT' }])('rejects mismatched or untrusted diagnostic fields: %j', value => {
    expect(nativeAdPreviewError(value, requestId)).toEqual({ key: 'hub.ad-preview.error.app', code: 'E_AD_REPLY' });
  });
  it.each([-1, 1.5, 1e10, '3003', NaN, '<img>'])('never displays malformed SDK codes: %j', sdkCode => {
    expect(nativeAdPreviewError({ ...reply, outcome: 'unavailable', errorCode: 'E_AD_SDK', sdkCode }, requestId))
      .toEqual({ key: 'hub.ad-preview.error.provider', code: 'E_AD_SDK' });
  });
});
