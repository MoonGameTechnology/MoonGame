import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createExporter } from './game-exporter.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
let game;
beforeAll(async () => {
  // This is the same build entry and emitted file Docker CMD runs, not the alternate host.
  await promisify(execFile)(process.execPath, ['prototype/bundle-netserver.mjs'], { cwd: root, timeout: 45000, maxBuffer: 65536 });
}, 50000);
afterAll(async () => { if (game?.exitCode === null) { game.kill('SIGTERM'); await once(game, 'exit'); } });

async function startGame(port = 0) {
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), GATE: '1', SEAT_LOCK: '1', PROD: '0', MATCHES: '1', TIME_SCALE: '1' };
  for (const key of ['DATABASE_URL', 'AUTH_JWT_SECRET', 'AUTH_JWT_PREVIOUS_SECRET', 'METRICS_TOKEN', 'ALLOWED_ORIGINS', 'TLS_KEY_FILE', 'TLS_CERT_FILE', 'CORPORATIONS_URL', 'CORPORATION_SERVICE_URL']) delete env[key];
  game = spawn(process.execPath, ['packages/server/dist/proto-server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('E_OBS_TEST_START')), 20000);
    const onExit = () => { clearTimeout(timer); reject(new Error('E_OBS_TEST_EXIT')); };
    game.once('exit', onExit);
    const read = (chunk) => {
      log = (log + chunk.toString()).slice(-65536);
      const match = /health\s*:\s*http:\/\/[^:]+:(\d+)\/health/.exec(log);
      if (match) { clearTimeout(timer); game.off('exit', onExit); resolve(Number(match[1])); }
    };
    game.stdout.on('data', read); game.stderr.on('data', read);
  });
}

it('reads the live production bundle and observes a Game counter reset without adding offsets', async () => {
  const port = await startGame();
  const exporter = createExporter({ sourcePort: port });
  let text = await exporter.scrape();
  for (const source of ['health', 'ready', 'metrics', 'summary']) expect(text).toContain(`moongame_source_up{source="${source}"} 1`);
  expect(text).toContain('moongame_matches 1');
  expect(text).toContain('moongame_connections 0');
  expect(text).toContain('moongame_joins_total 0');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/matches/proto?nick=ObsFixture`);
  try {
    await once(ws, 'message');
    text = await exporter.scrape();
    expect(text).toContain('moongame_connections 1');
    expect(text).toContain('moongame_joins_total 1');
    expect(await createExporter({ sourcePort: port }).scrape()).toContain('moongame_joins_total 1');
  } finally { ws.terminate(); }
  game.kill('SIGTERM'); await once(game, 'exit');
  text = await exporter.scrape();
  expect(text).toContain('moongame_source_up{source="summary"} 0');
  expect(text).not.toContain('moongame_joins_total');
  await startGame(port);
  text = await exporter.scrape();
  expect(text).toContain('moongame_joins_total 0');
  expect(text).toContain('moongame_connections 0');
}, 45000);
