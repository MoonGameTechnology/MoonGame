import type { TelemetryEventName, TelemetryProps } from '../packages/protocol/src/telemetry';
import config from '../mobile/vk-rewarded.json';
import { nativeAdPreviewError, nativeAdPreviewOutcome } from './nativeAdPreview';

/** Backward-compatible SDK observations, never evidence for a reward. */
export function nativeAdTelemetry(requestId: string, result: unknown, elapsed: number): {
  event: TelemetryEventName; props: TelemetryProps;
} | null {
  if (!/^preview_[A-Za-z0-9_-]{8,112}$/.test(requestId)) return null;
  const phase = result === undefined ? 'requested' : nativeAdPreviewOutcome(result, requestId);
  const props: TelemetryProps = {
    source: 'vk_rewarded_preview', diagnostic: true, phase, requestId,
    placement: config.placement, slotId: config.slotId, sdk: config.sdkVersion,
    serverVerifiedRewards: false,
    elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.min(330_000, Math.round(elapsed))) : 0,
  };
  if (phase === 'unavailable') {
    const issue = nativeAdPreviewError(result, requestId);
    Object.assign(props, { kind: 'native_ad', name: issue.code, code: issue.code, where: 'native-preview' });
    const sdk = /^VK-(\d{1,5})$/.exec(issue.code);
    if (sdk) props.sdkCode = Number(sdk[1]);
    return { event: 'client_error', props };
  }
  // A cancelled diagnostic is still an offered view, never a completed one.
  // Consumers group diagnostics by requestId/phase, not the raw offered count.
  return { event: phase === 'earned' ? 'rewarded_ad_completed' : 'rewarded_ad_offered', props };
}
