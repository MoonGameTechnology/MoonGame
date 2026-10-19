# APK на собственном HTTPS-сервере

Общий источник настроек — `mobile/distribution.json`: точный HTTPS origin,
префикс `/downloads/android` и SHA-256 действующего sideload-сертификата. Ключ и
applicationId не меняются. Это playtest/debug-профили; RuStore остаётся отдельным
каналом. [Мобильный клиент](../../mobile/README.md), [политика версий](../../docs/versioning.md).

Текущий бесплатный hostname `77-221-140-87.sslip.io` привязан к IP VPS и запечён
в APK. Это осознанное ограничение текущего плейтеста без собственного домена:
при смене IP потребуется вручную установить миграционный APK с новым origin.
Перед переносом VPS сначала выпустить миграцию через ещё работающий старый адрес.
Для независимости от IP нужен постоянный hostname с управляемым проектом DNS.

## Контракт публикации

- `/{alpha|player}/latest.json`: versionCode, versionName, apkUrl, notes,
  sha, apkSha256, appId, signerSha256. Это публичные сведения, без credentials.
- `/{alpha|player}/latest.apk`: постоянная ссылка для кнопки и QR.
- `/{alpha|player}/VERSION-SHA/void-dominion-LANE.apk`: неизменяемый APK,
  на который указывает JSON. Оба стабильных пути переписываются на `current/`.
- Кнопка хаба и QR всегда ведут на **player/latest.apk**. Параметры ПК не берутся
  из произвольного ввода игрока. SVG генерируется локально из этой же ссылки.

`android.yml` собирает оба профиля, сохраняет прежний ключ, проверяет signer,
реальные appId/versionCode/versionName через apksigner/aapt и создаёт version.json.
Changelog — последние восемь commit subjects, ограниченные2048 символами.
GitHub хранит артефакты сборки; устройства скачивают только с VPS. Маркер старого
rolling release сохраняется, чтобы уже установленные старые APK могли получить
одну миграционную сборку. При недоступном GitHub эту сборку можно установить по
ссылке нашего сайта. Не удалять приложение для обычного обновления.

Host `publish.mjs` каждые5мин опрашивает только фиксированные GitHub release URLs.
HTTPS redirects ограничены GitHub/CDN allowlist, JSON≤64KiB/metadata≤16KiB,
APK≤128MiB, timeout90s на скачивание. До switch проверяются SHA-256, подпись
apksigner, package name и обе Android версии. APK не исполняется на сервере.
Неизвестные JSON-поля отбрасываются. Отказ источника/проверки сохраняет прежний current.
Новый versionCode обязан расти; повтор с другими байтами под тем же кодом запрещён.
Legacy release без version.json допускается только как unchanged для уже вручную
импортированного и проверенного current с теми же versionCode/SHA. Новую legacy
сборку timer из описания релиза не импортирует.

Сначала готовится случайный staging, затем immutable directory и атомарный symlink
`current`: JSON и стабильный APK переключаются вместе. Остатки staging после kill
удаляются следующим запуском. Сохраняются восемь сборок/лейн (до2GiB плюс staging),
свободное место до начала ≥12GiB+128MiB. Старый баннер может ссылаться на удалённую
старую сборку после восьми новых выпусков: повторная проверка получает свежую ссылку.
Не запускать два raw CLI процесса параллельно: сериализацию обеспечивает один
oneshot systemd unit; для ручной синхронизации использовать `systemctl start`.

## Установка на VPS

Нужны Node≥22, apksigner, aapt, публичный HTTPS Caddy и рабочий DNS/TLS.
Установить системного `moon-apk` без shell, home и Docker-группы. Root-owned код
скопировать физически в `/opt/moongame-ops/deploy/apk/`, а `apk-manifest.mjs`,
`apk-verify.mjs`, `distribution.json` — в `/opt/moongame-ops/mobile/`.

Стандартное размещение: `/var/lib/moongame-apk/public`, доступное moon-apk на запись.
Добавить readonly overlay `docker-compose.apk.yml` к Caddy. В существующий Game
HTTPS site вставить результат `apkIngress('/srv/moongame-apk')` из `ingress.mjs`.
Сохранять operator/privacy/match-creation policy и закрытый мониторинг. Под
штатным autoupdate.lock проверить candidate через `caddy validate`, затем reload.
У bind-mounted Caddyfile сохранять inode; не заменять его atomic rename.

На действующем VPS использован отдельный public-only подкаталог существующего
постоянного Caddy data volume, root file_server — `/data/moongame-apk`: Game/БД/
Caddy контейнеры для этого не пересоздавались. Отдать moon-apk только этот подкаталог.
Systemd root на этапе подготовки namespace монтирует его отдельным BindPaths в
`/var/lib/moongame-apk/public`; publisher работает непривилегированным и не получает
доступ к остальному Docker state, TLS keys или Docker socket. Пример drop-in:

```ini
[Service]
BindPaths=/ACTUAL/CADDY/DATA/moongame-apk:/var/lib/moongame-apk/public
```

ACTUAL путь берётся оператором из Docker mount inventory; он не является сетевым
параметром приложения. Для fresh-install с readonly overlay drop-in не нужен.

```bash
install -m 0644 /opt/moongame-ops/deploy/apk/moongame-apk-publish.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now moongame-apk-publish.timer
systemctl start moongame-apk-publish.service
```

Unit:384MiB/0.5CPU/64tasks,420s deadline, ProtectSystem/ProtectHome/no-new-privileges,
Docker socket закрыт. Java verifier ограничен128MiB heap. Состояние Game/readiness
отдельно; при отказе публикации нет рестартов, миграций БД или очистки данных игроков.

## Проверка

`pnpm run smoke:apk-site` после `pnpm run prototype`: реальные desktop dev/player
хабы, RU/EN, скачивание через кнопку, декодирование фактически отрисованного QR,
скрытие блока в телефоне/APK; новые/equal/старые/offline версии обоих APK-лейнов,
native browser handoff, text-only notes. Harness включён в CI. Это WebView-подобный
браузерный сценарий, не установка на физический Android.

Vitest проверяет malformed URLs/JSON/units, timeout, неверную подпись/identity,
atomic publication, failed download/digest/signature, orphan cleanup и отсутствие
отката current. Реальный VPS: оба APK прошли apksigner/aapt; JSON, stable и immutable
HTTPS downloads совпали по SHA-256, CORS/no-store/MIME/attachment корректны.
Unprivileged drill разместил настоящий player APK, отверг искусственно неверный
versionCode и сохранил current:2.27s,167MiB peak (точечный замер, не soak).

Установка поверх старой версии на физическом устройстве и подтверждение Android
требуют отдельного device smoke; в этой проверке они не эмулируются.
