import { nativeAdTelemetry } from '../../decisions/nativeAdTelemetry';
import config from '../../mobile/vk-rewarded.json';
import distribution from '../../mobile/distribution.json';
import { createBrowserTelemetrySink } from './platform/telemetrySink';
import { APP_IDS, currentBuild, RELEASE_LANE } from './updater';

export interface NativeAdDiagnostics {
  requested(requestId: string): void;
  finished(requestId: string, result: unknown, elapsedMs: number): void;
  failed(requestId: string, elapsedMs: number): void;
}

/** SDK diagnostics always go to our HTTPS receiver, without account tokens. */
export function createNativeAdDiagnostics(): NativeAdDiagnostics {
  const inert: NativeAdDiagnostics = { requested() {}, finished() {}, failed() {} };
  try {
    const build = currentBuild();
    if (!build) return inert;
    const sink = createBrowserTelemetrySink({
      target: () => ({ base: distribution.origin.replace('https://', 'wss://'), url: distribution.origin + '/telemetry' }),
      token: () => null,
      build: /^[a-f0-9]{7,40}$/i.test(build.sha) ? `apk-${build.sha.slice(0, 12)}` : 'apk-unknown',
    });
    const observe = (requestId: string, result: unknown, elapsed: number): void => {
      try {
        const entry = nativeAdTelemetry(requestId, result, elapsed);
        if (entry) sink.emit(entry.event, { ...entry.props, apkVersion: build.versionCode, appId: APP_IDS[RELEASE_LANE] });
      } catch { /* Diagnostics must never prevent loading or closing an ad. */ }
    };
    window.addEventListener('pagehide', () => {
      try { sink.pageHide(); } catch { /* Best-effort observation only. */ }
    });
    return {
      requested: requestId => observe(requestId, undefined, 0),
      finished: (requestId, result, elapsed) => observe(requestId, result ?? null, elapsed),
      failed: (requestId, elapsed) => observe(requestId, {
        slotId: config.slotId, requestId, serverVerifiedRewards: false,
        outcome: 'unavailable', errorCode: 'E_AD_CLIENT',
      }, elapsed),
    };
  } catch { return inert; }
}
