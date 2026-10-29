import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

it.skipIf(!process.env.CADDY_BIN)('replaces upstream HSTS with one proxy policy, including proxy-generated responses', async () => {
  const upstream = createServer((_req, res) => {
    res.setHeader('Strict-Transport-Security', 'max-age=60');
    res.end('ok');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const slot = createServer();
  slot.listen(0, '127.0.0.1');
  await once(slot, 'listening');
  const port = slot.address().port;
  await new Promise((resolve) => slot.close(resolve));
  const dir = mkdtempSync(join(tmpdir(), 'caddy-hsts-'));
  const file = join(dir, 'Caddyfile');
  const source = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8');
  writeFileSync(file, source
    .replace('reverse_proxy server:8788', `reverse_proxy 127.0.0.1:${upstream.address().port}`)
    .replace('log default {', 'admin off\n\tlog default {'));
  const child = spawn(process.env.CADDY_BIN, ['run', '--config', file], {
    env: { ...process.env, DOMAIN: `http://127.0.0.1:${port}` },
    stdio: 'ignore',
  });
  try {
    let response;
    for (let n = 0; n < 50; n++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`);
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    expect(response?.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    const blocked = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(blocked.status).toBe(404);
    expect(blocked.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  } finally {
    child.kill();
    await once(child, 'exit');
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);
