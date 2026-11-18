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

The alpha/player WebView keeps `http://localhost`, preserving the existing origin-scoped
saves and account sessions. `server.cleartext` is disabled and `patch-updater.mjs` wires
`network-security.mjs` into the generated manifest: cleartext is denied by default, with
an exception for the exact `localhost` asset host. External multiplayer endpoints must
use HTTPS/WSS. The server's existing native Origin allowlist remains valid.
See [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config).
Mobile changes also build read-only APK candidates on pull requests; release publication
and its signing secret remain restricted to protected main.

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

The hub header offers the player APK next to the game mark in every browser except
iPhone/iPad (iOS cannot install it); on a mouse PC, hovering the button opens a locally
generated QR of the same stable link. No third-party QR service is contacted. The button
is removed from packaged APKs (`decisions/apkOffer.ts`); the Yandex archive excludes its markup.
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

The manual native ad probe (`minimal-ad/`, workflow `android-ad-probe.yml`) packages
one Android button plus status as a separate `com.voiddominion.adprobe` application.
It installs alongside `com.voiddominion.player`, with its own private data and
launcher entry. The debug certificate, slot and SDK privacy settings match the
player lane. VK sees the probe's separate package; fill can depend on the
provider's app/slot configuration, so it is not an identical game-package test.
The probe has no game assets, Capacitor runtime, account access or reward grants.
Its bounded `vk_rewarded_minimal` observations go only to the existing HTTPS
telemetry receiver; the status also reports whether the terminal log was accepted.
For SDK code 1000 the probe also sends a fixed `networkFailure` category and,
when available, the HTTP status. The source SDK error text stays on the device.
It is a manual diagnostic only and must never enter the signed normal update lane.
The emulator smoke blocks the probe UID's IPv4/IPv6 traffic before tapping: it
checks launch, a bounded offline error and retry, without generating live ad views.
It also installs the real player APK alongside the probe, seeds a private game
marker, and checks the game and marker survive removing the probe. The game's
fixture download is pinned by SHA-256 and the game is not launched.
Actual ad playback still requires the owner's on-device check.

Install a new site-aware APK once; subsequent checks read only our HTTPS site:
`/downloads/android/{alpha|player}/latest.json`. It is a signed envelope
`{payload, signature}`: `payload` is the manifest (`versionCode`, `versionName`,
`apkUrl`, `notes`, `sha`, `apkSha256`, `appId`, `signerSha256`) and `signature` is
Ed25519 over those exact bytes, made only by the main publication job with the
`APK_MANIFEST_SIGNING_KEY` Environment secret in `android-release`. That environment
must allow only the selected Branch `main`; remove repository/org copies of the key.
Branch builds have read-only contents permission and produce APK candidates without
the private key or a signed release manifest. See [operator setup](../deploy/apk/README.md).
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
so rotating never reloads the WebView / drops game state; and keeps the WebView between
the system bars, not under them — `system-bars.mjs`: the packaged page loses
`viewport-fit=cover`, the strip behind the bars is black with light icons), then `node patch-updater.mjs`
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

## VK Rewarded SDK для основной игры

`patch-vk-rewarded.mjs` подключает `com.my.target:mytarget-sdk:5.52.5`, фиксирует
транзитивный MyTracker на `3.6.0`, его Billing Client на `9.1.0` и регистрирует
Capacitor-плагин `VkRewardedAds`.
Слот **2111707**, переданный владельцем, и место `main.supply` заданы в
`vk-rewarded.json`. Это подключение Android SDK, а не выдача сетевых наград.
Sector Zero и его платформенные возможности не меняются; фиатные покупки закрыты.

Патч вызывается локальной командой `brand`, сборкой APK в `android.yml` и профилями
RuStore, включая синтетическую сборку CI. Он сохраняет существующий апдейтер.
Сгенерированные Java/Gradle/HTML-файлы живут в `android/` и в Git не попадают.
SDK не инициализируется при запуске приложения (`com.my.target.autoInitMode=0`);
первый вызов `show` устанавливает отказ от персонализированного сбора, отключает
отслеживание окружения и местоположения, затем запускает SDK. Разрешение `AD_ID`
удаляется при слиянии манифестов, как и разрешения Google Billing / Install Referrer.
Эти транзитивные библиотеки не включают оплату или начисление наград. Разрешения итогового APK проверяет прежний
`verify-rustore.mjs`; эту проверку не расширяют ради SDK.

Проверка с телефона: в APK с VPS (`alpha` / `player`) на главном экране **«Домой»**,
над режимами, находится кнопка **«Проверить рекламу»** с подписью «Просмотр без игровой
награды». Она появляется только при наличии нативного моста. Загрузка начинается
после нажатия; рядом выводятся ожидание, завершение, отмена или причина отказа с кодом.
`VK-3003` означает отсутствие объявления, `VK-1002` — ошибку соединения,
`VK-1403`/`VK-1404` — отклонённый запрос; остальные ответы SDK сохраняют числовой код.
Коды `E_AD_*` различают ошибки моста, инициализации, состояния приложения, показа и
тайм-ауты загрузки/показа. Текст ошибок провайдера, URL и исключения в интерфейс не попадают.
На время показа повторное нажатие блокируется. Кнопка не вызывает выдачу наград,
не видна в браузере, на отдельной странице Sector Zero и в профиле RuStore.
Режим тестовых объявлений по-прежнему задаётся в кабинете VK, кнопка его не переключает.

Диагностика кнопки автоматически уходит на фиксированный HTTPS-приёмник
`mobile/distribution.json` → `/telemetry`, даже если выбран другой игровой сервер.
Токены аккаунта и сырые сообщения SDK не отправляются. В существующем
`playtest-logs/client-YYYY-MM-DD.jsonl` записи помечены `p.source=vk_rewarded_preview`
и `p.diagnostic=true`: ID попытки, этап, код, длительность, slot ID, версия SDK,
пакет приложения и версия APK. Запрос/отмена используют `rewarded_ad_offered` с
разными `phase`, успешный клиентский callback — `rewarded_ad_completed`, отказ —
`client_error`. Это диагностические наблюдения: их группируют по `requestId`/`phase`,
не считают обычными рекламными предложениями и не используют как квитанции награды.
Сток ограничен и повторяет недоставленный пакет один раз; сбой журналирования не
влияет на рекламу. С игровой телеметрией сохраняется одна идентичность страницы,
поэтому второй приёмник не создаёт дополнительные установки или визиты.

Расширенная диагностика на подключённом Android-устройстве через WebView DevTools:

```js
await window.VoidRewardedAds.status();
await window.VoidRewardedAds.show({
  placement: 'main.supply',
  requestId: 'diagnostic_2111707_test',
});
```

Первый вызов не загружает рекламу. Второй — ручной тестовый показ без начисления
игровой ценности: диагностический request ID не является серверным заказом.
Тестовый режим показов управляется кабинетом VK; на предоставленном владельцем
экране он включён. Реальные показы, доход или досмотр на физическом устройстве
автоматическими тестами не подтверждаются.

Результаты — `earned`, `cancelled`, `unavailable`. `earned` приходит только после
`onReward` и закрытия того же объявления, один раз. Повторные/устаревшие события,
параллельные запросы, загрузка в фоне, тайм-ауты и уничтожение Activity не создают
дополнительного результата. Ошибки SDK не передают внутренние сообщения в WebView.
Все ответы явно содержат `serverVerifiedRewards: false`: это наблюдение клиента,
а не квитанция и не команда начисления.

**Оставшийся блокер сетевых наград.** Публичная инструкция VK описывает
`RewardedAdListener.onReward`, но не описывает проверяемое сервером доказательство
просмотра. Необходимо получить у VK протокол и тестовый пример server-to-server
подтверждения для блока 2111707: способ проверки источника/подписи, уникальный ID
просмотра, привязку к непрозрачному ID нашего заказа и slot ID. Отсутствие такого
описания в проверенной инструкции не доказывает, что VK не предоставляет эту услугу.
Секрет проверки должен храниться на сервере, а не в APK.

До этого `CommerceProvider.verify` не заменяется доверием к клиентскому callback,
`rewarded_supply` остаётся недоступен, кнопка награды в сетевом магазине выключена.
Подтверждённый просмотр должен пройти существующие Commerce order → проверка
провайдера → durable outbox → Meta entitlement и дневной лимит аккаунта
([контракт](../docs/meta-economy.md#commerce-готовность-и-доверие)). SDK сам не
меняет баланс, материалы или состояние матча.

Проверки: установка патча дважды, сохранение апдейтера, Java-сценарии с тестовыми
двойниками Android/SDK, проверки JS-моста и сборка реального синтетического APK в CI.
Нативные тесты требуют Java с модулем `jdk.compiler`; платных или реальных показов
в тестах нет. Перед публикацией RuStore нужно обновить декларацию SDK и проверенную
политику по фактическому использованию рекламной сети.

Источники, проверенные 2026-11-17:
[инструкция Rewarded](https://ads.vk.ru/ru/help/partner/partner_integration/partner_android/partner_android_rewarded),
[приватность](https://ads.vk.ru/ru/help/partner/partner_integration/partner_android/partner_privacy_android),
[официальный пример](https://github.com/myTargetSDK/mytarget-android/blob/075e1fc03191a288d7465e7a3d36004485abc883/myTargetDemo/app/src/main/java/com/my/targetDemoApp/helpers/RewardedHelper.kt),
[Maven POM](https://repo.maven.apache.org/maven2/com/my/target/mytarget-sdk/5.52.5/mytarget-sdk-5.52.5.pom).

Перед нажатием на скачивание приложение повторно получает и проверяет подписанный манифест.
Это обновляет ссылки старых баннеров после удаления APK из ограниченного архива.
Загрузчик отдельно сообщает об ошибках DNS, TLS, тайм-ауте, устаревшей ссылке и запуске установки.
