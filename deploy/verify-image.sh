#!/usr/bin/env bash
# Verify a published Void Dominion image before deploying it (SEC-13).
#
#   ./deploy/verify-image.sh ghcr.io/moonwuk/moongame@sha256:<digest>
#
# What it proves: those exact bytes were built and signed by THIS repository's
# image.yml workflow on `main` (keyless cosign — Fulcio certificate + Rekor
# transparency log), and image.yml only pushes what a blocking Trivy scan passed.
# An image someone built by hand, or a tag re-pointed in the registry, fails here.
#
# Exit code is the gate: run it before `docker pull` / `compose up` and stop on failure.
set -euo pipefail

# Same pin as .github/workflows/image.yml and android.yml (A08 — a tag is mutable).
COSIGN_IMAGE='ghcr.io/sigstore/cosign/cosign@sha256:b03690aa52bfe94054187142fba24dc54137650682810633901767d8a3e15b31'
REPO="${VOID_REPO:-Moonwuk/MoonGame}"

REF="${1:-}"
if [ -z "$REF" ]; then
  echo "usage: $0 <image-ref@sha256:digest>" >&2
  exit 2
fi

# A signature over a TAG is worthless for a deploy: the tag can be re-pointed at other
# bytes after verification. Refuse anything that isn't pinned by digest.
case "$REF" in
  *@sha256:*) ;;
  *)
    echo "refusing to verify '$REF': pass the digest ref (…@sha256:…), not a tag." >&2
    echo "resolve it with: docker buildx imagetools inspect $REF" >&2
    exit 2
    ;;
esac

echo "verifying $REF"
# Учётные данные реестра: НЕ монтируем в /root — образ cosign distroless и работает не от
# root, поэтому ни путь, ни права на файл 0600 ему не подходят (на этом упал первый прогон
# image.yml — cosign молча ушёл анонимом). Отдаём каталог по фиксированному пути через
# DOCKER_CONFIG и запускаем от текущего пользователя, которому этот файл и принадлежит.
# Для публичного пакета аутентификация не нужна вовсе — пустой каталог не мешает.
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e DOCKER_CONFIG=/dockercfg \
  -v "${HOME}/.docker:/dockercfg:ro" \
  "$COSIGN_IMAGE" \
  verify "$REF" \
  --certificate-identity-regexp "^https://github.com/${REPO}/\.github/workflows/image\.yml@refs/heads/main$" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  -o text

echo
echo "✅ signature OK — built and signed by ${REPO} image.yml on main."
echo "   deploy it with:"
echo "     docker pull $REF"
echo "     cd deploy && VOID_IMAGE=$REF \\"
echo "       docker compose -f docker-compose.yml -f docker-compose.release.yml up -d --no-build"
