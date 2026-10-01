// Wire the RuStore In-App Updates SDK into the generated Android project (RUS-3).
//
// A no-op unless VOID_CHANNEL=rustore (see channel.mjs): the dev/player lanes are not
// touched. Runs AFTER patch-updater.mjs, which leaves MainActivity alone in this channel
// so that exactly one script owns it. Like the other patch scripts it is idempotent and
// fails loudly when an anchor in Capacitor's template moves — a silently half-patched
// store build is worse than a red one.
//
// It does two things:
//   1. app/build.gradle — the RuStore Maven repository, as EXCLUSIVE content for the
//      ru.rustore groups (those artifacts resolve only from RuStore's repository, and
//      nothing else is looked up there), plus the SDK BOM and `appupdate`.
//   2. MainActivity.java — a Capacitor host activity exposing `window.VoidRuStore`
//      (checkUpdate / startUpdate / completeUpdate) and answering with `void-rustore`
//      CustomEvents. The web side is prototype/src/rustoreUpdate.ts; what the player sees
//      is decided in decisions/storeUpdate.ts. There is NO `VoidNative.open` here: the
//      store build has no third-party APK channel.
//
// The SDK only answers for an app installed FROM RuStore, signed with the key the store
// knows, on a phone with RuStore installed and signed in. Anywhere else (a sideloaded
// debug APK) every call fails — the bridge reports an error and the game stays quiet.
//
// API and coordinates are taken from RuStore's official examples
// (github.com/rustore-dev/rustore-sdk-update-example, rustore-update-java-example).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { packagingChannel } from './channel.mjs';

/** RuStore's public Maven repository for its SDKs. */
const RUSTORE_MAVEN = 'https://nexus-external.rustore.ru/repository/maven-rustore-exposed';
/** SDK BOM — pins every RuStore SDK version at once. A bump is this one constant. */
const RUSTORE_BOM = '2025.11.01';

const channel = packagingChannel();
if (channel !== 'rustore') {
  console.log(`patch-rustore: channel "${channel}" — RuStore SDK not wired (no-op).`);
  process.exit(0);
}

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(p, 'utf8');

const appId = JSON.parse(read(here('./capacitor.config.json'))).appId;
if (!appId) throw new Error('patch-rustore: appId missing from capacitor.config.json');
const mainActivityPath = here(`./android/app/src/main/java/${appId.replace(/\./g, '/')}/MainActivity.java`);
const buildGradlePath = here('./android/app/build.gradle');

// --- 1. app/build.gradle ------------------------------------------------------
{
  let gradle = read(buildGradlePath);
  const MARK = '// void: RuStore SDK (RUS-3, mobile/patch-rustore.mjs)';
  if (gradle.includes(MARK)) {
    console.log('patch-rustore: build.gradle already wired — leaving as-is.');
  } else {
    // Module-level blocks of Capacitor's app/build.gradle (top level, column 0).
    const repositories = /^repositories \{\n/m;
    const dependencies = /^dependencies \{\n/m;
    if (!repositories.test(gradle) || !dependencies.test(gradle)) {
      throw new Error('patch-rustore: no top-level repositories {} / dependencies {} in app/build.gradle');
    }
    gradle = gradle.replace(
      repositories,
      (m) =>
        m +
        `    ${MARK}\n` +
        `    exclusiveContent {\n` +
        `        forRepository {\n` +
        `            maven { url '${RUSTORE_MAVEN}' }\n` +
        `        }\n` +
        `        filter {\n` +
        `            includeGroupByRegex 'ru[.]rustore([.].*)?'\n` +
        `        }\n` +
        `    }\n`,
    );
    gradle = gradle.replace(
      dependencies,
      (m) =>
        m +
        `    ${MARK}\n` +
        `    implementation platform('ru.rustore.sdk:bom:${RUSTORE_BOM}')\n` +
        `    implementation 'ru.rustore.sdk:appupdate'\n`,
    );
    writeFileSync(buildGradlePath, gradle);
    console.log(`patch-rustore: build.gradle — RuStore repository + bom ${RUSTORE_BOM} + appupdate.`);
  }
}

// --- 2. MainActivity.java -----------------------------------------------------
{
  if (!existsSync(mainActivityPath)) {
    throw new Error(`patch-rustore: MainActivity not found at ${mainActivityPath}`);
  }
  const java = `package ${appId};

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import org.json.JSONException;
import org.json.JSONObject;
import ru.rustore.sdk.appupdate.listener.InstallStateUpdateListener;
import ru.rustore.sdk.appupdate.manager.RuStoreAppUpdateManager;
import ru.rustore.sdk.appupdate.manager.factory.RuStoreAppUpdateManagerFactory;
import ru.rustore.sdk.appupdate.model.AppUpdateOptions;
import ru.rustore.sdk.appupdate.model.AppUpdateType;
import ru.rustore.sdk.appupdate.model.InstallStatus;
import ru.rustore.sdk.appupdate.model.UpdateAvailability;

/**
 * Capacitor host activity of the RuStore store build (VOID_CHANNEL=rustore, RUS-3).
 *
 * Generated by mobile/patch-rustore.mjs. Unlike the dev/player activity it has no
 * VoidNative.open bridge: the store build has no third-party APK channel. Updates go
 * through the RuStore In-App Updates SDK, exposed to the bundled page as VoidRuStore.
 */
public class MainActivity extends BridgeActivity {
    private RuStoreUpdateBridge ruStore;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = this.bridge.getWebView();
        ruStore = new RuStoreUpdateBridge(this, webView);
        webView.addJavascriptInterface(ruStore, "VoidRuStore");
    }

    @Override
    public void onDestroy() {
        if (ruStore != null) ruStore.dispose();
        super.onDestroy();
    }

    /**
     * window.VoidRuStore: three calls in, 'void-rustore' CustomEvents out. Event shapes
     * are parsed strictly on the web side (decisions/storeUpdate.ts):
     *   {type:'check', available}  {type:'flow', accepted}
     *   {type:'install', status}   {type:'error', op}
     */
    public static class RuStoreUpdateBridge {
        private static final String TAG = "VoidRuStore";
        private final Activity activity;
        private final WebView webView;
        private final InstallStateUpdateListener listener;
        private RuStoreAppUpdateManager manager;
        private boolean listening = false;

        RuStoreUpdateBridge(Activity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
            try {
                this.manager = RuStoreAppUpdateManagerFactory.INSTANCE.create(activity);
            } catch (Exception error) {
                Log.w(TAG, "create", error);
                this.manager = null;
            }
            this.listener = installState -> {
                int status = installState.getInstallStatus();
                String name = status == InstallStatus.DOWNLOADED ? "downloaded"
                        : status == InstallStatus.DOWNLOADING ? "downloading"
                        : status == InstallStatus.FAILED ? "failed"
                        : "other";
                emit(event("install", "status", name));
            };
        }

        /** Is an update available? Silent: never opens a dialog. */
        @JavascriptInterface
        public void checkUpdate() {
            run("check", () -> manager.getAppUpdateInfo()
                    .addOnSuccessListener(info -> guard("check", () -> emit(event("check", "available",
                            info.getUpdateAvailability() == UpdateAvailability.UPDATE_AVAILABLE))))
                    .addOnFailureListener(error -> fail("check", error)));
        }

        /** The player tapped "Update": open RuStore's download dialog (deferred update). */
        @JavascriptInterface
        public void startUpdate() {
            // Each AppUpdateInfo is single-use (SDK docs), so the dialog gets a fresh one.
            run("start", () -> manager.getAppUpdateInfo()
                    .addOnSuccessListener(info -> guard("start", () -> {
                        if (info.getUpdateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
                            emit(event("check", "available", false));
                            return;
                        }
                        if (!listening) {
                            manager.registerListener(listener);
                            listening = true;
                        }
                        manager.startUpdateFlow(info, new AppUpdateOptions.Builder().build())
                                .addOnSuccessListener(code -> emit(event("flow", "accepted",
                                        code != null && code == Activity.RESULT_OK)))
                                .addOnFailureListener(error -> fail("start", error));
                    }))
                    .addOnFailureListener(error -> fail("start", error)));
        }

        /** The player tapped "Restart": install the downloaded update (the app restarts). */
        @JavascriptInterface
        public void completeUpdate() {
            run("complete", () -> manager
                    .completeUpdate(new AppUpdateOptions.Builder().appUpdateType(AppUpdateType.FLEXIBLE).build())
                    .addOnFailureListener(error -> fail("complete", error)));
        }

        void dispose() {
            if (listening && manager != null) {
                manager.unregisterListener(listener);
                listening = false;
            }
        }

        /**
         * JavaScript-interface calls arrive on a background thread; the SDK and the
         * WebView are driven from the UI thread. Only the bundled page may drive the
         * bridge: if the WebView ever shows anything but the local Capacitor origin, the
         * call is dropped.
         */
        private void run(String op, Runnable action) {
            activity.runOnUiThread(() -> {
                if (!fromLocalPage()) return;
                if (manager == null) {
                    fail(op, null);
                    return;
                }
                guard(op, action);
            });
        }

        private void guard(String op, Runnable action) {
            try {
                action.run();
            } catch (Exception error) {
                fail(op, error);
            }
        }

        private boolean fromLocalPage() {
            String url = webView.getUrl();
            if (url == null) return false;
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            return "localhost".equals(uri.getHost()) && ("http".equals(scheme) || "https".equals(scheme));
        }

        /** Details stay in logcat; the page learns only which call failed (fail-secure). */
        private void fail(String op, Throwable error) {
            Log.w(TAG, op, error);
            emit(event("error", "op", op));
        }

        private void emit(JSONObject detail) {
            String js = "window.dispatchEvent(new CustomEvent('void-rustore',{detail:" + detail + "}))";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }

        private static JSONObject event(String type, String key, Object value) {
            JSONObject e = new JSONObject();
            try {
                e.put("type", type);
                e.put(key, value);
            } catch (JSONException ignored) {
                // Non-null string keys with a String/Boolean value cannot fail.
            }
            return e;
        }
    }
}
`;
  writeFileSync(mainActivityPath, java);
  console.log('patch-rustore: MainActivity.java — installed the VoidRuStore update bridge.');
}
