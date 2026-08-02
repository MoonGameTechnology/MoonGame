#!/usr/bin/env node
/**
 * Browser smoke test — boots the REAL built prototype in a real (headless) browser
 * and fails on anything the console reports.
 *
 * Why this exists next to `uitest.mjs`: that one drives a fake DOM and a Proxy
 * canvas, so it answers «the code did not throw». This one answers «the shipped
 * bundle actually boots in a browser» — the only place a whole class of defects is
 * visible at all (`prototype/` is outside ESLint and outside tsc; esbuild-only bugs
 * like the `httpBase` TDZ trap live exclusively in the built file; console errors,
 * unhandled rejections and browser warnings have no other reporter).
 *
 * It talks to the SAME pinned MCP server the humans/agents use (`scripts/mcp-browser.mjs`)
 * over stdio JSON-RPC, so CI and interactive sessions exercise one identical path —
 * including the browser-resolution logic for images that ship a pre-installed Chromium.
 *
 * The static host also answers `/auth/status` with `{"enabled":false}`: that is the
 * honest minimal contract of an accounts-off server, so a clean run has a genuinely
 * EMPTY console and every message is a real finding (no allow-list to rot).
 *
 *   node prototype/browsertest.mjs            # build if needed, then check
 *   node prototype/browsertest.mjs --install  # fetch the matching Chromium first (CI)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(root, 'prototype/dist/void-dominion.html');
const NAV_TIMEOUT_MS = 90_000;

/** `--install`: fetch the Chromium build this Playwright expects (CI runners have none). */
if (process.argv.includes('--install')) {
  const cli = createRequire(import.meta.url).resolve('playwright-core/cli.js');
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

if (!existsSync(bundle) || statSync(bundle).size === 0) {
  console.log('· собираю прототип (dist отсутствует)…');
  const built = spawnSync(process.execPath, [path.join(root, 'prototype/build.mjs')], {
    stdio: 'inherit',
    cwd: root,
  });
  if (built.status !== 0) {
    console.error('✗ сборка прототипа упала — смотри вывод выше');
    process.exit(1);
  }
}

/** Static host for `dist/` + the one endpoint the client probes on boot. */
function serve() {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/auth/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled: false }));
      return;
    }
    const file = path.join(root, 'prototype/dist', url === '/' ? 'void-dominion.html' : url);
    // Confine reads to dist/ — this host is throwaway, but a path-traversal smoke
    // harness is still a bad habit to ship.
    if (!file.startsWith(path.join(root, 'prototype/dist')) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Minimal stdio JSON-RPC client for the MCP server. */
function mcp() {
  const child = spawn(process.execPath, [path.join(root, 'scripts/mcp-browser.mjs')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: root,
  });
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-JSON chatter is not ours
    }
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      waiter(msg);
    }
  });
  let seq = 0;
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`MCP не ответил на ${method} за ${NAV_TIMEOUT_MS} мс`));
      }, NAV_TIMEOUT_MS).unref();
    });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { child, send, notify };
}

const textOf = (reply) =>
  (reply?.result?.content ?? []).map((c) => c.text ?? '').join('\n');

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/void-dominion.html`;
const { child, send, notify } = mcp();
let failure = null;

try {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'void-browsertest', version: '1' },
  });
  notify('notifications/initialized');

  console.log(`· открываю ${url}`);
  const nav = textOf(await send('tools/call', { name: 'browser_navigate', arguments: { url } }));
  const snapshot = textOf(await send('tools/call', { name: 'browser_snapshot', arguments: {} }));

  // 1. The bundle must actually be the game, not an error page.
  if (!/Void Dominion/i.test(nav + snapshot)) {
    failure = 'страница загрузилась, но это не игра (нет заголовка Void Dominion)';
  }
  // 2. The welcome card must render its localized controls — catches a boot chain
  //    that dies silently and leaves an empty shell (and missing i18n).
  else if (!/New Commander|Новый командир/.test(snapshot)) {
    failure = 'экран входа пуст: нет кнопки «Новый командир» (boot-цепочка или локализация)';
  }
  // 3. Any console error is a finding — the host answers /auth/status, so a healthy
  //    boot prints nothing at all.
  else {
    const errors = (nav.match(/Console: (\d+) errors?/)?.[1] ?? '0') !== '0';
    if (errors) {
      const messages = textOf(
        await send('tools/call', { name: 'browser_console_messages', arguments: { onlyErrors: true } }),
      );
      failure = `ошибки в консоли при загрузке:\n${messages.slice(0, 1500)}`;
    }
  }
} catch (err) {
  failure = `прогон не состоялся: ${err instanceof Error ? err.message : String(err)}`;
} finally {
  child.kill();
  server.close();
}

if (failure) {
  console.error(`\n✗ browser smoke: ${failure}`);
  process.exit(1);
}
console.log('\n✓ browser smoke: игра грузится, экран входа на месте, консоль чистая');
