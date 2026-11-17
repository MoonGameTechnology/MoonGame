/* global window */
/** Native SDK observations are diagnostics, never server-authorized reward receipts. */
(function () {
  const unavailable = () => ({ outcome: 'unavailable', serverVerifiedRewards: false });
  const nativeCall = async (method, options) => {
    const cap = window.Capacitor;
    if (typeof cap?.nativePromise !== 'function') return unavailable();
    let timer;
    try {
      const result = await Promise.race([
        cap.nativePromise('VkRewardedAds', method, options),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), method === 'show' ? 330_000 : 3_000); }),
      ]);
      if (!result || result.slotId !== 2111707 || result.serverVerifiedRewards !== false) return unavailable();
      if (method === 'status') return { slotId: result.slotId, placement: 'main.supply', serverVerifiedRewards: false };
      if (result.requestId !== options.requestId || !['earned', 'cancelled', 'unavailable'].includes(result.outcome)) return unavailable();
      return { outcome: result.outcome, requestId: result.requestId, slotId: result.slotId, serverVerifiedRewards: false };
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timer);
    }
  };
  window.VoidRewardedAds = Object.freeze({
    status: () => nativeCall('status', {}),
    show: (request) => {
      if (request?.placement !== 'main.supply' || typeof request.requestId !== 'string' ||
          !/^[A-Za-z0-9_-]{16,128}$/.test(request.requestId)) return Promise.resolve(unavailable());
      return nativeCall('show', { placement: 'main.supply', requestId: request.requestId });
    },
  });
})();
