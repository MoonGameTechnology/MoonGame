package com.voiddominion.adprobe;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

/** Fixed HTTPS receiver, bounded observations, no account token or raw SDK text. */
final class ProbeTelemetry {
    interface Receipt { void done(boolean ok); }
    private final ThreadPoolExecutor sender = new ThreadPoolExecutor(1, 1, 5, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(8), new ThreadPoolExecutor.AbortPolicy());
    private final String install;
    private final String session = UUID.randomUUID().toString();

    ProbeTelemetry(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("vk-ad-probe-diagnostics", Context.MODE_PRIVATE);
        String saved = prefs.getString("install", "");
        if (!saved.matches("[a-f0-9-]{36}")) {
            saved = UUID.randomUUID().toString();
            prefs.edit().putString("install", saved).apply();
        }
        install = saved;
    }

    void emit(String requestId, String phase, String code, Integer sdkCode, long elapsed, Receipt receipt) {
        try {
            JSONObject props = new JSONObject().put("source", "vk_rewarded_minimal").put("diagnostic", true)
                .put("phase", phase).put("requestId", requestId).put("slotId", BuildConfig.SLOT_ID)
                .put("placement", "main.supply").put("sdk", BuildConfig.SDK_VERSION)
                .put("appId", BuildConfig.APPLICATION_ID).put("apkVersion", BuildConfig.VERSION_CODE)
                .put("elapsedMs", elapsed).put("serverVerifiedRewards", false)
                .put("consent", false).put("trackingEnvironment", false).put("trackingLocation", false);
            if (code != null) props.put("code", code).put("name", code).put("kind", "native_ad").put("where", "native-minimal");
            if (sdkCode != null) props.put("sdkCode", sdkCode);
            String event = code != null ? "client_error" : "earned".equals(phase) ? "rewarded_ad_completed" : "rewarded_ad_offered";
            JSONObject row = new JSONObject().put("id", UUID.randomUUID().toString()).put("e", event)
                .put("t", System.currentTimeMillis()).put("p", props);
            byte[] body = new JSONObject().put("v", 1).put("install", install).put("session", session)
                .put("build", "apk-" + BuildConfig.SOURCE_SHA).put("events", new JSONArray().put(row))
                .toString().getBytes(StandardCharsets.UTF_8);
            if (body.length > 8192) { if (receipt != null) receipt.done(false); return; }
            sender.execute(() -> { boolean ok = send(body); if (receipt != null) receipt.done(ok); });
        } catch (Exception ignored) { if (receipt != null) receipt.done(false); }
    }

    private boolean send(byte[] body) {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(BuildConfig.TELEMETRY_URL).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setFixedLengthStreamingMode(body.length);
            connection.setDoOutput(true);
            try (OutputStream stream = connection.getOutputStream()) { stream.write(body); }
            int status = connection.getResponseCode();
            InputStream response = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (response != null) response.close();
            return status >= 200 && status < 300;
        } catch (Exception ignored) { return false; }
        finally { if (connection != null) connection.disconnect(); }
    }

    void close() { sender.shutdown(); }
}
