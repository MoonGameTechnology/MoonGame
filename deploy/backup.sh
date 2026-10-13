#!/bin/bash
#
# Бэкап БД: снять завершённый дамп, зашифровать, опубликовать файл.
# bundle-v1 добавляет подпись; legacy сохраняет checksum и локальную ротацию.
#
# ПОЧЕМУ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ (SE-3.4). До него бэкапа в репозитории не было вообще —
# он жил в `deploy/README.md` одной строкой crontab:
#
#     docker compose exec -T postgres pg_dump -U void void | gzip > /backups/void-$(date +%F).sql.gz
#
# и ни один restore из него ни разу не проверялся. На учении 2026-09-09 (настоящий
# кластер, настоящая схема из `migrate()`, 26 таблиц) эта строка показала отказ,
# страшный именно своей тишиной:
#
#   КОД ВОЗВРАТА ТЕРЯЕТСЯ В КОНВЕЙЕРЕ. `pg_dump` к недоступной базе завершается
#   ошибкой, но код возврата ВСЕЙ строки — 0: последним в конвейере стоит успешный
#   `gzip`. На диске появляется корректный, читаемый gzip-файл в 20 байт. Крон
#   рапортует об успехе. Копить такие «бэкапы» можно месяцами, а узнать правду — в
#   день аварии, когда они единственное, что осталось.
#
# Отсюда две дисциплины, которые здесь важнее любого удобства:
#
#   1. НИКАКИХ КОНВЕЙЕРОВ ПОД КРИТИЧНЫМИ СТАДИЯМИ. Дамп, сжатие и шифрование идут
#      РАЗДЕЛЬНЫМИ шагами через временный каталог: код возврата каждого принадлежит
#      ровно ему и ловится `set -e`, а не растворяется в чужом успехе.
#   2. ИМЯ ФАЙЛА — ЭТО УТВЕРЖДЕНИЕ О ПРИГОДНОСТИ. Под итоговым именем файл появляется
#      после подготовки содержимого. В legacy каждый `mv` атомарен отдельно,
#      архив и sidecar не являются атомарной парой. bundle-v1 публикует один файл
#      эксклюзивным hardlink: прежний ID не заменяется.
#
# Полноту дампа проверяем по хвостовому маркеру `PostgreSQL database dump complete`,
# который `pg_dump` печатает ПОСЛЕДНИМ. Проверка не косметическая: обрыв дампа — тот
# отказ, от которого восстановление не защищено НИКАК. Обрезанный дамп не содержит
# ошибок: он успевает выполнить `DROP` всех таблиц и просто кончается, поэтому и
# `ON_ERROR_STOP=1`, и `--single-transaction` честно коммитят пустоту (проверено на том
# же учении: живая база из 26 таблиц осталась с 10, код возврата — 0). Здесь
# единственное место, где обрыв ещё ловится.
set -euo pipefail
umask 077

# Пути считаются ОТ САМОГО СКРИПТА — как в `update.sh`: файл репозитория, а клон может
# лежать где угодно (прод-хост, машина разработчика, CI).
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/server.env"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/void}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DB_NAME="${POSTGRES_DB:-void}"
DB_USER="${POSTGRES_USER:-void}"
FORMAT="${BACKUP_FORMAT:-legacy}"

# Bundle mode is explicit: existing Docker-only hosts do not necessarily have Node.
# Reject configuration before taking a plaintext dump or contacting PostgreSQL.
case "$FORMAT" in
  legacy) ;;
  bundle-v1)
    command -v node >/dev/null || { echo '[✗] E_BACKUP_CONFIG: bundle-v1 requires Node >=20.' >&2; exit 1; }
    command -v flock >/dev/null || { echo '[✗] E_BACKUP_CONFIG: bundle-v1 requires util-linux flock.' >&2; exit 1; }
    [ -n "${BACKUP_AGE_RECIPIENT:-}" ] || { echo '[✗] E_BACKUP_CONFIG: bundle-v1 requires BACKUP_AGE_RECIPIENT.' >&2; exit 1; }
    command -v age >/dev/null || { echo '[✗] E_BACKUP_CONFIG: age is required.' >&2; exit 1; }
    # Keep a known job ID even if publication succeeds but its final fsync fails.
    # A scheduler may persist/provide it; retry must not silently create a new ID.
    BACKUP_ID="${BACKUP_ID:-$(node --input-type=module -e 'import { randomUUID } from "node:crypto"; process.stdout.write(randomUUID())')}"
    export BACKUP_ID
    node "$DEPLOY_DIR/backup-bundle.mjs" check-seal >/dev/null
    echo "[*] Подписанный backupId=$BACKUP_ID"
    ;;
  *) echo '[✗] E_BACKUP_CONFIG: unknown BACKUP_FORMAT.' >&2; exit 1 ;;
esac

# Как ходим в Postgres. По умолчанию — ВНУТРЬ контейнера: на прод-хосте база живёт в
# compose, её порт опубликован только на loopback, клиентский `pg_dump` установщик на
# сам хост не ставит, да и версия клиента на хосте может разойтись с серверной.
# `DATABASE_URL` переключает на прямое подключение — так ходит учение
# (`backup.test.mjs`) и не-docker развёртывание.
dump_to() {
  # `--no-owner`/`--no-privileges`: восстанавливать дамп могут под другой ролью (учение,
  # dev-копия для разбора инцидента), а `ALTER … OWNER TO void` под чужой ролью — ошибка,
  # которая с `ON_ERROR_STOP=1` обрушит ВЕСЬ restore. `restore-acl.sql` восстанавливает
  # владельца/минимальные runtime-права в той же транзакции, что и данные.
  # `--clean --if-exists`: дамп самодостаточен и ложится поверх непустой базы — именно
  # это и нужно в аварии, когда восстанавливают ПОВЕРХ повреждённой.
  local args=(--clean --if-exists --no-owner --no-privileges)
  if [ -n "${DATABASE_URL:-}" ]; then
    pg_dump "${args[@]}" -d "$DATABASE_URL" > "$1"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE" exec -T postgres \
      pg_dump "${args[@]}" -U "$DB_USER" -d "$DB_NAME" > "$1"
  fi
}

# Имя базы для ЛОГА. В прямом режиме оно приходит из `DATABASE_URL`, а не из умолчания
# `POSTGRES_DB`: во время аварии сообщение «восстанавливаем базу void» при работе с другой
# базой — это дезинформация в худший возможный момент.
DB_LABEL="$DB_NAME"
if [ -n "${DATABASE_URL:-}" ]; then
  DB_LABEL="${DATABASE_URL%%\?*}"
  DB_LABEL="${DB_LABEL##*/}"
fi

STARTED=$SECONDS
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="void-$STAMP"
mkdir -p "$BACKUP_DIR"

WORK_PREFIX=".tmp-$STAMP"
if [ "$FORMAT" = bundle-v1 ]; then
  # GC takes an exclusive nonblocking lock; a running job makes it skip cleanup.
  # The stable lock inode must never be removed/replaced. Hold shared fd 9 through
  # dump/age/seal/EXIT cleanup; subprocesses inherit it, including after shell death.
  node "$DEPLOY_DIR/backup-bundle.mjs" cleanup "$BACKUP_DIR" >/dev/null
  exec 9<>"$BACKUP_DIR/.backup.lock"
  flock -s 9
  WORK_PREFIX=".bundle-job-$STAMP"
fi

# Временный каталог — В ТОМ ЖЕ разделе, что и цель: иначе финальный `mv` перестаёт быть
# атомарным (превращается в копирование между устройствами) и снова может оставить
# полуфайл под итоговым именем.
WORK="$(mktemp -d "$BACKUP_DIR/$WORK_PREFIX.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Legacy names also need to distinguish jobs started in the same second.
BASE="$BASE-${WORK##*.}"

echo "[*] Снимаем дамп базы «$DB_LABEL»..."
dump_to "$WORK/$BASE.sql"

if ! tail -c 200 "$WORK/$BASE.sql" | grep -q 'PostgreSQL database dump complete'; then
  echo "[✗] Дамп ОБОРВАН: нет хвостового маркера. Бэкап НЕ создан." >&2
  exit 1
fi
echo "[✓] Дамп полный: $(wc -c < "$WORK/$BASE.sql") байт"

gzip -9 "$WORK/$BASE.sql"
ARTIFACT="$BASE.sql.gz"

# Шифрование (SE-3.4). Дамп несёт таблицу `users` с `pass_hash` и почтой для
# восстановления доступа — то есть выносить его на хранение открытым нельзя.
# Получатель задаётся ПУБЛИЧНЫМ ключом age: на бэкап-хосте лежит только он, приватный
# там не нужен, поэтому захват хоста не раскрывает архив.
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || { echo "[✗] BACKUP_AGE_RECIPIENT задан, а age не установлен (apt install age)." >&2; exit 1; }
  age -r "$BACKUP_AGE_RECIPIENT" -o "$WORK/$ARTIFACT.age" "$WORK/$ARTIFACT"
  rm -f "$WORK/$ARTIFACT"
  ARTIFACT="$ARTIFACT.age"
  echo "[✓] Зашифровано для $BACKUP_AGE_RECIPIENT"
elif [ "${BACKUP_PLAINTEXT:-0}" != "1" ]; then
  # Fail-secure (инвариант 4): по умолчанию отказ, а не тихая выдача открытых данных.
  echo "[✗] Шифрование не настроено. Задай BACKUP_AGE_RECIPIENT=<age1...>," >&2
  echo "    либо осознанно разреши открытый бэкап через BACKUP_PLAINTEXT=1." >&2
  exit 1
fi

if [ "$FORMAT" = bundle-v1 ]; then
  # One authenticated file is the publication unit. The helper never replaces a
  # previous ID. Local legacy rotation must never become repository retention.
  node "$DEPLOY_DIR/backup-bundle.mjs" seal "$WORK/$ARTIFACT" "$BACKUP_DIR"
  echo "[✓] Подписанный комплект готов за $((SECONDS - STARTED)) с."
  exit 0
fi

# Legacy: checksum ловит порчу до касания базы, но не доказывает происхождение.
( cd "$WORK" && sha256sum "$ARTIFACT" > "$ARTIFACT.sha256" )

mv "$WORK/$ARTIFACT" "$WORK/$ARTIFACT.sha256" "$BACKUP_DIR/"
echo "[✓] Готово за $((SECONDS - STARTED)) с: $BACKUP_DIR/$ARTIFACT ($(wc -c < "$BACKUP_DIR/$ARTIFACT") байт)"

# Ротация. Джоб без неё однажды забивает раздел — то есть сам устраивает аварию, ради
# которой заводился. Удаляем парами «архив + сумма», чтобы не копить сироты-суммы.
if [ "$KEEP_DAYS" -gt 0 ]; then
  removed=$(find "$BACKUP_DIR" -maxdepth 1 -name 'void-*.sql.gz*' -mtime "+$KEEP_DAYS" -print -delete | wc -l)
  [ "$removed" -gt 0 ] && echo "[*] Ротация: удалено файлов старше $KEEP_DAYS дней — $removed"
fi
exit 0
