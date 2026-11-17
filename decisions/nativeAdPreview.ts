import config from '../mobile/vk-rewarded.json';

export type NativeAdPreviewOutcome = 'earned' | 'cancelled' | 'unavailable';

/** A preview reports SDK observations only; no result authorizes a game reward. */
export function nativeAdPreviewOutcome(value: unknown, requestId: string): NativeAdPreviewOutcome {
  if (!value || typeof value !== 'object') return 'unavailable';
  const result = value as Record<string, unknown>;
  if (result.serverVerifiedRewards !== false || result.slotId !== config.slotId || result.requestId !== requestId)
    return 'unavailable';
  return result.outcome === 'earned' || result.outcome === 'cancelled' ? result.outcome : 'unavailable';
}
