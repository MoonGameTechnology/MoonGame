#!/bin/bash
#
# Обновление живого прода: подтянуть код/образ, перезапустить сервер, проверить
# здоровье, откатиться если не поднялся.
#
# ПОЧЕМУ ЭТОТ ФАЙЛ ЛЕЖИТ В РЕПОЗИТОРИИ (OPS-1). Раньше скрипт обновления жил в
# heredoc внутри `install-ubuntu.sh` и писался на диск ОДИН раз, при установке
# (`/opt/moongame/update-dev.sh`). Отсюда ловушка целого класса: любая починка самого
# механизма обновления до уже развёрнутой машины не доезжала — `moongame update`
# тянул свежий код, но продолжал исполнять свою старую копию скрипта. Ровно на этом
# поймались на живой машине: `git pull` падал на «dubious ownership», фикс уехал в
# репозиторий, а на хосте остался прежний сломанный файл. Теперь механизм обновления
# обновляется вместе с кодом, как и всё остальное, а вопрос «какая версия скрипта у
# меня на хосте» отвечается одним `git log`.
#
# Три вещи, которых здесь когда-то не было и без которых «обновление» было прыжком с
# завязанными глазами:
#   1. ПРОВЕРКА ПОДПИСИ на образном пути — верификация обязательна, а не по желанию
#      оператора: непроверенный образ до рестарта не доходит.
#   2. ПРОВЕРКА ЗДОРОВЬЯ после рестарта — раньше скрипт печатал «Обновление
#      завершено!» ровно после `systemctl restart`, то есть радостно рапортовал об
#      успехе, даже если сервер немедленно падал в цикл перезапуска.
#   3. ОТКАТ на предыдущий образ, если здоровье не поднялось.
set -euo pipefail

# Пути считаются ОТ САМОГО СКРИПТА, а не от `/opt/moongame`: скрипт — файл репозитория,
# и клон может лежать где угодно (плейтест-хост, машина разработчика, CI).
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
SERVICE_NAME="moongame"
COMPOSE_BASE="$DEPLOY_DIR/docker-compose.yml"
RELEASE_OVERLAY="$DEPLOY_DIR/docker-compose.release.yml"
LAST_GOOD="$REPO_DIR/.last-good-image"
# Тот же файл, что EnvironmentFile у systemd-юнита. Прямые вызовы compose (в отличие
# от `systemctl restart`) его не видят — передаём явно, иначе POSTGRES_PASSWORD
# схлопнется в дефолт `void`.
ENV_FILE="$DEPLOY_DIR/server.env"
HEALTH_PORT="${PORT:-8788}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"

health_ok() {
  local i
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ---- путь 1: подписанный образ из реестра (VOID_IMAGE=ghcr.io/...@sha256:...) ----
if [ -n "${VOID_IMAGE:-}" ]; then
  echo "[*] Проверяем подпись образа (гейт — без неё дальше не идём)..."
  if ! "$DEPLOY_DIR/verify-image.sh" "$VOID_IMAGE"; then
    echo "[✗] Подпись не подтверждена — обновление ОТМЕНЕНО, сервер не тронут." >&2
    exit 1
  fi

  PREV_IMAGE="$(cat "$LAST_GOOD" 2>/dev/null || true)"

  echo "[*] Забираем образ и поднимаем на нём стек..."
  docker pull "$VOID_IMAGE"
  VOID_IMAGE="$VOID_IMAGE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE" -f "$RELEASE_OVERLAY" up -d --no-build

  if health_ok; then
    echo "$VOID_IMAGE" > "$LAST_GOOD"
    echo "[✓] Обновление завершено, /health отвечает."
    exit 0
  fi

  echo "[✗] Сервер не поднялся после обновления." >&2
  if [ -n "$PREV_IMAGE" ]; then
    echo "[*] Откатываемся на предыдущий проверенный образ: $PREV_IMAGE" >&2
    VOID_IMAGE="$PREV_IMAGE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE" -f "$RELEASE_OVERLAY" up -d --no-build
    health_ok && echo "[✓] Откат удался, работает предыдущая версия." >&2 \
      || echo "[✗] Откат НЕ помог — смотри логи: moongame logs" >&2
  else
    echo "[!] Отката нет: предыдущий образ неизвестен ($LAST_GOOD пуст)." >&2
  fi
  exit 1
fi

# ---- путь 2: сборка из исходников (историческое поведение) ----
# У этого пути нет ни сканирования, ни подписи: в прод уезжает то, что собралось на
# этой машине из текущего main. Оставлен рабочим для плейтест-хостов, но теперь честно
# об этом говорит и хотя бы проверяет здоровье с откатом.
echo "[!] Путь без гейта: сборка на хосте — образ не сканирован и не подписан."
echo "[!] Проверяемый путь: VOID_IMAGE=ghcr.io/moongametechnology/moongame@sha256:... moongame update"

# Каталог установки принадлежит служебному пользователю, а `moongame update` набирают
# из-под своей учётки. git на такое отвечает «detected dubious ownership» и не делает
# НИЧЕГО — обновление тихо останавливается на первом же шаге (поймано на живой машине).
# Поэтому git и docker зовём ОТ ВЛАДЕЛЬЦА каталога, а не от того, кто набрал команду.
# Глобальный `safe.directory` тут не годится: он маскирует ту же ошибку в следующий раз
# и засоряет ~/.gitconfig у root.
OWNER="$(stat -c %U "$REPO_DIR")"
run_as_owner() {
  if [ "$(id -un)" = "$OWNER" ]; then "$@"; else sudo -u "$OWNER" "$@"; fi
}

# Обновляемся по ТЕКУЩЕЙ ветке, а не по прибитому гвоздями main: плейтест-хост
# регулярно стоит на ветке с ещё не примёрженным фиксом, и `git pull origin main`
# на нём молча привозит не то, что просили. Переопределяется явно: BRANCH=... moongame update.
BRANCH="${BRANCH:-$(run_as_owner git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)}"
echo "[*] Обновляем код из репозитория (ветка $BRANCH)..."
run_as_owner git -C "$REPO_DIR" fetch origin "$BRANCH"
# --ff-only: деплой-хост не место для сюрпризных merge-коммитов. Разошлось — пусть
# падает здесь, до пересборки, а не оставляет полугибрид в проде.
run_as_owner git -C "$REPO_DIR" merge --ff-only "origin/$BRANCH"

# Образ, на котором сервер работает ПРЯМО СЕЙЧАС — единственная точка отката.
PREV_IMAGE_ID="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE" ps -q server 2>/dev/null \
  | head -1 | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null || true)"

echo "[*] Пересобираем образ (сервер пока работает, ~1-3 мин)..."
# Тоже от владельца: в группе docker состоит служебный пользователь (его туда завёл
# установщик), а не тот, кто набрал `moongame update`.
run_as_owner docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE" build

echo "[*] Перезапускаем сервер на новом образе..."
sudo systemctl restart "$SERVICE_NAME"

if health_ok; then
  echo "[✓] Обновление завершено, /health отвечает."
  echo "[*] Логи: sudo journalctl -u $SERVICE_NAME -f"
  exit 0
fi

echo "[✗] Сервер не отвечает на /health после обновления." >&2
if [ -n "$PREV_IMAGE_ID" ]; then
  IMAGE_NAME="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE" config --images 2>/dev/null | head -1)"
  if [ -n "$IMAGE_NAME" ]; then
    echo "[*] Откатываемся на предыдущий образ ($PREV_IMAGE_ID)..." >&2
    docker tag "$PREV_IMAGE_ID" "$IMAGE_NAME"
    sudo systemctl restart "$SERVICE_NAME"
    health_ok && echo "[✓] Откат удался, работает предыдущая версия." >&2 \
      || echo "[✗] Откат НЕ помог — смотри логи: moongame logs" >&2
  fi
else
  echo "[!] Отката нет: не удалось определить предыдущий образ." >&2
fi
exit 1
