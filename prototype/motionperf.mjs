// CPU only: identical 831-province input, uncached/cached pan and batched/sliced AI.
// Run from the repository root: node prototype/motionperf.mjs
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const bundled = await build({
  stdin: {
    contents: `export { newGame, networkSeats } from './prototype/src/matchSetup';
      export { advance, order } from './prototype/src/protoKernel';
      export { aiOrders } from './prototype/src/ai';
      export { StaggeredAi } from './prototype/src/aiScheduler';
      export { aiOrderSlices } from './prototype/src/aiOrderSlices';
      export { HOUR } from './prototype/src/time';
      export { mapPreset } from './prototype/src/mapCatalog';
      export { frontierOutline } from './prototype/src/frontierOutline';
      export { provinceSeeds } from './prototype/src/provinceMap';
      export { computePowerCells } from './packages/client/src/territory';
      export { TerritoryGeometryCache, projectTerritoryCells } from './packages/client/src/territoryCache';
      export { fitTransform, worldToScreen } from './packages/client/src/camera';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const stats = (times) => {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};
const id = 'frontier-50';
const initial = api.newGame({
  mapId: id,
  seed: 'motion-perf-1',
  seats: api.networkSeats('ffa', id).map((seat, i) => ({ ...seat, ai: i > 0 })),
});
const map = api.mapPreset(id).nodes;
const bounds = {
  minX: Math.min(...map.map((n) => n.x)),
  maxX: Math.max(...map.map((n) => n.x)),
  minY: Math.min(...map.map((n) => n.y)),
  maxY: Math.max(...map.map((n) => n.y)),
};
const viewport = { left: 0, right: 390, top: 130, bottom: 740 };
const fitScale = api.fitTransform(viewport, bounds).scale;
const outline = api.frontierOutline(map);
const worldClip = outline.map(({ x, y }) => [x, y]);
const cache = new api.TerritoryGeometryCache();
const pan = { uncached: [], cached: [] };
let vertices = 0;
// Alternate paths per camera: warm-up 5, measure 60 identical pan positions.
for (let frame = 0; frame < 65; frame++) {
  const cam = { x: frame * 3, y: frame * -2, scale: 2 };
  const project = (n) => api.worldToScreen(n, cam, viewport, bounds);
  let start = performance.now();
  const directSeeds = api.provinceSeeds(map, cam.scale, (n) => ({
    at: project(n),
    size: initial.planets[n.id].size ?? 1,
    owner: null,
  }));
  const direct = api.computePowerCells(
    directSeeds,
    outline.map((n) => {
      const p = project(n);
      return [p.x, p.y];
    }),
  );
  const directMs = performance.now() - start;
  start = performance.now();
  const seeds = api.provinceSeeds(map, 1 / fitScale, (n) => ({
    at: n,
    size: initial.planets[n.id].size ?? 1,
    owner: null,
  }));
  const projected = api.projectTerritoryCells(
    cache.cells(seeds, worldClip),
    fitScale * cam.scale,
    project({ x: 0, y: 0 }),
  );
  const cachedMs = performance.now() - start;
  if (frame >= 5) {
    pan.uncached.push(directMs);
    pan.cached.push(cachedMs);
  }
  if (direct.length !== projected.length) throw new Error('Lost province');
  for (let i = 0; i < direct.length; i++) {
    const a = direct[i],
      b = projected[i];
    if (a.poly.length !== b.poly.length) throw new Error('Changed topology');
    for (let k = 0; k < a.poly.length; k++)
      for (let axis = 0; axis < 2; axis++) {
        if (Math.abs(a.poly[k][axis] - b.poly[k][axis]) > 0.0001)
          throw new Error('Changed geometry');
      }
  }
  vertices = projected.reduce((sum, cell) => sum + cell.poly.length, 0);
}
const ai = { batched: [], slices: [], planning: [], applying: [] };
let actionCount = 0;
for (let trial = 0; trial < 3; trial++) {
  const advanced = api.advance(globalThis.structuredClone(initial), 2 * api.HOUR);
  if (advanced.error) throw new Error(advanced.error);
  let state = advanced.state;
  const seats = Object.keys(state.players);
  let start = performance.now();
  for (const seat of seats)
    if (state.players[seat].ai) {
      for (const action of api.aiOrders(state, seat))
        state = api.order(state, action, state.time).state;
    }
  ai.batched.push(performance.now() - start);
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const expected = digest(state);
  state = globalThis.structuredClone(advanced.state);
  const scheduler = new api.StaggeredAi(2 * api.HOUR);
  actionCount = 0;
  for (let slice = 0; slice < 10000; slice++) {
    start = performance.now();
    const step = scheduler.step(
      state.time,
      seats,
      (seat) => (state.players[seat].ai ? 'expand' : null),
      (seat) => {
        const before = performance.now();
        const actions = api.aiOrders(state, seat);
        ai.planning.push(performance.now() - before);
        return api.aiOrderSlices(actions);
      },
    );
    for (const action of step.action ?? []) {
      const before = performance.now();
      state = api.order(state, action, state.time).state;
      ai.applying.push(performance.now() - before);
      actionCount++;
    }
    if (!step.worked) break;
    ai.slices.push(performance.now() - start);
    if (slice === 9999) throw new Error('Unbounded AI backlog');
  }
  if (digest(state) !== expected)
    throw new Error('Slicing changed order/results at the same game time');
}
console.log(
  `MOTION_PERF_JSON ${JSON.stringify({ provinces: map.length, vertices, pan: { uncached: stats(pan.uncached), cached: stats(pan.cached) }, ai: Object.fromEntries(Object.entries(ai).map(([k, times]) => [k, stats(times)])), actionCount, identicalAiState: true })}`,
);
