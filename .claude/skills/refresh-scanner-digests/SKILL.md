---
name: refresh-scanner-digests
description: Ежемесячное обновление sha256-пинов Docker-образов сканеров в .github/workflows/security.yml (Gitleaks, OSV-Scanner, Trivy, Syft, Semgrep, TruffleHog, ZAP, zizmor) — снять дайджест живым запросом к реестру, заменить tag-пин на digest-пин, обновить docs/security/image-pinning.md. Запускай, когда просят "обновить дайджесты образов", "перепиновать сканеры", "закрепить образ по sha256", "образ пинен по тегу, надо по дайджесту", "ежемесячный refresh образов сканеров", "image pinning", "refresh scanner digests", "pin docker image by digest", "re-pin scanner images", "supply-chain pinning / A08 maintenance"; а также когда в security.yml замечен `image:tag` вместо `image@sha256:` или TODO-комментарий "Update to sha256 digest", когда пришло время месячного ревью supply-chain, или когда бампят версию сканера.
---

# Обновление sha256-дайджестов образов сканеров

## Зачем это вообще

Тег (`aquasec/trivy:0.58.2`) — **изменяемая** ссылка: владелец репозитория может
перетегировать её на другой образ, а компрометация реестра или MITM подменят содержимое
под тем же именем. Дайджест (`aquasec/trivy@sha256:...`) — контентный адрес: подменить
образ, не сломав пин, нельзя. Плюс аудит-след: в git видно, когда и на что менялся образ.
Это supply-chain-контроль **OWASP A08**, пункт 5 дорожной карты зрелости
(`docs/security/pipeline.md`).

Важно про статус: кирпичик **SEC-3 закрыт (✅)** — он поставил документацию, скрипт
обновления дайджестов и комментарии в `security.yml`. Остаточные тег-пины ниже
**не отслеживаются открытым кирпичом**, это регулярное обслуживание. Не ищи под них
`⏳`-кирпич (и не бери закрытый — см. скилл `brick`): заводи обычный PR зоны `[sec]`.

Отдельный вес это имеет потому, что сканеры в `security.yml` — **блокирующие** (SEC-1:
semgrep, gitleaks, osv, trivy-fs, trivy-image валят джобу на любом ненулевом выходе).
Инструмент, который решает, пускать ли код в `main`, не должен приезжать по изменяемой
ссылке.

## Текущая карта пинов (сверь перед работой — она устаревает)

Пинены по дайджесту: `semgrep/semgrep` (два вызова в джобе `semgrep`),
`trufflesecurity/trufflehog`, `ghcr.io/zaproxy/zaproxy` (джоба `dast-zap`),
`ghcr.io/zizmorcore/zizmor`.

Остались по тегу — **это и есть предмет работы**:

| Образ                        | Тег        | Где в `security.yml`             |
| ---------------------------- | ---------- | -------------------------------- |
| `zricethezav/gitleaks`       | `v8.18.4`  | джоба `gitleaks`                 |
| `ghcr.io/google/osv-scanner` | `v1.9.1`   | джоба `osv`                      |
| `aquasec/trivy`              | `0.58.2`   | джобы `trivy-fs` и `trivy-image` |
| `anchore/syft`               | `v1.20.0`  | джобы `trivy-image` и `sbom`     |

Над каждым таким шагом стоит TODO-комментарий «Update to sha256 digest — run:
./.github/scripts/update-image-digests.sh». Такой же TODO висит в `dast-zap`, хотя ZAP
уже пинен по дайджесту — комментарий протух, удали его заодно.

Таблица в `docs/security/image-pinning.md` тоже отстала: в ней нет строки про
`ghcr.io/zaproxy/zaproxy`. Приведи её в порядок в том же PR — правило «reconcile, don't
append» из `CLAUDE.md` требует чинить устаревшее утверждение, а не жить рядом с ним.

## Что реально делает скрипт

`.github/scripts/update-image-digests.sh` (bash, `set -e`, запускать из корня репо):

1. Копирует `.github/workflows/security.yml` во временный файл.
2. Идёт по **захардкоженному** списку из четырёх пар «образ → тег» (те самые четыре
   строки таблицы выше). Если ты бампишь версию сканера — теги правятся и в скрипте, и в
   workflow, иначе замена просто не найдёт строку.
3. Для каждого образа `get_digest` пробует по очереди: `docker pull` + `docker inspect
--format='{{index .RepoDigests 0}}'`; если докера нет — `skopeo inspect`; если и его
   нет, а образ из `ghcr.io` — безтокенный `curl` к `ghcr.io/v2/.../manifests/TAG`.
4. Заменяет `sed`'ом все вхождения `image:tag` → `image@sha256:<digest>` во временном
   файле, печатает `diff -u` и спрашивает интерактивно `Apply changes? (y/n)`. Только по
   `y` подменяет настоящий файл.

Ограничения, о которых надо знать заранее:

- **Скрипт интерактивный** (`read -p`). В неинтерактивной сессии он повиснет или
  отменится — тогда делай замены руками по тем же правилам, это ровно один `sed`-шаг.
- Если дайджест снять не удалось, образ **пропускается** с предупреждением; плейсхолдер
  `<digest-here>` в файл не попадает. Молчаливой порчи нет, но и молчаливого успеха тоже:
  читай вывод, а не только код возврата.
- Последний шаг скрипта правит комментарий с датой через `sed` по строке
  `pinned from their :latest on ...`, **которой в `security.yml` больше нет**: реальный
  комментарий — `#   - Last updated: 2026-07` в шапке файла. Обнови его вручную.
- Безтокенная ветка для `ghcr.io` сейчас отвечает `401` — не полагайся на неё, см. ниже.

## Как убедиться, что дайджест снят живьём, а не выдуман

В репозитории есть прямой прецедент: пины ZAP (SEC-6) и cosign (SEC-7) сняты **живым
запросом к `ghcr.io/v2` и перепроверены** — так и записано в `docs/backlog.md`: «дайджест
снят и перепроверен живым запросом, не выдуман» (там же отмечено, что `api.github.com` из
сессии недоступен, а реестровый API — доступен). Выдуманный sha256 — худший исход из
возможных: он выглядит как усиление безопасности, а на деле или ломает CI, или (при
случайном совпадении формата) маскирует отсутствие проверки.

Проверенные рабочие рецепты (оба возвращают заголовок `Docker-Content-Digest` —
это и есть дайджест манифеста, который надо пинить):

```bash
# Docker Hub (gitleaks, trivy, syft, semgrep, trufflehog)
IMG=zricethezav/gitleaks; TAG=v8.18.4
T=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$IMG:pull" | jq -r .token)
curl -sI "https://registry-1.docker.io/v2/$IMG/manifests/$TAG" -H "Authorization: Bearer $T" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
  | grep -i docker-content-digest

# ghcr.io (osv-scanner, zaproxy, zizmor) — анонимный токен обязателен
IMG=google/osv-scanner; TAG=v1.9.1
T=$(curl -s "https://ghcr.io/token?scope=repository:$IMG:pull" | jq -r .token)
curl -sI "https://ghcr.io/v2/$IMG/manifests/$TAG" -H "Authorization: Bearer $T" \
  -H "Accept: application/vnd.oci.image.index.v1+json" | grep -i docker-content-digest
```

Два подвоха: без `Authorization` `ghcr.io/v2` отдаёт `401` (то есть «Способ 3» из
`image-pinning.md` в текущем виде не работает), а `.config.digest` из тела манифеста —
дайджест конфиг-блоба, **не** тот, что подставляется после `@sha256:`. Пинится дайджест
манифеста: заголовок `Docker-Content-Digest` или `docker inspect .RepoDigests`.

Если дайджест для **того же тега** отличается от прежнего пина — тег перетегировали.
Это ровно тот сценарий, ради которого пин и существует: сходи в release notes образа и
опиши находку в PR, не проглатывай молча.

## Порядок работы

1. Ветка от свежего `main` (`CONTRIBUTING.md`: одна задача → одна ветка → один PR, зона
   `[sec]`).
2. Снять дайджесты (скриптом или рецептами выше) и подставить `image@sha256:...`.
3. Убрать отработавшие TODO-комментарии над изменёнными шагами и протухший TODO в
   `dast-zap`; обновить `#   - Last updated: YYYY-MM` в шапке `security.yml`.
4. Обновить таблицу статусов и, если правил методы, разделы способов в
   `docs/security/image-pinning.md`.
5. `pnpm run check` (lint + typecheck + test + docs-check). YAML он не валидирует, но
   `docs-check` проверит ссылки в тронутых `.md` — гейт должен остаться зелёным.
6. Настоящая проверка — прогон самого пайплайна: `security.yml` запускается на **push в
   любую ветку**, так что после пуша убедись, что джобы с новыми пинами реально стянули
   образы и отработали (сентинелы `status-<key>.json`, таблица подтверждения сканов в
   отчёте).
7. Коммит по конвенции из `docs/security/image-pinning.md`: `sec: update scanner image
digests` (префикс `sec:` уже используется в истории репо).

## Чего не делать

- Не менять версию/тег сканера «заодно» с рефрешем дайджеста. Новая версия приносит
  новые правила и, скорее всего, новые находки, а базовый уровень блокирующих сканеров
  зафиксирован на нуле (SEC-1) — это отдельный кирпичик с триажем, а не побочный эффект.
- Не трогать хардненинг workflow ради краткости: `persist-credentials: false` у каждого
  checkout и чтение `${{ steps.*.outcome }}` только через `env:`-переменную. Файл
  проверяет сам себя джобой `zizmor` (информационная, `continue-on-error`) — новых
  алертов оставлять не надо.
- Не переходить на `:latest` и не «упрощать» пин обратно к тегу.
- Если в этом же заходе бампится дайджест базового distroless-образа в `Dockerfile` —
  перечитай `.trivyignore`: принятые там no-fix CVE помечены «ревью при бампе digest»
  (`docs/security/pipeline.md`).
