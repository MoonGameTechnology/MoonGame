// Wire the in-app verified updater into the freshly-generated Android project.
//
// Runs AFTER `cap add android` / `cap sync` / brand / patch-android.mjs, and is
// idempotent + defensive: the android/ project is gitignored and regenerated every
// build, and we cannot run the Android SDK in dev, so each step checks before it edits
// and tolerates whatever Capacitor's template already provides.
//
// It does three things:
//   1. MainActivity.java — replace with a version that exposes
//      window.VoidNative.installVerified(url, sha256). The web layer calls it only with a
//      manifest whose Ed25519 signature it has verified (prototype/src/updater.ts). The
//      native side downloads the APK itself into the app's private cache, compares the
//      SHA-256 of the bytes it got with the signed one, checks the package name and only
//      then opens the system installer. The signing key of the APK is public
//      (mobile/debug.keystore), so Android's own "same signer" rule cannot tell our build
//      from a forged one: the digest check is what makes a compromised download host
//      unable to swap the file. The earlier "hand the URL to the system browser" bridge is
//      gone on purpose: the browser would install bytes nobody checked.
//   2. AndroidManifest.xml — REQUEST_INSTALL_PACKAGES (the installer intent needs it on
//      Android 8+), and the FileProvider the template ships, serving the cache directory.
//   3. app/build.gradle — pinned debug signing + versionCode/versionName (from env
//      VOID_VC / VOID_VN) so Android treats each rolling build as a strictly newer update.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(p, 'utf8');

const appId = JSON.parse(read(here('./capacitor.config.json'))).appId;
if (!appId) throw new Error('patch-updater: appId missing from capacitor.config.json');
const pkgPath = appId.replace(/\./g, '/');
const lane = { 'com.voiddominion.prototype': 'alpha', 'com.voiddominion.player': 'player' }[appId];
if (!lane) throw new Error(`patch-updater: no sideload lane for appId ${appId}`);
const distribution = JSON.parse(read(here('./distribution.json')));
if (!/^https:\/\/[a-z0-9.-]+$/.test(distribution.origin) || !/^(\/[a-z0-9-]+)+$/.test(distribution.basePath)) {
  throw new Error('patch-updater: distribution.json origin/basePath must be plain HTTPS literals');
}
// Only immutable APKs of THIS lane at the configured origin (same rule as isTrustedApkUrl).
const apkPrefix = `${distribution.origin}${distribution.basePath}/${lane}/`;

const mainActivityPath = here(`./android/app/src/main/java/${pkgPath}/MainActivity.java`);
const buildGradlePath = here('./android/app/build.gradle');
const manifestPath = here('./android/app/src/main/AndroidManifest.xml');
const filePathsPath = here('./android/app/src/main/res/xml/file_paths.xml');

// --- 1. MainActivity.java ---------------------------------------------------
{
  const java = `package ${appId};

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/**
 * Capacitor host activity + the verified in-app updater bridge (see patch-updater.mjs).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Exposed to the bundled web app (local content only) as window.VoidNative.
        WebView webView = this.bridge.getWebView();
        webView.addJavascriptInterface(new UpdaterBridge(this, webView), "VoidNative");
    }

    public static class UpdaterBridge {
        private static final String APK_PREFIX = "${apkPrefix}";
        private static final Pattern APK_PATH = Pattern.compile("^[1-9][0-9]{0,9}-[a-f0-9]{7,40}/void-dominion-${lane}\\\\.apk$");
        private static final Pattern SHA256 = Pattern.compile("^[a-f0-9]{64}$");
        private static final long MAX_APK = 128L * 1024 * 1024;
        private final Activity activity;
        private final WebView webView;
        private final AtomicBoolean busy = new AtomicBoolean(false);

        UpdaterBridge(Activity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
        }

        /** Download, check against the signed digest, then hand to the system installer. */
        @JavascriptInterface
        public void installVerified(final String url, final String sha256) {
            if (url == null || sha256 == null || !url.startsWith(APK_PREFIX)
                    || !APK_PATH.matcher(url.substring(APK_PREFIX.length())).matches()
                    || !SHA256.matcher(sha256).matches()) {
                report("E_UPDATE_REQUEST");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                report("E_UPDATE_PERMISSION");
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + activity.getPackageName())));
                    } catch (Exception ignored) {
                        // The status line already tells the player what to allow.
                    }
                });
                return;
            }
            if (!busy.compareAndSet(false, true)) return;
            report("downloading");
            new Thread(() -> {
                try {
                    report(downloadVerifyInstall(url, sha256));
                } finally {
                    busy.set(false);
                }
            }).start();
        }

        private String downloadVerifyInstall(String url, String sha256) {
            File dir = new File(activity.getCacheDir(), "updates");
            File apk = new File(dir, "update.apk");
            HttpsURLConnection connection = null;
            boolean keep = false;
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) return "E_UPDATE_DOWNLOAD";
                if (apk.exists() && !apk.delete()) return "E_UPDATE_DOWNLOAD";
                connection = (HttpsURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                if (connection.getResponseCode() != 200) return "E_UPDATE_DOWNLOAD";
                if (connection.getContentLengthLong() > MAX_APK) return "E_UPDATE_DOWNLOAD";
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        total += n;
                        if (total > MAX_APK) return "E_UPDATE_DOWNLOAD";
                        digest.update(buffer, 0, n);
                        out.write(buffer, 0, n);
                    }
                }
                if (!MessageDigest.isEqual(digest.digest(), hex(sha256))) return "E_UPDATE_DIGEST";
                PackageInfo info = activity.getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
                if (info == null || !activity.getPackageName().equals(info.packageName)) return "E_UPDATE_PACKAGE";
                // The file stays in this app's private cache: nothing else can rewrite it
                // between the check above and the installer reading it.
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                keep = true;
                activity.runOnUiThread(() -> {
                    try {
                        activity.startActivity(install);
                    } catch (Exception e) {
                        report("E_UPDATE_INSTALL");
                    }
                });
                return "installing";
            } catch (Exception e) {
                return "E_UPDATE_DOWNLOAD";
            } finally {
                if (connection != null) connection.disconnect();
                if (!keep) apk.delete();
            }
        }

        private static byte[] hex(String value) {
            byte[] out = new byte[value.length() / 2];
            for (int i = 0; i < out.length; i++) {
                out[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
            }
            return out;
        }

        /** Fixed status codes only — never page-supplied text — back to the web layer. */
        private void report(String code) {
            String script = "window.dispatchEvent(new CustomEvent('void-apk-update',{detail:'" + code + "'}))";
            activity.runOnUiThread(() -> webView.evaluateJavascript(script, null));
        }
    }
}
`;
  if (!existsSync(mainActivityPath)) {
    throw new Error(`patch-updater: MainActivity not found at ${mainActivityPath}`);
  }
  writeFileSync(mainActivityPath, java);
  console.log(`patch-updater: MainActivity.java — installed the verified updater bridge (${apkPrefix}).`);
}

// --- 1b. AndroidManifest.xml + file_paths.xml (installer permission, cache provider) ---
{
  let xml = read(manifestPath);
  const permission = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />';
  if (!xml.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
    if (!xml.includes('</manifest>')) throw new Error('patch-updater: AndroidManifest has no </manifest>');
    xml = xml.replace('</manifest>', `    ${permission}\n</manifest>`);
    writeFileSync(manifestPath, xml);
    console.log('patch-updater: AndroidManifest — added REQUEST_INSTALL_PACKAGES.');
  }
  // Capacitor's template declares this provider; the bridge reuses it rather than adding one.
  if (!xml.includes('${applicationId}.fileprovider') || !xml.includes('@xml/file_paths')) {
    throw new Error('patch-updater: the template FileProvider (${applicationId}.fileprovider) is missing');
  }
  if (!existsSync(filePathsPath)) throw new Error(`patch-updater: ${filePathsPath} is missing`);
  let paths = read(filePathsPath);
  if (!/<cache-path\b[^>]*path="\.?\/?"/.test(paths) && !paths.includes('name="void_updates"')) {
    if (!paths.includes('</paths>')) throw new Error('patch-updater: file_paths.xml has no </paths>');
    paths = paths.replace('</paths>', '    <cache-path name="void_updates" path="updates/" />\n</paths>');
    writeFileSync(filePathsPath, paths);
    console.log('patch-updater: file_paths.xml — exposed cache/updates/ to the installer.');
  }
}

// --- 2a. app/build.gradle (pinned debug signing) ------------------------------
// The COMMITTED mobile/debug.keystore must be the signer NO MATTER what the build
// host's HOME / ANDROID_USER_HOME point at. Copying it to ~/.android proved
// UNRELIABLE — CI's signature assert caught real drift (the APK came out signed by
// a different, runner-generated key, which is exactly the "conflicts with another
// package" update-breaker on phones) — so pin it EXPLICITLY in gradle: an explicit
// signingConfig wins over every default-keystore lookup path.
{
  let gradle = read(buildGradlePath);
  const MARK = '// void: pinned debug signing (mobile/debug.keystore — stable update signature)';
  if (gradle.includes(MARK)) {
    console.log('patch-updater: debug signingConfig already pinned — leaving as-is.');
  } else {
    if (!/^android \{\n/m.test(gradle)) {
      throw new Error('patch-updater: could not find the android {} block in app/build.gradle');
    }
    // Forward slashes keep the gradle string literal portable (file() accepts them anywhere).
    const ksPath = here('./debug.keystore').replace(/\\/g, '/');
    // AGP pre-creates signingConfigs.debug; setting its fields here re-points the
    // default debug buildType at the committed keystore — no buildTypes edit needed.
    const block =
      `    ${MARK}\n` +
      `    signingConfigs {\n` +
      `        debug {\n` +
      `            storeFile file('${ksPath}')\n` +
      `            storePassword 'android'\n` +
      `            keyAlias 'androiddebugkey'\n` +
      `            keyPassword 'android'\n` +
      `        }\n` +
      `    }\n`;
    gradle = gradle.replace(/^android \{\n/m, (m) => m + block);
    writeFileSync(buildGradlePath, gradle);
    console.log('patch-updater: build.gradle — pinned the debug signingConfig to mobile/debug.keystore.');
  }
}

// --- 2. app/build.gradle (versionCode / versionName) ------------------------
{
  const vc = process.env.VOID_VC;
  const vn = process.env.VOID_VN;
  if (!vc || !/^\d+$/.test(vc)) {
    console.log('patch-updater: VOID_VC unset/invalid — leaving build.gradle versionCode as-is.');
  } else {
    let gradle = read(buildGradlePath);
    if (!/versionCode\s+\d+/.test(gradle)) {
      // Check presence (not whether a change happened): on a re-run the value may already
      // equal the target, which is a successful no-op, not a missing-anchor failure.
      throw new Error('patch-updater: could not find versionCode in app/build.gradle');
    }
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${vc}`);
    if (vn) gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${vn}"`);
    writeFileSync(buildGradlePath, gradle);
    console.log(`patch-updater: build.gradle — versionCode ${vc}${vn ? ` / versionName "${vn}"` : ''}.`);
  }
}
