#!/usr/bin/env bash
# Приёмка собственной сборки Caddy: закрывает ли пересборка ровно то, ради чего она есть?
#
# ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ (SEC-35). Проверку завёл SEC-31 внутри джобы `trivy-caddy`
# (`security.yml`). С SEC-35 наш Caddy ещё и публикуется — `image.yml` собирает его на
# `main`, и ЕМУ нужен тот же блокирующий критерий перед пушем в реестр. Список находок,
# скопированный в два воркфлоу, разъехался бы на первой же правке, а разъехавшийся
# критерий приёмки — это гейт, который в одном месте разрешает то, что в другом
# запрещает. Один файл, два вызова.
#
# ЧТО ИМЕННО ПРОВЕРЯЕТСЯ — три группы, и каждая соответствует одному обещанию Dockerfile'а.
#
#   1. ТУЛЧЕЙН (16 находок stdlib). Их закрывает тулчейн сборочной стадии: тринадцать
#      закрыл go1.26.8 (SEC-31), ещё три — go1.27.2 (2026-10-12). Откатился тулчейн —
#      находки вернутся сюда.
#   2. МОДУЛИ (9 находок, SEC-40). x/text, x/crypto и grpc закрывает `go.mod` caddy
#      v2.11.7 (их прежние `--with` сняты), x/net — `--with x/net/http2@v0.60.0` в
#      `deploy/caddy/Dockerfile`. Откат версии caddy или снятый бамп вернут их сюда.
#   3. ПАКЕТЫ БАЗЫ (5 пар «пакет → версия», SEC-40). Их закрывает `apk upgrade --no-cache`
#      в рантайм-стадии. Сверка идёт не по id находки, а по УСТАНОВЛЕННОЙ ВЕРСИИ: пока в
#      отчёте есть находка на `curl 8.19.0-r0`, значит upgrade не отработал (или бранч
#      Alpine перестал нести фиксы) — то есть пересборка перестала делать то, что обещает.
#      Проверка по версии, а не «нет фиксируемых находок ОС», намеренно: новая CVE в
#      обновлённом пакете НЕ должна красить гейт всему репозиторию — она про мир, а не
#      про то, отработала ли наша сборка.
#
# СВЕРКА В ГРУППАХ 1–2 ИДЁТ ПО ПАРЕ (id, ПАКЕТ), а не по одному id, и это не педантизм:
# `CVE-2026-46600` и `CVE-2026-78669` есть и в stdlib (их закрывает тулчейн), и в `x/net`
# (их закрывает модуль) — проверка по голому id не различила бы, что именно починилось.
#
# ЧТО ЭТО НЕ ПРОВЕРЯЕТ, И ПОЧЕМУ ЗДЕСЬ НЕТ `--ignore-unfixed --exit-code 1`, как у образа
# сервера. Такой гейт сделал бы ЛЮБУЮ новую фиксируемую CVE в чужом коде (alpine-пакет,
# модуль caddy) стоп-краном для всей очереди мержа — ровно та поломка, которую разбирал
# SEC-27, только теперь у фронта. Здесь блокирует другое: «пересборка всё ещё закрывает
# то, ради чего затевалась». Что в бинаре осталось С фиксом — видно в группе ниже и в
# отчёте Code Scanning (например, MEDIUM в cel-go: бамп до 0.29.0 в этот заход не брали,
# разбор недостижимости — запись SEC-32 в docs/security/pipeline.md).
#
# Использование:  .github/scripts/caddy-rebuild-acceptance.sh <trivy-json>
set -eu

report="${1:?usage: caddy-rebuild-acceptance.sh <trivy-json>}"
[ -s "$report" ] || {
  echo "::error::приёмка Caddy: отчёт '$report' пуст или отсутствует — сверять нечего"
  exit 1
}

# --- группы 1–2: находки в бинаре, сверка по паре (id, пакет) ------------------------
left=""
while read -r id pkg; do
  [ -n "$id" ] || continue
  if jq -e --arg id "$id" --arg pkg "$pkg" '[.Results[]? | select(.Target == "usr/bin/caddy")
       | (.Vulnerabilities // [])[]
       | select(.VulnerabilityID == $id and .PkgName == $pkg)] | length > 0' \
       "$report" >/dev/null; then
    left="$left $id($pkg)"
  fi
done <<'PAIRS'
CVE-2026-27145 stdlib
CVE-2026-33818 stdlib
CVE-2026-39821 stdlib
CVE-2026-39822 stdlib
CVE-2026-42504 stdlib
CVE-2026-42505 stdlib
CVE-2026-42507 stdlib
CVE-2026-46600 stdlib
CVE-2026-56853 stdlib
CVE-2026-56858 stdlib
CVE-2026-56859 stdlib
CVE-2026-56860 stdlib
CVE-2026-56862 stdlib
CVE-2026-78667 stdlib
CVE-2026-78669 stdlib
CVE-2026-97031 stdlib
CVE-2026-56852 golang.org/x/text
CVE-2026-56854 golang.org/x/crypto
CVE-2026-56855 golang.org/x/crypto
CVE-2026-78662 golang.org/x/crypto
CVE-2026-84304 google.golang.org/grpc
CVE-2026-84445 google.golang.org/grpc
GHSA-hrxh-6v49-42gf google.golang.org/grpc
CVE-2026-46600 golang.org/x/net
CVE-2026-78669 golang.org/x/net
PAIRS

# --- группа 3: пакеты базы, сверка по установленной версии ---------------------------
stale=""
for pv in curl=8.19.0-r0 libcurl=8.19.0-r0 libcrypto3=3.5.7-r0 libssl3=3.5.7-r0 c-ares=1.34.6-r0; do
  pkg=${pv%%=*}
  ver=${pv#*=}
  if jq -e --arg p "$pkg" --arg v "$ver" '[.Results[]? | (.Vulnerabilities // [])[]
       | select(.PkgName == $p and .InstalledVersion == $v)] | length > 0' \
       "$report" >/dev/null; then
    stale="$stale $pkg@$ver"
  fi
done

echo "::group::что осталось в бинаре после пересборки"
jq -r '.Results[]? | select(.Target == "usr/bin/caddy") | (.Vulnerabilities // [])[]
       | "\(.Severity)\t\(.VulnerabilityID)\t\(.PkgName) \(.InstalledVersion)"' \
       "$report" | sort || true
echo "::endgroup::"

echo "::group::версии обновляемых пакетов базы, как их видит отчёт"
jq -r '.Results[]? | (.Vulnerabilities // [])[]
       | select(.PkgName | IN("curl", "libcurl", "libcrypto3", "libssl3", "c-ares"))
       | "\(.PkgName) \(.InstalledVersion) → фикс \(.FixedVersion // "нет")"' \
       "$report" | sort -u || true
echo "::endgroup::"

rc=0
if [ -n "$left" ]; then
  echo "::error::пересборка перестала закрывать целевые находки бинаря:$left"
  rc=1
fi
if [ -n "$stale" ]; then
  echo "::error::apk upgrade не отработал — в образе остались старые пакеты:$stale"
  rc=1
fi
[ "$rc" -eq 0 ] || exit 1
echo "приёмка пройдена: 25 целевых находок отсутствуют в usr/bin/caddy, пакеты базы обновлены"
