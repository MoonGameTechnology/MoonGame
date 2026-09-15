// Reproducible CPU comparison of the retired and compact maps. No DOM, canvas or GPU.
// Run from the repository root: node prototype/frontierperf.mjs
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';

const bundled = await build({
  stdin: {
    contents: `export { newGame, networkSeats } from './prototype/src/matchSetup';
    export { advance, order } from './prototype/src/protoKernel';
    export { aiOrders } from './prototype/src/ai';
    export { HOUR } from './prototype/src/game';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { newGame, networkSeats, advance, order, aiOrders, HOUR } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const stats = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return {
    median: b[Math.floor(b.length / 2)],
    p95: b[Math.floor(b.length * 0.95)],
    max: b.at(-1),
  };
};
const report = {};
for (const id of ['frontier-100', 'frontier-50']) {
  const seed = newGame({
    mapId: id,
    seed: 'frontier-perf-1',
    seats: networkSeats('ffa', id).map((s, i) => ({ ...s, ai: i > 0 })),
  });
  const idle = [],
    rounds = [];
  let actions = 0;
  // Identical time progression and weak-AI policy, differing only in map content.
  for (let trial = 0; trial < 3; trial++) {
    let state = globalThis.structuredClone(seed);
    for (let frame = 1; frame <= 30; frame++) {
      const start = performance.now();
      const next = advance(state, frame * 1600); // a 16 ms frame at the player's x100
      if (next.error) throw new Error(next.error);
      state = next.state;
      if (frame > 5) idle.push(performance.now() - start);
    }
    const next = advance(state, 2 * HOUR);
    if (next.error) throw new Error(next.error);
    state = next.state;
    const start = performance.now();
    let count = 0;
    for (const p of Object.values(state.players))
      if (p.ai) {
        for (const a of aiOrders(state, p.id, 'expand', 'weak')) {
          const applied = order(state, a, state.time);
          state = applied.state;
          count++;
        }
      }
    rounds.push(performance.now() - start);
    actions = count;
  }
  report[id] = {
    provinces: Object.keys(seed.planets).length,
    players: Object.keys(seed.players).length,
    fleets: Object.keys(seed.fleets).length,
    diplomacyPairs: Object.keys(seed.diplomacy).length,
    snapshotBytes: Buffer.byteLength(JSON.stringify(seed)),
    advanceMs: stats(idle),
    aiRoundMs: stats(rounds),
    actions,
  };
  console.log(JSON.stringify({ map: id, ...report[id] }));
}
console.log(`FRONTIER_PERF_JSON ${JSON.stringify(report)}`);
