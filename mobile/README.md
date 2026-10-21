# Void Dominion — Android APK (Capacitor)

Packages the **prototype** (`prototype/dist/void-dominion.html`, a self-contained
offline HTML game) into an installable Android APK by wrapping it in a Capacitor
WebView. No hosting needed — the HTML ships inside the app. The app is **branded**
(diamond crest icon + splash) and **rotates freely** — the responsive layout serves
phones in portrait and tablets / landscape with the wider framing. Standalone project
(not in the pnpm workspace); uses `npm`.

This is `cross-platform-roadmap.md` CP6.2 (Capacitor route — pulled forward ahead of
the CP6.1 TWA route to enable the multiplayer-via-APK test). The wrapped prototype
now ships **net mode**: its connect overlay can join a live session served by
`pnpm dev:proto-server`. See `docs/multiplayer.md` → "Two phones, one session" for
the friend-test runbook (server + `wss://` tunnel → sideload → both connect).

## Sector Zero on RuStore — release plan

The [RuStore research and release roadmap](rustore-sector-zero-release-roadmap.md)
(Russian, researched 2026-09-30) covers the proposed standalone Sector Zero Android
profile, production signing, store updates, save safety, listing requirements,
testing, moderation, and optional monetization. It does **not** claim that a
store-ready APK exists or change the existing dev/player release lanes below.

## RuStore profile verification

`node rustore-smoke.mjs` (from `mobile/`, with no generated `android/` directory)
builds the actual release profile with an ephemeral signing key and explicitly
synthetic configuration. Requires locked dependencies, JDK 21, Android SDK/build-tools,
`openssl` and `unzip`. It restores `capacitor.config.json` and deletes test keys/APK;
only `dist/rustore-smoke.json` is retained. The PR/merge-group workflow runs this
without release credentials. This verifies packaging, not device installation or
approval to publish. See [the drill report](../docs/reviews/rustore-release-drill-2026-10-18.md).

## Install on a phone (easiest)

The public download source is our VPS over HTTPS, configured once in
`mobile/distribution.json`:

- **Player client** (`com.voiddominion.player`):
  https://77-221-140-87.sslip.io/downloads/android/player/latest.apk
- **Dev client** (`com.voiddominion.prototype`):
  https://77-221-140-87.sslip.io/downloads/android/alpha/latest.apk

The desktop hub offers the player APK and a locally generated QR of the same
stable link. No third-party QR service is contacted. The promotion is hidden on
touch phones and removed from packaged APKs; the Yandex archive excludes its markup.
GitHub rolling releases remain build inputs/archive and a migration path for old
installed APKs, whose hardcoded updater cannot be changed without installing a new APK.

The two APKs have **different application ids**, so a host can install both side by
side; each updates from its own release lane (the in-app updater picks the lane baked
into the build — `prototype/src/updater.ts`).

On the phone: open the direct link → download → open the APK → allow "install from
unknown sources" if prompted → launch. In the **dev** APK single-player runs fully
offline; rotate freely on a phone or tablet.

It is a **debug** APK, signed with a **committed debug keystore** (`mobile/debug.keystore`,
standard `android`/`android` credentials — not a secret) so every build shares one
signature and updates install over the previous build. A Play-Store release/AAB still
needs a real (secret) keystore — a later step.

### If the install fails

- **"App not installed — it conflicts with another package"** — you have an older build
  installed that was signed with a *different* key (older builds regenerated the debug
  key each time). **Uninstall Void Dominion once**, then install this build; from now on
  the signature is stable, so future updates install straight over the top. CI now
  **asserts** every APK is signed by the committed `debug.keystore` (the build fails on
  drift), so a signature mismatch can never silently ship again. Note the two lanes are
  two separate apps (`…prototype` dev / `…player`) — an update of one never conflicts
  with the other.
- **Google Play Protect "blocked for your protection"** — expected for a sideloaded
  debug APK from an unverified developer. Tap **Подробнее → Установить всё равно**
  (More details → Install anyway). It's the same code you build here.

## In-app auto-update

Install a new site-aware APK once; subsequent checks read only our HTTPS site:
`/downloads/android/{alpha|player}/latest.json`. It is a signed envelope
`{payload, signature}`: `payload` is the manifest (`versionCode`, `versionName`,
`apkUrl`, `notes`, `sha`, `apkSha256`, `appId`, `signerSha256`) and `signature` is
Ed25519 over those exact bytes, made in CI with the `APK_MANIFEST_SIGNING_KEY` secret.
The app checks it against `manifestPublicKey` in `mobile/distribution.json` through
WebCrypto and ignores anything else, so the download host cannot forge a version.
The APK URL is immutable and belongs to the same origin/lane.
The app prompts only when the remote Android versionCode is strictly larger;
notes are plain text and the action is **«Скачать обновление»**. The native bridge
(`VoidNative.installVerified`, written by `patch-updater.mjs`) downloads the APK into
the app's private cache, compares its SHA-256 with the signed one and its package
name, and only then opens the system installer. A mismatch deletes the file. This
check, not the APK signature, is what stops a swapped file: the debug key is public.
Android installation always requires the user's approval; the first time it also asks
to allow installs from this app. A WebView without Ed25519 (Chromium older than 137)
shows that instead of offering the update.
Application IDs, WebView origin and `mobile/debug.keystore` are unchanged, so a
compatible update installs over the existing app and retains its local data.

Checks run at launch, foreground return (15min throttle), every4h, and manually.
Timeout5s/body32KiB, malformed JSON, a bad signature, unavailable site and older/equal versions never
block boot. Requests omit credentials, reject redirects and bypass caches.
RuStore builds remain on their store update channel and never check sideload versions.

CI stamps versionCode=git commit count and versionName=lane-SHA into both Gradle and
`window.__BUILD__`, verifies the actual APK signer/package/versions, signs the manifest,
then attaches `version.json` to the rolling release. Non-increasing publication is refused.
The unprivileged VPS timer downloads/verifies each new release and switches one
pointer shared by JSON and the stable APK link only after all checks pass. No
SSH deploy credential or public upload endpoint is required. Old releases remain
usable during failed publication. See the [publication runbook](../deploy/apk/README.md).

> Authenticity caveat: the debug keystore is committed (public), so the signature proves
> only "built by this pipeline's key", not a secret identity. Fine for an alpha; a real
> (secret) release keystore is the Play-Store step.

## Get the APK as a CI artifact (any branch build)

Each run also uploads both APKs as artifacts (handy for `claude/*` branch builds that
don't publish a release):

1. Actions tab → "Android APK (prototype)" → open the run (or **Run workflow**).
2. Download the **`void-dominion-debug-apk`** (dev client) or
   **`void-dominion-player-apk`** (player client) artifact.
3. Sideload `app-debug.apk` (enable "install from unknown sources").

## Build locally (needs JDK 21 + Android SDK)

```bash
cd mobile
npm install
npm run www          # builds the prototype and stages www/index.html
npx cap add android  # generates the native android/ project (first time only)
npm run apk          # sync → brand (icon/splash + landscape) → ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run apk` runs `npm run brand` between sync and the Gradle build:
`capacitor-assets generate --android` (icons + splash from `assets/`), then
`node patch-android.mjs` (enables rotation — `fullUser` + in-place `configChanges`
so rotating never reloads the WebView / drops game state), then `node patch-updater.mjs`
(wires the MainActivity system-browser bridge and stamps `versionCode`/`versionName` from `VOID_VC`/`VOID_VN` when set).
A local build leaves `versionCode 1` and ships no `window.__BUILD__`, so its updater stays
dormant — those are injected by CI from the git commit count; the native hook still
compiles locally, which is the point of running it here.

Requirements: JDK 21, Android SDK (set `ANDROID_HOME`), and accepted SDK licenses.
`gradlew` downloads its own Gradle. The locked Capacitor 8 toolchain requires JDK 21 (see `package-lock.json`).

## Notes

- `www/` and `android/` are generated (gitignored); only the config + scripts +
  `assets/` source art are tracked.
- Brand art lives in `assets/` (`icon-only` / `icon-foreground` / `icon-background`
  at 1024², `splash` / `splash-dark` at 2732²); regenerate with the scratch
  generator if the crest changes. `@capacitor/assets` fans them out to every density.
- App id `com.voiddominion.prototype`, name "Void Dominion".
- CI action versions are tag-pinned for now; SHA-pin them with the pipeline-hardening
  brick (SD-6.1) alongside the other workflows.


## Канал RuStore

Для сетевой игры подготовлен отдельный release workflow. См.
[инструкцию выпуска и удаления аккаунтов](../docs/security/rustore-preparation.md).
Debug APK и `debug.keystore` не используются для магазина. Публикация пока выключена.
