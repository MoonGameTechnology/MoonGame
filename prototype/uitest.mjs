// Headless smoke test for the browser UI: bundle main.ts for node, run it
// against a fake DOM/canvas, drive several animation frames + a click, and
// assert nothing throws. Not a substitute for a real browser, but it exercises
// init, the real-time loop, rendering calls, the side panel and input.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const listeners = new Map(); // el -> {type: [fn]}
function mkEl(id) {
  const classes = new Set();
  const el = {
    id,
    value: '',
    style: { removeProperty(name) { delete this[name]; }, setProperty(name, value) { this[name] = value; }, getPropertyPriority() { return ''; } },
    setAttribute(name, value) { this[name] = String(value); },
    removeAttribute(name) { delete this[name]; },
    parentNode: null,
    get nextSibling() {
      const siblings = this.parentNode?._children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    },
    dataset: {},
    classList: {
      toggle(name, on) { const value = on ?? !classes.has(name); if (value) classes.add(name); else classes.delete(name); return value; },
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    focus() { globalThis.document.activeElement = this; },
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
  addEventListener(type, fn) { const m = listeners.get(this) ?? {}; (m[type] ??= []).push(fn); listeners.set(this, m); },
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
const storage = new Map();
// A returning player's old skin choice must not revive the retired interface.
storage.set('void.holography', '0');
const bootCheck = process.argv.includes('--boot-check');
const soloBootCheck = process.argv.includes('--solo-boot-check');
const savedAtBoot = (bootCheck || soloBootCheck) ? readFileSync(0, 'utf8') : null;
if (savedAtBoot) {
  storage.set(soloBootCheck ? 'void.solo.v1' : 'void.run.v1', savedAtBoot);
  storage.set('void.nick', 'ReturningCommander');
}
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
// The local entry has no account server. Never send real HTTP requests from this harness.
globalThis.fetch = async () => new globalThis.Response('', { status: 404 });
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
globalThis.addEventListener = globalThis.window.addEventListener;
globalThis.history = { pushState() {}, back() {} };
globalThis.location = { protocol: 'file:', host: '', hostname: '', href: 'file:///', search: '' };
const rafCbs = [];
globalThis.requestAnimationFrame = (cb) => {
  rafCbs.push(cb);
  return rafCbs.length;
};
const sectorEntry = process.argv.includes('--sector-zero');
if (sectorEntry) globalThis.document.body.dataset.entry = 'sector-zero';
getEl('sz-workshop').hidden = true;
getEl('sz-confirm').hidden = true;
getEl('sz-weak').dataset.difficulty = 'weak';
getEl('sz-strong').dataset.difficulty = 'strong';
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const click = async id => {
  const el = getEl(id);
  for (const handle of (listeners.get(el) ?? {}).click ?? []) handle({ target: el });
  await flush();
};

// Test-only access to selection; clicks still go through the shipped side-panel delegate.
const bridge = `
module.exports = {
  cards: () => ({
    planet: Object.values(s.planets).find(p => p.owner === ME).id,
    fleet: Object.values(s.fleets).find(f => f.owner === ME).id,
    foreign: Object.values(s.fleets).find(f => f.owner !== ME).id,
  }),
  selectCard: (kind, id) => {
    clearSelection();
    if (kind === 'planet') selPlanet = id;
    else setFleetSelection([id]);
    renderPanel();
  },
  selected: () => ({ fleet: panelFleet(), planet: selPlanet, orders: [...selFleets] }),
  state: () => JSON.stringify(s),
  back: () => closeTop(BACK_LAYERS.filter(l => l.id === 'swarm-dossier' || l.id === 'boonpick')),
  backLabel: () => t('side.summary.back'),
  dev: () => ({ active: sectorDevActive, fog: sandboxConfig.fog, reveal: vision === null }),
  finishDev: () => { s.match = { ...s.match, status: 'ended', winner: ME }; awardSectorRun(); tickRunSave(performance.now()); },
  solo: () => ({ active: soloSaveActive, speed, save: currentSoloSave() }),
  soloBack: () => closeTop(BACK_LAYERS.filter(l => l.id === 'solo-replace')),
  tutorial: startGuidedMatch,
  saveSolo: () => saveSolo(true),
  autoSaveSolo: () => { s.players[ME].resources.metal += 1; tickSoloSave(performance.now() + 15000); },
  sandboxBack: () => closeTop(BACK_LAYERS.filter(l => l.id === 'sandbox')),
};`;
const res = await build({
  stdin: {
    contents: readFileSync('prototype/src/main.ts', 'utf8') + bridge,
    resolveDir: process.cwd() + '/prototype/src',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  loader: { '.webp': 'dataurl' },
  write: false,
  // The build profile is a REQUIRED define (see main.ts) — the smoke test drives
  // the full dev client, same as dist/void-dominion.html.
  define: { __PLAYER_BUILD__: process.argv.includes('--player') ? 'true' : 'false' },
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
await flush();
if (sectorEntry) {
  assert.equal(getEl('sector-zero').style.display, 'flex', 'direct entry opens Sector Zero home');
  assert.equal(getEl('connect').style.display, 'none', 'no identity screen on the local entry');
  assert.equal(getEl('sz-new').disabled, false);
} else {
  assert.equal(getEl('connect').style.display, 'flex', 'the shared entry always starts at login');
  assert.equal(getEl('hub').style.display, 'none', 'login precedes the hub');
  assert.notEqual(getEl('sector-zero').style.display, 'flex', 'a saved run must not hijack login');
}

// drive ~40 frames (~0.6s real → with speed 2 ≈ many game hours)
let frames = 0;
for (let i = 0; i < 40 && rafCbs.length; i++) {
  const cb = rafCbs.shift();
  cb(performance.now());
  frames++;
}
assert.equal(globalThis.document.body.classList.contains('holo-ui'), true, 'old preferences cannot disable the modern desktop UI');
if (soloBootCheck) {
  assert.equal(storage.get('void.solo.v1'), savedAtBoot, 'boot leaves the normal slot untouched');
  await click('cwgo');
  assert.equal(getEl('hub').style.display, 'flex');
  const valid = savedAtBoot !== '{broken';
  assert.equal(getEl('hub-solo-continue').disabled, !valid);
  if (valid) {
    const expected = JSON.parse(savedAtBoot).payload;
    await click('hub-solo-continue');
    assert.deepEqual(JSON.parse(mod.exports.state()), expected.state);
    assert.deepEqual(mod.exports.solo().save.ai, expected.ai);
    assert.deepEqual(mod.exports.solo().save.memory, expected.memory);
    assert.equal(mod.exports.solo().speed, 0, 'reload resumes paused');
    for (let i = 0; i < 5 && rafCbs.length; i++) await rafCbs.shift()(performance.now());
    assert.equal(JSON.parse(mod.exports.state()).time, expected.state.time, 'no offline advancement');
    assert.ok(getEl('devline').innerHTML.includes('data-solo-play'), 'resume is visible even when the PC speed bar is hidden');
  } else assert.equal(storage.get('void.solo.v1'), savedAtBoot, 'bad saves are not silently deleted');
  assert.equal(frameErrors.length, 0);
  console.log('Solo boot regression OK');
  process.exit(0);
}

if (bootCheck) {
  await flush();
  assert.equal(storage.get('void.run.v1'), savedAtBoot, 'opening the page preserves the run');
  if (sectorEntry) assert.equal(getEl('sz-continue').hidden, false, 'direct entry still offers Continue');
  else {
    assert.equal(getEl('connect').style.display, 'flex', 'login survives asynchronous save loading');
    assert.notEqual(getEl('sector-zero').style.display, 'flex');
    await click('cwgo'); // the existing offline callsign flow; no auth bypass in the app
    assert.equal(getEl('connect').style.display, 'none');
    assert.equal(getEl('hub').style.display, 'flex', 'sign-in leads to the main hub');
    assert.notEqual(getEl('sector-zero').style.display, 'flex', 'sign-in does not choose a mode');
    await click('hub-sector-zero');
    assert.equal(getEl('sector-zero').style.display, 'flex', 'the explicit hub entry still works');
    assert.equal(getEl('sz-continue').hidden, savedAtBoot === '{broken', 'valid runs remain available');
    await click('sz-back');
    assert.equal(getEl('hub').style.display, 'flex');
  }
  assert.equal(frameErrors.length, 0);
  console.log('Boot regression OK — login, legacy preference and saved run');
  process.exit(0);
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
const clickSide = (dataset) => {
  const button = { disabled: false, dataset };
  for (const handle of sideClicks)
    handle({ target: { closest: (selector) => selector === 'button' ? button : null } });
};
// A foreign fleet is inspected outside the order selection. Both the title and
// the rendered Back button must operate on that card without issuing an order.
for (const [kind, id] of Object.entries(mod.exports.cards())) {
  mod.exports.selectCard(kind, id);
  const selected = mod.exports.selected();
  const state = mod.exports.state();
  const backButton = () => [...sideEl.innerHTML.matchAll(/<button[^>]*data-act="([^"]+)"[^>]*>([^<]*)<\/button>/g)]
    .find((match) => match[2] === mod.exports.backLabel()) ?? null;
  assert.equal(backButton(), null, `${kind}: the regular card must not offer Back to itself`);
  const title = kind === 'planet' ? 'planetinfo' : 'fleetinfo';
  clickSide({ act: title });
  assert.ok(backButton(), `${kind}: title must open its summary`);
  const back = backButton()[1];
  clickSide({ act: back });
  assert.equal(backButton(), null, `${kind}: Back must restore the regular card`);
  clickSide({ act: back });
  assert.equal(backButton(), null, `${kind}: repeated Back must not reopen the summary`);
  assert.deepEqual(mod.exports.selected(), selected, `${kind}: Back must retain selection`);
  assert.equal(mod.exports.state(), state, `${kind}: card navigation must not change the match`);
  // Reopening and closing by the title remains supported as well.
  clickSide({ act: title });
  assert.ok(backButton(), `${kind}: summary must reopen after Back`);
  clickSide({ act: title });
  assert.equal(backButton(), null, `${kind}: title must close its summary`);
  if (kind === 'foreign') {
    assert.deepEqual(mod.exports.selected().orders, [], 'inspected fleet must never enter orders');
    assert.doesNotMatch(sideEl.innerHTML, /data-act="(?:bombard|assault|retreat|instantrepair|dockrepair)"/);
  }
}
console.log('Card navigation OK — planet, own fleet and inspected foreign fleet');
for (const fn2 of sideClicks)
  fn2({
    target: { closest: () => ({ disabled: false, dataset: { act: 'build', arg: 'refinery' } }) },
  });

// a few more frames after interaction
for (let i = 0; i < 20 && rafCbs.length; i++) {
  rafCbs.shift()(performance.now());
  frames++;
}

// Exercise the shipped map selector and launch path, including switching back.
// This catches stale geometry/capacity references that pure map tests cannot see.
const selectMap = (id) => {
  const input = getEl('setup-map-id');
  input.value = id;
  for (const handle of (listeners.get(input) ?? {}).change ?? []) handle({ target: input });
};
if (sectorEntry) await click('sz-back');
await click('cwgo');
await click('hub-solo');
selectMap('frontier-50');
assert.equal((getEl('setup-home-id').innerHTML.match(/<option /g) ?? []).length, 50);
assert.equal((getEl('setupmap').innerHTML.match(/data-cand=/g) ?? []).length, 50);
assert.ok(getEl('setupslots').innerHTML.includes('max="49"'));
for (const handle of (listeners.get(getEl('setupslots')) ?? {}).change ?? [])
  handle({ target: { id: 'setup-bot-count', value: '999' } });
assert.ok(getEl('setupslots').innerHTML.includes('value="49"'));
for (const handle of (listeners.get(getEl('setupgo')) ?? {}).click ?? []) await handle({});
assert.equal(getEl('setup').style.display, 'none');
for (let i = 0; i < 30 && rafCbs.length; i++) {
  await rafCbs.shift()(performance.now());
  frames++;
}
const beforeAuto = storage.get('void.solo.v1');
mod.exports.autoSaveSolo();
assert.notEqual(storage.get('void.solo.v1'), beforeAuto, 'autosave checkpoints live changes');
globalThis.document.visibilityState = 'hidden';
for (const handler of (listeners.get(globalThis.document) ?? {}).visibilitychange ?? []) handler();
assert.equal(mod.exports.solo().speed, 0, 'hiding the page pauses the normal game');
globalThis.document.visibilityState = 'visible';
// Menu exit persists the running world; Continue loads the same map on pause.
await click('tomenu');
const soloCheckpoint = storage.get('void.solo.v1');
assert.ok(soloCheckpoint);
assert.equal(getEl('hub-solo-continue').disabled, false);
await click('hub-solo-continue');
assert.deepEqual(JSON.parse(mod.exports.state()), JSON.parse(soloCheckpoint).payload.state);
assert.equal(mod.exports.solo().speed, 0);
await click('hub-solo');
selectMap('nexus');
assert.equal((getEl('setup-home-id').innerHTML.match(/<option /g) ?? []).length, 10);
for (const handle of (listeners.get(getEl('setupgo')) ?? {}).click ?? []) await handle({});
for (let i = 0; i < 10 && rafCbs.length; i++) {
  await rafCbs.shift()(performance.now());
  frames++;
}

assert.equal(getEl('solo-replace').style.display, 'flex');
const beforeReplace = storage.get('void.solo.v1');
mod.exports.soloBack();
assert.equal(getEl('solo-replace').style.display, 'none');
assert.equal(storage.get('void.solo.v1'), beforeReplace, 'Back cancels replacement');
await click('setupgo');
await click('solo-replace-confirm');
assert.equal(JSON.parse(storage.get('void.solo.v1')).payload.state.mapId, 'nexus');
for (const [checkpoint, extra] of [[soloCheckpoint, []], ['{broken', []], [soloCheckpoint, ['--player']]]) {
  const child = spawnSync(process.execPath, ['prototype/uitest.mjs', '--solo-boot-check', ...extra], {
    input: checkpoint, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  process.stdout.write(child.stdout);
}
await click('tomenu');
const beforeTutorial = storage.get('void.solo.v1');
mod.exports.tutorial();
mod.exports.saveSolo();
assert.equal(storage.get('void.solo.v1'), beforeTutorial, 'training does not overwrite the normal game');

// Sector Zero's real event handlers: preparation → new run → menu → Continue,
// preserving the saved world's difficulty and set when next-run choices change.
await click('hub-sector-zero');
assert.equal(getEl('sector-zero').style.display, 'flex');
assert.equal(getEl('hub').style.display, 'none', 'Sector Zero replaces the main hub');
assert.equal(getEl('setup').style.display, 'none', 'the separate entry skips skirmish setup');
await click('sz-back');
assert.equal(getEl('sector-zero').style.display, 'none');
assert.equal(getEl('hub').style.display, 'flex', 'Back returns to the main hub');
await click('hub-sector-zero');
assert.equal(getEl('sz-continue').hidden, true);
await click('sz-prep');
const prep = async (kind, id = '') => {
  const target = { dataset: { prep: kind, id }, disabled: false };
  for (const handle of (listeners.get(getEl('sz-workshop')) ?? {}).click ?? [])
    handle({ target: { closest: () => target } });
  await flush();
};
await prep('fit', 'ion_engine');
assert.deepEqual(JSON.parse(storage.get('sector-zero.progress.v1')).loadouts.cruiser, ['ion_engine']);
await prep('tab', 'heroes');
assert.ok(getEl('sz-workshop').innerHTML.includes('data-prep="upgrade-hero"'));
assert.ok(getEl('sz-workshop').innerHTML.includes('data-prep="skill"'));
await prep('back');
await click('sz-strong');
await click('sz-new');
assert.equal(getEl('sector-zero').style.display, 'none');
assert.equal(getEl('setup').style.display, 'none');
assert.equal(getEl('scipick').classList.contains('show'), false);
for (let i = 0; i < 12 && rafCbs.length; i++) { await rafCbs.shift()(performance.now()); frames++; }
assert.ok(getEl('devline').innerHTML.includes('data-swarm-intel'));
for (const handle of (listeners.get(getEl('devline')) ?? {}).click ?? [])
  handle({ target: { closest: selector => selector === '[data-swarm-intel]' ? ({ dataset: { swarmIntel: '1' } }) : null } });
assert.equal(getEl('swarm-dossier').classList.contains('show'), true);
assert.ok(getEl('swarm-dossier-body').innerHTML.length > 0);
getEl('boonpick').classList.add('show'); // a wave offers a boon over the open dossier
const beforeBoonBack = mod.exports.state();
mod.exports.back();
assert.equal(getEl('boonpick').classList.contains('show'), false, 'Back defers the upper boon offer');
assert.equal(getEl('swarm-dossier').classList.contains('show'), true, 'the dossier stays underneath');
assert.equal(mod.exports.state(), beforeBoonBack, 'deferring keeps the earned boon');
await click('swarm-dossier-close');
assert.equal(getEl('swarm-dossier').classList.contains('show'), false);
await click('tomenu');
assert.equal(getEl('sz-continue').hidden, false, 'a live run is offered after returning to menu');
let saved = JSON.parse(storage.get('void.run.v1'));
assert.equal(saved.difficulty, 'strong');
assert.deepEqual(saved.shipLoadouts.cruiser, ['ion_engine']);
assert.equal(Object.values(saved.state.heroes).filter(h => h.owner === 'p1').length, 1);
const pausedAt = saved.state.time;
for (let i = 0; i < 12 && rafCbs.length; i++) { await rafCbs.shift()(performance.now()); frames++; }
assert.equal(getEl('boonpick').classList.contains('show'), false);
await click('sz-weak'); // next attempt only
await click('sz-new');
assert.equal(getEl('sz-confirm').hidden, false);
await click('sz-cancel');
assert.equal(getEl('sz-confirm').hidden, true);
await click('sz-prep');
await prep('tab', 'ships');
await prep('fit', 'ion_engine');
await prep('fit', 'cargo_bay');
await prep('back');
await click('sz-continue');
await click('tomenu');
saved = JSON.parse(storage.get('void.run.v1'));
assert.equal(saved.difficulty, 'strong', 'Continue keeps the saved difficulty');
assert.equal(saved.state.time, pausedAt, 'the run does not advance while the menu is open');
assert.deepEqual(saved.shipLoadouts.cruiser, ['ion_engine'], 'Continue keeps the saved ship set');
await click('sz-new');
await click('sz-replace');
for (let i = 0; i < 4 && rafCbs.length; i++) { await rafCbs.shift()(performance.now()); frames++; }
await click('tomenu');
saved = JSON.parse(storage.get('void.run.v1'));
assert.equal(saved.difficulty, 'weak');
assert.deepEqual(saved.shipLoadouts.cruiser, ['cargo_bay']);
assert.equal(saved.sectorZeroAttempt, 2);
assert.equal(JSON.parse(storage.get('sector-zero.progress.v1')).research, 0, 'a menu exit awards nothing');
// Dev attempts use real panel handlers and must not touch normal saves or meta.
assert.equal(storage.get('void.solo.v1'), beforeTutorial, 'Sector Zero preserves the normal game');
const normalSave = storage.get('void.run.v1');
const normalProgress = storage.get('sector-zero.progress.v1');
await click('sz-dev');
assert.equal(mod.exports.dev().active, true);
assert.equal(getEl('sandboxbtn').style.display, '');
await click('sandboxbtn');
assert.equal(getEl('sandbox').style.display, 'flex');
assert.ok(getEl('sandbox').innerHTML.includes('data-sbx="compare"'));
const sandboxAction = async (act, key = '', change = false, value = '', checked = false) => {
  const target = { dataset: { sbx: act, k: key }, value, checked };
  for (const handle of (listeners.get(getEl('sandbox')) ?? {})[change ? 'change' : 'click'] ?? [])
    handle({ target: { closest: () => target } });
  await flush();
};
const beforeDevTime = JSON.parse(mod.exports.state()).time;
await sandboxAction('wave');
let devState = JSON.parse(mod.exports.state());
assert.equal(devState.pve.waveNumber, 1);
assert.equal(devState.time, beforeDevTime + 1);
assert.ok(devState.fleets['pve:wave:1']);
await sandboxAction('wave');
assert.equal(JSON.parse(mod.exports.state()).pve.waveNumber, 2);
await sandboxAction('compare', 'right', true, 'frigate');
assert.ok(getEl('sandbox').innerHTML.includes('value="frigate" selected'));
await sandboxAction('tog', 'fog', true, '', false);
for (let i = 0; i < 2 && rafCbs.length; i++) { await rafCbs.shift()(performance.now()); frames++; }
assert.equal(mod.exports.dev().reveal, true);
mod.exports.sandboxBack();
assert.equal(getEl('sandbox').style.display, 'none');
mod.exports.finishDev();
await flush();
await click('tomenu');
assert.equal(storage.get('void.run.v1'), normalSave, 'dev does not overwrite or clear the normal attempt');
assert.equal(storage.get('sector-zero.progress.v1'), normalProgress, 'dev does not consume attempts or grant rewards');
assert.equal(getEl('sz-continue').hidden, false);
await click('sz-continue');
assert.equal(mod.exports.dev().active, false);
const restoredBefore = mod.exports.state();
await sandboxAction('wave'); // stale/forged click after leaving dev must do nothing
await sandboxAction('res', 'metal');
assert.equal(mod.exports.state(), restoredBefore);
assert.equal(getEl('sandboxbtn').style.display, 'none');
for (let i = 0; i < 2 && rafCbs.length; i++) { await rafCbs.shift()(performance.now()); frames++; }
assert.equal(mod.exports.dev().reveal, false, 'normal runs regain real fog');
await click('tomenu');
console.log('Sector Zero dev isolation OK');
// Reboot the real bundled entry with a real save from the flow above, not a guessed fixture.
if (!sectorEntry) {
  for (const [input, args] of [
    [storage.get('void.run.v1'), []],
    ['{broken', []],
    [storage.get('void.run.v1'), ['--sector-zero']],
  ]) {
    const reboot = spawnSync(process.execPath, ['prototype/uitest.mjs', '--boot-check', ...args], {
      input, encoding: 'utf8', timeout: 120_000,
    });
    assert.equal(reboot.status, 0, reboot.stderr || reboot.error?.message);
    console.log(reboot.stdout.trim());
  }
}
assert.equal(frameErrors.length, 0, 'the render loop must not silently recover from a broken frame');
console.error = printError;
console.log(
  `UI OK — ran ${frames} frames + clicks with no throw. clock="${getEl('clock').textContent}"`,
);
console.log(`purse="${getEl('purse').textContent}"`);
console.log(`log has ${(getEl('log').innerHTML.match(/<div>/g) || []).length} lines`);
