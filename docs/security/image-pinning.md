# Image Pinning и обновление sha256-дайджестов

Все образы должны быть пинены по `sha256`-дайджесту, а не по тегу.
Это обеспечивает **воспроизводимость** и предотвращает **supply-chain атаки** через замену образа.

Пиненных групп три — правило одно, а вот кто их обновляет и что ломается при протухании,
разное:

| Группа | Где | Обновление |
|---|---|---|
| **Сканеры** | `security.yml` | ежемесячно, скилл `refresh-scanner-digests` |
| **Базы нашего образа** | `Dockerfile` (`node:26-slim`, distroless) | при бампе базы + ре-ревью `.trivyignore` |
| **Сторонние образы прода** | `deploy/docker-compose*.yml` (postgres, caddy) | при бампе; их CVE видит джоба `trivy-deps` |

Наш собственный образ в проде дайджестом не пинится «в файле»: его публикует
`image.yml` (GHCR + подпись cosign), а дайджест приезжает на деплой через
`VOID_IMAGE` — см. `deploy/docker-compose.release.yml` и `deploy/verify-image.sh`.

## Как получить sha256-дайджест образа

### Способ 1: используя docker (локально)

```bash
# Стандартный способ для любого образа
docker pull IMAGE:TAG
docker inspect IMAGE:TAG --format='{{index .RepoDigests 0}}'

# Пример:
docker pull zricethezav/gitleaks:v8.18.4
docker inspect zricethezav/gitleaks:v8.18.4 --format='{{index .RepoDigests 0}}'
# Output: zricethezav/gitleaks@sha256:abc123...
```

### Способ 2: используя skopeo (без Docker)

```bash
skopeo inspect docker://IMAGE:TAG --format '{{.Digest}}'

# Пример:
skopeo inspect docker://aquasec/trivy:0.58.2 --format '{{.Digest}}'
# Output: sha256:abc123...
```

### Способ 3: используя GitHub Container Registry API

```bash
# Для ghcr.io образов
curl -s "https://ghcr.io/v2/OWNER/REPO/manifests/TAG" \
  -H "Accept: application/vnd.oci.image.manifest.v1+json" | jq '.config.digest'
```

### Способ 4: Docker Hub Registry API (без Docker и skopeo)

Для `docker.io`-образов (`postgres`, `caddy`, `node`) нужен анонимный токен, а дайджест
берётся из заголовка `Docker-Content-Digest` — **не** из `.config.digest` (то дайджест
конфига, а не образа; в `image@sha256:` идёт именно первый). Так сняты пины
postgres/caddy ниже:

```bash
repo=library/postgres; tag=16-alpine   # official-образы живут в library/
tok=$(curl -sS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repo:pull" |
  sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sS -o /dev/null -D - -H "Authorization: Bearer $tok" \
  -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
  "https://registry-1.docker.io/v2/$repo/manifests/$tag" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'
```

## Текущий статус пинов в security.yml

| Образ | Статус | Примечание |
|-------|--------|-----------|
| `semgrep/semgrep` | ✅ sha256 | Пинен по дайджесту |
| `zricethezav/gitleaks` | ⚠️ TAG | `v8.18.4` — нужен sha256 |
| `trufflesecurity/trufflehog` | ✅ sha256 | Пинен по дайджесту |
| `ghcr.io/google/osv-scanner` | ⚠️ TAG | `v1.9.1` — нужен sha256 |
| `aquasec/trivy` | ⚠️ TAG | `0.58.2` — нужен sha256 (используется 2 раза) |
| `anchore/syft` | ⚠️ TAG | `v1.20.0` — нужен sha256 (используется 2 раза) |
| `ghcr.io/zizmorcore/zizmor` | ✅ sha256 | Пинен по дайджесту |

## Сторонние образы прода (`deploy/docker-compose*.yml`)

Прод — это не только наш образ: рядом крутятся БД и (на публичном хосте) TLS-прокси.
Их пины и обновление — здесь; их CVE каждую неделю проверяет джоба `trivy-deps`
(`security.yml`), которая читает ссылки **прямо из compose-файлов**, поэтому бамп
дайджеста автоматически меняет и то, что сканируется.

| Образ | Дайджест | Снят | Файл |
|-------|----------|------|------|
| `postgres:16-alpine` | `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | 2026-07 | `docker-compose.yml` |
| `caddy:2-alpine` | `sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648` | 2026-07 | `docker-compose.tls.yml` |

Бамп: снять дайджест (Способ 4), заменить `image:` в compose, задеплоить, убедиться, что
`trivy-deps` на новом дайджесте зелёная. Формат — `image:tag@sha256:…`: тег остаётся
рядом с дайджестом как читаемая метка версии (Docker при таком написании тянет именно
дайджест).

## Процесс обновления дайджестов

1. **Получить новый дайджест** для версии образа (см. методы выше)
2. **Заменить в security.yml**: `image:tag` → `image@sha256:xxx`
3. **Обновить дату комментария** (line 23): `pinned from their :latest on 2026-07`
4. **Запустить pipeline** локально для проверки
5. **Коммитить с сообщением**: `sec: update scanner image digests`

## Почему это безопасно?

- **Immutability**: образ с дайджестом не может быть заменён (даже если tag будет перетегирован)
- **Audit trail**: в коммите видно, когда и на какую версию был обновлён образ
- **Supply-chain integrity**: защита от MITM и взлома registry

## Рекомендация

Обновляйте дайджесты **ежемесячно** или при выпуске новой версии сканера
для получения свежих правил обнаружения. Это не требует переписывания логики
сканирования, только обновления базы знаний.
