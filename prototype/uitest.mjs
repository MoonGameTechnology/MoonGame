// Headless smoke test for the browser UI: bundle main.ts for node, run it
// against a fake DOM/canvas, drive several animation frames + a click, and
// assert nothing throws. Not a substitute for a real browser, but it exercises
// init, the real-time loop, rendering calls, the side panel and input.
import { build } from 'esbuild';
import assert from 'node:assert/strict';

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
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    getContext() {
      return ctxProxy;
    },
    setPointerCapture() {},
    width: 900,
    height: 600,
  };
  return el;
}
// Chainable stub: every method returns the proxy, so e.g.
// createRadialGradient(...).addColorStop(...) works.
const ctxProxy = new Proxy(
  {},
  {
    get: () => () => ctxProxy,
    set: () => true,
  },
);

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
  addEventListener() {},
  getElementById: getEl,
  querySelector: () => mkEl('q'), // tab/overlay wiring uses it; a stub element is enough
  querySelectorAll: () => [],
  // The prototype bakes offscreen canvases (glow sprites, the static map layer) via
  // document.createElement('canvas') at module load — give the stub a real element
  // (its getContext returns the chainable ctx proxy) so the render path runs.
  createElement: () => mkEl('canvas'),
  createComment: () => ({ ...mkEl('comment'), nodeType: 8 }),
  body: mkEl('body'),
};
let t = 0;
const realPerformance = globalThis.performance;
globalThis.performance = new Proxy(realPerformance, {
  get(target, prop) {
    if (prop === 'now') return () => (t += 16);
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
globalThis.Path2D = class Path2D {};
// Net-mode reads localStorage for the saved server URL; stub it (no persistence).
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// resize() probes coarse-pointer media to spot phones; the fake DOM is a desktop.
globalThis.matchMedia = () => ({ matches: false });
globalThis.getComputedStyle = (el) => ({ display: el.style.display ?? 'block' });
// The APK Back integration wires popstate/history straight on window at module
// load — give the fake DOM a minimal window + history so init runs headless.
globalThis.window = {
  innerWidth: 900,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener() {},
  matchMedia: globalThis.matchMedia,
  setTimeout,
  clearTimeout,
};
globalThis.history = { pushState() {}, back() {} };
globalThis.location = { protocol: 'file:', host: '', hostname: '', href: 'file:///', search: '' };
const rafCbs = [];
globalThis.requestAnimationFrame = (cb) => {
  rafCbs.push(cb);
  return rafCbs.length;
};

const res = await build({
  entryPoints: ['prototype/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  loader: { '.webp': 'dataurl' },
  write: false,
  // The build profile is a REQUIRED define (see main.ts) — the smoke test drives
  // the full dev client, same as dist/void-dominion.html.
  define: { __PLAYER_BUILD__: 'false' },
});

const mod = { exports: {} };
// Production keeps scheduling after a failed frame. The smoke test must still fail
// when that recovery path logs a render error, rather than report healthy frames.
const frameErrors = [];
const printError = console.error;
console.error = (...args) => {
  if (String(args[0]).startsWith('frame fail')) frameErrors.push(args[1] ?? args[0]);
  printError(...args);
};
const fn = new Function('module', 'exports', 'require', res.outputFiles[0].text);
fn(mod, mod.exports, () => ({}));

// drive ~40 frames (~0.6s real → with speed 2 ≈ many game hours)
let frames = 0;
for (let i = 0; i < 40 && rafCbs.length; i++) {
  const cb = rafCbs.shift();
  cb(performance.now());
  frames++;
}

// Drive the actual pointer handlers: a synthetic `click` no longer reaches map input.
const canvas = getEl('map');
for (const type of ['pointerdown', 'pointerup']) {
  const handlers = (listeners.get(canvas) ?? {})[type] ?? [];
  assert.ok(handlers.length, `map must register ${type}`);
  for (const handler of handlers)
    handler({
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 450,
      clientY: 300,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    });
}
const sideEl = getEl('side');
const sideClicks = (listeners.get(sideEl) ?? {}).click ?? [];
for (const fn2 of sideClicks)
  fn2({
    target: { closest: () => ({ disabled: false, dataset: { act: 'build', arg: 'refinery' } }) },
  });

// a few more frames after interaction
for (let i = 0; i < 20 && rafCbs.length; i++) {
  rafCbs.shift()(performance.now());
  frames++;
}

assert.equal(frameErrors.length, 0, 'the render loop must not silently recover from a broken frame');
console.error = printError;
console.log(
  `UI OK — ran ${frames} frames + clicks with no throw. clock="${getEl('clock').textContent}"`,
);
console.log(`purse="${getEl('purse').textContent}"`);
console.log(`log has ${(getEl('log').innerHTML.match(/<div>/g) || []).length} lines`);
