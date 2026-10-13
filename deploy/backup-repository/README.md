# S3-доставка подписанных бэкапов — SE-3.5

`s3.mjs` загружает подписанный `.vdbak` и получает конкретную версию объекта для
восстановления. Это отдельный backup/restore worker: у игрового сервера нет
зависимости от его процесса или доступности S3. SDK выделен в workspace-пакет
`@void/backup-repository` и исключён из production-зависимостей игрового Docker-образа.

Внешний bucket, IAM, Object Lock, расписание, независимый журнал receipts и
мониторинг оператор разворачивает отдельно. Наличие transport receipt подтверждает
ответ хранилища о доставке; восстановимость БД подтверждается restore-учением.
Полный план — [SE-3.5](../../docs/secure-environment-roadmap.md).

## Требования

- Отдельный checkout на backup/restore worker; Node >=20, pnpm 10.33.0,
  util-linux `flock`, локальная Linux FS. Для получения файла work/output должны
  находиться на одном разделе: публикация использует эксклюзивный hardlink.
- Существующий S3 endpoint по HTTPS, правильный region, bucket с versioning.
  Требуются conditional `PutObject` (`If-None-Match: *`), SHA-256 checksum в PUT
  и ответе, ненулевой version ID, `GetObject` с явно заданным version ID.
  Несовместимый endpoint не получает fallback в HTTP, multipart или «latest».
- Внешний доверенный Ed25519 public key и независимо выбранные domain/producer/ID.
  Подробности формата — [подписанный комплект v1](../README.md#подписанный-комплект-v1).
- S3 credentials выдаются только соответствующему worker через стандартную цепочку
  credentials AWS SDK (например, environment или отдельный workload/profile).
  Конфигурация credentials и её process/SSO providers должны быть доверенными.
  Не помещайте их в игровой `server.env` или образ игры.

Установка **в отдельном checkout worker**, без игровых runtime-зависимостей:

```bash
pnpm --filter @void/backup-repository install --prod --frozen-lockfile --ignore-scripts
```

## Контракт и границы

Ключ объекта вычисляется из ожидаемой identity, а не принимается произвольным путём:
`backups/v1/<domain>/<producer>/<backupId>.vdbak`. Один архив — максимум **5 ГиБ**;
multipart пока не поддерживается. Исходный файл должен быть regular file без symlink.

Перед PUT файл копируется в закрытый workspace и проверяется существующим
`prepareBundle`: подпись, identity, ciphertext digest/длина. SDK отправляет именно
этот снимок, а не повторно открытый исходник. PUT содержит checksum всего `.vdbak`
и `If-None-Match: *`. Успех требует version ID, отличный от `null`, и совпавший
checksum в ответе. Исходник после передачи сохраняется.

GET использует только version ID из доверенного receipt. Endpoint, bucket, region,
ключ и identity receipt должны совпасть с независимо заданной конфигурацией.
Размер скачивания ограничен receipt; лишние байты отвергаются до записи на диск.
Проверяются полный digest и Ed25519-подпись; файл публикуется только после проверки,
с fsync и без перезаписи существующего файла. Команда `get` не расшифровывает архив
и не обращается к БД. Приватный age-key нужен только отдельному restore job.

TLS проверяет CA и hostname, минимум TLS 1.2. `NODE_TLS_REJECT_UNAUTHORIZED=0`
проверку не отключает. Редиректы и автоматические retries отключены.
`BACKUP_S3_TIMEOUT_MS` ограничивает сетевую операцию, включая чтение тела GET;
умолчание — 300000 мс, допустимы 1…1800000. Разрешение credentials зависит от
выбранного provider и его собственных таймаутов.

Рабочие каталоги — `0700`, файлы — `0600`; родители и локальный пользователь
должны быть доверенными. Проверка может временно занять около двух размеров
архива в workspace; исходный архив хранится отдельно. Задайте дисковую квоту и
предел параллельных jobs. `withBackupWorkspace` использует существующий
`.backup.lock`/shared `flock`: активные задания защищены, после SIGKILL следующий
запуск в свободном каталоге убирает остатки. Lock inode нельзя удалять/заменять.
Уборка не заменяет retention готовых копий.

## Загрузка

Сначала создайте комплект через `backup.sh` с `BACKUP_FORMAT=bundle-v1` и сохраните
`BACKUP_ID` в журнале задания до dump. Для передачи задайте:

```bash
export BACKUP_S3_ENDPOINT=https://s3.example.net
export BACKUP_S3_REGION=us-east-1
export BACKUP_S3_BUCKET=void-backups
export BACKUP_VERIFY_KEY=/secure/backup-verify.pem
export BACKUP_EXPECT_DOMAIN=game
export BACKUP_EXPECT_PRODUCER=nightly-game
export BACKUP_EXPECT_ID="$BACKUP_ID"
# При собственной CA: regular PEM-файл, максимум 1 МиБ.
# export BACKUP_S3_CA=/secure/repository-ca.pem

node deploy/backup-repository/s3.mjs put \
  "$BACKUP_DIR/void-$BACKUP_EXPECT_ID.vdbak" /var/lib/void-backup/work
```

Успешный stdout — JSON receipt с полями `version: 1`,
`type: "void.backup.s3-receipt"`, `endpoint`, `region`, `bucket`, `key`,
`domain`, `producer`, `backupId`, `versionId`, `bytes`, `sha256`.
Digest относится ко всему `.vdbak`, включая подписанный header.
Receipt не подписывается отдельно: job journal должен надёжно сохранить его
**вне игрового хоста**, с собственными правами и подтверждением записи.
CLI сам такой журнал не создаёт. Не удаляйте локальную копию на основании одного
stdout или успешного PUT без сохранённого receipt и принятой retention/restore policy.

## Получение и восстановление

На отдельном restore worker используйте read-role, доверенный receipt и независимо
подтверждённые переменные выше. Receipt ограничен 16 КиБ; данные из объекта/имени
файла не должны автоматически назначать ожидаемую identity.

```bash
node deploy/backup-repository/s3.mjs get \
  "/secure/receipts/$BACKUP_EXPECT_ID.json" \
  /var/lib/void-recovery/work /var/lib/void-recovery/downloads
```

Результат — receipt с дополнительным `path`; файл называется
`void-<backupId>.vdbak`. Затем отдельный авторизованный restore job получает age-key
и восстанавливает **выбранную тестовую/восстановительную БД**:

```bash
export BACKUP_REQUIRE_SIGNED=1
export BACKUP_AGE_IDENTITY=/run/restore-secrets/age.key
# DATABASE_URL заранее указывает на отдельную recovery БД.
bash deploy/restore.sh "/var/lib/void-recovery/downloads/void-$BACKUP_EXPECT_ID.vdbak"
```

Ни один пример не меняет bucket policy, retention или работающую игровую БД.

## Отказы и неизвестный результат

| Код | Действие |
| --- | --- |
| `E_BACKUP_REMOTE_UNKNOWN` | PUT мог сохраниться, даже если ответ потерян или не подтверждает версию/checksum. Сохранить исходник и прежний ID; не повторять задание под новым ID автоматически. |
| `E_BACKUP_REMOTE_EXISTS` | S3 вернул 412. Это не подтверждение пригодности уже существующего объекта. |
| `E_BACKUP_RECEIPT` | Receipt некорректен либо не совпал с ожидаемой конфигурацией; сеть не используется. |
| `E_BACKUP_REMOTE_FAILED` | GET/таймаут/доступ не завершились; готовый локальный файл не опубликован. |
| `E_BACKUP_REMOTE_INVALID` | Ответ/версия/длина/digest не совпали; файл не опубликован. |
| `E_BACKUP_COMMIT_UNKNOWN` | Локальный файл после GET уже появился, но fsync каталога не подтверждён; проверить существующий файл по прежним identity/ID. |

Коды подписи/identity/формата наследуются от bundle helper. Повторная передача —
явное решение оператора после сверки. При потерянном version ID отдельная recovery
роль может получить временное право `ListBucketVersions` для точного prefix,
выбрать версию и сверить её байты/подпись с сохранённым локальным комплектом.
Не назначайте «последнюю версию» пригодной автоматически и не расширяйте writer-role
до чтения/удаления ради обработки ошибки.

## Приёмка выбранного провайдера — ещё обязательна

Минимальные права: writer — `s3:PutObject` в своём domain/producer prefix;
restore reader — `s3:GetObjectVersion` в разрешённом prefix. Для SSE-KMS нужны
соответствующие отдельные KMS-права. Writer не получает чтение, удаление объектов/
версий, изменение retention/legal hold, bypass governance, bucket policy,
versioning или lifecycle. Требование conditional PUT должно обеспечиваться и
политикой хранилища; клиентская настройка не ограничивает украденные credentials.

До production проверить на синтетических объектах реального bucket:

1. Versioning и выбранный Object Lock/default retention действуют; writer не
   может их отключить, сократить или обойти.
2. Повторный conditional PUT не заменяет объект, старая версия читается; writer
   не удаляет объект, version или историю. Reader не записывает/не удаляет.
3. Неверные TLS CA/hostname/credentials отклоняются, потеря PUT-ответа разбирается
   по прежнему ID; receipt переживает потерю игрового хоста.
4. Из независимой среды выполняется настоящее восстановление, сверяются данные,
   ACL/pins, возраст копии и RPO/RTO.

В этой среде проверены настоящий AWS SDK, HTTPS/TLS и S3 wire fixture,
SIGKILL/таймауты/подмена, а также полный круг PostgreSQL + age + `.vdbak` + HTTPS
после удаления локального архива и тестовой БД. Это не сертификация совместимости
провайдера или его IAM/Object Lock: реальный bucket/credentials не подключены,
два официальных реестра образов MinIO отказали в доступе.
`s3.test.mjs` и `s3-https.test.mjs` входят в общий gate; криптографическое PG-учение
запускается при наличии `DATABASE_URL` и настоящего age. Остальные HTTPS-тесты
работают и в CI без age; OpenSSL нужен для временных тестовых сертификатов.
