import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

it.skipIf(!process.env.CADDY_BIN)('removes request credentials from a real reverse-proxy error log', async () => {
  const slot = createServer();
  slot.listen(0, '127.0.0.1');
  await once(slot, 'listening');
  const port = slot.address().port;
  await new Promise((resolve) => slot.close(resolve));
  const dir = mkdtempSync(join(tmpdir(), 'caddy-privacy-'));
  const file = join(dir, 'Caddyfile');
  const source = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8');
  writeFileSync(file, source.replace('reverse_proxy server:8788', 'reverse_proxy 127.0.0.1:1').replace('log default {', 'admin off\n\tlog default {'));
  const child = spawn(process.env.CADDY_BIN, ['run', '--config', file], {
    env: { ...process.env, DOMAIN: `http://127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (b) => { logs += b; });
  child.stderr.on('data', (b) => { logs += b; });
  try {
    let response;
    for (let n = 0; n < 50; n++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/matches/test?token=private-query-sentinel`, {
          headers: { Authorization: 'Bearer private-header-sentinel', Cookie: 'private-cookie-sentinel' },
        });
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    expect(response?.status).toBe(502);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
  expect(logs).toContain('http.log.error');
  expect(logs).not.toMatch(/private-query-sentinel|private-header-sentinel|private-cookie-sentinel/);
  expect(logs).not.toContain('"request":');
}, 10_000);
