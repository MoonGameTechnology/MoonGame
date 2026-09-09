#!/usr/bin/env bash
# Стартует ли собранный образ Caddy и обслуживает ли он? — тот же гейт, что у сервера
# (`smoke-image.sh`), но для второго публикуемого образа (SEC-35).
#
# ЗАЧЕМ ЭТО ЕСТЬ. Trivy читает ФАЙЛОВУЮ СИСТЕМУ образа и никогда не запускает то, что
# просканировал: образ, падающий на первой секунде, проходит скан идеально чисто. У сервера
# это уже ловили руками (`pnpm prune --prod` опустошал node_modules — разбор в шапке
# `smoke-image.sh`), и подписанный нерабочий образ ХУЖЕ неподписанного: подпись удостоверяет
# сломанный артефакт.
#
# У Caddy риск свой и конкретный: мы подменяем в образе бинарь, собранный СВОИМ тулчейном
# (`deploy/caddy/Dockerfile`, SEC-31). Скан подтверждает, что в новом бинаре нет целевых
# находок, но не то, что он вообще запускается и разбирает Caddyfile.
#
# Три зонда, все обязательные:
#   1. контейнер жив спустя старт;
#   2. HEALTHCHECK образа дошёл до `healthy` — а это ровно проба SEC-31 (`curl` к admin-API
#      на 127.0.0.1:2019/config/), то есть заодно проверяются наличие рабочего `curl` в
#      образе и то, что конфиг ЗАГРУЖЕН, а не «процесс запустился»;
#   3. :80 отдаёт HTTP — бинарь действительно обслуживает, а не только слушает admin-порт.
#
# Конфиг берётся ШТАТНЫЙ из базового образа (`/etc/caddy/Caddyfile`, `:80` + `file_server`),
# а НЕ `deploy/Caddyfile`: тот требует ${DOMAIN} и пошёл бы выпускать сертификат через ACME —
# в CI это сетевой поход наружу и гарантированный флейк. Для «бинарь жив и обслуживает»
# штатного конфига достаточно.
#
# Использование:  .github/scripts/smoke-caddy-image.sh <image-ref>
# Переменные:     SMOKE_PORT (порт на хосте, 18080), SMOKE_TRIES (секунд ожидания, 60).
set -uo pipefail

image="${1:?usage: smoke-caddy-image.sh <image-ref>}"
port="${SMOKE_PORT:-18080}"
tries="${SMOKE_TRIES:-60}"
base="http://127.0.0.1:$port"

# Порт публикуем только на loopback: раннер одноразовый, но открывать наружу нечего.
# Без --rm — контейнер нужен живым после падения, чтобы снять с него логи.
cid=$(docker run -d -p "127.0.0.1:$port:80" "$image")
if [ -z "$cid" ]; then
  echo "::error::smoke-caddy: образ не запустился вообще (docker run не отдал контейнер)"
  exit 1
fi
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

fail() {
  echo "::error::smoke-caddy: $1 — образ собран и просканирован, но не работает"
  echo "--- docker logs ($cid) ---"
  docker logs "$cid" 2>&1 | tail -60
  exit 1
}

# Ждём HEALTHCHECK, но не вслепую: если контейнер уже умер, ждать нечего.
healthy=false
for _ in $(seq 1 "$tries"); do
  state=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null)
  case "$state" in
    */healthy)
      healthy=true
      break
      ;;
    */none)
      fail "у образа НЕТ HEALTHCHECK — его ставит наш Dockerfile (SEC-31), значит собрали не то"
      ;;
    running/*) ;;
    *) fail "контейнер завершился (состояние '$state'), не дойдя до healthy" ;;
  esac
  sleep 1
done
[ "$healthy" = true ] || fail "HEALTHCHECK не дошёл до healthy за ${tries}s"

curl -fsS -o /dev/null "$base/" || fail ":80 не отдал HTTP"

echo "smoke-caddy ok: $image — HEALTHCHECK healthy и :80 отвечает"
