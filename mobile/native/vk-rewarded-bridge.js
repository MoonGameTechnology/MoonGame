/* global window */
/** Native SDK observations are diagnostics, never server-authorized reward receipts. */
(function () {
  const SLOT_ID = 2111707;
  const codes = new Set(['E_AD_REQUEST', 'E_AD_BUSY', 'E_AD_BACKGROUND', 'E_AD_ORIGIN',
    'E_AD_INIT', 'E_AD_SDK', 'E_AD_SHOW', 'E_AD_LOAD_TIMEOUT', 'E_AD_SHOW_TIMEOUT', 'E_AD_DESTROYED']);
  const unavailable = (request, errorCode) => ({ outcome: 'unavailable', slotId: SLOT_ID,
    requestId: typeof request?.requestId === 'string' ? request.requestId : '',
    serverVerifiedRewards: false, errorCode });
  const nativeCall = async (method, options) => {
    const cap = window.Capacitor;
    if (typeof cap?.nativePromise !== 'function') return unavailable(options, 'E_AD_BRIDGE');
    let timer;
    const expired = Symbol();
    try {
      const result = await Promise.race([
        cap.nativePromise('VkRewardedAds', method, options),
        new Promise(resolve => { timer = setTimeout(() => resolve(expired), method === 'show' ? 330_000 : 3_000); }),
      ]);
      if (result === expired) return unavailable(options, 'E_AD_BRIDGE_TIMEOUT');
      if (!result || result.slotId !== SLOT_ID || result.serverVerifiedRewards !== false) return unavailable(options, 'E_AD_REPLY');
      if (method === 'status') return { slotId: result.slotId, placement: 'main.supply', serverVerifiedRewards: false };
      if (result.requestId !== options.requestId || !['earned', 'cancelled', 'unavailable'].includes(result.outcome)) return unavailable(options, 'E_AD_REPLY');
      const reply = { outcome: result.outcome, requestId: result.requestId, slotId: result.slotId, serverVerifiedRewards: false };
      if (result.outcome === 'unavailable' && result.errorCode !== undefined) {
        reply.errorCode = codes.has(result.errorCode) ? result.errorCode : 'E_AD_REPLY';
        if (reply.errorCode === 'E_AD_SDK' && Number.isInteger(result.sdkCode) && result.sdkCode >= 0 && result.sdkCode <= 99999)
          reply.sdkCode = result.sdkCode;
      }
      return reply;
    } catch {
      return unavailable(options, 'E_AD_BRIDGE');
    } finally {
      clearTimeout(timer);
    }
  };
  window.VoidRewardedAds = Object.freeze({
    status: () => nativeCall('status', {}),
    show: (request) => {
      if (request?.placement !== 'main.supply' || typeof request.requestId !== 'string' ||
          !/^[A-Za-z0-9_-]{16,128}$/.test(request.requestId)) return Promise.resolve(unavailable({}, 'E_AD_REQUEST'));
      return nativeCall('show', { placement: 'main.supply', requestId: request.requestId });
    },
  });
})();
