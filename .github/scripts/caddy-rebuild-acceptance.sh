#!/usr/bin/env bash
# Приёмка собственной сборки Caddy: закрывает ли пересборка ровно то, ради чего она есть?
#
# ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ (SEC-35). Проверку завёл SEC-31 внутри джобы `trivy-caddy`
# (`security.yml`). С SEC-35 наш Caddy ещё и публикуется — `image.yml` собирает его на
# `main`, и ЕМУ нужен тот же блокирующий критерий перед пушем в реестр. Список из
# четырнадцати находок, скопированный в два воркфлоу, разъехался бы на первой же правке, а
# разъехавшийся критерий приёмки — это гейт, который в одном месте разрешает то, что в
# другом запрещает. Один файл, два вызова.
#
# ЧТО ИМЕННО ПРОВЕРЯЕТСЯ. Тринадцать stdlib-находок, которые закрывает свежий тулчейн
# (go1.26.8 сборочной стадии против go1.26.3 у апстрима), плюс `CVE-2026-56852` в x/text —
# её закрывает единственный модульный бамп в `deploy/caddy/Dockerfile`. Если пересборка
# перестала их закрывать (апстрим сменил базу, бамп потерялся, тулчейн откатился), смысла
# в собственной сборке больше нет — и это красное.
#
# СВЕРКА ИДЁТ ПО ПАРЕ (id, ПАКЕТ), а не по одному id, и это не педантизм: `CVE-2026-46600`
# есть и в stdlib (её пересборка закрывает), и в `x/net` (не закрывает) — проверка по
# голому id соврала бы.
#
# ЧТО ЭТО НЕ ПРОВЕРЯЕТ, И ПОЧЕМУ ЗДЕСЬ НЕТ `--ignore-unfixed --exit-code 1`, как у образа
# сервера. В бинаре остаются находки С ОПУБЛИКОВАННЫМ фиксом — `CVE-2026-56854` CRITICAL
# (x/crypto → 0.55.0), три HIGH в grpc, — и закрыть их можно только бампом модулей ПОВЕРХ
# `go.mod` caddy. SEC-31 отказался это делать сознательно: непроверенных апстримом
# комбинаций в бинаре, терминирующем TLS из интернета, быть не должно. Каждая из них
# разобрана поимённо и признана недостижимой по СИМВОЛАМ в бинаре (запись SEC-32 в
# `docs/security/pipeline.md`: у SSH-дефекта x/crypto нет соединенческого слоя, у grpc нет
# листенера, у cel-go нет `Native*`). Гейт `--ignore-unfixed` запрещал бы ВЫПУСК образа
# из-за уже разобранного и принятого — то есть держал бы прод на старой сборке. Пакеты
# базы (curl, openssl, c-ares) — та же история с другой причиной: их лечит `apk upgrade`,
# и это отдельное решение владельца (шапка `deploy/caddy/Dockerfile`).
#
# Использование:  .github/scripts/caddy-rebuild-acceptance.sh <trivy-json>
set -eu

report="${1:?usage: caddy-rebuild-acceptance.sh <trivy-json>}"
[ -s "$report" ] || {
  echo "::error::приёмка Caddy: отчёт '$report' пуст или отсутствует — сверять нечего"
  exit 1
}

stdlib_ids="CVE-2026-27145 CVE-2026-33818 CVE-2026-39821 CVE-2026-39822 CVE-2026-42504 CVE-2026-42505 CVE-2026-42507 CVE-2026-46600 CVE-2026-56853 CVE-2026-56858 CVE-2026-56859 CVE-2026-56860 CVE-2026-56862"

left=""
for id in $stdlib_ids; do
  if jq -e --arg id "$id" '[.Results[]? | select(.Target == "usr/bin/caddy")
       | (.Vulnerabilities // [])[]
       | select(.VulnerabilityID == $id and .PkgName == "stdlib")] | length > 0' \
       "$report" >/dev/null; then
    left="$left $id(stdlib)"
  fi
done
if jq -e '[.Results[]? | select(.Target == "usr/bin/caddy")
     | (.Vulnerabilities // [])[]
     | select(.VulnerabilityID == "CVE-2026-56852" and .PkgName == "golang.org/x/text")] | length > 0' \
     "$report" >/dev/null; then
  left="$left CVE-2026-56852(x/text)"
fi

echo "::group::что осталось в бинаре после пересборки"
jq -r '.Results[]? | select(.Target == "usr/bin/caddy") | (.Vulnerabilities // [])[]
       | "\(.Severity)\t\(.VulnerabilityID)\t\(.PkgName) \(.InstalledVersion)"' \
       "$report" | sort || true
echo "::endgroup::"

if [ -n "$left" ]; then
  echo "::error::пересборка перестала закрывать целевые находки:$left"
  exit 1
fi
echo "приёмка пройдена: все 14 целевых находок отсутствуют в usr/bin/caddy"
