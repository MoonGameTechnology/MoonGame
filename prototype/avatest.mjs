#!/usr/bin/env node
/* global AbortSignal, localStorage, document, getComputedStyle */
/** CORP-5: a corporations battle on the players' host, end to end over HTTP, WS and the
 * browser. Run after `pnpm prototype`: the exact netserver bundle of the production image,
 * against a throwaway database created next to the given local `*_test` one
 * (AVA_TEST_DATABASE_URL) and dropped after. The matchups are written straight into the
 * store — the challenge and roster windows last days of real time — and everything after
 * that is the host's own doing: its first AvA pass (a minute after boot) raises the battle
 * and hands a cancelled battle's warehouse item back unworn, a member enters it from the
 * hub, the side's bot plays its empty seat while no AI touches a member's, present or
 * not, and the next pass opens the war. The hub reads the battle from both sides meanwhile
 * (CORP-9). Takes about two and a half minutes. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { bundleNetserver } from './bundle-netserver.mjs';
import { launchBrowser, waitForApp, withDiagnostics } from './harnessKit.mjs';

const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { Pool } = require('pg');

const sourceUrl = process.env.AVA_TEST_DATABASE_URL;
const source = sourceUrl ? new URL(sourceUrl) : null;
assert(
  source && ['127.0.0.1', 'localhost'].includes(source.hostname) && source.pathname.endsWith('_test'),
  'Provide a local *_test database URL in AVA_TEST_DATABASE_URL',
);
const start = Date.now();
const deadline = start + 240_000;
const report = (stage, detail = {}) => console.log(JSON.stringify({ stage, ...detail }));

const database = `ava_smoke_${randomBytes(6).toString('hex')}_test`;
const admin = new Pool({ connectionString: sourceUrl });
await admin.query(`CREATE DATABASE "${database}"`);
const url = new URL(sourceUrl);
url.pathname = `/${database}`;
const db = new Pool({ connectionString: url.href });

const picker = createServer();
await new Promise((resolve, reject) => {
  picker.once('error', reject);
  picker.listen(0, '127.0.0.1', resolve);
});
const port = picker.address().port;
await new Promise((resolve, reject) => picker.close((error) => (error ? reject(error) : resolve())));
const base = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');

report('build-production-bundle');
const bundle = await bundleNetserver();
// Allowlist process plumbing instead of inheriting endpoints/credentials from a real deployment.
const env = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);
Object.assign(env, {
  HOST: '127.0.0.1', PORT: String(port), PROD: '0', NODE_ENV: 'test',
  AUTH_JWT_SECRET: secret, ALLOWED_ORIGINS: base, AUTH_RATE_MAX: '200', GATE: '1',
  MATCHES: '1', DATABASE_URL: url.href,
  // Ten game minutes a second: the bots' two-hour planning cycle comes round in seconds.
  TIME_SCALE: '600',
  // The war opens on the first pass after the battle was raised, not a game day later.
  AVA_PEACE_MS: '1000',
  // No reconnect grace: in an ordinary match the stand-in AI would take a seat the moment
  // its player is away. A battle never lets it (corporation-wars.md §7).
  AI_GRACE_MS: '0',
});
// The AI's planning cycle — two game hours — in real time at this TIME_SCALE.
const AI_CYCLE_MS = (2 * 3_600_000) / Number(env.TIME_SCALE);
const server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let spawnError;
server.once('error', (error) => { spawnError = error; });
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => { log = (log + chunk).slice(-12_000); });
const exited = new Promise((resolve) => server.once('exit', resolve));
const killAtDeadline = setTimeout(() => server.kill('SIGKILL'), Math.max(1, deadline - Date.now()));
const killOnExit = () => server.kill('SIGKILL');
process.on('exit', killOnExit);
const secrets = [secret];
const sockets = new Set();

async function request(path, { token, body } = {}, expected = 200) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      // Operator routes accept a direct loopback peer; a session JWT is never sent there.
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${path.split('?')[0]}: ${response.status} ${payload.error ?? ''}`);
  return payload;
}

async function until(check, description, timeout) {
  const untilAt = Math.min(deadline, Date.now() + timeout);
  while (Date.now() < untilAt) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(`Host exited during ${description}`);
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out: ${description}`);
}

const suffix = randomBytes(4).toString('hex');
const password = `Smoke-aA1-${randomBytes(18).toString('base64url')}`;
async function account(name) {
  const login = `${name}${suffix}`;
  const body = await request('/auth/register', { body: { login, password } }, 201);
  secrets.push(body.token);
  return { login, token: body.token, accountId: body.accountId };
}

const battle = `smoke-${suffix}`;
const cancelled = `smoke-cancelled-${suffix}`;
const matchId = `ava-${battle}`;

/** Enter the battle with a join token; resolves on the welcome and leaves at once,
 *  unless asked to stay (the socket then closes with the run). */
function enter(joinToken, stay = false) {
  secrets.push(joinToken);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${base.replace(/^http/, 'ws')}/matches/${matchId}?token=${encodeURIComponent(joinToken)}`,
      { origin: base },
    );
    sockets.add(ws);
    const timer = setTimeout(() => reject(new Error('welcome timeout')), 5000);
    ws.once('error', (error) => { clearTimeout(timer); reject(error); });
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'error') { clearTimeout(timer); reject(new Error(`WS ${message.code}`)); }
      if (message.type === 'welcome') {
        clearTimeout(timer);
        if (!stay) ws.close();
        resolve(message);
      }
    });
  });
}

try {
  await until(async () => {
    try { return (await request('/health')).ok; } catch { return false; }
  }, 'host startup', 30_000);
  report('host-ready');

  const alpha = await account('Alpha');
  const charlie = await account('Charlie');
  const bravo = await account('Bravo');
  const outsider = await account('Outsider');
  const corpA = (await request('/corps', { token: alpha.token, body: { name: `Alpha ${suffix}` } }, 201)).corpId;
  const corpB = (await request('/corps', { token: bravo.token, body: { name: `Bravo ${suffix}` } }, 201)).corpId;

  // A locked two-on-one: the short side's empty seat goes to the host's AI. A matchup
  // cancelled after its warehouse handout. Corp A lends one hull for each of them.
  const now = Date.now();
  await db.query(
    `INSERT INTO ava_challenges(id, challenger_corp, target_corp, cost, status, created_at, expires_at, pause_ends_at)
     VALUES ($1, $2, $3, 0, 'locked', $4, $4, $4), ($5, $2, $3, 0, 'cancelled', $4, $4, $4)`,
    [battle, corpA, corpB, now, cancelled],
  );
  await db.query(
    `INSERT INTO ava_roster(matchup_id, account_id, side, source, at)
     VALUES ($1, $2, 'challenger', 'self', $5), ($1, $3, 'challenger', 'self', $5), ($1, $4, 'target', 'self', $5)`,
    [battle, alpha.accountId, charlie.accountId, bravo.accountId, now],
  );
  const warItem = `smoke-war-${suffix}`;
  const cancelItem = `smoke-cancel-${suffix}`;
  await db.query(
    `INSERT INTO arsenal(item_id, account_id, kind, form, def_id, grade, soulbound, durability, origin, acquired_at)
     VALUES ($1, $3, 'hull', 'instance', 'evac_transport', 0, false, 5, 'auction', 0),
            ($2, $3, 'hull', 'instance', 'cruiser', 0, false, 5, 'auction', 0)`,
    [warItem, cancelItem, corpA],
  );
  await db.query(
    `INSERT INTO corp_arsenal_rent(item_id, corp_id, matchup_id, account_id, rented_at)
     VALUES ($1, $3, $4, $6, 0), ($2, $3, $5, $6, 0)`,
    [warItem, cancelItem, corpA, battle, cancelled, alpha.accountId],
  );
  report('matchups-seeded', { roster: 3, handouts: 2 });

  // 1. The first AvA pass raises the battle; its roster finds it among their own matches.
  const listed = await until(async () => {
    const lists = await request('/matches', { token: alpha.token });
    return lists.active.find((row) => row.matchId === matchId) ?? false;
  }, 'the first AvA pass raises the battle', 100_000);
  assert.equal(listed.mapId, 'team-2v2'); // CORP-8: a 2-on-2 is played on the main-game team map
  assert.equal(listed.entryOpen, false, 'nobody queues into a battle: its roster holds every seat');
  for (const member of [charlie, bravo]) {
    const lists = await request('/matches', { token: member.token });
    assert.ok(lists.active.some((row) => row.matchId === matchId), `${member.login} sees the battle`);
  }
  const strangers = await request('/matches', { token: outsider.token });
  assert.ok(
    ![...strangers.available, ...strangers.active].some((row) => row.matchId === matchId),
    'a battle is never offered outside its roster',
  );
  const { rows: [session] } = await db.query('SELECT seats FROM ava_sessions WHERE match_id = $1', [matchId]);
  assert.deepEqual(Object.keys(session.seats).sort(), [alpha.accountId, bravo.accountId, charlie.accountId].sort());
  assert.deepEqual(Object.values(session.seats).sort(), ['slot_1', 'slot_2', 'slot_3']);
  const seat = session.seats[alpha.accountId];
  const { rows: [raised] } = await db.query('SELECT state FROM matches WHERE id = $1', [matchId]);
  assert.equal(raised.state.mapId, 'team-2v2');
  assert.equal(raised.state.players['bot:slot_4']?.ai, true);
  assert.ok(raised.state.players[seat].arsenal.hulls.includes('evac_transport'), 'the handout rides into the battle deck');
  assert.ok(!raised.state.players[session.seats[charlie.accountId]].arsenal.hulls.includes('evac_transport'));
  report('battle-raised', { matchId, mapId: listed.mapId, sinceBootMs: Date.now() - start });

  // CORP-9: the «Битвы» tab. The corporations list the battle among the challenges, and the
  // host running it shows a side its war: at peace the rival is a headcount, and a
  // corporation outside the matchup sees nothing.
  const tab = await request('/ava/battles', { token: alpha.token });
  assert.deepEqual(
    tab.challenges.map((row) => `${row.id}:${row.status}`).sort(),
    [`${battle}:locked`, `${cancelled}:cancelled`].sort(),
  );
  assert.equal(tab.names[corpB], (await request(`/corps/${corpB}`, { token: alpha.token })).corp.name);
  const peace = await request(`/ava-war/${battle}`, { token: alpha.token });
  assert.equal(peace.phase, 'peace');
  assert.equal(peace.side, 'challenger');
  assert.equal(peace.scoreGoal, 3080); // team-2v2: 2 200 × 2 seats × 0.7
  assert.deepEqual(peace.mine.map((row) => row.login).sort(), [alpha.login, charlie.login].sort());
  assert.deepEqual(peace.rivals, { count: 1 });
  assert.equal((await request(`/ava-war/${battle}`, { token: outsider.token }, 403)).error, 'E_FORBIDDEN');
  report('war-view-peace', { rivals: peace.rivals.count });

  // 2. The same pass hands the cancelled battle's item back unworn; the war's stays out.
  await until(
    async () => (await db.query('SELECT 1 FROM corp_arsenal_rent WHERE item_id = $1', [cancelItem])).rowCount === 0,
    'the cancelled battle returns its handout',
    15_000,
  );
  const { rows: [returned] } = await db.query('SELECT account_id, durability FROM arsenal WHERE item_id = $1', [cancelItem]);
  assert.deepEqual(returned, { account_id: corpA, durability: 5 });
  assert.equal((await db.query('SELECT 1 FROM corp_arsenal_rent WHERE item_id = $1', [warItem])).rowCount, 1);
  report('cancelled-handout-returned', { durability: returned.durability });

  // 3. Only the roster enters, each on their own seat — and a member who left comes back.
  const joined = await request(`/matches/${matchId}/join`, { token: alpha.token });
  assert.equal(joined.playerId, seat);
  const refused = await request(`/matches/${matchId}/join`, { token: outsider.token }, 403);
  assert.equal(refused.error, 'E_NOT_ROSTERED');
  assert.equal((await enter(joined.token)).playerId, seat);
  const again = await request(`/matches/${matchId}/join`, { token: alpha.token });
  assert.equal(again.playerId, seat);
  assert.equal((await enter(again.token)).playerId, seat);
  report('roster-entry', { seat, rejoined: true, outsider: refused.error });

  // 4. A member enters from the hub, the way a player does: the battle waits among their
  //    own matches under its own name, and its world opens without a page error.
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(20_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('vd.locale', 'ru'));
    await withDiagnostics(page, 'ava-battle', async () => {
      await page.goto(base);
      await waitForApp(page);
      await page.locator('#cwpass').waitFor({ state: 'visible' });
      if (!(await page.locator('#cwnick').isVisible())) await page.click('#clogin');
      await page.fill('#cwnick', bravo.login);
      await page.fill('#cwpass', password);
      await page.click('#cwgo');
      await page.locator('#hub').waitFor({ state: 'visible' });
      // New accounts acknowledge their welcome award and medal before navigating the hub.
      await page.locator('#registration-reward[open]').waitFor();
      await page.click('#registration-reward [data-reward="accept"]');
      await page.locator('#registration-reward').waitFor({ state: 'hidden' });
      await page.locator('#medal-rewards[open]').waitFor();
      await page.click('#medal-rewards [data-mreward="ok"]');
      await page.locator('#medal-rewards').waitFor({ state: 'hidden' });
      await page.click('#hub-play');
      await page.click('.mtab[data-tab="active"]');
      const row = page.locator(`#mlist .mrow[data-match="${matchId}"]`);
      assert.equal(await row.locator('.mname b').textContent(), 'Битва корпораций');
      await row.locator('.mbtn.btn-second').click();
      await page.waitForURL(new RegExp(`/game/${matchId}`));
      await page.waitForFunction(() => getComputedStyle(document.getElementById('connect')).display === 'none');
      await page.waitForTimeout(1500); // a few deltas on top of the welcome snapshot
      mkdirSync('.playwright-mcp', { recursive: true });
      await page.screenshot({ path: '.playwright-mcp/ava-battle-ru.png' });
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  report('hub-entry', { login: bravo.login, screenshot: '.playwright-mcp/ava-battle-ru.png' });

  // 5. The side's bot plays its seat. A member stays in for a whole AI cycle meanwhile, so
  //    a stand-in for the members who are away (one never came) would have had its turn too.
  //    Orders only: the host also files the war declarations and a member's seat claim on
  //    entry under the seat's name.
  const ordersOf = async (seats) =>
    (
      await db.query(
        `SELECT player_id, action_id, ok, code FROM receipts
         WHERE match_id = $1 AND player_id = ANY($2)
           AND action_id NOT LIKE 'ava-war:%' AND action_id NOT LIKE 'seat-%'`,
        [matchId, seats],
      )
    ).rows;
  await enter((await request(`/matches/${matchId}/join`, { token: alpha.token })).token, true);
  const watchedUntil = Date.now() + AI_CYCLE_MS + 2000;
  const orders = await until(async () => {
    const n = (await ordersOf(['bot:slot_4'])).filter((row) => row.ok).length;
    return Date.now() >= watchedUntil && n;
  }, 'the side’s bot plays its seat for a whole AI cycle', 60_000);
  const members = [seat, session.seats[charlie.accountId]];
  assert.deepEqual(await ordersOf(members), [], 'no AI plays a member’s seat in a battle');
  report('bot-plays', { orders, membersPlayedByAi: 0 });

  // 6. The next pass opens the war between the sides.
  await until(
    async () =>
      (await db.query('SELECT war_declared_at FROM ava_sessions WHERE match_id = $1', [matchId])).rows[0]
        ?.war_declared_at != null,
    'the next AvA pass opens the war',
    100_000,
  );
  const { rows: [atWar] } = await db.query('SELECT state FROM matches WHERE id = $1', [matchId]);
  assert.equal(atWar.state.diplomacy[[seat, 'slot_3'].sort().join('|')], 'war');
  assert.equal(atWar.state.diplomacy[['slot_1', 'slot_2'].join('|')], 'alliance');
  // At war the other side learns who it fights and who is out, never their score or land.
  const war = await request(`/ava-war/${battle}`, { token: bravo.token });
  assert.equal(war.phase, 'war');
  assert.equal(war.side, 'target');
  assert.deepEqual(war.rivals.seats.map((row) => row.login).sort(), [alpha.login, charlie.login].sort());
  assert.ok(
    war.rivals.seats.every((row) => Object.keys(row).sort().join() === 'bot,login,out'),
    'a rival seat carries no score, land or account',
  );
  report('war-view-war', { rivals: war.rivals.seats.length });
  report('PASS', { durationMs: Date.now() - start });
} catch (error) {
  let safeLog = log;
  for (const value of secrets) safeLog = safeLog.replaceAll(value, '[redacted]');
  process.stderr.write(`AvA host smoke failed: ${error.message}\n${safeLog}\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(killAtDeadline);
  for (const ws of sockets) ws.terminate();
  server.kill('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    await exited;
  }
  process.off('exit', killOnExit);
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
}
