/**
 * Хозяин боковой панели (REFM-225) — прямой тест модуля на живом мире прототипа.
 *
 * Кто претендует на лист, решает `panelSelect.ts`; что его прячет — `hudDock.ts`; что
 * помнит кэш — `panelCache.ts`; когда поднять камеру — `sheetLift.ts`; как шагает
 * наведение — `dossierHover.ts`; разметку окна деления — `splitDialog.ts`; гейты быстрого
 * заказа — `quickBuild.ts`. Здесь — то, что собирается только вместе: карточка доходит до
 * своего владельца, DOM листа трогается только при новой разметке, живые сроки правятся на
 * месте, нажатие по листу уходит своим приказом или своим окном, а окно деления живёт
 * ровно столько, сколько его флот. Карточки, камера, туман, лента и конвейер подменены:
 * тест подслушивает, что модуль у них спросил. Выбор и создатели приказов настоящие. Каждый
 * тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type {
  Action,
  Fleet,
  GameState,
  Planet,
  ShuttleStrike,
  Squadron,
} from '../../packages/shared-core/src/index';
import type { Dossier } from './dossiers';

/** Узел без браузера: разметка разбирается в дерево тегов, селекторы — простые (`tag`,
 *  `.cls`, `#id`, `[data-x]`, `[data-x="v"]`, через запятую). */
class El {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly dataset: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;
  style: Record<string, string> = {};
  textContent = '';
  scrollTop = 0;
  hidden = false;
  offsetWidth = 200;
  offsetHeight = 60;
  /** Сколько раз переписана разметка узла. */
  writes = 0;
  rect = { left: 0, top: 0, right: 0, bottom: 0 };
  readonly listeners: Array<[string, (ev: unknown) => void]> = [];
  private html = '';
  private readonly classes: Set<string>;
  readonly classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => {
      const v = on ?? !this.classes.has(c);
      if (v) this.classes.add(c);
      else this.classes.delete(c);
      return v;
    },
  };

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.classes = new Set((attrs.class ?? '').split(/\s+/).filter(Boolean));
    for (const [k, v] of Object.entries(attrs))
      if (k.startsWith('data-'))
        this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }

  get id(): string {
    return this.attrs.id ?? '';
  }
  get disabled(): boolean {
    return 'disabled' in this.attrs;
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.html = v;
    this.writes++;
    this.children = [];
    this.textContent = '';
    parseInto(this, v);
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  matches(sel: string): boolean {
    return sel.split(',').some((one) => matchOne(this, one.trim()));
  }
  closest(sel: string): El | null {
    if (this.matches(sel)) return this;
    return this.parent ? this.parent.closest(sel) : null;
  }
  contains(other: El | null): boolean {
    for (let n = other; n; n = n.parent) if (n === this) return true;
    return false;
  }
  *nodes(): Generator<El> {
    for (const c of this.children) {
      yield c;
      yield* c.nodes();
    }
  }
  querySelector(sel: string): El | null {
    for (const n of this.nodes()) if (n.matches(sel)) return n;
    return null;
  }
  querySelectorAll(sel: string): El[] {
    return [...this.nodes()].filter((n) => n.matches(sel));
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.push([type, fn]);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

function matchOne(el: El, sel: string): boolean {
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (attr) {
    const v = el.attrs[attr[1]!];
    return v !== undefined && (attr[2] === undefined || v === attr[2]);
  }
  return el.tag === sel;
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'wbr']);

/** Разметка → дерево узлов под `root`; текст копится в `textContent` всех открытых узлов. */
function parseInto(root: El, html: string): void {
  const stack: El[] = [root];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)) {
    const top = stack[stack.length - 1]!;
    if (m[4] !== undefined) {
      for (const n of stack) n.textContent += m[4];
      continue;
    }
    const name = m[2]!.toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
      attrs[a[1]!] = a[2] ?? a[3] ?? a[4] ?? '';
    const el = new El(name, attrs);
    el.parent = top;
    top.children.push(el);
    if (!VOID.has(name) && !/\/\s*$/.test(m[3]!)) stack.push(el);
  }
}

/** Лист, окно деления, шапка, всплывашка досье, окно справочника, телефонный лист и `body`.
 *  `tip: false` — сборка без всплывашки у курсора. */
function fakePage(tip: boolean) {
  const side = new El('div', { id: 'side' });
  const splitdlg = new El('div', { id: 'splitdlg' });
  const top = new El('div', { id: 'top' });
  top.rect = { left: 0, top: 0, right: 400, bottom: 40 };
  const objtip = new El('div', { id: 'objtip' });
  const codex = new El('div', { id: 'codex' });
  const sheet = new El('div', { id: 'mobile-sheet' });
  sheet.rect = { left: 0, top: 400, right: 400, bottom: 800 };
  const body = new El('body');
  const roots = [side, splitdlg, top, codex, sheet, ...(tip ? [objtip] : [])];
  vi.stubGlobal('document', {
    body,
    getElementById: (id: string) => {
      for (const r of roots) {
        if (r.id === id) return r;
        for (const n of r.nodes()) if (n.id === id) return n;
      }
      return null;
    },
  });
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  return { side, splitdlg, top, objtip, codex, sheet, body };
}

/** Событие `type` на узле `on` с целью `target`; `prevented` — погасил ли модуль браузер. */
function fire(on: El, type: string, target: El, extra: Record<string, unknown> = {}) {
  const ev = {
    target,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  };
  for (const [kind, fn] of on.listeners) if (kind === type) fn(ev);
  return ev;
}

type Base = { planetId: string } | { fleetId: string };

/** Ответы игры, которые тест подменяет, и следы модуля у соседей. */
interface Env {
  world: GameState;
  mobile: boolean;
  pc: boolean;
  vw: number;
  vh: number;
  inMatch: boolean;
  /** Разметка внутри подменённой карточки. */
  body: string;
  sees: boolean;
  refuse: boolean;
  run: boolean;
  paid: boolean;
  pings: boolean;
  mobileOrder: string | null;
  chain: string | null;
  pointers: Map<number, unknown>;
  anchor: { x: number; y: number };
  dossiers: Record<string, Dossier>;
  squadrons: Record<string, { sq: Squadron; base: Base }>;
  strikes: Record<string, ShuttleStrike>;
  locked: string[];
  /** Зовётся внутри `playerOrder`, до ответа: что видно модулю в этот момент. */
  onOrder: () => void;
  sent: Action[];
  notes: string[];
  toasts: string[];
  cam: unknown[][];
  forgot: number;
  frames: Array<() => void>;
  builds: unknown[][];
  toggles: string[];
  statPops: number;
  cmdClicks: unknown[];
  cmdBar: string[];
  saved: unknown[];
  /** Окна и выбор, которые модуль попросил у игры. */
  calls: unknown[][];
}

/** Приказ без сквозного `id`, который раздаёт его создатель. */
const bare = (a: Action) => {
  const { id: _id, ...rest } = a as Action & { id?: unknown };
  return rest;
};

/** Кнопка листа с действием `act`. */
const button = (act: string, arg = '') => `<button data-act="${act}" data-arg="${arg}"></button>`;

/** Свой флот в мире `at`. */
const ship = (id: string, at: string, over: Partial<Fleet> = {}): Fleet =>
  ({
    id,
    owner: 'p1',
    location: at,
    movement: null,
    units: [{ unit: 'cruiser', count: 3 }],
    traits: [],
    battleId: null,
    ...over,
  }) as Fleet;

/** Свой вылет в воздухе. */
const strike = (id: string, over: Partial<ShuttleStrike> = {}): ShuttleStrike =>
  ({
    id,
    owner: 'p1',
    squadronId: `sq:${id}`,
    units: [{ unit: 'interceptor', count: 2 }],
    ...over,
  }) as ShuttleStrike;

// Первая загрузка мира и его данных дольше таймаута одного теста.
beforeAll(async () => {
  await import('./game');
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Свежая загрузка листа над живым миром и игрой, которая отвечает на его вопросы. */
async function boot({ tip = true } = {}) {
  vi.resetModules();
  const page = fakePage(tip);
  const env: Env = {
    world: null as unknown as GameState,
    mobile: false,
    pc: false,
    vw: 400,
    vh: 800,
    inMatch: true,
    body: '',
    sees: true,
    refuse: false,
    run: false,
    paid: false,
    pings: true,
    mobileOrder: null,
    chain: null,
    pointers: new Map(),
    anchor: { x: 500, y: 700 },
    dossiers: {},
    squadrons: {},
    strikes: {},
    locked: [],
    onOrder: () => {},
    sent: [],
    notes: [],
    toasts: [],
    cam: [],
    forgot: 0,
    frames: [],
    builds: [],
    toggles: [],
    statPops: 0,
    cmdClicks: [],
    cmdBar: [],
    saved: [],
    calls: [],
  };
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => env.frames.push(fn));

  // Карточки рисуют их владельцы (`worldCard.ts`, `fleetCard.ts`): здесь — метка, чью
  // карточку лист позвал, и разметка теста внутри неё.
  const card = (who: string) => `<div class="card" data-card="${who}">${env.body}</div>`;
  vi.doMock('./worldCard', () => ({
    forkPanelHtml: (f: { province: string; trail: number }) =>
      card(`fork:${f.province}:${f.trail}`),
    planetPanelHtml: (p: Planet) => card(`planet:${p.id}`),
    unknownPlanetHtml: (p: Planet) => card(`unknown:${p.id}`),
  }));
  vi.doMock('./fleetCard', () => ({
    taskGroupPanelHtml: (g: Fleet[]) => card(`group:${g.map((f) => f.id).join(',')}`),
    fleetPanelHtml: (f: Fleet) => card(`fleet:${f.id}`),
    aloftPanelHtml: (st: ShuttleStrike) => card(`aloft:${st.id}`),
    renderStatPop: () => env.statPops++,
    toggleStatPop: (stat: string) => env.toggles.push(stat),
  }));
  // Камера, туман, указатели, якорь флота и палитра тянут холст и настройки браузера.
  vi.doMock('./mapCamera', () => ({
    clampCam: () => env.cam.push(['clamp']),
    focusWorld: (id: string) => env.cam.push(['focus', id]),
    panBy: (dx: number, dy: number) => env.cam.push(['pan', dx, dy]),
    world: (p: { x: number; y: number }) => ({ x: p.x + 1000, y: p.y }), // точка на экране
  }));
  vi.doMock('./mapFog', () => ({ seesDetails: () => env.sees }));
  vi.doMock('./mapInput', () => ({
    forgetAimPointer: () => env.forgot++,
    pointers: env.pointers,
  }));
  vi.doMock('./fleetGeometry', () => ({ fleetAnchor: () => env.anchor }));
  vi.doMock('./mapPalette', () => ({ youColor: '#you' }));
  vi.doMock('./graphicsPrefs', () => ({ pcUi: () => env.pc }));
  // Конвейер, лента, ряд команд, режим «Приказ», очередь мира и забег Сектора Ноль.
  vi.doMock('./orderPipeline', () => ({
    playerOrder: (a: Action) => {
      env.sent.push(a);
      env.onOrder();
      return !env.refuse;
    },
  }));
  vi.doMock('./eventFeed', () => ({
    note: (text: string) => env.notes.push(text),
    toast: (text: string) => env.toasts.push(text),
  }));
  vi.doMock('./cmdActions', () => ({
    mobileOrderKind: () => env.mobileOrder,
    onCommandClick: (ev: unknown) => env.cmdClicks.push(ev),
  }));
  vi.doMock('./cmdBar', () => ({
    invalidateCmdBar: () => env.cmdBar.push('invalidate'),
    renderCmdBar: () => env.cmdBar.push('render'),
  }));
  vi.doMock('./chainComposer', () => ({
    get chainMode() {
      return env.chain;
    },
  }));
  vi.doMock('./worldQueries', () => ({
    enqueueBuild: (planetId: string, item: unknown) => env.builds.push([planetId, item]),
    timeLeft: (at: number) => `T${at}`,
  }));
  vi.doMock('./sectorRun', () => ({ isSectorZeroRun: () => env.run }));
  vi.doMock('./sectorProfile', () => ({
    sectorProgress: { profile: true },
    saveSectorProgress: (p: unknown) => env.saved.push(p),
  }));
  vi.doMock('../../decisions/sectorZeroProgress', () => ({
    changeSectorZeroProgress: () => (env.paid ? { paid: true } : null),
    sovereignRepairCost: () => 77,
  }));

  // Свежая загрузка берёт и свежий рантайм локали: без языка браузера он встал бы на EN.
  const rt = await import('../../localization/runtime');
  rt.setLocale('ru');
  const game = await import('./game');
  env.world = game.newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: game.START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'B', faction: 'crimson', start: game.START_CANDIDATES[1]!, ai: false },
    ],
  });
  const inter = await import('./interaction');
  const sp = await import('./sidePanel');
  sp.initSidePanel({
    world: () => env.world,
    me: () => 'p1',
    mobile: () => env.mobile,
    vw: () => env.vw,
    vh: () => env.vh,
    inMatch: () => env.inMatch,
    panelFleet: () => inter.selFleet ?? inter.inspectFleet,
    dossier: (key) => env.dossiers[key] ?? null,
    setFleetSelection: (ids) => env.calls.push(['select', ids]),
    clearSelection: () => env.calls.push(['clear']),
    squadronBase: (id) => env.squadrons[id]?.base ?? null,
    squadronAt: (id) => env.squadrons[id] ?? null,
    ownStrike: (id) => env.strikes[id] ?? null,
    strikeSquadron: (st) => ({ id: st.squadronId, units: st.units }) as Squadron,
    strikeFrom: (st) => ({ planetId: `base:${st.id}` }),
    buildingLocked: (_planetId, id) => (env.locked.includes(id) ? 'built' : null),
    openShipCard: (fleetId, index) => env.calls.push(['shipcard', fleetId, index]),
    openCodex: (key) => env.calls.push(['codex', key]),
    techTree: () => ({ open: () => env.calls.push(['tech']) }),
    buildWin: () => ({ open: (id, units) => env.calls.push(['build', id, units]) }),
    battleWindow: () => ({ open: (id) => env.calls.push(['battle', id]) }),
    pings: () => (env.pings ? { openMenu: () => env.calls.push(['ping']) } : null),
    armRetreat: (id) => env.calls.push(['retreat', id]),
  });

  const home = Object.values(env.world.planets).find((p) => p.owner === 'p1')!;
  const foe = Object.values(env.world.planets).find((p) => p.owner === 'p2')!;
  /** Выбрать флоты, как рамка или тап: свои — к приказам, одинокий чужой — на осмотр. */
  const select = (...ids: string[]) =>
    inter.pickFleets(ids, (id) => env.world.fleets[id]?.owner === 'p1');
  /** Положить флот в мир (или заменить). */
  const put = (f: Fleet) => {
    env.world = { ...env.world, fleets: { ...env.world.fleets, [f.id]: f } };
    return f;
  };
  /** Положить мир (или заменить). */
  const putPlanet = (p: Planet) => {
    env.world = { ...env.world, planets: { ...env.world.planets, [p.id]: p } };
    return p;
  };
  /** Карточка с разметкой `body`, собранная заново. */
  const show = (body = '') => {
    env.body = body;
    sp.invalidatePanel();
    sp.renderPanel();
  };
  /** Узел листа по селектору — он обязан там быть. */
  const node = (sel: string) => {
    const el = page.side.querySelector(sel);
    if (!el) throw new Error(`в листе нет ${sel}`);
    return el;
  };
  /** Нажать узел листа. */
  const press = (sel: string) => fire(page.side, 'click', node(sel));
  /** Чью карточку показывает лист; `null` — ничью. */
  const shown = () => page.side.querySelector('.card')?.dataset.card ?? null;
  /** Ушедшие приказы без `id`. */
  const orders = () => env.sent.map(bare);
  return {
    sp,
    game,
    inter,
    t: rt.t,
    env,
    page,
    home,
    foe,
    select,
    put,
    putPlanet,
    show,
    node,
    press,
    shown,
    orders,
  };
}

describe('REFM-225 — какую карточку показать', () => {
  it('развилка, вылет, группа, флот, мир и мир в тумане — каждую рисует её владелец', async () => {
    const { inter, env, page, home, select, put, show, shown } = await boot();
    show();
    expect([shown(), page.side.style.display]).toEqual([null, 'none']);
    inter.pickWorld(home.id);
    show();
    expect(shown()).toBe(`planet:${home.id}`);
    env.sees = false;
    show();
    expect(shown()).toBe(`unknown:${home.id}`);
    env.sees = true;
    put(ship('A', home.id));
    put(ship('B', home.id));
    select('A', 'B');
    show();
    expect(shown()).toBe('group:A,B');
    select('A');
    show();
    expect(shown()).toBe('fleet:A');
    inter.pickFork({ province: home.id, trail: 2 });
    show();
    expect(shown()).toBe(`fork:${home.id}:2`);
    env.strikes.S1 = strike('S1');
    inter.pickStrike('S1');
    show();
    expect(shown()).toBe('aloft:S1');
  });

  it('осматриваемый чужой флот — та же карточка флота', async () => {
    const { env, select, show, shown } = await boot();
    const theirs = Object.values(env.world.fleets).find((f) => f.owner === 'p2')!;
    select(theirs.id);
    show();
    expect(shown()).toBe(`fleet:${theirs.id}`);
  });

  it('севший вылет проваливается дальше, а не рисует пустую карточку вылета', async () => {
    const { inter, page, t, show, shown } = await boot();
    inter.pickStrike('S9');
    show();
    expect(shown()).toBeNull();
    expect(page.side.querySelector('.hint')?.textContent).toBe(t('side.empty'));
  });
});

describe('REFM-225 — лист, кэш и живые сроки', () => {
  it('DOM листа трогается только при новой разметке; дверь сбивает кэш', async () => {
    const { sp, inter, env, page, home } = await boot();
    inter.pickWorld(home.id);
    env.body = '<b>1</b>';
    sp.renderPanel();
    sp.renderPanel();
    expect(page.side.writes).toBe(1);
    sp.invalidatePanel();
    sp.renderPanel();
    expect(page.side.writes).toBe(2);
    env.body = '<b>2</b>';
    sp.renderPanel();
    expect(page.side.writes).toBe(3);
    expect(page.side.querySelector('.pscroll')?.querySelector('.card')).not.toBeNull();
    expect(page.side.querySelector('#pdesc')).not.toBeNull();
    expect([page.side.style.display, page.body.classList.contains('sheet-open')]).toEqual([
      'flex',
      true,
    ]);
    expect(env.statPops).toBe(4);
  });

  it('закрытый лист забывает разметку: снова открытый рисуется заново, а не остаётся пустым', async () => {
    const { sp, inter, env, page, home, select } = await boot();
    inter.pickWorld(home.id);
    sp.renderPanel();
    select();
    sp.renderPanel();
    expect([page.side.style.display, page.body.classList.contains('sheet-open')]).toEqual([
      'none',
      false,
    ]);
    expect(env.statPops).toBe(2);
    inter.pickWorld(home.id);
    sp.renderPanel();
    expect(page.side.writes).toBe(2);
  });

  it('прицел карты прячет лист: курс, патруль, перелёт, отход и сбор — везде, удар — только на телефоне', async () => {
    const { sp, inter, env, page, home, select, put } = await boot();
    put(ship('A', home.id));
    select('A');
    const open = () => {
      sp.renderPanel();
      return page.side.style.display === 'flex';
    };
    expect([open(), page.body.classList.contains('aim-mode')]).toEqual([true, false]);
    inter.arm('aiming', true);
    expect([open(), page.body.classList.contains('aim-mode')]).toEqual([false, true]);
    inter.drop('aiming');
    inter.arm('pickMode', true);
    expect(open()).toBe(false);
    inter.drop('pickMode');
    const aim = { from: { planetId: home.id }, squadronId: 'sq:1' };
    for (const armed of [
      () => inter.arm('strikeAim', { ...aim, patrol: true as const }),
      () => inter.arm('strikeAim', { ...aim, relocate: true as const }),
      () => inter.arm('retreatAim', 'A'),
      () => inter.arm('rallyAim', home.id),
    ]) {
      armed();
      expect(open()).toBe(false);
      for (const flag of ['strikeAim', 'retreatAim', 'rallyAim'] as const) inter.drop(flag);
    }
    inter.arm('strikeAim', aim);
    expect(open()).toBe(true);
    env.mobile = true;
    expect(open()).toBe(false);
  });

  it('раскрытые подробности — ширина листа: класс идёт за разметкой', async () => {
    const { inter, page, home, show } = await boot();
    inter.pickWorld(home.id);
    show('<div class="object-detail"></div>');
    expect(page.side.classList.contains('details-open')).toBe(true);
    show('<b></b>');
    expect(page.side.classList.contains('details-open')).toBe(false);
  });

  it('прокрутка переживает пересборку листа', async () => {
    const { inter, home, show, node } = await boot();
    inter.pickWorld(home.id);
    show('<b>1</b>');
    node('.pscroll').scrollTop = 140;
    show('<b>2</b>');
    expect(node('.pscroll').scrollTop).toBe(140);
  });

  it('живые сроки правятся на месте каждый кадр, а лист не пересобирается', async () => {
    const { sp, game, inter, env, page, home, show, node } = await boot();
    const { barPct } = await import('./buildProgress');
    const { arrivalHours } = await import('./travelEta');
    const { fmtEta } = await import('./format');
    const now = env.world.time;
    inter.pickWorld(home.id);
    show(
      `<div class="conv-fill" data-at="${now + 4 * game.HOUR}" data-dur="${4 * game.HOUR}"></div>` +
        `<span class="conv-time" data-at="${now + 4 * game.HOUR}"></span>` +
        `<span class="pn-eta" data-arrive="${now + 3 * game.HOUR}" data-rest="2"></span>` +
        `<span class="pn-timer" data-at="900"></span>`,
    );
    const live = () => [
      node('.conv-fill').style.width,
      node('.conv-time').textContent,
      node('.pn-eta').textContent,
      node('.pn-timer').textContent,
    ];
    const at = (time: number) => [
      `${barPct(now + 4 * game.HOUR, 4 * game.HOUR, time).toFixed(0)}%`,
      `T${now + 4 * game.HOUR}`,
      fmtEta(arrivalHours(now + 3 * game.HOUR, time, game.HOUR, 2)),
      'T900',
    ];
    expect(live()).toEqual(at(now));
    env.world = { ...env.world, time: now + game.HOUR };
    sp.renderPanel();
    expect(live()).toEqual(at(now + game.HOUR));
    expect(live()[0]).not.toBe(at(now)[0]);
    expect(page.side.writes).toBe(1);
  });

  it('телефон: открытие листа поднимает камеру один раз, на следующем кадре', async () => {
    const { sp, inter, env, home, select } = await boot();
    inter.pickWorld(home.id);
    sp.renderPanel();
    expect(env.frames).toHaveLength(0);
    select();
    sp.renderPanel();
    env.mobile = true;
    inter.pickWorld(home.id);
    sp.renderPanel();
    sp.renderPanel();
    expect(env.frames).toEqual([sp.revealMobileSelection]);
    select();
    sp.renderPanel();
    inter.pickWorld(home.id);
    sp.renderPanel();
    expect(env.frames).toHaveLength(2);
  });
});

describe('REFM-225 — камера над листом на телефоне', () => {
  it('выбранный флот уходит из-под листа и из-под шапки; камера потом зажата', async () => {
    const { sp, env, page, home, select, put } = await boot();
    env.mobile = true;
    put(ship('A', home.id));
    select('A');
    sp.revealMobileSelection();
    // Портрет: правый край — экран без 28 px, низ — лист без 32, верх — шапка плюс 32.
    expect(env.cam).toEqual([['pan', 372 - 500, 368 - 700], ['clamp']]);
    env.cam.length = 0;
    env.anchor = { x: 100, y: 10 };
    sp.revealMobileSelection();
    expect(env.cam).toEqual([['pan', 0, 72 - 10], ['clamp']]);
    env.anchor = { x: 500, y: 700 };
    // Пейзаж (высота < 520): лист справа, правый край — его левый край без 32.
    env.cam.length = 0;
    env.vw = 1000;
    env.vh = 480;
    page.sheet.rect = { left: 600, top: 0, right: 1000, bottom: 480 };
    env.anchor = { x: 700, y: 300 };
    sp.revealMobileSelection();
    expect(env.cam).toEqual([['pan', 568 - 700, 0], ['clamp']]);
  });

  it('выбранный мир поднимается по своей точке на экране', async () => {
    const { sp, inter, env, home, putPlanet } = await boot();
    env.mobile = true;
    putPlanet({ ...home, position: { x: -900, y: 900 } });
    inter.pickWorld(home.id);
    sp.revealMobileSelection();
    expect(env.cam).toEqual([['pan', 0, 368 - 900], ['clamp']]);
  });

  it('камера стоит, пока игрок занят картой, лист скрыт или раскладка не телефонная', async () => {
    const { sp, inter, env, page, home, select, put } = await boot();
    put(ship('A', home.id));
    const still = (set: () => void, undo: () => void) => {
      env.mobile = true;
      select('A');
      set();
      sp.revealMobileSelection();
      undo();
      return env.cam.length;
    };
    expect(
      still(
        () => (env.mobile = false),
        () => {},
      ),
    ).toBe(0);
    expect(
      still(
        () => (env.inMatch = false),
        () => (env.inMatch = true),
      ),
    ).toBe(0);
    expect(
      still(
        () => (env.mobileOrder = 'move'),
        () => (env.mobileOrder = null),
      ),
    ).toBe(0);
    expect(
      still(
        () => inter.arm('pickMode', true),
        () => inter.drop('pickMode'),
      ),
    ).toBe(0);
    expect(
      still(
        () => (env.chain = 'A'),
        () => (env.chain = null),
      ),
    ).toBe(0);
    expect(
      still(
        () => env.pointers.set(1, {}),
        () => env.pointers.clear(),
      ),
    ).toBe(0);
    expect(
      still(
        () => (page.sheet.hidden = true),
        () => (page.sheet.hidden = false),
      ),
    ).toBe(0);
    expect(
      still(
        () => select(),
        () => {},
      ),
    ).toBe(0);
    expect(
      still(
        () => {},
        () => {},
      ),
    ).toBe(2);
  });
});

describe('REFM-225 — досье по наведению и по тапу', () => {
  const MINE = { name: 'Шахта', body: 'даёт металл' };
  const METAL = { name: 'Металл', body: '' };
  const rows =
    '<div data-desc="b:metal_mine:3"><span class="mine"></span></div>' +
    '<div class="gap"></div><div data-desc="r:metal"><span class="metal"></span></div>';

  it('ПК: досье идёт за курсором, пустота его гасит, уход с листа — тоже', async () => {
    const { inter, env, page, home, show, node } = await boot();
    const { hl } = await import('./format');
    const { cursorTipPos } = await import('./tipPlacement');
    env.pc = true;
    env.dossiers = { 'b:metal_mine:3': MINE, 'r:metal': METAL };
    inter.pickWorld(home.id);
    show(rows);
    const move = (sel: string, x = 300, y = 200) =>
      fire(page.side, 'pointermove', node(sel), { clientX: x, clientY: y });
    move('.mine');
    expect(page.objtip.innerHTML).toBe(
      `<div class="pd-title">Шахта ${hl(3)}</div><div class="pd-body">даёт металл</div>`,
    );
    const at = cursorTipPos(
      { x: 300, y: 200 },
      { width: 200, height: 60 },
      { width: 1280, height: 800 },
    );
    expect([page.objtip.style.display, page.objtip.style.left, page.objtip.style.top]).toEqual([
      'block',
      `${at.x}px`,
      `${at.y}px`,
    ]);
    move('.mine', 310, 210);
    expect(page.objtip.writes).toBe(1);
    expect(page.objtip.style.left).not.toBe(`${at.x}px`);
    // Досье без тела — одно имя.
    move('.metal');
    expect(page.objtip.innerHTML).toBe('<div class="pd-title">Металл</div>');
    // Над колонкой досье показанное держится.
    move('#pdesc');
    expect(page.objtip.style.display).toBe('block');
    move('.gap');
    expect(page.objtip.style.display).toBe('none');
    move('.mine');
    fire(page.side, 'pointerleave', page.side);
    expect(page.objtip.style.display).toBe('none');
  });

  it('узкое окно и сборка без всплывашки: досье стоит в колонке, промежуток его не гасит', async () => {
    for (const [pc, tip] of [
      [false, true],
      [true, false],
    ] as const) {
      const { sp, inter, env, page, t, home, show, node } = await boot({ tip });
      env.pc = pc;
      env.dossiers = { 'b:metal_mine:3': MINE, 'r:metal': METAL };
      inter.pickWorld(home.id);
      show(rows);
      const pane = () => node('#pdesc').innerHTML;
      const hint = `<div class="pd-empty">${t('dossier.hint')}</div>`;
      expect(pane()).toBe(hint);
      const writes = node('#pdesc').writes;
      sp.renderPanel();
      expect(node('#pdesc').writes).toBe(writes);
      fire(page.side, 'pointermove', node('.metal'));
      expect(pane()).toBe('<div class="pd-title">Металл</div><div class="pd-body"></div>');
      fire(page.side, 'pointermove', node('.gap'));
      fire(page.side, 'pointermove', node('#pdesc'));
      expect(pane()).toBe('<div class="pd-title">Металл</div><div class="pd-body"></div>');
      expect(page.objtip.writes).toBe(0);
      fire(page.side, 'pointerleave', page.side);
      expect(pane()).toBe(hint);
    }
  });

  it('телефон не наводит: тап по строке открывает то же досье, а параметры и вкладки — нет', async () => {
    const { inter, env, page, t, home, show, node, press } = await boot();
    const { hl } = await import('./format');
    env.mobile = true;
    env.dossiers = { 'b:metal_mine:3': MINE, 'stat:atk': METAL, 'tab:ships': METAL };
    inter.pickWorld(home.id);
    show(
      rows +
        '<div data-desc="stat:atk"><span class="atk"></span></div>' +
        '<div data-desc="tab:ships"><span class="tab"></span></div>',
    );
    fire(page.side, 'pointermove', node('.mine'));
    expect([page.objtip.writes, node('#pdesc').innerHTML]).toEqual([
      0,
      `<div class="pd-empty">${t('dossier.hint')}</div>`,
    ]);
    press('.atk');
    press('.tab');
    expect(page.codex.writes).toBe(0);
    press('.mine');
    expect(page.codex.innerHTML).toBe(
      `<div class="cxbox"><div class="cx-head"><b>Шахта ${hl(3)}</b></div><div class="cx-desc">даёт металл</div><button class="cx-close">${t('codex.close')}</button></div>`,
    );
    expect(page.codex.classList.contains('show')).toBe(true);
    env.mobile = false;
    press('.mine');
    expect(page.codex.writes).toBe(1);
  });

  it('досье нет — окно справочника не открывается', async () => {
    const { sp, page } = await boot();
    expect(sp.openDossier('b:nothing:1')).toBe(false);
    expect(page.codex.writes).toBe(0);
  });
});

describe('REFM-225 — нажатия по листу', () => {
  it('ссылка на мир двигает камеру и не трогает выбор, лист и кнопку под ней', async () => {
    const { inter, env, page, home, foe, show, press } = await boot();
    inter.pickWorld(home.id);
    show(
      `<button data-act="capital"><span data-goto="${foe.id}"><i class="go"></i></span></button>`,
    );
    press('.go');
    expect(env.cam).toEqual([['focus', foe.id]]);
    expect([inter.selPlanet, page.side.writes, env.sent]).toEqual([home.id, 1, []]);
  });

  it('параметр флота открывает всплывашку; кнопка в его строке — своё действие', async () => {
    const { game, env, home, select, put, show, press, orders } = await boot();
    put(ship('A', home.id));
    select('A');
    show(
      '<div data-stat="hp"><span class="v">5</span><button data-act="dockrepair" data-arg=""></button></div>' +
        '<button data-stat="atk" class="atk"></button>',
    );
    press('.v');
    expect(env.toggles).toEqual(['hp']);
    press('[data-act="dockrepair"]');
    expect(orders()).toEqual([bare(game.repairFleet('p1', 'A'))]);
    press('.atk');
    expect(env.toggles).toEqual(['hp', 'atk']);
  });

  it('клавиатура: Enter и пробел на числе-кнопке открывают всплывашку', async () => {
    const { inter, env, page, home, show, node } = await boot();
    inter.pickWorld(home.id);
    show('<div data-stat="hp"><span role="button" class="v"></span><span class="w"></span></div>');
    const key = (sel: string, k: string) => fire(page.side, 'keydown', node(sel), { key: k });
    expect(key('.v', 'Enter').prevented).toBe(true);
    expect(key('.v', ' ').prevented).toBe(true);
    expect(key('.v', 'a').prevented).toBe(false);
    expect(key('.w', 'Enter').prevented).toBe(false);
    expect(env.toggles).toEqual(['hp', 'hp']);
  });

  it('погашенная кнопка и пустое место ничего не делают', async () => {
    const { inter, env, page, home, show, press } = await boot();
    inter.pickWorld(home.id);
    show('<button data-act="capital" disabled></button><div class="gap"></div>');
    press('[data-act="capital"]');
    press('.gap');
    expect([env.sent, env.calls, page.side.writes]).toEqual([[], [], 1]);
  });

  it('команда ряда в листе — делегату ряда; карточки корабля и справочника — своим окнам', async () => {
    const { inter, env, home, show, press } = await boot();
    inter.pickWorld(home.id);
    show(
      '<button data-cmd="troops" class="cmd"></button><button data-shipcard="F|x|2"></button>' +
        '<button data-codex="b:metal_mine"></button>',
    );
    press('.cmd');
    expect(env.cmdClicks).toHaveLength(1);
    press('[data-shipcard]');
    press('[data-codex]');
    expect(env.calls).toEqual([
      ['shipcard', 'F|x', 2],
      ['codex', 'b:metal_mine'],
    ]);
  });

  it('приказы мира и флота уходят своими создателями', async () => {
    const { game, inter, env, home, select, put, show, press, orders } = await boot();
    const decide = await import('../../decisions/actions');
    const H = home.id;
    put(ship('A', H));
    const cases: Array<[string, string, 'world' | 'fleet', Action]> = [
      ['fortress', '', 'world', game.deployStation('p1', H)],
      ['cancelbuild', '2', 'world', game.cancelConstruction('p1', H, 2)],
      ['resumebuild', '1', 'world', game.resumeConstruction('p1', H, 1)],
      ['dequeue', '3', 'world', game.cancelConstruction('p1', H, 3)],
      ['spyplanet', 'recon', 'world', game.spyOn('p1', H, 'recon')],
      ['spyrecall', '', 'world', game.recallSpy('p1', H)],
      ['capital', '', 'world', game.designateCapital('p1', H)],
      ['holdpoint', 'on', 'world', game.setHoldPoint('p1', H, true)],
      ['holdpoint', 'off', 'world', game.setHoldPoint('p1', H, false)],
      ['rally', 'off', 'world', game.setRallyPoint('p1', H, null)],
      ['engage', 'X', 'fleet', game.engageFleet('p1', 'A', 'X')],
      ['laymines', '', 'fleet', game.layMinesFleet('p1', 'A')],
      ['laymines', 'G', 'fleet', game.layMinesFleet('p1', 'G')],
      ['rmmode', 'any', 'fleet', decide.setRocketMineMode('p1', 'A', 'any')],
      ['rmmode', 'confirmed', 'fleet', decide.setRocketMineMode('p1', 'A', 'confirmed')],
      ['rmdisarm', '', 'fleet', decide.disarmRocketMine('p1', 'A')],
      ['instantrepair', '', 'fleet', game.instantRepairFleet('p1', 'A')],
      ['instantrepair', 'G', 'fleet', game.instantRepairFleet('p1', 'G')],
      ['dockrepair', '', 'fleet', game.repairFleet('p1', 'A')],
      ['dockrepair', 'G', 'fleet', game.repairFleet('p1', 'G')],
      ['wingrecall', 'S1', 'fleet', decide.recallPatrol('p1', 'S1')],
    ];
    for (const [act, arg, on, want] of cases) {
      if (on === 'world') inter.pickWorld(H);
      else select('A');
      show(button(act, arg));
      env.sent.length = 0;
      press(`[data-act="${act}"]`);
      expect(orders(), `${act} ${arg}`).toEqual([bare(want)]);
    }
    select('A');
    show(button('rmmode', 'bogus'));
    env.sent.length = 0;
    press('[data-act="rmmode"]');
    expect(env.sent).toEqual([]);
  });

  it('окна и выбор: постройки, ростер, технологии, бой, пинги, отход, снять и выбрать', async () => {
    const { inter, env, home, select, put, show, press } = await boot();
    const H = home.id;
    put(ship('A', H));
    put(ship('B', H));
    const cases: Array<[string, string, 'world' | 'fleet', unknown[][]]> = [
      ['openbuild', '', 'world', [['build', H, undefined]]],
      ['openunits', 'ships', 'world', [['build', H, 'ships']]],
      ['openunits', 'ground', 'world', [['build', H, 'ground']]],
      ['openunits', 'buildings', 'world', []],
      ['opentech', '', 'world', [['tech']]],
      ['openbattle', 'B1', 'fleet', [['battle', 'B1']]],
      ['openbattle', '', 'fleet', []],
      ['ping', '', 'world', [['ping']]],
      ['retreat', '', 'fleet', [['retreat', 'A']]],
      ['close', '', 'world', [['clear']]],
      ['selfleet', 'B', 'world', [['select', ['B']]]],
    ];
    for (const [act, arg, on, want] of cases) {
      if (on === 'world') inter.pickWorld(H);
      else select('A');
      show(button(act, arg));
      env.calls.length = 0;
      press(`[data-act="${act}"]`);
      expect(env.calls, `${act} ${arg}`).toEqual(want);
    }
    env.pings = false;
    inter.pickWorld(H);
    show(button('ping'));
    env.calls.length = 0;
    press('[data-act="ping"]');
    expect(env.calls).toEqual([]);
    // «Снять» в карточке группы гасит флоты, а мир и прицелы не трогает.
    select('A', 'B');
    show(button('cancel'));
    press('[data-act="cancel"]');
    expect([inter.selFleet, inter.selFleets.size]).toEqual([null, 0]);
    expect(env.sent).toEqual([]);
  });

  it('вкладка мира — только одна из четырёх известных', async () => {
    const { sp, inter, home, show, press } = await boot();
    inter.pickWorld(home.id);
    expect(sp.planetTab).toBe('buildings');
    for (const [arg, want] of [
      ['ground', 'ground'],
      ['bogus', 'ground'],
      ['ships', 'ships'],
      ['shuttle', 'shuttle'],
      ['buildings', 'buildings'],
    ] as const) {
      show(button('tab', arg));
      press('[data-act="tab"]');
      expect(sp.planetTab, arg).toBe(want);
    }
  });

  it('стройка и найм встают в очередь выбранного мира', async () => {
    const { inter, env, home, show, press } = await boot();
    inter.pickWorld(home.id);
    show(button('build', 'power_plant') + `<i>${button('unit', 'cruiser')}</i>`);
    press('[data-act="build"]');
    press('[data-act="unit"]');
    expect(env.builds).toEqual([
      [home.id, { kind: 'building', id: 'power_plant', count: 1 }],
      [home.id, { kind: 'unit', id: 'cruiser', count: 1 }],
    ]);
  });

  it('звенья: удар, патруль и перелёт взводят прицел с подсказкой; пропавшее звено — ничего', async () => {
    const { game, inter, env, t, home, show, press } = await boot();
    const core = await import('../../packages/shared-core/src/index');
    const sq = { id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] } as Squadron;
    const base = { planetId: home.id };
    env.squadrons['sq:1'] = { sq, base };
    inter.pickWorld(home.id);
    // Взведённый прицел прячет лист: следующая кнопка — когда прицел снят.
    const tap = (act: string, arg = 'sq:1') => {
      inter.drop('strikeAim');
      show(button(act, arg));
      press(`[data-act="${act}"]`);
    };
    tap('wingstrike');
    expect(inter.strikeAim).toEqual({ from: base, squadronId: 'sq:1' });
    tap('wingpatrol');
    expect(inter.strikeAim).toEqual({ from: base, squadronId: 'sq:1', patrol: true });
    expect(env.forgot).toBe(0);
    env.mobile = true;
    tap('wingpatrol');
    expect(env.forgot).toBe(1);
    tap('wingrelocate');
    expect(inter.strikeAim).toEqual({ from: base, squadronId: 'sq:1', relocate: true });
    const plan = core.squadronPatrol(sq, game.data);
    const r = Math.round(core.squadronFerryRange(sq, game.data));
    expect(env.notes).toEqual([
      t('hint.wing-aim'),
      t('hint.wing-patrol-aim', { h: plan.hours, r: plan.radius }),
      t('hint.wing-patrol-aim', { h: plan.hours, r: plan.radius }),
      t('hint.wing-relocate-aim', { r }),
    ]);
    env.notes.length = 0;
    for (const act of ['wingstrike', 'wingpatrol', 'wingrelocate', 'wingrelease', 'wingsplit'])
      tap(act, 'sq:gone');
    expect([inter.strikeAim, env.notes, env.sent]).toEqual([null, [], []]);
  });

  it('звенья: удержание, делёж, слияние; «держать патруль» читает сам патруль', async () => {
    const { game, inter, env, t, home, show, press, orders } = await boot();
    const decide = await import('../../decisions/actions');
    const { splitOne } = await import('./squadronPanel');
    const sq = { id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] } as Squadron;
    const base = { planetId: home.id };
    env.squadrons['sq:1'] = { sq, base };
    env.squadrons['sq:2'] = { sq: { ...sq, id: 'sq:2' }, base };
    inter.pickWorld(home.id);
    const tap = (act: string, arg: string) => {
      show(button(act, arg));
      press(`[data-act="${act}"]`);
    };
    tap('wingrelease', 'sq:1');
    tap('wingsplit', 'sq:1');
    tap('wingmerge', 'sq:1');
    expect(inter.squadMerge).toEqual({ from: 'sq:1' });
    tap('wingmerge', 'sq:1');
    expect(inter.squadMerge).toBeNull();
    tap('wingmerge', 'sq:1');
    tap('wingmergeto', 'sq:2');
    expect(inter.squadMerge).toBeNull();
    tap('wingmergeto', 'sq:2');
    expect(orders()).toEqual(
      [
        decide.releaseHold('p1', base, 'sq:1'),
        game.splitSquadron('p1', base, 'sq:1', [splitOne(sq)!]),
        game.mergeSquadron('p1', base, 'sq:1', 'sq:2'),
      ].map(bare),
    );
    env.sent.length = 0;
    env.world = { ...env.world, strikes: [strike('S1', { patrol: { hold: true } } as never)] };
    tap('wingkeep', 'S1');
    expect([orders(), env.notes]).toEqual([[bare(decide.holdPatrol('p1', 'S1', false))], []]);
    env.sent.length = 0;
    tap('wingkeep', 'S2');
    expect([orders(), env.notes]).toEqual([
      [bare(decide.holdPatrol('p1', 'S2', true))],
      [t('hint.wing-keep')],
    ]);
    env.refuse = true;
    tap('wingkeep', 'S3');
    expect(env.notes).toHaveLength(1);
  });

  it('перегрузка: первая эскадра порта — на носитель, трюма — в порт; брать нечего — приказа нет', async () => {
    const { game, inter, home, foe, show, press, put, putPlanet, orders } = await boot();
    const hp = game.data.buildings.spaceport!.hp;
    const port = putPlanet({
      ...home,
      buildings: [
        ...home.buildings.filter((b) => b.type !== 'spaceport'),
        { type: 'spaceport', level: 1, hp },
      ],
      hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] }],
    } as Planet);
    put(
      ship('C', port.id, {
        units: [{ unit: 'shuttle_carrier', count: 1 }],
        hangar: [{ id: 'sq:2', units: [{ unit: 'bomber', count: 1 }] }],
      } as Partial<Fleet>),
    );
    put(ship('D', foe.id, { units: [{ unit: 'shuttle_carrier', count: 1 }] }));
    inter.pickWorld(port.id);
    for (const [act, arg] of [
      ['wingload', 'C'],
      ['wingunload', 'C'],
      ['wingload', 'D'],
      ['wingload', 'gone'],
    ] as const) {
      show(button(act, arg));
      press(`[data-act="${act}"]`);
    }
    expect(orders()).toEqual(
      [game.loadShuttle('p1', 'C', 'sq:1'), game.unloadShuttle('p1', 'C', 'sq:2')].map(bare),
    );
  });

  it('вылет в воздухе: удар, патруль, перелёт и делёж — от базы вылета', async () => {
    const { game, inter, env, t, show, press, orders } = await boot();
    const decide = await import('../../decisions/actions');
    const core = await import('../../packages/shared-core/src/index');
    const { splitOne } = await import('./squadronPanel');
    const st = strike('S1');
    env.strikes.S1 = st;
    inter.pickStrike('S1');
    const aim = { from: { planetId: 'base:S1' }, squadronId: 'sq:S1', strikeId: 'S1' };
    const tap = (act: string, arg = 'S1') => {
      inter.drop('strikeAim'); // взведённый прицел прячет лист
      show(button(act, arg));
      press(`[data-act="${act}"]`);
    };
    tap('aloftstrike');
    expect(inter.strikeAim).toEqual(aim);
    env.mobile = true;
    tap('aloftpatrol');
    expect([inter.strikeAim, env.forgot]).toEqual([{ ...aim, patrol: true }, 1]);
    tap('aloftrelocate');
    expect(inter.strikeAim).toEqual({ ...aim, relocate: true });
    expect(env.notes).toEqual([
      t('hint.wing-aim'),
      t('hint.aloft-patrol-aim'),
      t('hint.wing-relocate-aim', { r: Math.round(core.squadronFerryRange(st, game.data)) }),
    ]);
    tap('aloftsplit');
    const sq = { id: 'sq:S1', units: st.units } as Squadron;
    expect(orders()).toEqual([bare(decide.splitAloft('p1', 'S1', [splitOne(sq)!]))]);
    env.notes.length = 0;
    for (const act of ['aloftstrike', 'aloftpatrol', 'aloftrelocate', 'aloftsplit']) tap(act, 'S9');
    expect([inter.strikeAim, env.notes, env.sent.length]).toEqual([null, [], 1]);
  });

  it('крепость на развилке: встала — выбрана как мир; отказ оставляет развилку', async () => {
    const { inter, env, home, show, press, orders } = await boot();
    const decide = await import('../../decisions/actions');
    const core = await import('../../packages/shared-core/src/index');
    const fork = { province: home.id, trail: 1 };
    inter.pickFork(fork);
    env.refuse = true;
    show(button('forkfortress'));
    press('[data-act="forkfortress"]');
    expect(inter.selFork).toEqual(fork);
    env.refuse = false;
    show(button('forkfortress'));
    press('[data-act="forkfortress"]');
    expect([inter.selFork, inter.selPlanet]).toEqual([null, core.forkSiteId(home.id, 1)]);
    expect(orders()).toEqual([
      bare(decide.deployForkFortress('p1', home.id, 1)),
      bare(decide.deployForkFortress('p1', home.id, 1)),
    ]);
  });

  it('сбор: «Снять» — сразу приказ, «Задать» — выбор цели на карте с подсказкой', async () => {
    const { inter, env, t, home, show, press } = await boot();
    inter.pickWorld(home.id);
    show(button('rally', 'on'));
    press('[data-act="rally"]');
    expect([inter.rallyAim, env.notes, env.sent]).toEqual([home.id, [t('hint.rally-pick')], []]);
  });

  it('ремонт за Суверены: вне Сектора Ноль — ничего; не хватает — тост; отказ ядра — без списания', async () => {
    const { game, env, t, home, select, put, show, press, orders } = await boot();
    put(ship('A', home.id));
    select('A');
    const tap = () => {
      show(button('premiumrepair'));
      press('[data-act="premiumrepair"]');
    };
    tap();
    expect([env.sent, env.toasts, env.saved]).toEqual([[], [], []]);
    env.run = true;
    tap();
    expect([env.sent, env.toasts]).toEqual([[], [t('side.fleet.repair.premium.short', { n: 77 })]]);
    env.paid = true;
    env.refuse = true;
    tap();
    expect(env.saved).toEqual([]);
    env.refuse = false;
    tap();
    expect(env.saved).toEqual([{ paid: true }]);
    expect(orders()).toEqual(
      [game.premiumRepairFleet('p1', 'A'), game.premiumRepairFleet('p1', 'A')].map(bare),
    );
  });

  it('сводка армии: тап открывает и закрывает, «Назад» закрывает, прокрутка — наверх', async () => {
    const { sp, select, put, home, show, press, node } = await boot();
    put(ship('A', home.id));
    select('A');
    const tap = (act: string) => {
      show(button(act));
      node('.pscroll').scrollTop = 50;
      press(`[data-act="${act}"]`);
      return node('.pscroll').scrollTop;
    };
    expect(tap('fleetinfo')).toBe(0);
    expect(sp.fleetInfoFor).toBe('A');
    tap('fleetinfo');
    expect(sp.fleetInfoFor).toBeNull();
    tap('fleetinfo');
    expect(tap('summaryback')).toBe(0);
    expect(sp.fleetInfoFor).toBeNull();
    expect(tap('tab')).toBe(50);
  });

  it('после нажатия лист пересобран, даже если разметка та же', async () => {
    const { inter, page, home, show, press } = await boot();
    inter.pickWorld(home.id);
    show(button('tab', 'ground'));
    press('[data-act="tab"]');
    expect(page.side.writes).toBe(2);
  });
});

describe('REFM-225 — окно деления', () => {
  /** Свой флот `S` из трёх крейсеров, выбранный, с открытым окном деления. */
  async function opened() {
    const b = await boot();
    b.put(ship('S', b.home.id));
    b.select('S');
    b.inter.arm('splitState', { fleetId: 'S', take: {} });
    b.sp.renderSplitDialog();
    /** Кнопка окна по `data-sx`; `n` — шаг «+N». */
    const sx = (kind: string, n?: number) => {
      const all = b.page.splitdlg.querySelectorAll(`[data-sx="${kind}"]`);
      const el = n === undefined ? all[0] : all.find((x) => x.dataset.n === String(n));
      if (!el) throw new Error(`нет кнопки ${kind}`);
      return el;
    };
    const click = (el: El) => fire(b.page.splitdlg, 'click', el);
    return { ...b, sx, click };
  }

  it('нет плана — окно скрыто; план выбранного флота — окно с его строками, без лишних перезаписей', async () => {
    const { sp, page } = await boot();
    sp.renderSplitDialog();
    expect([page.splitdlg.style.display, page.splitdlg.writes]).toEqual(['none', 0]);
    const { sp: sp2, page: page2 } = await opened();
    const { fleetCallsign } = await import('./fleetName');
    expect(page2.splitdlg.style.display).toBe('flex');
    expect(page2.splitdlg.innerHTML).toContain(`«${fleetCallsign('S')}»`);
    sp2.renderSplitDialog();
    expect(page2.splitdlg.writes).toBe(1);
  });

  it('+1, все и −1 правят отбор; «Отделить» шлёт стеки и ждёт раскола до ответа ядра', async () => {
    const { sp, game, inter, env, page, sx, click, orders } = await opened();
    click(sx('inc', 1));
    const key = Object.keys(inter.splitState!.take)[0]!;
    expect(inter.splitState!.take[key]).toBe(1);
    click(sx('all'));
    expect(inter.splitState!.take[key]).toBe(3);
    click(sx('dec'));
    expect(inter.splitState!.take[key]).toBe(2);
    const seen: unknown[] = [];
    env.onOrder = () => seen.push(sp.splitAwait);
    const writes = page.side.writes;
    click(sx('confirm'));
    expect(orders()).toEqual([
      bare(game.splitFleet('p1', 'S', [{ unit: 'cruiser', modules: [], count: 2 }], undefined)),
    ]);
    expect([seen, sp.splitAwait, inter.splitState]).toEqual([['S'], 'S', null]);
    expect(page.splitdlg.style.display).toBe('none');
    expect(env.cmdBar).toEqual(['invalidate', 'render']);
    expect(page.side.writes).toBe(writes + 1);
    sp.endSplitAwait();
    expect(sp.splitAwait).toBeNull();
  });

  it('отказ ядра снимает ожидание раскола', async () => {
    const { sp, env, sx, click } = await opened();
    env.refuse = true;
    click(sx('inc', 1));
    click(sx('confirm'));
    expect([env.sent.length, sp.splitAwait]).toEqual([1, null]);
  });

  it('пустой отбор не отделить: погашенная кнопка ничего не делает', async () => {
    const { inter, env, sx, click } = await opened();
    click(sx('confirm'));
    expect([env.sent, inter.splitState?.fleetId]).toEqual([[], 'S']);
    expect(Object.values(inter.splitState!.take).every((n) => n === 0)).toBe(true);
  });

  it('фон и «Отмена» закрывают окно без приказа и собирают ряд заново', async () => {
    for (const where of ['backdrop', 'cancel'] as const) {
      const { inter, env, page, sx, click } = await opened();
      click(where === 'backdrop' ? page.splitdlg : sx('cancel'));
      expect([inter.splitState, page.splitdlg.style.display, env.sent]).toEqual([null, 'none', []]);
      expect(env.cmdBar).toEqual(['invalidate', 'render']);
    }
  });

  it('окно гаснет, когда флот ушёл из выбора или вступил в бой', async () => {
    const a = await opened();
    a.inter.pickWorld(a.home.id);
    a.sp.renderSplitDialog();
    expect([a.inter.splitState, a.page.splitdlg.style.display]).toEqual([null, 'none']);
    const b = await opened();
    b.put(ship('S', b.home.id, { battleId: 'B1' }));
    b.sp.renderSplitDialog();
    expect(b.inter.splitState).toBeNull();
  });
});

describe('REFM-225 — быстрый заказ правым кликом', () => {
  const tiles =
    '<div data-buildorder="building:power_plant"><i class="pp"></i></div>' +
    '<div data-buildorder="unit:cruiser" class="cr"></div><div class="gap"></div>';

  it('ПК: правый клик по плитке своего мира заказывает её сразу; меню браузера погашено', async () => {
    const { inter, env, page, home, show, node } = await boot();
    env.pc = true;
    inter.pickWorld(home.id);
    show(tiles);
    const menu = (sel: string) => fire(page.side, 'contextmenu', node(sel)).prevented;
    expect(menu('.pp')).toBe(true);
    expect(menu('.cr')).toBe(true);
    expect(menu('.gap')).toBe(false);
    expect(env.builds).toEqual([
      [home.id, { kind: 'building', id: 'power_plant', count: 1 }],
      [home.id, { kind: 'unit', id: 'cruiser', count: 1 }],
    ]);
    expect(page.side.writes).toBe(3);
  });

  it('чужой мир, занятое место и не-ПК — заказа нет', async () => {
    const { inter, env, page, home, foe, show, node } = await boot();
    inter.pickWorld(home.id);
    show(tiles);
    expect(fire(page.side, 'contextmenu', node('.pp')).prevented).toBe(false);
    env.pc = true;
    env.locked = ['power_plant'];
    show(tiles);
    expect(fire(page.side, 'contextmenu', node('.pp')).prevented).toBe(true);
    inter.pickWorld(foe.id);
    show(tiles);
    fire(page.side, 'contextmenu', node('.cr'));
    expect(env.builds).toEqual([]);
  });
});

describe('REFM-225 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./sidePanel.ts', import.meta.url), 'utf8');
  const init = /initSidePanel\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('слушатели листа и окна деления вешает сам модуль', async () => {
    const { page } = await boot();
    expect(page.side.listeners.map(([type]) => type)).toEqual([
      'keydown',
      'click',
      'pointermove',
      'pointerleave',
      'contextmenu',
    ]);
    expect(page.splitdlg.listeners.map(([type]) => type)).toEqual(['click']);
    expect(MAIN).not.toMatch(/\b(?:side|splitdlg)\.addEventListener\(/);
    expect(MAIN).not.toMatch(/\$\('splitdlg'\)/);
  });

  it('main.ts поднимает лист один раз — миром, местом, раскладкой, выбором, эскадрами, окнами', () => {
    expect(MAIN.match(/initSidePanel\(/g)).toHaveLength(1);
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'mobile: () => MOBILE,',
      'vw: () => VW,',
      'vh: () => VH,',
      'inMatch,',
      'panelFleet,',
      'dossier: (key) => objDossier(key),',
      'setFleetSelection,',
      'clearSelection,',
      'squadronBase,',
      'squadronAt,',
      'ownStrike,',
      'strikeSquadron,',
      'strikeFrom,',
      'buildingLocked,',
      'openShipCard,',
      'openCodex,',
      'techTree: () => techTree,',
      'buildWin: () => buildWin,',
      'battleWindow: () => battleWindow,',
      'pings: () => pings,',
      'armRetreat,',
    ])
      expect(init).toContain(hook);
  });

  it('лист уехал целиком; его состояния main.ts только читает; модуль не тянет main.ts', () => {
    for (const fn of [
      'panelHtml',
      'dossierTitleHtml',
      'objDescHtml',
      'openDossier',
      'renderObjDesc',
      'revealMobileSelection',
      'invalidatePanel',
      'renderPanel',
      'updatePanelLive',
      'fleetSplitSlots',
      'stackCargoCapacity',
      'renderSplitDialog',
      'placeObjTip',
    ])
      expect(MAIN).not.toMatch(new RegExp(`function ${fn}\\(`));
    for (const name of [
      'lastPanelHtml',
      'lastSplitHtml',
      'lastObjDescHtml',
      'hoverObj',
      'sheetWasOpen',
    ])
      expect(MAIN).not.toMatch(new RegExp(`\\b${name}\\b`));
    for (const name of ['planetTab', 'fleetInfoFor', 'splitAwait'])
      expect(MAIN).not.toMatch(new RegExp(`\\b${name}\\s*=[^=>]`));
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
