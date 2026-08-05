#!/usr/bin/env bash
# Does the built image actually BOOT and serve? — the gate that was missing.
#
# ЗАЧЕМ ЭТО ЕСТЬ. Trivy читает ФАЙЛОВУЮ СИСТЕМУ образа: пакеты, версии, CVE. Он никогда
# не запускает то, что просканировал. Значит образ, который падает на первой секунде,
# проходит блокирующий `trivy-image` идеально чисто — и уезжает в GHCR как «проверенный».
#
# Это не гипотеза. Ровно так и случилось: шаг, выкидывающий devDependencies из образа,
# был написан как `pnpm prune --prod`. В воркспейсе pnpm `prune` работает по ОДНОМУ
# проекту, поэтому в корне он переписывает раскладку, оставляя каждый
# packages/*/node_modules ПУСТЫМ. Образ собирается, Trivy доволен (уязвимого кода стало
# даже меньше), а контейнер умирает на `Cannot find module 'ws'`. Поймать это может
# только запуск.
#
# Проверяем два зонда, оба обязательные:
#   GET /health — сервер поднялся и отвечает (тот же эндпоинт, что у HEALTHCHECK);
#   GET /       — HTML игрока реально запечён в образ (иначе игрок получит пустоту,
#                 а сервер при этом будет «жив»).
#
# Использование:  .github/scripts/smoke-image.sh <image-ref>
# Переменные:     SMOKE_PORT (порт на хосте, 18788), SMOKE_TRIES (секунд ожидания, 40).
set -uo pipefail

image="${1:?usage: smoke-image.sh <image-ref>}"
port="${SMOKE_PORT:-18788}"
tries="${SMOKE_TRIES:-40}"
base="http://127.0.0.1:$port"

# Порт публикуем только на loopback: раннер одноразовый, но открывать наружу нечего.
# Без --rm — контейнер нужен живым после падения, чтобы снять с него логи.
cid=$(docker run -d -p "127.0.0.1:$port:8788" "$image")
if [ -z "$cid" ]; then
  echo "::error::smoke: образ не запустился вообще (docker run не отдал контейнер)"
  exit 1
fi
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

fail() {
  echo "::error::smoke: $1 — образ собран и просканирован, но не работает"
  echo "--- docker logs ($cid) ---"
  docker logs "$cid" 2>&1 | tail -60
  exit 1
}

# Ждём готовности, но не вслепую: если контейнер уже умер, ждать нечего.
up=false
for _ in $(seq 1 "$tries"); do
  if curl -fsS -o /dev/null "$base/health"; then
    up=true
    break
  fi
  [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" = true ] ||
    fail "контейнер завершился, не начав отвечать на /health"
  sleep 1
done
[ "$up" = true ] || fail "/health не ответил за ${tries}s"

curl -fsS -o /dev/null "$base/" || fail "/ не отдал HTML игрока"

echo "smoke ok: $image — /health и / отвечают"
