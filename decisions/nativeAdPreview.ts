import config from '../mobile/vk-rewarded.json';

export type NativeAdPreviewOutcome = 'earned' | 'cancelled' | 'unavailable';

function matchingReply(value: unknown, requestId: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  return result.serverVerifiedRewards === false && result.slotId === config.slotId && result.requestId === requestId
    ? result : null;
}

/** A preview reports SDK observations only; no result authorizes a game reward. */
export function nativeAdPreviewOutcome(value: unknown, requestId: string): NativeAdPreviewOutcome {
  const result = matchingReply(value, requestId);
  if (!result) return 'unavailable';
  return result.outcome === 'earned' || result.outcome === 'cancelled' ? result.outcome : 'unavailable';
}

/** Fixed copy and bounded codes only; provider messages never enter the UI. */
export function nativeAdPreviewError(value: unknown, requestId: string): { key: string; code: string } {
  const fallback = { key: 'hub.ad-preview.error.app', code: 'E_AD_REPLY' };
  const result = matchingReply(value, requestId);
  if (!result || result.outcome !== 'unavailable') return fallback;
  const errorCode = result.errorCode;
  if (errorCode === 'E_AD_SDK') {
    const sdkCode = result.sdkCode;
    if (typeof sdkCode !== 'number' || !Number.isInteger(sdkCode) || sdkCode < 0 || sdkCode > 99999)
      return { key: 'hub.ad-preview.error.provider', code: 'E_AD_SDK' };
    // IAdLoadingError.LoadErrorType in the pinned VK SDK 5.52.5.
    const code = `VK-${sdkCode}`;
    switch (sdkCode) {
      case 3003: return { key: 'hub.ad-preview.error.no-ads', code };
      case 1000: case 1002: return { key: 'hub.ad-preview.error.connection', code };
      case 1003: return { key: 'hub.ad-preview.error.timeout', code };
      case 1403: case 1404: return { key: 'hub.ad-preview.error.rejected', code };
      default: return { key: 'hub.ad-preview.error.provider', code };
    }
  }
  switch (errorCode) {
    case 'E_AD_LOAD_TIMEOUT': case 'E_AD_SHOW_TIMEOUT': case 'E_AD_BRIDGE_TIMEOUT':
      return { key: 'hub.ad-preview.error.timeout', code: errorCode };
    case 'E_AD_SHOW': return { key: 'hub.ad-preview.error.show', code: errorCode };
    case 'E_AD_INIT': case 'E_AD_BRIDGE': case 'E_AD_ORIGIN': case 'E_AD_BACKGROUND':
    case 'E_AD_REQUEST': case 'E_AD_BUSY': case 'E_AD_DESTROYED': case 'E_AD_REPLY':
      return { key: 'hub.ad-preview.error.app', code: errorCode };
    default: return fallback;
  }
}
