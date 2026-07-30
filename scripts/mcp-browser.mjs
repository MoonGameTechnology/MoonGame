#!/usr/bin/env node
/**
 * Launcher for the Playwright MCP server (see `.mcp.json`).
 *
 * Why a wrapper instead of calling `playwright-mcp` straight from `.mcp.json`:
 * the pinned `@playwright/mcp` ships its own Playwright, which wants a specific
 * Chromium revision. Some environments (Claude Code on the web, CI images)
 * PRE-INSTALL a browser at a different revision and forbid downloading a new one
 * (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`) — there the server must be pointed at the
 * existing binary with `--executable-path`, or it hangs on the first navigation.
 * On a normal dev machine no such flag must be passed, or Playwright would be
 * pinned to a browser that isn't there. So: resolve, then launch.
 *
 * Resolution order:
 *   1. `VOID_MCP_CHROMIUM` — explicit override (any environment);
 *   2. the `chromium` symlink/binary under `PLAYWRIGHT_BROWSERS_PATH`;
 *   3. nothing — let Playwright pick its own managed browser (the normal case).
 *
 * Extra CLI args are forwarded, e.g. `node scripts/mcp-browser.mjs --device "iPhone 15"`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** First readable candidate, or null when Playwright should decide for itself. */
function resolveChromium() {
  const explicit = process.env.VOID_MCP_CHROMIUM;
  if (explicit) return existsSync(explicit) ? explicit : null;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return null;
  for (const candidate of [
    path.join(root, 'chromium'), // symlink shipped by the web/CI images
    path.join(root, 'chromium', 'chrome-linux', 'chrome'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// The package exports only `.` and `./package.json`, so the CLI is resolved from the
// package root rather than imported as a subpath (`./cli.js` is not exported).
const pkgJson = createRequire(import.meta.url).resolve('@playwright/mcp/package.json');
const cli = path.join(path.dirname(pkgJson), 'cli.js');
const executablePath = resolveChromium();

// `--isolated` keeps the profile in memory: an MCP browsing session must never
// leave cookies/localStorage behind that a later run could silently inherit
// (the prototype stores seat tickets and session JWTs in localStorage).
const args = [cli, '--headless', '--isolated', '--browser', 'chromium'];
if (executablePath) args.push('--executable-path', executablePath);
args.push(...process.argv.slice(2));

spawn(process.execPath, args, { stdio: 'inherit' }).on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
