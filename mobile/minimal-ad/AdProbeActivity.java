package com.voiddominion.adprobe;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.my.target.ads.Reward;
import com.my.target.ads.RewardedAd;
import com.my.target.common.MyTargetConfig;
import com.my.target.common.MyTargetManager;
import com.my.target.common.MyTargetPrivacy;
import com.my.target.common.models.IAdLoadingError;
import java.util.UUID;

/** Native-only probe: no WebView, account, game state, or entitlement writes. */
public final class AdProbeActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Button button;
    private TextView status;
    private ProbeTelemetry telemetry;
    private RewardedAd active;
    private String request;
    private long started;
    private boolean shown;
    private boolean earned;
    private boolean resumed;
    private final Runnable timeout = () -> finish("unavailable", shown ? "E_AD_SHOW_TIMEOUT" : "E_AD_LOAD_TIMEOUT", null);

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        telemetry = new ProbeTelemetry(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        int pad = Math.round(24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        layout.setFitsSystemWindows(true);
        button = new Button(this);
        button.setText(R.string.action);
        button.setContentDescription(getString(R.string.action));
        button.setOnClickListener(view -> load());
        layout.addView(button, new LinearLayout.LayoutParams(-1, -2));
        status = new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, pad, 0, 0);
        status.setText(R.string.hint);
        status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
        layout.addView(status, new LinearLayout.LayoutParams(-1, -2));
        setContentView(layout);
    }

    @Override protected void onResume() { super.onResume(); resumed = true; }
    @Override protected void onPause() { resumed = false; super.onPause(); }

    // SDK 5.52.5 stores its random per-install UUID here. Seed it before SDK
    // initialization on a fresh probe, and reuse the SDK's UUID on upgrades.
    private String testInstanceId() {
        SharedPreferences prefs = getSharedPreferences("mytarget_prefs", MODE_PRIVATE);
        String id = prefs.getString("instanceId", null);
        if (id == null || id.isEmpty()) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString("instanceId", id).apply();
        }
        return id;
    }

    private void load() {
        if (request != null || !visible()) return;
        request = "preview_" + UUID.randomUUID();
        started = SystemClock.elapsedRealtime();
        earned = false;
        shown = false;
        button.setEnabled(false);
        status.setText(R.string.loading);
        observe("requested", null, null, null, false);
        handler.postDelayed(timeout, 30_000);
        try {
            // Match the game's explicit-tap, non-personalized SDK configuration.
            MyTargetPrivacy.setUserConsent(false);
            String instanceId = testInstanceId();
            MyTargetManager.setSdkConfig(new MyTargetConfig.Builder()
                .withTestDevices(instanceId)
                .withTrackingEnvironment(false).withTrackingLocation(false).build());
            MyTargetManager.initSdk(this);
            String[] devices = MyTargetManager.getSdkConfig().testDevices;
            if (devices == null || devices.length != 1 || !instanceId.equals(devices[0])) {
                finish("unavailable", "E_AD_TEST_CONFIG", null);
                return;
            }
            android.util.Log.i("VkAdProbe", "Test device configured");
            active = new RewardedAd(BuildConfig.SLOT_ID, this);
            active.setListener(new RewardedAd.RewardedAdListener() {
                @Override public void onLoad(RewardedAd ad) {
                    onMain(ad, () -> {
                        if (shown) return;
                        if (!visible()) { finish("unavailable", "E_AD_BACKGROUND", null); return; }
                        shown = true;
                        observe("loaded", null, null, null, false);
                        handler.removeCallbacks(timeout);
                        handler.postDelayed(timeout, 300_000);
                        try { ad.show(); } catch (RuntimeException e) { finish("unavailable", "E_AD_SHOW", null); }
                    });
                }
                @Override public void onNoAd(IAdLoadingError error, RewardedAd ad) {
                    onMain(ad, () -> {
                        Integer code = error == null ? null : error.getCode();
                        VkNetworkFailure network = null;
                        if (code != null && code == IAdLoadingError.LoadErrorType.UNDEFINED_NETWORK_ERROR) {
                            try { network = VkNetworkFailure.fromMessage(error.getMessage()); }
                            catch (RuntimeException ignored) { /* Preserve the original SDK code. */ }
                        }
                        finish("unavailable", "E_AD_SDK", code, network);
                    });
                }
                @Override public void onFailedToShow(RewardedAd ad) {
                    onMain(ad, () -> finish("unavailable", "E_AD_SHOW", null));
                }
                @Override public void onDisplay(RewardedAd ad) {
                    onMain(ad, () -> observe("displayed", null, null, null, false));
                }
                @Override public void onReward(Reward reward, RewardedAd ad) {
                    onMain(ad, () -> { if (shown) earned = true; });
                }
                @Override public void onDismiss(RewardedAd ad) {
                    onMain(ad, () -> finish(earned ? "earned" : "cancelled", null, null));
                }
                @Override public void onClick(RewardedAd ad) {}
            });
            active.load();
        } catch (RuntimeException e) { finish("unavailable", "E_AD_INIT", null); }
    }

    private boolean visible() { return resumed && !isFinishing() && !isDestroyed(); }

    private void onMain(RewardedAd ad, Runnable callback) {
        handler.post(() -> { if (request != null && active == ad) callback.run(); });
    }

    private void observe(String phase, String code, Integer sdkCode, VkNetworkFailure network, boolean receipt) {
        final String id = request;
        long elapsed = Math.max(0, Math.min(330_000, SystemClock.elapsedRealtime() - started));
        telemetry.emit(id, phase, code, sdkCode, network, elapsed, receipt ? ok -> handler.post(() -> {
            // A previous request's receipt cannot overwrite the next request's UI.
            if (!isDestroyed() && request == null && id.equals(button.getTag())) {
                status.append("\n" + getString(ok ? R.string.log_sent : R.string.log_failed));
            }
        }) : null);
    }

    private void finish(String phase, String error, Integer sdkCode) {
        finish(phase, error, sdkCode, null);
    }

    private void finish(String phase, String error, Integer sdkCode, VkNetworkFailure network) {
        if (request == null) return;
        Integer safeSdk = sdkCode != null && sdkCode >= 0 && sdkCode <= 99999 ? sdkCode : null;
        String code = error == null ? null : "E_AD_SDK".equals(error) && safeSdk != null ? "VK-" + safeSdk : error;
        int text = "earned".equals(phase) ? R.string.earned : "cancelled".equals(phase) ? R.string.cancelled : errorText(code);
        status.setText(getString(text).replace("{code}", code == null ? "E_AD_SDK" : code));
        button.setTag(request);
        observe(phase, code, safeSdk, network, true);
        request = null;
        RewardedAd ad = active;
        active = null;
        handler.removeCallbacks(timeout);
        shown = false;
        earned = false;
        button.setEnabled(true);
        if (ad != null) {
            ad.setListener(null);
            try { ad.dismiss(); } catch (RuntimeException ignored) {}
            try { ad.destroy(); } catch (RuntimeException ignored) {}
        }
    }

    private int errorText(String code) {
        if ("VK-3003".equals(code)) return R.string.error_no_ads;
        if ("VK-1000".equals(code) || "VK-1002".equals(code)) return R.string.error_connection;
        if ("VK-1003".equals(code) || "E_AD_LOAD_TIMEOUT".equals(code) || "E_AD_SHOW_TIMEOUT".equals(code)) return R.string.error_timeout;
        if ("VK-1403".equals(code) || "VK-1404".equals(code)) return R.string.error_rejected;
        if ("E_AD_SHOW".equals(code)) return R.string.error_show;
        return code != null && code.startsWith("VK-") ? R.string.error_provider : R.string.error_app;
    }

    @Override protected void onDestroy() {
        finish("unavailable", "E_AD_DESTROYED", null);
        telemetry.close();
        super.onDestroy();
    }
}
