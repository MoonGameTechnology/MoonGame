import { afterEach, describe, expect, it, vi } from 'vitest';
import distribution from '../../mobile/distribution.json';

const mock = vi.hoisted(() => ({ emit: vi.fn(), pageHide: vi.fn(), factory: vi.fn(),
  build: vi.fn(() => ({ sha: '12345678', versionCode: 5964 })) }));
vi.mock('./updater', () => ({ currentBuild: mock.build, RELEASE_LANE: 'player',
  APP_IDS: { player: 'com.voiddominion.player' } }));
vi.mock('./platform/telemetrySink', () => ({ createBrowserTelemetrySink: mock.factory }));
import { createNativeAdDiagnostics } from './nativeAdDiagnostics';
const requestId = 'preview_12345678-1234-1234-1234-123456789abc';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mock.emit.mockReset(); mock.pageHide.mockReset(); mock.factory.mockReset(); mock.build.mockReset(); });
function setup() {
  mock.build.mockReturnValue({ sha: '12345678', versionCode: 5964 });
  mock.factory.mockReturnValue({ emit: mock.emit, pageHide: mock.pageHide });
  const listener = vi.fn();
  vi.stubGlobal('window', { addEventListener: listener });
  return { logger: createNativeAdDiagnostics(), listener };
}
describe('native SDK diagnostics wiring', () => {
  it('uses only the first-party HTTPS receiver and never sends an account token', () => {
    const { logger, listener } = setup();
    const opts = mock.factory.mock.calls[0]![0];
    expect(opts.target().url).toBe(distribution.origin + '/telemetry');
    expect(opts.token('wss://other.invalid')).toBeNull();
    expect(mock.emit).not.toHaveBeenCalled();
    logger.requested(requestId);
    logger.finished(requestId, { slotId: 2111707, requestId, serverVerifiedRewards: false,
      outcome: 'unavailable', errorCode: 'E_AD_SDK', sdkCode: 3003 }, 80);
    expect(mock.emit).toHaveBeenLastCalledWith('client_error', expect.objectContaining({
      code: 'VK-3003', apkVersion: 5964, appId: 'com.voiddominion.player', diagnostic: true,
    }));
    listener.mock.calls[0]![1]();
    expect(mock.pageHide).toHaveBeenCalledOnce();
  });
  it('treats a missing reply as a failure, not as another request', () => {
    const { logger } = setup();
    logger.finished(requestId, undefined, 100);
    expect(mock.emit).toHaveBeenCalledWith('client_error', expect.objectContaining({ phase: 'unavailable', code: 'E_AD_REPLY' }));
    logger.failed(requestId, 5);
    expect(mock.emit).toHaveBeenLastCalledWith('client_error', expect.objectContaining({ code: 'E_AD_CLIENT' }));
  });
  it('does not let failed telemetry interfere with the ad operation', () => {
    const { logger } = setup();
    mock.emit.mockImplementation(() => { throw Error('transport failed'); });
    expect(() => logger.requested(requestId)).not.toThrow();
    expect(() => logger.finished(requestId, { get slotId() { throw Error('untrusted'); } }, 10)).not.toThrow();
    expect(() => logger.failed(requestId, 10)).not.toThrow();
  });
  it('is inert when initialization fails', () => {
    vi.stubGlobal('window', {});
    mock.factory.mockImplementation(() => { throw Error('storage closed'); });
    mock.build.mockReturnValue({ sha: '12345678', versionCode: 5964 });
    const logger = createNativeAdDiagnostics();
    expect(() => logger.requested(requestId)).not.toThrow();
    expect(() => logger.failed(requestId, 0)).not.toThrow();
  });
});
