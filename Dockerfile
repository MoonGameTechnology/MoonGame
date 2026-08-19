# Deploys the Void Dominion prototype multiplayer server — the in-memory proto
# server that hosts the prototype's own world AND serves the game HTML (the player
# client at `/`, the dev client at `/dev` — see prototype/build.mjs). One
# deploy gives a permanent URL: both players just open it (the connect overlay
# auto-fills the same-origin wss://), pick Azure / Crimson, and play. State is
# in-memory and the handshake is unauthenticated — this is for testing, not prod.
#
#   docker build -t void-dominion . && docker run -p 8788:8788 void-dominion
#   (or one-click via render.yaml — see docs/multiplayer.md)
#
# Multi-stage: a full node:26-slim builder installs deps and bakes the prototype HTML,
# then a distroless runtime carries only the installed /app and runs `node` as non-root.
# Distroless drops the entire Debian userland (perl, pam, bsdutils, gpg, apt, …) that the
# Node-only server never touches — that base-OS layer was the source of nearly all the
# `trivy image` MEDIUM CVEs (audit SD-5.1 / F-15). It has no shell or package manager,
# which also removes the npm/corepack tooling the old single-stage image had to delete.
#
# Runtime note: the server bundle is BAKED AT BUILD TIME (see the bundle step below) and
# the runtime stage runs it directly — so the image ships no esbuild and no dev toolchain.
# The only write the running container needs is playtest-logs/ (event JSONL); that dir is
# pre-created in the builder and the tree is owned by the non-root user.

# ---- Stage 1: build (full toolchain) ----
# Both FROM lines are digest-pinned (audit F-15 / CWE-1357): a tag is mutable, a digest
# names the exact multi-arch index that was reviewed. To bump: re-resolve the tag's
# current digest (Docker Hub API `/v2/repositories/library/node/tags/26-slim` for node;
# `gcr.io/v2/distroless/nodejs22-debian13/manifests/nonroot` Docker-Content-Digest for
# distroless), update the digest + the refreshed-date below, and re-review .trivyignore.
# The dates live in these comments, not inline: a `#` after FROM's args would be parsed
# as extra arguments (Dockerfile comments only count at line start) and break the build.
# node:26-slim digest refreshed 2026-07.
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS build
WORKDIR /app
# Node ≥25 no longer ships corepack in the distribution (the 22→26 bump, PR #106,
# silently broke this line — caught by the SEC-1 blocking trivy-image gate), so install
# it explicitly (version-pinned; it then fetches the exact pnpm from `packageManager`).
RUN npm install -g corepack@0.35.0 && corepack enable

# Install deps first (cached unless the lockfile/manifests change), then the source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared-core/package.json packages/shared-core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/action-layer/package.json packages/action-layer/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run prototype # bake dist/void-dominion{,-player}.html (player at /, dev at /dev)

# Bake the server bundle HERE instead of at container startup. Two reasons, and the
# second one is the important one:
#   1. Startup gets shorter and deterministic — no transpile on every boot.
#   2. It removes esbuild from the RUNTIME requirements, which is what finally lets the
#      dev-toolchain drop below happen. The root package.json has NO production
#      dependencies at all — esbuild, typescript, eslint, vitest and prettier are all
#      devDependencies — so as long as the server needed esbuild to boot, the image had
#      to ship the whole dev toolchain into production.
# What made this concrete: TypeScript 7 started shipping a NATIVE Go-compiled tsc, and
# Trivy found Go CVEs inside our production image, in
# `node_modules/.pnpm/@typescript+typescript-linux-x64/.../tsc` (blocked PR #489). The
# vulnerability was in a compiler that has no business being in production at all.
RUN node prototype/bundle-netserver.mjs

# Drop devDependencies from the tree that gets copied into the runtime stage: re-resolve
# node_modules with --prod, which removes the root's toolchain (esbuild, typescript,
# eslint, vitest, prettier, …) and keeps every workspace project's real dependencies —
# `packages/server`'s ws/pg/fastify (left external by the bundle) plus @fastify/rate-limit,
# jose and web-push, which the bundle inlines but whose native/optional parts resolve at
# runtime. The baked HTML and the bundle itself are untouched.
#
# NOT `pnpm prune --prod`, which is the obvious choice and is wrong here: `prune` operates
# on ONE project, so at the workspace root it rewrites the modules layout with only the
# root importer included and leaves every packages/*/node_modules EMPTY. The image still
# builds and Trivy still scans it clean — nothing runs the server — but the container dies
# at boot on `Cannot find module 'ws'`. `install --prod` covers all importers.
#
# CI=true is load-bearing, not decoration: this purges node_modules, and pnpm 10 asks for
# interactive confirmation first. `docker build` has no TTY, so pnpm refuses outright
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY) and the build dies here. The variable is
# scoped to this one RUN so it cannot change how any other step behaves.
RUN CI=true pnpm install --prod --frozen-lockfile --ignore-scripts

# Pre-create the dir the server writes at runtime so it exists (and, after the
# COPY --chown below, is owned by the non-root user): playtest-logs/ (event JSONL).
# packages/server/dist/ already exists — the bundle above lives there.
RUN mkdir -p playtest-logs

# ---- Stage 2: runtime (distroless, no shell, non-root by default) ----
# The :nonroot tag runs as uid 65532. Base is nodejs22-**debian13** (trixie): upstream
# deprecated the nodejs*-debian12 repos (their digests carry deprecated-public-image-*
# tags; last rebuild 2026-02), so debian12 is frozen with the libssl3/libc6 CVEs Trivy
# flags — debian13 is the actively rebuilt line with current trixie-security packages.
# Digest-pinned like the build stage (bump procedure in the Stage 1 comment);
# nodejs22-debian13:nonroot digest refreshed 2026-07.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167 AS runtime
# Bring the app (source + prod-only node_modules + baked HTML + the pre-built server
# bundle) and hand the tree to the non-root user so the one runtime write left
# (playtest-logs) succeeds. node_modules uses pnpm's relative symlink layout, so copying
# all of /app keeps the links valid.
COPY --from=build --chown=nonroot:nonroot /app /app
WORKDIR /app
USER nonroot

ENV HOST=0.0.0.0
ENV PORT=8788
EXPOSE 8788
# Liveness probe (Trivy DS026). Distroless has no shell or curl, so the probe is
# exec-form node hitting the server's own contentless GET /health. It reads $PORT the
# same way the server does, so a platform-injected PORT moves both together.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["/nodejs/bin/node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||8788}/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# distroless/nodejs ENTRYPOINT is already ["/nodejs/bin/node"], so CMD is just the script.
# Runs the PRE-BUILT bundle, not prototype/netserver.mjs: that one bundles on startup and
# therefore needs esbuild, which no longer ships in this image. The bundle reads $PORT the
# same way (platforms like Render/Fly inject their own).
CMD ["packages/server/dist/proto-server.mjs"]
