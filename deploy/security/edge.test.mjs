import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withEdgeLogging } from './edge-logging.mjs';

it.skipIf(!process.env.CADDY_BIN)(
  'the shipped Caddy redacts request/response secrets before persistent access logging',
  async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'Set-Cookie': 'RESPONSE_COOKIE_SECRET',
        'X-Private': 'RESPONSE_HEADER_SECRET',
      });
      res.end('RESPONSE_BODY_SECRET');
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const slot = createServer();
    slot.listen(0, '127.0.0.1');
    await once(slot, 'listening');
    const port = slot.address().port;
    await new Promise((done) => slot.close(done));
    const dir = await mkdtemp(join(tmpdir(), 'security-edge-')),
      path = join(dir, 'access.log'),
      config = join(dir, 'Caddyfile');
    const source = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');
    await writeFile(
      config,
      withEdgeLogging(
        source
          .replace('log default {', 'admin off\n\tlog default {')
          .replace(
            'reverse_proxy server:8788',
            `reverse_proxy 127.0.0.1:${upstream.address().port}`,
          ),
        path,
      ),
    );
    const child = spawn(process.env.CADDY_BIN, ['run', '--config', config], {
      env: { ...process.env, DOMAIN: `http://127.0.0.1:${port}` },
      stdio: 'ignore',
    });
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          await (await fetch(`http://127.0.0.1:${port}/health`)).text();
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 40));
        }
      }
      expect(ready).toBe(true);
      const response = await fetch(`http://127.0.0.1:${port}/auth/login?token=QUERY_SECRET`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer HEADER_SECRET',
          cookie: 'COOKIE_SECRET',
          'user-agent': 'AGENT_SECRET',
          'content-type': 'text/plain',
        },
        body: 'REQUEST_BODY_SECRET',
      });
      expect(response.status).toBe(401);
      await response.text();
      expect(
        (await fetch(`http://127.0.0.1:${port}/metrics/PRIVATE_PATH_SECRET?token=QUERY_SECRET`))
          .status,
      ).toBe(404);
      await (
        await fetch(`http://127.0.0.1:${port}/PRIVATE_PATH_SECRET?token=QUERY_SECRET`, {
          method: 'SECRET_METHOD',
        })
      ).text();
    } finally {
      child.kill();
      await once(child, 'exit');
      await new Promise((done) => upstream.close(done));
    }
    try {
      const text = await readFile(path, 'utf8'),
        rows = text
          .trim()
          .split('\n')
          .map((s) => JSON.parse(s));
      expect(rows).toContainEqual(
        expect.objectContaining({
          status: 404,
          security_route: 'operator',
          security_method: 'GET',
        }),
      );
      expect(rows).toContainEqual(
        expect.objectContaining({
          status: 401,
          security_route: 'auth.login',
          security_method: 'POST',
        }),
      );
      expect(text).not.toMatch(/SECRET|127\.0\.0\.1|"request":|"resp_headers":|"headers":/);
      expect((await stat(path)).mode & 0o077).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  15000,
);
