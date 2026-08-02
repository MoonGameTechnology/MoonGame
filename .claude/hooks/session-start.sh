#!/bin/bash
# SessionStart hook — install workspace dependencies before the session begins.
#
# Claude Code on the web starts from a FRESH container: `node_modules` is empty, so the
# gate (`pnpm run check`), every test and every lint run would fail on missing packages
# before doing any real work. A local dev machine manages its own install, so this runs
# in remote sessions only.
#
# Note for whoever extends this: do NOT add a Playwright browser download here. The web
# image ships Chromium at $PLAYWRIGHT_BROWSERS_PATH and `scripts/mcp-browser.mjs` points
# the MCP server at it; a download would be both redundant and a different revision.
# (On a LOCAL machine the browser is genuinely missing — see the MCP section of
# CONTRIBUTING.md — but that is not this hook's job.)
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$(dirname "$(dirname "$(readlink -f "$0")")")")}"

# `packageManager` in package.json pins the pnpm version; corepack honours it. Absent
# corepack (or an already-correct pnpm on PATH) we simply fall through to the shim.
corepack enable >/dev/null 2>&1 || true

# --frozen-lockfile: reproducible and refuses to silently rewrite pnpm-lock.yaml. Unlike
# `npm ci` it does not wipe node_modules, so a warm container still reuses the store.
pnpm install --frozen-lockfile
