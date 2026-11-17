package __APP_ID__;

import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.my.target.ads.Reward;
import com.my.target.ads.RewardedAd;
import com.my.target.common.MyTargetPrivacy;
import com.my.target.common.MyTargetConfig;
import com.my.target.common.MyTargetManager;
import com.my.target.common.models.IAdLoadingError;

/** SDK observations only. A client callback never authorizes a server entitlement. */
@CapacitorPlugin(name = "VkRewardedAds")
public final class VkRewardedAdsPlugin extends Plugin {
    private static final int SLOT_ID = __SLOT_ID__;
    private static final String PLACEMENT = "main.supply";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PluginCall pending;
    private RewardedAd active;
    private boolean earned;
    private boolean shown;
    private final Runnable timeout = () -> finish("unavailable", shown ? "E_AD_SHOW_TIMEOUT" : "E_AD_LOAD_TIMEOUT", null);

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("slotId", SLOT_ID);
        result.put("placement", PLACEMENT);
        result.put("serverVerifiedRewards", false);
        call.resolve(result);
    }

    @PluginMethod
    public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String requestId = call.getString("requestId", "");
            if (!PLACEMENT.equals(call.getString("placement")) || !requestId.matches("[A-Za-z0-9_-]{16,128}")) {
                reply(call, "unavailable", "E_AD_REQUEST", null);
                return;
            }
            if (pending != null) { reply(call, "unavailable", "E_AD_BUSY", null); return; }
            if (!visible()) { reply(call, "unavailable", "E_AD_BACKGROUND", null); return; }
            if (!localPage()) { reply(call, "unavailable", "E_AD_ORIGIN", null); return; }
            pending = call;
            earned = false;
            shown = false;
            handler.postDelayed(timeout, 30_000);
            try {
                // No personalized-data consent is inferred from tapping an ad button.
                MyTargetPrivacy.setUserConsent(false);
                MyTargetManager.setSdkConfig(new MyTargetConfig.Builder()
                    .withTrackingEnvironment(false).withTrackingLocation(false).build());
                MyTargetManager.initSdk(getContext());
                active = new RewardedAd(SLOT_ID, getContext());
                active.setListener(new RewardedAd.RewardedAdListener() {
                    @Override public void onLoad(@NonNull RewardedAd ad) {
                        onMain(ad, () -> {
                            if (shown) return;
                            if (!visible()) { finish("unavailable", "E_AD_BACKGROUND", null); return; }
                            shown = true;
                            handler.removeCallbacks(timeout);
                            handler.postDelayed(timeout, 300_000);
                            try { ad.show(); } catch (RuntimeException e) { finish("unavailable", "E_AD_SHOW", null); }
                        });
                    }
                    @Override public void onNoAd(@NonNull IAdLoadingError error, @NonNull RewardedAd ad) {
                        onMain(ad, () -> finish("unavailable", "E_AD_SDK", error == null ? null : error.getCode()));
                    }
                    @Override public void onFailedToShow(@NonNull RewardedAd ad) {
                        onMain(ad, () -> finish("unavailable", "E_AD_SHOW", null));
                    }
                    @Override public void onClick(@NonNull RewardedAd ad) {}
                    @Override public void onDisplay(@NonNull RewardedAd ad) {}
                    @Override public void onReward(@NonNull Reward reward, @NonNull RewardedAd ad) {
                        onMain(ad, () -> { if (shown) earned = true; });
                    }
                    @Override public void onDismiss(@NonNull RewardedAd ad) {
                        onMain(ad, () -> finish(earned ? "earned" : "cancelled"));
                    }
                });
                active.load();
            } catch (RuntimeException e) {
                finish("unavailable", "E_AD_INIT", null);
            }
        });
    }

    private boolean visible() {
        return !getActivity().isFinishing() && !getActivity().isDestroyed() &&
            getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED);
    }

    private boolean localPage() {
        String url = getBridge().getWebView().getUrl();
        return url != null && (url.startsWith("https://localhost/") || url.startsWith("http://localhost/"));
    }

    private boolean current(RewardedAd ad) { return pending != null && active == ad; }

    private void onMain(RewardedAd ad, Runnable callback) {
        handler.post(() -> { if (current(ad)) callback.run(); });
    }

    private void reply(PluginCall call, String outcome, String errorCode, Integer sdkCode) {
        JSObject result = new JSObject();
        result.put("outcome", outcome);
        result.put("slotId", SLOT_ID);
        result.put("requestId", call.getString("requestId", ""));
        result.put("serverVerifiedRewards", false);
        if ("unavailable".equals(outcome) && errorCode != null) {
            result.put("errorCode", errorCode);
            if (sdkCode != null) result.put("sdkCode", sdkCode);
        }
        call.resolve(result);
    }

    private void finish(String outcome) {
        finish(outcome, null, null);
    }

    private void finish(String outcome, String errorCode, Integer sdkCode) {
        PluginCall call = pending;
        RewardedAd ad = active;
        pending = null;
        active = null;
        earned = false;
        shown = false;
        handler.removeCallbacks(timeout);
        if (ad != null) {
            ad.setListener(null);
            try { ad.dismiss(); } catch (RuntimeException ignored) {}
            try { ad.destroy(); } catch (RuntimeException ignored) {}
        }
        if (call != null) reply(call, outcome, errorCode, sdkCode);
    }

    @Override protected void handleOnDestroy() {
        handler.post(() -> finish("unavailable", "E_AD_DESTROYED", null));
        super.handleOnDestroy();
    }
}
