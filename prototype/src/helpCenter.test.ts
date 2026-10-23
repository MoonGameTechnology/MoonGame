/**
 * Хозяин справки (REFM-221) — прямой тест модуля на живом мире прототипа.
 *
 * Чистые части проверены у своих владельцев: индекс и поиск — `codexIndex.ts`, вводные —
 * `intros.ts`, сводка — `recap.ts`, когда её показывать — `awayBrief.ts`, карточка корабля —
 * `shipCard.ts`. Здесь — то, что собирается только вместе: вводная показывается новичку
 * один раз и гаснет первым же действием, ветеран её не видит; поиск справочника прячет
 * статью об очках в забеге Sector Zero; сводка по возвращении во вкладку и дверь
 * {@link forgetAway}; «Построить здесь» уходит заказом выбранному миру. Лента, камера,
 * лист, выбор и очередь заказов подменены: тест подслушивает, что модуль у них спросил.
 * Каждый тест — свежая загрузка модулей.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../packages/shared-core/src/index';
import type { RecapEvent } from './recap';

type Listener = (ev: unknown) => void;

/** Узел без браузера: классы, разметка и слушатели — то, что трогает модуль. */
class El {
  readonly id: string;
  innerHTML = '';
  oninput: (() => void) | null = null;
  value = '';
  readonly listeners: Array<[string, Listener]> = [];
  private readonly classes = new Set<string>();
  readonly classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
  };
  constructor(id: string) {
    this.id = id;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.push([type, fn]);
  }
  /** Нажатие по узлу: `target` — то, по чему попали внутри него. */
  fire(type: string, target: unknown): void {
    for (const [t, fn] of this.listeners) if (t === type) fn({ target });
  }
}

/** Цель нажатия: `closest` отвечает только на перечисленные селекторы. */
function hit(match: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    classList: { contains: () => false },
    closest: (sel: string) => match[sel] ?? null,
  };
}

interface Env {
  els: Map<string, El>;
  store: Map<string, string>;
  docListeners: Array<[string, Listener]>;
  winListeners: Array<[string, Listener]>;
  events: RecapEvent[];
  calls: string[];
  sel: string | null;
  hidden: boolean;
}

function stubBrowser(): Env {
  const env: Env = {
    els: new Map(),
    store: new Map(),
    docListeners: [],
    winListeners: [],
    events: [],
    calls: [],
    sel: null,
    hidden: false,
  };
  const el = (id: string): El => {
    let e = env.els.get(id);
    if (!e) env.els.set(id, (e = new El(id)));
    return e;
  };
  vi.stubGlobal('__PLAYER_BUILD__', false);
  vi.stubGlobal('document', {
    getElementById: el,
    addEventListener: (type: string, fn: Listener) => env.docListeners.push([type, fn]),
    body: { classList: { contains: () => false } },
    get hidden() {
      return env.hidden;
    },
  });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: Listener) => env.winListeners.push([type, fn]),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => env.store.get(k) ?? null,
    setItem: (k: string, v: string) => void env.store.set(k, v),
  });
  return env;
}

let env: Env;
let inMatch = true;
let sectorZero = false;
let xp = 0;

async function load(world: () => GameState) {
  vi.resetModules();
  env = stubBrowser();
  vi.doMock('./eventFeed', () => ({ eventLog: env.events }));
  vi.doMock('./mapCamera', () => ({ jumpToPing: (id: string) => env.calls.push(`jump:${id}`) }));
  vi.doMock('./sidePanel', () => ({
    invalidatePanel: () => env.calls.push('invalidate'),
    renderPanel: () => env.calls.push('render'),
  }));
  vi.doMock('./interaction', () => ({
    get selPlanet() {
      return env.sel;
    },
  }));
  vi.doMock('./worldQueries', () => ({
    enqueueBuild: (pid: string, o: { kind: string; id: string }) =>
      env.calls.push(`build:${pid}:${o.kind}:${o.id}`),
    myRes: () => ({}),
  }));
  const help = await import('./helpCenter');
  help.initHelpCenter({
    world,
    me: () => 'p1',
    callsign: () => 'Vega',
    loadMeta: () => ({ xp }) as ReturnType<Parameters<typeof help.initHelpCenter>[0]['loadMeta']>,
    inMatch: () => inMatch,
    codexHtml: (kind, id, level) => `<article>${kind}:${id}:${level}</article>`,
    buildingLocked: () => null,
    fleetTitle: (id) => id,
    sectorZeroToolsHidden: () => sectorZero,
  });
  return help;
}

let game: typeof import('./game');

beforeAll(async () => {
  game = await import('./game');
});

afterEach(() => {
  for (const m of ['./eventFeed', './mapCamera', './sidePanel', './interaction', './worldQueries'])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  inMatch = true;
  sectorZero = false;
  xp = 0;
});

const shown = (id: string): boolean => env.els.get(id)?.classList.contains('show') === true;
const fireDoc = (type: string, ev: unknown) => {
  for (const [t, fn] of env.docListeners) if (t === type) fn(ev);
};
const fireWin = (type: string, ev: unknown) => {
  for (const [t, fn] of env.winListeners) if (t === type) fn(ev);
};

describe('REFM-221 · справка — вводные к механикам', () => {
  it('новичку — один раз; набор увиденного помнится по позывному', async () => {
    const s = game.newGame();
    const help = await load(() => s);
    help.maybeIntro('tech');
    expect(shown('intro')).toBe(true);
    expect(JSON.parse(env.store.get('vd.seenIntros.Vega') ?? '[]')).toContain('tech');
    env.els.get('intro')!.classList.remove('show');
    help.maybeIntro('tech');
    expect(shown('intro')).toBe(false);
  });

  it('ветеран вводных не видит, но они помечены увиденными', async () => {
    xp = 50;
    const s = game.newGame();
    const help = await load(() => s);
    help.maybeIntro('market');
    expect(shown('intro')).toBe(false);
    expect(JSON.parse(env.store.get('vd.seenIntros.Vega') ?? '[]')).toContain('market');
  });

  it('первое действие мимо гасит подсказку; Escape и модификатор — нет', async () => {
    const s = game.newGame();
    const help = await load(() => s);
    help.maybeIntro('tech');
    fireWin('keydown', { repeat: false, key: 'Shift' });
    fireWin('keydown', { repeat: false, key: 'Escape' });
    expect(shown('intro')).toBe(true);
    fireDoc('pointerdown', { target: { closest: () => null } });
    expect(shown('intro')).toBe(false);
    help.maybeIntro('steward');
    fireWin('keydown', { repeat: false, key: 't' });
    expect(shown('intro')).toBe(false);
  });
});

describe('REFM-221 · справка — справочник', () => {
  it('поиск прячет статью об очках в забеге Sector Zero', async () => {
    const s = game.newGame();
    await load(() => s);
    env.els.get('hub-help')!.fire('click', {});
    expect(shown('codexhub')).toBe(true);
    expect(env.els.get('ch-results')!.innerHTML).toContain('data-codex="m:score"');
    sectorZero = true;
    env.els.get('rail-help')!.fire('click', {});
    expect(env.els.get('ch-results')!.innerHTML).not.toContain('data-codex="m:score"');
  });

  it('статья из поиска открывает карточку; «Построить здесь» — заказ выбранному миру', async () => {
    const s = game.newGame();
    const help = await load(() => s);
    const home = Object.values(s.planets).find((p) => p.owner === 'p1' && p.kind === 'planet')!;
    env.sel = home.id;
    env.els
      .get('codexhub')!
      .fire('click', hit({ '.ch-item': { dataset: { codex: 'u:frigate' } } }));
    expect(shown('codex')).toBe(true);
    expect(env.els.get('codex')!.innerHTML).toContain('<article>u:frigate:1</article>');
    help.openCodex('u:frigate');
    env.els
      .get('codex')!
      .fire('click', hit({ '.cx-build': { dataset: { build: 'unit:frigate' } } }));
    expect(env.calls).toEqual(['build:' + home.id + ':unit:frigate', 'invalidate', 'render']);
    expect(shown('codex')).toBe(false);
  });

  it('из хаба мира нет — «Построить здесь» не уходит заказом', async () => {
    const s = game.newGame();
    await load(() => s);
    env.sel = null;
    env.els
      .get('codex')!
      .fire('click', hit({ '.cx-build': { dataset: { build: 'unit:frigate' } } }));
    expect(env.calls.filter((c) => c.startsWith('build:'))).toEqual([]);
  });
});

describe('REFM-221 · справка — «пока вас не было»', () => {
  it('долгий уход из партии — сводка по возвращении, тап по строке ведёт камеру', async () => {
    vi.useFakeTimers();
    const s = game.newGame();
    await load(() => s);
    env.hidden = true;
    fireDoc('visibilitychange', {});
    env.events.push({ at: s.time, text: '🚩 RED захватил VEGA', anchor: 'VEGA' });
    vi.advanceTimersByTime(60_000);
    env.hidden = false;
    fireDoc('visibilitychange', {});
    expect(shown('recap')).toBe(false); // кадр сначала догоняет мир
    vi.advanceTimersByTime(500);
    expect(shown('recap')).toBe(true);
    env.els.get('recap')!.fire('click', hit({ '.rc-item': { dataset: { jump: 'VEGA' } } }));
    expect(env.calls).toContain('jump:VEGA');
    expect(shown('recap')).toBe(false);
  });

  it('новая партия гасит метку ухода дверью — сводка не пересказывает прошлую', async () => {
    vi.useFakeTimers();
    const s = game.newGame();
    const help = await load(() => s);
    env.hidden = true;
    fireDoc('visibilitychange', {});
    env.events.push({ at: s.time, text: '🚩 RED захватил VEGA' });
    vi.advanceTimersByTime(60_000);
    help.forgetAway();
    env.hidden = false;
    fireDoc('visibilitychange', {});
    vi.advanceTimersByTime(500);
    expect(shown('recap')).toBe(false);
  });

  it('пустой брифинг не показывается, а сводку по кнопке журнала можно открыть всегда', async () => {
    const s = game.newGame();
    await load(() => s);
    env.els.get('lw-recap')!.fire('click', {});
    expect(shown('recap')).toBe(false);
    env.events.push({ at: 0, text: '⚛ изучено: Ходовые школы' });
    env.els.get('lw-recap')!.fire('click', {});
    expect(shown('recap')).toBe(true);
  });
});
