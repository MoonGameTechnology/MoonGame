// M2 headless perf harness (docs/metrics-roadmap.md): bundle the prototype like
// uitest.mjs, run its REAL render loop against the fake DOM/canvas, and measure
// the CPU cost of a frame (avg/p95/max) in three scenarios — idle, pan, zoom.
// Draw calls hit a no-op canvas proxy, so this measures the main-thread work
// (sim + scene math + render-path logic) — the regression source a code change
// can introduce — not GPU compositing. Budgets follow the doc's category C
// target (frame time p95 < 20 ms).
//
//   pnpm run perf              # report, always exit 0 (non-blocking, CI-friendly)
//   PERF_STRICT=1 pnpm run perf  # exit 1 when a budget is exceeded (local gate)
//   PERF_MAP=frontier-100 PERF_REVEAL=1 PERF_PAUSE=1 pnpm run perf
//   PERF_MAP=frontier-100 PERF_VERIFY_LOD=1 pnpm run perf  # render/fog/picking checks
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers';

const listeners = new Map(); // el -> {type: [fn]}
function mkEl(id) {
  const el = {
    id,
    style: { removeProperty(name) { delete this[name]; }, setProperty(name, value) { this[name] = value; }, getPropertyPriority() { return ''; } },
    setAttribute(name, value) { this[name] = String(value); },
    removeAttribute(name) { delete this[name]; },
    parentNode: null,
    get nextSibling() {
      const siblings = this.parentNode?._children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    },
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    _children: [],
    set innerHTML(v) {
      this._html = v;
    },
    get innerHTML() {
      return this._html ?? '';
    },
    textContent: '',
    focus() { globalThis.document.activeElement = this; },
    addEventListener(type, fn) {
      const m = listeners.get(this) ?? {};
      (m[type] ??= []).push(fn);
      listeners.set(this, m);
    },
    appendChild(child) {
      child.parentNode?.removeChild(child);
      this._children.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child, before) {
      child.parentNode?.removeChild(child);
      const index = this._children.indexOf(before);
      this._children.splice(index < 0 ? this._children.length : index, 0, child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this._children = this._children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    remove() {},
    get children() {
      return this._children;
    },
    get firstElementChild() {
      return this._children[0] ?? null;
    },
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 };
    },
    querySelector() { return null; },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return this._context ??= makeContext(this);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    width: 900,
    height: 600,
  };
  return el;
}
// Typed probes must return their real kind of value. A truthy no-op function from
// isContextLost() used to skip EVERY paint while the harness reported a fast frame.
let drawCalls = 0;
function makeContext(canvas) {
  const stack = [];
  const state = { canvas, globalAlpha: 1, lineWidth: 1 };
  const methods = {
    isContextLost: () => false,
    getContextAttributes: () => ({}),
    measureText: (value) => ({ width: String(value).length * 6 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} }),
    save: () => stack.push(state.globalAlpha),
    restore: () => { state.globalAlpha = stack.pop() ?? 1; },
  };
  return new Proxy(state, {
    get: (target, key) => key in target ? target[key] :
      (methods[key] ??= () => { drawCalls++; }),
    set: (target, key, value) => { target[key] = value; return true; },
  });
}

const els = new Map();
const getEl = (id) => {
  if (!els.has(id)) {
    const attached = globalThis.document?.body?._children.find((child) => child.id === id);
    const el = attached ?? mkEl(id);
    els.set(id, el);
    if (!attached) globalThis.document?.body?.appendChild(el);
  }
  return els.get(id);
};

globalThis.document = {
  getElementById: getEl,
  querySelector: () => mkEl('q'),
  querySelectorAll: () => [],
  createElement: () => mkEl('canvas'),
  createComment: () => ({ ...mkEl('comment'), nodeType: 8 }),
  body: mkEl('body'),
  // Document-level listeners (contextmenu, key handling, …) are registered at import
  // time. The harness drives input by calling handlers directly (see `fire` below),
  // so these only need to exist — but they DO need to exist, or the bundle throws
  // before the first frame is ever measured.
  addEventListener() {},
  removeEventListener() {},
};
// The game clock the render loop reads — advances a fixed 16 ms per call so every
// run walks the same simulated timeline (measurement uses hrtime, below).
let t = 0;
// Only `now` is faked (so every run walks the same simulated timeline). Everything else
// delegates to the real `performance` — Node's own fetch internals call
// `performance.markResourceTiming`, and a bare `{ now }` stub made the process die on the
// async tail AFTER the report had already printed.
const realPerformance = globalThis.performance;
globalThis.performance = new Proxy(realPerformance, {
  get(target, prop) {
    if (prop === 'now') return () => (t += 16);
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
// The pan path (clampCam → panelSlack) probes panel visibility via computed style.
globalThis.getComputedStyle = () => ({ display: 'block' });
// Ship archetypes are drawn from cached Path2D objects. The canvas context here is a
// swallow-everything proxy, so the path only has to be constructible — but it does have
// to exist, since the cache builds one on the very first rendered frame.
globalThis.Path2D = class Path2D {
  constructor() { return new Proxy(this, { get: () => () => {} }); }
};
globalThis.window = {
  innerWidth: 900,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener() {},
  matchMedia: globalThis.matchMedia,
  setTimeout,
  clearTimeout,
};
globalThis.addEventListener = globalThis.window.addEventListener;
globalThis.history = { pushState() {}, back() {} };
globalThis.location = { protocol: 'file:', host: '', hostname: '', href: 'file:///', search: '' };
const rafCbs = [];
globalThis.requestAnimationFrame = (cb) => {
  rafCbs.push(cb);
  return rafCbs.length;
};

// A benchmark-only bridge; it is absent from both shipped profiles.
const bridge = `
let perfPaints = 0;
let perfSpheres = 0;
const perfSphere = blitSphere;
blitSphere = function(...args) { perfSpheres++; perfSphere(...args); };
const perfRender = render;
render = function(now) { perfPaints++; perfRender(now); };
module.exports = {
  ready: () => !mapPreparation.active || mapPreparation.ready,
  paints: () => perfPaints,
  scene: () => ({ nodes: MAP.length, known: MAP.filter(n => known(n.id)).length,
    holo: holographicMapOn(), scale: cam.scale, paused: speed === 0 }),
  verifyView: (gap, reveal) => {
    speed = 0;
    const before = JSON.stringify(s);
    const home = Object.values(s.planets).find(p => p.owner === ME);
    const fleet = Object.values(s.fleets).find(f => f.owner === ME);
    const scale = gap / (mapNodeSpacing * camFitTransform(insets(), mapBounds()).scale);
    centerOn(home.position, scale);
    vision = reveal ? null : computeVision();
    memory.clear();
    if (vision) updateMemory(vision.identify);
    clearSelection(); selPlanet = home.id;
    render(2000); // warm static layers and atlases at this density
    perfSpheres = 0;
    const rings = [];
    let questions = 0;
    const arc = cx.arc, fillText = cx.fillText;
    cx.arc = function(x, y, r, ...rest) {
      if (cx.strokeStyle === '#506773' && cx.lineWidth === 0.85) rings.push([x, y, r]);
      return arc.call(cx, x, y, r, ...rest);
    };
    cx.fillText = function(label, ...rest) {
      if (label === '?') questions++;
      return fillText.call(cx, label, ...rest);
    };
    render(2000);
    cx.arc = arc; cx.fillText = fillText;
    const lod = currentMapLod();
    const expected = MAP.filter(n => s.planets[n.id] && visible(world(n), 10))
      .map(n => { const p = world(n); return [p.x, p.y, lod.markerRadius]; });
    const a = fleetAnchor(fleet);
    selectAt(a.x, a.y); // same map-tap path as pointer/touch input
    return { lod, spheres: perfSpheres, terrain: terrainFields.length,
      allMarkers: JSON.stringify(rings) === JSON.stringify(expected), questions,
      pickedFleet: selFleet === fleet.id || selFleets.has(fleet.id),
      sensing: sweepOn && sweepArms.length > 0,
      known: MAP.filter(n => known(n.id)).length,
      stateUnchanged: JSON.stringify(s) === before };
  },
  configure: (id, scale, reveal, pause) => {
    if (id) {
      const preset = mapPreset(id);
      installMatch(newGame({ mapId: preset.id, seats: preset.starts.map((start, i) =>
        ({ id: 'p' + (i + 1), name: 'P' + (i + 1), faction: SEAT_META[i].faction, start, ai: false })) }), new Map());
    }
    if (scale) { cam.scale = scale; cam.x = 0; cam.y = 0; }
    if (reveal) { sandboxConfig.enabled = true; sandboxConfig.fog = false; }
    if (pause) speed = 0;
  }
};`;
const res = await build({
  stdin: { contents: readFileSync('prototype/src/main.ts', 'utf8') + bridge,
    resolveDir: process.cwd() + '/prototype/src', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  loader: { '.webp': 'dataurl' },
  write: false,
  // The build profile is a REQUIRED define (see main.ts) — without it the bundle
  // keeps a bare `__PLAYER_BUILD__` and dies with a ReferenceError on first read.
  // Profile the full dev client, same as uitest.mjs and dist/void-dominion.html.
  define: { __PLAYER_BUILD__: 'false', __SECTOR_ZERO_ONLY__: 'false' },
});

const mod = { exports: {} };
const frameErrors = [];
const printError = console.error;
console.error = (...args) => {
  if (String(args[0]).startsWith('frame fail')) frameErrors.push(args[1] ?? args[0]);
  printError(...args);
};
const fn = new Function('module', 'exports', 'require', res.outputFiles[0].text);
fn(mod, mod.exports, () => ({}));
mod.exports.configure(process.env.PERF_MAP, Number(process.env.PERF_SCALE) || 0,
  process.env.PERF_REVEAL === '1', process.env.PERF_PAUSE === '1' || process.env.PERF_VERIFY_LOD === '1');

// Profile a visible match. The real entry screens are opaque, so their covered
// canvas must not be mistaken for the renderer workload this harness measures.
for (const id of ['connect', 'hub', 'setup']) getEl(id).style.display = 'none';

const canvas = getEl('map');
const fire = (type, ev) => {
  for (const h of (listeners.get(canvas) ?? {})[type] ?? []) h(ev);
};
const pointer = (type, x, y) =>
  fire(type, {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
  });
const wheel = (deltaY) =>
  fire('wheel', { clientX: 450, clientY: 300, deltaY, preventDefault() {} });

/** Run one frame callback and return its CPU cost in ms (hrtime — the stubbed
 *  performance.now is the game's clock, not the measurement's). */
function runFrame() {
  const callbacks = rafCbs.splice(0);
  if (!callbacks.length) return null;
  const start = process.hrtime.bigint();
  const now = performance.now();
  for (const cb of callbacks) cb(now);
  return Number(process.hrtime.bigint() - start) / 1e6;
}

/** Drive `frames` frames, calling `input(i)` before each, and collect costs. */
function scenario(frames, input) {
  const costs = [];
  for (let i = 0; i < frames; i++) {
    input?.(i);
    const ms = runFrame();
    if (ms === null) break;
    costs.push(ms);
  }
  return costs;
}

function stat(costs) {
  const sorted = [...costs].sort((a, b) => a - b);
  const avg = costs.reduce((s, v) => s + v, 0) / (costs.length || 1);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  const max = sorted.at(-1) ?? 0;
  return { frames: costs.length, avg, p95, max };
}

// Finish cooperative map loading (including promise continuations) BEFORE warm-up.
for (let i = 0; i < 5000; i++) {
  runFrame();
  await new Promise(setImmediate);
  assert.equal(frameErrors.length, 0, 'a recovered frame failure is still a failed benchmark');
  if (mod.exports.ready() && mod.exports.paints() > 0) break;
}
assert(mod.exports.ready() && mod.exports.paints() > 0, 'benchmark must reach the live map');
console.log('PERF_SCENE ' + JSON.stringify(mod.exports.scene()));
if (process.env.PERF_VERIFY_LOD === '1') {
  for (const reveal of [true, false]) {
    for (const gap of [20, 48, 110, 20]) {
      const sample = mod.exports.verifyView(gap, reveal);
      assert(sample.stateUnchanged, 'zoom and drawing must not alter simulation state');
      assert(sample.pickedFleet, 'the visible fleet anchor must remain selectable at every LOD');
      assert(sample.sensing, 'schematic mode must retain radar sensing');
      if (sample.lod.art === 0) {
        assert.equal(sample.spheres, 0, 'overview must not call the sphere renderer');
        assert.equal(sample.terrain, 0, 'overview must not prepare or draw terrain');
        assert(sample.allMarkers, 'every province and empty waypoint must have one identical ring');
        assert.equal(sample.questions, 0, 'overview contains no revealing question marks');
      }
      if (gap === 110) {
        assert.equal(sample.lod.detail, 1);
        assert(sample.spheres > 0, 'planet art returns on approach');
      }
      if (!reveal) assert(sample.known < mod.exports.scene().nodes, 'zoom must not reveal the map');
      console.log('LOD_CHECK ' + JSON.stringify({ gap, reveal, ...sample }));
    }
  }
  assert.equal(frameErrors.length, 0);
  process.exit(0);
}
// Warm-up: JIT + the lazily-baked sprites/map layers settle before we measure.
scenario(30);
const paintsBefore = mod.exports.paints();
drawCalls = 0;

const FRAMES = 120;
const results = {
  idle: stat(scenario(FRAMES)),
  pan: stat(
    scenario(FRAMES, (i) => {
      // one long drag across the map: down once, then a moving pointer every frame
      if (i === 0) pointer('pointerdown', 450, 300);
      else pointer('pointermove', 450 + Math.sin(i / 10) * 200, 300 + Math.cos(i / 10) * 120);
      if (i === FRAMES - 1) pointer('pointerup', 450, 300);
    }),
  ),
  zoom: stat(
    scenario(FRAMES, (i) => {
      wheel(i % 20 < 10 ? -100 : 100); // breathe in and out around the map centre
    }),
  ),
};

// Budgets: the doc's C-category target is frame-time p95 < 20 ms. Interaction
// scenarios get a little headroom (they add input handling + camera math).
const BUDGET_P95_MS = { idle: 20, pan: 25, zoom: 25 };
assert.equal(frameErrors.length, 0, 'the measured frames must not silently fail');
assert.equal(mod.exports.paints() - paintsBefore, FRAMES * 3, 'every sample must paint the map');
assert(drawCalls > 0, 'a lost or hidden canvas is not a render benchmark');
console.error = printError;

let failed = false;
const lines = ['── perf report (CPU frame cost, headless — no GPU) ──'];
for (const [name, s] of Object.entries(results)) {
  const budget = BUDGET_P95_MS[name];
  const over = s.p95 > budget;
  failed ||= over;
  lines.push(
    `  ${name.padEnd(5)}: avg ${s.avg.toFixed(2)}ms · p95 ${s.p95.toFixed(2)}ms · max ${s.max.toFixed(2)}ms` +
      `  (${s.frames} frames, budget p95 ≤ ${budget}ms${over ? ' — EXCEEDED' : ''})`,
  );
}
lines.push('──────────────────────────────────────────────────────');
console.log(lines.join('\n'));
// Machine-readable line for trend tracking (a future M3 collector can grep it).
console.log('PERF_JSON ' + JSON.stringify(results));
console.log('PERF_DRAWS ' + drawCalls);

if (failed && process.env.PERF_STRICT === '1') {
  console.error('perf budget exceeded (PERF_STRICT=1) — failing');
  process.exit(1);
}
