import { describe, expect, it } from 'vitest';
import { nativeAdPreviewOutcome } from './nativeAdPreview';

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
