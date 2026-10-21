#!/usr/bin/env node
/** Isolated scheduler comparison, NOT a production CPU/RAM capacity estimate.
 * Same 50 seats and bot decisions, 24 game hours at x24, no scheduled world events.
 * Compares the archive's fixed polling cadence with eligible-actor deadlines. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: `export { StaggeredAi } from './prototype/src/aiScheduler';
      export { startClockDriver } from './packages/server/src/clockDriver';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const mod = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(mod, mod.exports);
const { StaggeredAi, startClockDriver } = mod.exports;
const HOUR = 3_600_000;
const period = 2 * HOUR;
const scale = 24;
const duration = 24 * HOUR / scale;
const seats = Array.from({ length: 50 }, (_, i) => `p${i}`);

function run(bots, deadlines) {
  let wall = 0;
  let wakes = 0;
  let pending = null;
  const trace = [];
  const policy = (seat) => Number(seat.slice(1)) >= seats.length - bots ? 'bot' : null;
  const ai = new StaggeredAi(period);
  ai.reset(0);
  const room = {
    isClockRunning: true, peerCount: 0,
    msUntilNextEvent: () => null,
    tick: () => { wakes++; return true; },
  };
  const driver = startClockDriver(room, {
    now: () => wall,
    schedule: (fn, ms) => { pending = { fn, at: wall + ms }; return pending; },
    cancel: () => { pending = null; },
    maxDelayMs: HOUR,
    backgroundHeartbeatMs: () => {
      if (!bots) return null;
      if (!deadlines) return period / (scale * seats.length);
      const delay = ai.nextDelay(wall * scale, seats, policy);
      return delay === null ? null : Math.max(1000, delay / scale);
    },
    onTick: () => {
      while (ai.step(wall * scale, seats, policy, (seat) => {
        trace.push([wall * scale, seat]);
        return [];
      }).worked) { /* no orders: measure idle scheduling only */ }
    },
  });
  while (pending && pending.at <= duration) {
    const timer = pending;
    pending = null;
    wall = timer.at;
    timer.fn();
  }
  driver.stop();
  return { wakes, trace };
}
for (const bots of [0, 2, 10, 20]) {
  const before = run(bots, false);
  const after = run(bots, true);
  assert.deepEqual(after.trace, before.trace, 'bot decisions and exact game times must agree');
  assert.equal(after.trace.length, bots * 12);
  assert.ok(after.wakes <= before.wakes);
  console.log(JSON.stringify({ seats: 50, bots, gameHours: 24, timeScale: scale,
    pollingWakes: before.wakes, deadlineWakes: after.wakes,
    decisions: after.trace.length, sameDecisions: true,
    note: 'No world events, connected players, AI planning, persistence or CPU/RAM load measured.' }));
}
