#!/bin/bash
#
# Агент автообновления прода (ZTP-1.2, журнал — ZTP-1.3).
#
# Раз в 5 минут его зовёт `moongame-autoupdate.timer` (ставит install-autodeploy.sh). Он
# смотрит, на какой дайджест сейчас указывает `ghcr.io/moongametechnology/moongame:main`,
# и если это новая сборка — проверяет подпись, достаёт из образа его же `deploy/`,
# выкатывает через `update.sh` из этой новой версии (там проверка здоровья и откат) и
# только после успеха атомарно делает её текущей. Человек в цепочке не нужен: merge в
# `main` → image.yml собрал и подписал → агент забрал в окно выкатки.
#
#   autoupdate.sh               — обычный прогон по таймеру
#   autoupdate.sh --now         — сейчас, мимо окна и выключателя (`moongame update`)
#   autoupdate.sh --bootstrap   — первый перевод хоста (зовёт install-autodeploy.sh)
#
# ПОЧЕМУ PULL, А НЕ PUSH ИЗ CI. У GitHub нет ключа от прода, SSH наружу не открыт, а хост
# может стоять за домашним NAT (решение ADEP в playtest-hardening-roadmap.md).
#
# ПОЧЕМУ `deploy/` ЕДЕТ ВНУТРИ ОБРАЗА. Подписанный путь `update.sh` намеренно не трогает
# git-клон, поэтому без этого агент, юниты и сам `update.sh` навсегда остались бы на хосте
# в версии установки, и любая их починка не доезжала бы без входа на машину (та же
# болезнь, от которой OPS-1 лечил `update-dev.sh`). Здесь канал доверия один: подпись
# образа удостоверяет и сервер, и скрипты, которыми его выкатывают. Подпись же не говорит,
# что скрипты РАБОТАЮТ, поэтому новая версия кладётся рядом с текущей, выкатка идёт из
# неё, а текущей она становится только после проверки здоровья. Откат возвращает и
# образ, и прежний `deploy/`.
#
# ЧЕГО АГЕНТ НЕ ДЕЛАЕТ НИКОГДА:
#   - не катит без точки отката (первый перевод — только руками, `--bootstrap`);
#   - не катит повторно дайджест, на котором уже случился откат;
#   - не трогает systemd-юниты: они принадлежат root, а агент работает от сервисной
#     учётки. Юниты статичны и читают текущую версию по ссылке `$STATE_DIR/current`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${STATE_DIR:-/var/lib/moongame}"

ENV_FILE="$STATE_DIR/server.env"
LAST_GOOD="$STATE_DIR/last-good-image"
FAILED="$STATE_DIR/failed-images"
HISTORY="$STATE_DIR/deploy-history"
RELEASES="$STATE_DIR/releases"
CURRENT="$STATE_DIR/current"
HEALTH_PORT="${PORT:-8788}"

# Файлы, без которых версия `deploy/` не способна ни выкатить себя, ни подняться после
# ребута. Образ без них (собранный до автодеплоя) агент не катит: иначе следующий прогон
# таймера искал бы себя в каталоге, где его нет.
REQUIRED_FILES="autoupdate.sh update.sh stack.sh moongame.sh verify-image.sh env-keys.sh docker-compose.yml docker-compose.release.yml"

MODE=timer
case "${1:-}" in
  "") ;;
  --now) MODE=now ;;
  --bootstrap) MODE=bootstrap ;;
  *)
    echo "usage: $0 [--now|--bootstrap]" >&2
    exit 2
    ;;
esac

log() { echo "autodeploy: $*"; }

# Значение ключа из server.env. Файл — ДАННЫЕ, а не скрипт: `source` исполнил бы любую
# строку, которую туда кто-то дописал, поэтому читаем ровно одну строку по имени.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  local line
  line="$(grep -m1 -E "^$1=" "$ENV_FILE" || true)"
  printf '%s' "${line#*=}"
}

# Чей образ катить. Переопределение (свой реестр или тег: стенд, форк) лежит в server.env
# рядом с окном, а не в юните: таймер и `moongame update` читают одно место и не могут
# смотреть в разные реестры. Переменная окружения сильнее файла (тесты, разовый прогон).
IMAGE_REPO="${VOID_IMAGE_REPO:-$(env_value VOID_IMAGE_REPO)}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/moongametechnology/moongame}"
TRACK_TAG="${VOID_TRACK_TAG:-$(env_value VOID_TRACK_TAG)}"
TRACK_TAG="${TRACK_TAG:-main}"

short() {
  # Короткое имя дайджеста для журнала и каталога версии: первые 12 знаков.
  [ -n "$1" ] || {
    printf 'none'
    return 0
  }
  local digest="${1##*@sha256:}"
  printf '%s' "${digest:0:12}"
}

# ---- окно выкатки ----
# AUTODEPLOY_WINDOW=ЧЧ:ММ-ЧЧ:ММ по часам хоста; окно может переходить через полночь
# (23:00-02:00). Пусто — катить сразу. Выкатка сейчас рвёт WebSocket'ы игроков (drain
# OPS-1.1 ещё не сделан), поэтому окно и есть защита вечерней партии.
to_minutes() {
  local hh="${1%%:*}" mm="${1##*:}"
  printf '%d' $((10#$hh * 60 + 10#$mm))
}

in_window() {
  local window="$1" now="$2"
  [ -n "$window" ] || return 0
  if ! [[ "$window" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
    # Опечатка в окне не должна превращаться в «катить когда угодно» — то есть в рестарт
    # посреди вечерней партии. Не катим и говорим об этом на каждом прогоне.
    log "AUTODEPLOY_WINDOW='$window' не в формате ЧЧ:ММ-ЧЧ:ММ — выкатка остановлена до исправления"
    return 1
  fi
  local start end cur
  start="$(to_minutes "${window%-*}")"
  end="$(to_minutes "${window#*-}")"
  cur="$(to_minutes "$now")"
  if [ "$start" -eq "$end" ]; then return 0; fi
  if [ "$start" -lt "$end" ]; then
    [ "$cur" -ge "$start" ] && [ "$cur" -lt "$end" ]
  else
    [ "$cur" -ge "$start" ] || [ "$cur" -lt "$end" ]
  fi
}

# ---- журнал (ZTP-1.3) ----
# Строка в journald (вывод юнита) и строка в файле рядом с точкой отката — `moongame
# history` читает его. Снаружи видна только текущая версия (/health); полная история
# живёт на хосте.
record() {
  local from="$1" to="$2" outcome="$3" version="${4:-}"
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $MODE $(short "$from") -> $(short "$to") $outcome${version:+ version=$version}"
  log "deploy: $(short "$from") → $(short "$to") $outcome${version:+ (сборка $version)}"
  printf '%s\n' "$line" >> "$HISTORY"
}

running_version() {
  # Что сервер сам говорит о своей сборке (ZTP-1.1). Пусто — образ старше версии на /health.
  local body
  body="$(curl -fsS --max-time 3 "http://127.0.0.1:${HEALTH_PORT}/health" 2>/dev/null || true)"
  if [[ "$body" =~ \"version\":\"([0-9a-f]{7,40})\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# ---- реестр ----
# Пакет GHCR может быть приватным: тогда install-autodeploy.sh кладёт токен на чтение в
# `$STATE_DIR/registry.env` (0600) и логинит docker под DOCKER_CONFIG юнита. Проверке
# подписи креды нужны ФЛАГАМИ (так устроен verify-image.sh), поэтому читаем их здесь.
load_registry_creds() {
  local file="$STATE_DIR/registry.env" user token
  [ -f "$file" ] || return 0
  user="$(grep -m1 -E '^VOID_REGISTRY_USER=' "$file" | cut -d= -f2- || true)"
  token="$(grep -m1 -E '^VOID_REGISTRY_TOKEN=' "$file" | cut -d= -f2- || true)"
  if [ -n "$user" ] && [ -n "$token" ]; then
    export VOID_REGISTRY_USER="$user" VOID_REGISTRY_TOKEN="$token"
  fi
}

resolve_ref() {
  # Дайджест, на который СЕЙЧАС указывает тег. Без скачивания байтов: только манифест.
  local digest
  digest="$(docker buildx imagetools inspect "$IMAGE_REPO:$TRACK_TAG" --format '{{.Manifest.Digest}}')" || return 1
  digest="$(printf '%s' "$digest" | tr -d '[:space:]')"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    log "реестр вернул не дайджест: '$digest'"
    return 1
  }
  printf '%s@%s' "$IMAGE_REPO" "$digest"
}

# Достать `deploy/` из образа в каталог версии. Образ НЕ запускается: `docker create`
# только заводит контейнер, `docker cp` копирует файлы, и контейнер сразу удаляется.
extract_release() {
  local ref="$1" dest="$2" cid
  rm -rf "$dest.tmp"
  mkdir -p "$dest.tmp"
  cid="$(docker create "$ref")"
  if ! docker cp "$cid:/app/deploy" "$dest.tmp/deploy" >/dev/null; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
    rm -rf "$dest.tmp"
    log "в образе нет /app/deploy"
    return 1
  fi
  docker rm -f "$cid" >/dev/null 2>&1 || true
  local f
  for f in $REQUIRED_FILES; do
    if [ ! -f "$dest.tmp/deploy/$f" ]; then
      rm -rf "$dest.tmp"
      log "в deploy/ образа нет $f — образ собран до автодеплоя, не катим"
      return 1
    fi
  done
  # Сертификаты — состояние машины, а не версии: compose монтирует ./certs из каталога
  # версии, и он обязан смотреть в постоянный каталог.
  rm -rf "$dest.tmp/deploy/certs"
  ln -s "$STATE_DIR/certs" "$dest.tmp/deploy/certs"
  rm -rf "$dest"
  mv "$dest.tmp" "$dest"
}

# Сделать версию текущей. `mv -T` поверх ссылки атомарен: юнит, стартующий в этот момент,
# видит либо старую версию, либо новую, но никогда — отсутствие ссылки.
make_current() {
  ln -sfn "$1" "$CURRENT.tmp"
  mv -Tf "$CURRENT.tmp" "$CURRENT"
}

# Хранить две версии: текущую и предыдущую (на неё откатываются). Остальные — мусор.
prune_releases() {
  local keep_a="$1" keep_b="$2" dir name
  for dir in "$RELEASES"/*; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    [ "$name" = "$keep_a" ] || [ "$name" = "$keep_b" ] && continue
    rm -rf "$dir"
  done
}

# ---------------------------------------------------------------------------------------

mkdir -p "$RELEASES"
touch "$FAILED" "$HISTORY"

# Два прогона одновременно (таймер и ручной `moongame update`) подрались бы за compose.
exec 9>"$STATE_DIR/autoupdate.lock"
if ! flock -n 9; then
  log "уже идёт другая выкатка — пропускаю этот прогон"
  exit 0
fi

if [ "$MODE" = timer ] && [ "$(env_value AUTODEPLOY)" = "0" ]; then
  exit 0
fi

PREV="$(cat "$LAST_GOOD" 2>/dev/null || true)"
if [ -z "$PREV" ] && [ "$MODE" != bootstrap ]; then
  # update.sh пишет точку отката только после удачного подъёма; без неё сломанной сборке
  # некуда было бы откатиться. Первый перевод хоста делает человек, глядя на результат.
  log "нет точки отката ($LAST_GOOD пуст) — не катим. Переведите хост: deploy/install-autodeploy.sh"
  exit 0
fi

if [ "$MODE" = timer ] && ! in_window "$(env_value AUTODEPLOY_WINDOW)" "$(date +%H:%M)"; then
  exit 0
fi

load_registry_creds
if ! REF="$(resolve_ref)"; then
  log "не удалось узнать дайджест $IMAGE_REPO:$TRACK_TAG — реестр недоступен или нет доступа"
  exit 1
fi

if [ "$REF" = "$PREV" ] && [ -e "$CURRENT" ]; then
  [ "$MODE" = timer ] || log "уже на $(short "$REF") — нового нет"
  exit 0
fi

if [ "$MODE" = timer ] && grep -qxF "$REF" "$FAILED"; then
  # Повторять бессмысленно: те же байты поведут себя так же, а каждый заход — рестарт
  # сервера на глазах у игроков. Следующий merge даст новый дайджест.
  exit 0
fi

# Гейт: подпись проверяет ТЕКУЩАЯ версия скриптов (на первом переводе — git-клон), а не
# та, что лежит в непроверенном образе. Иначе образ проверял бы сам себя.
log "новая сборка $(short "$REF") — проверяем подпись"
if ! "$HERE/verify-image.sh" "$REF"; then
  # В журнал — один раз на дайджест: следующий прогон попробует снова (сбой Rekor или
  # реестра проходит сам), и строка каждые 5 минут утопила бы историю.
  grep -qF " -> $(short "$REF") signature-rejected" "$HISTORY" || record "$PREV" "$REF" signature-rejected
  exit 1
fi

docker pull "$REF" >/dev/null
NEW_ID="$(short "$REF")"
NEW_DIR="$RELEASES/$NEW_ID"
if ! extract_release "$REF" "$NEW_DIR"; then
  record "$PREV" "$REF" refused-no-deploy
  printf '%s\n' "$REF" >> "$FAILED"
  exit 1
fi

if [ "$REF" = "$PREV" ]; then
  # Первый перевод хоста, который уже работает на этом самом образе: выкатывать нечего,
  # нужно только завести версию и ссылку на неё.
  make_current "$NEW_DIR"
  record "$PREV" "$REF" adopted "$(running_version)"
  exit 0
fi

log "выкатываем $(short "$REF") (было $(short "$PREV"))"
if STATE_DIR="$STATE_DIR" VOID_IMAGE="$REF" bash "$NEW_DIR/deploy/update.sh"; then
  make_current "$NEW_DIR"
  record "$PREV" "$REF" ok "$(running_version)"
  prune_releases "$NEW_ID" "$(short "$PREV")"
  exit 0
fi

# Не поднялось. update.sh новой версии уже вернул прежний образ и server.env; здесь
# возвращаем и прежний deploy/ — ещё один подъём тем, чем прод работал до выкатки.
printf '%s\n' "$REF" >> "$FAILED"
outcome=rolled-back
if [ -n "$PREV" ] && [ -e "$CURRENT/deploy/update.sh" ]; then
  if ! STATE_DIR="$STATE_DIR" VOID_IMAGE="$PREV" bash "$CURRENT/deploy/update.sh"; then
    outcome=rollback-failed
  fi
elif [ -z "$PREV" ]; then
  outcome=failed-no-rollback
fi
rm -rf "$NEW_DIR"
record "$PREV" "$REF" "$outcome" "$(running_version)"
exit 1
