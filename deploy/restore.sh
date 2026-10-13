#!/bin/bash
#
# Восстановление БД из бэкапа, снятого `backup.sh`.
#
# Использование: deploy/restore.sh /var/backups/void/void-20260909T040000Z.sql.gz.age
#
# ПОЧЕМУ ПРОВЕРОК ТРИ И НИ ОДНА НЕ ЛИШНЯЯ (SE-3.4). Учение 2026-09-09 прогнало через
# настоящий кластер тот способ восстановления, что был описан в `README.md` —
# `gunzip -c bak.sql.gz | psql -U void void`, — и он на битом архиве РАЗРУШАЕТ базу,
# рапортуя об успехе:
#
#   • обрезанный дамп подали в живую базу из 26 таблиц → код возврата 0, осталось 10;
#   • дамп поверх непустой базы → код возврата 0 при 95 строках ERROR в логе.
#
# Три проверки закрывают три РАЗНЫХ отказа, и ни одна не подменяет соседнюю:
#
#   1. КОНТРОЛЬНАЯ СУММА — порча файла в хранилище. Ловится до касания базы.
#   2. ХВОСТОВОЙ МАРКЕР — обрыв дампа при снятии. Сумма его НЕ поймает: у обрезанного
#      файла своя честная сумма, если он обрезался до подсчёта. А `psql` его не
#      поймает тем более: обрезанный дамп не содержит ОШИБОК — он выполняет `DROP`
#      всех таблиц и просто кончается, поэтому и `ON_ERROR_STOP=1`, и
#      `--single-transaction` добросовестно коммитят пустоту. Проверено.
#   3. `--single-transaction` + `ON_ERROR_STOP=1` — ошибка ВО ВРЕМЯ применения. Дамп
#      цел, но не лёг (конфликт версий, нехватка прав): база откатывается целиком, а
#      не остаётся наполовину восстановленной. Первые две проверки этот случай не
#      видят: файл-то в порядке.
set -euo pipefail
umask 077

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$DEPLOY_DIR/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/server.env"

DB_NAME="${POSTGRES_DB:-void}"
DB_USER="${POSTGRES_USER:-void}"

ARCHIVE="${1:-}"
[ -n "$ARCHIVE" ] || { echo "Использование: $0 <файл-бэкапа>" >&2; exit 2; }
[ -f "$ARCHIVE" ] || { echo "[✗] Нет такого файла: $ARCHIVE" >&2; exit 2; }

case "${BACKUP_REQUIRE_SIGNED:-0}" in
  0|1) ;;
  *) echo '[✗] E_BACKUP_CONFIG: BACKUP_REQUIRE_SIGNED must be 0 or 1.' >&2; exit 1 ;;
esac

# Имя базы для ЛОГА. В прямом режиме оно приходит из `DATABASE_URL`, а не из умолчания
# `POSTGRES_DB`: во время аварии сообщение «восстанавливаем базу void» при работе с другой
# базой — это дезинформация в худший возможный момент.
DB_LABEL="$DB_NAME"
if [ -n "${DATABASE_URL:-}" ]; then
  DB_LABEL="${DATABASE_URL%%\?*}"
  DB_LABEL="${DB_LABEL##*/}"
fi

STARTED=$SECONDS
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---- 1. authenticate a bundle, or explicitly use the legacy checksum path ----
SRC="$ARCHIVE"
if [[ "$ARCHIVE" == *.vdbak ]] || [ "${BACKUP_REQUIRE_SIGNED:-0}" = 1 ] || [ -n "${BACKUP_VERIFY_KEY:-}" ]; then
  command -v node >/dev/null || { echo '[✗] E_BACKUP_CONFIG: signed restore requires Node >=20.' >&2; exit 1; }
  # The helper checks externally selected identity/ID and copies the verified
  # ciphertext to private WORK. Decryption never reopens the untrusted bundle.
  node "$DEPLOY_DIR/backup-bundle.mjs" prepare "$ARCHIVE" "$WORK/verified"
  SRC="$WORK/verified/archive.sql.gz.age"
elif [ -f "$ARCHIVE.sha256" ]; then
  # Verify THIS archive. sha256sum -c follows the filename inside the sidecar and
  # could validate an unrelated file while restore reads a damaged archive.
  CHECKSUM_LINE=''
  if [ "$(wc -c < "$ARCHIVE.sha256")" -gt 4096 ] ||
     [ "$(wc -l < "$ARCHIVE.sha256")" -ne 1 ] ||
     ! IFS= read -r CHECKSUM_LINE < "$ARCHIVE.sha256" ||
     [[ ! "$CHECKSUM_LINE" =~ ^([a-fA-F0-9]{64})[[:space:]][[:space:]](.+)$ ]]; then
    echo '[✗] Контрольная сумма НЕ СОВПАЛА — некорректный sidecar.' >&2; exit 1
  fi
  EXPECTED="${BASH_REMATCH[1],,}"
  CHECKSUM_NAME="${BASH_REMATCH[2]}"
  ACTUAL="$(sha256sum -- "$ARCHIVE")"
  if [ "$CHECKSUM_NAME" != "$(basename "$ARCHIVE")" ] || [ "$EXPECTED" != "${ACTUAL:0:64}" ]; then
    echo '[✗] Контрольная сумма НЕ СОВПАЛА — архив повреждён. База не тронута.' >&2; exit 1
  fi
  echo "[✓] Контрольная сумма совпала"
elif [ "${VOID_RESTORE_UNVERIFIED:-0}" = "1" ]; then
  echo "[!] Суммы рядом нет, продолжаем по VOID_RESTORE_UNVERIFIED=1 — целостность НЕ проверена."
else
  echo "[✗] Рядом нет $ARCHIVE.sha256 — целостность недоказуема." >&2
  echo "    Осознанно продолжить: VOID_RESTORE_UNVERIFIED=1 $0 $ARCHIVE" >&2
  exit 1
fi

# ---- расшифровка + распаковка ----
if [ "${SRC%.age}" != "$SRC" ]; then
  : "${BACKUP_AGE_IDENTITY:?[✗] Архив зашифрован — укажи BACKUP_AGE_IDENTITY=<файл с приватным ключом>}"
  command -v age >/dev/null || { echo "[✗] age не установлен (apt install age)." >&2; exit 1; }
  age -d -i "$BACKUP_AGE_IDENTITY" -o "$WORK/dump.sql.gz" "$SRC"
  SRC="$WORK/dump.sql.gz"
  echo "[✓] Расшифровано"
fi
# Invalidate any destination-only marker in the same SQL transaction. Prefix while
# decompressing: making a second uncompressed copy can exhaust a recovery disk.
cat "$DEPLOY_DIR/restore-marker.sql" > "$WORK/dump.sql"
gunzip -c "$SRC" >> "$WORK/dump.sql"

# ---- 2. полнота дампа ----
if ! tail -c 200 "$WORK/dump.sql" | grep -q 'PostgreSQL database dump complete'; then
  echo "[✗] Дамп ОБОРВАН: нет хвостового маркера — восстанавливать нечего." >&2
  echo "    База НЕ тронута (именно здесь наивный путь её и уничтожает)." >&2
  exit 1
fi
echo "[✓] Дамп полный"

# ACLs were intentionally omitted by pg_dump. Restore the dedicated runtime grants
# atomically with the data; an absent/unsafe role aborts the entire transaction.
cat "$DEPLOY_DIR/restore-acl.sql" >> "$WORK/dump.sql"

# ---- 3. применение одной транзакцией ----
echo "[*] Восстанавливаем базу «$DB_LABEL»..."
if [ -n "${DATABASE_URL:-}" ]; then
  psql --single-transaction -v ON_ERROR_STOP=1 -q -d "$DATABASE_URL" -f "$WORK/dump.sql" >/dev/null
else
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE" exec -T postgres \
    psql --single-transaction -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DB_NAME" < "$WORK/dump.sql" >/dev/null
fi

# Время восстановления — это и есть измеренный RTO по базе (без учёта времени на
# осознание аварии и подъём стека). Печатаем всегда: цифру, которой нет, в план
# аварийного восстановления не впишешь.
echo "[✓] Восстановлено за $((SECONDS - STARTED)) с — RTO по базе"
exit 0
