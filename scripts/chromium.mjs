/**
 * Where is the Chromium that the browser tooling must drive?
 *
 * Shared by the MCP launcher (`scripts/mcp-browser.mjs`) and the browser smoke
 * (`prototype/browsertest.mjs`): the launcher needs the path to pass as
 * `--executable-path`, the smoke needs the same answer to decide whether its
 * `--install` step has anything left to download. Two copies of this order would
 * drift, and the drift is invisible — the smoke would fetch a browser the launcher
 * then ignores.
 *
 * Resolution order:
 *   1. `VOID_MCP_CHROMIUM` — explicit override (any environment);
 *   2. the `chromium` symlink/binary under `PLAYWRIGHT_BROWSERS_PATH`;
 *   3. nothing — let Playwright pick its own managed browser (the normal case).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** First readable candidate, or null when Playwright should decide for itself. */
export function resolveChromium() {
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
