/**
 * Хозяин хаба (REFM-220) — прямой тест модуля.
 *
 * Экраны вкладок проверены у своих владельцев (`friendsScreen`, `rankScreen`,
 * `arsenalScreen`, `shopScreen`, `newsScreen` и соседи), дерево прокачки — `meta.ts`, разметка
 * хаба — сторожа `hubHome` и `rankScreen`, вход в хаб вживую — робот `smoke:startup`. Здесь —
 * то, что собирается только вместе: хаб показывает ровно одну панель, вкладки из «Ещё»
 * подсвечивают «Ещё», «Игры» уводят в обозреватель, покупка узла прокачки ложится в хранилище
 * по позывному, а вход в хаб ставит одиночную партию на паузу. Экраны вкладок подменены:
 * тест подслушивает, что модуль у них спросил. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HubScreenHost } from './hubScreen';

type Listener = (ev: unknown) => void;

/** Узел без браузера: стиль, классы, разметка, данные и слушатели. */
class El {
  readonly id: string;
  innerHTML = '';
  textContent = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  readonly listeners: Array<[string, Listener]> = [];
  private readonly classes = new Set<string>();
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
  constructor(id: string) {
    this.id = id;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.push([type, fn]);
  }
  replaceChildren(): void {}
  fire(type: string, ev: unknown): void {
    for (const [t, fn] of this.listeners) if (t === type) fn(ev);
  }
}

interface Env {
  els: Map<string, El>;
  tabs: El[];
  store: Map<string, string>;
  calls: string[];
  solo: boolean;
}

let env: Env;

function stubBrowser(): void {
  const el = (id: string): El => {
    let e = env.els.get(id);
    if (!e) env.els.set(id, (e = new El(id)));
    return e;
  };
  env.tabs = ['home', 'games', 'arsenal', 'corp', 'more'].map((tab) => {
    const b = new El(`tab-${tab}`);
    b.dataset.hub = tab;
    return b;
  });
  vi.stubGlobal('__SECTOR_ZERO_ONLY__', true); // экраны вкладок не поднимаются — как в архиве площадки
  vi.stubGlobal('document', {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: (sel: string) => (sel === '.hub-tab' ? env.tabs : []),
    body: { classList: { toggle: () => {} } },
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => env.store.get(k) ?? null,
    setItem: (k: string, v: string) => void env.store.set(k, v),
  });
}

async function load() {
  vi.resetModules();
  env = { els: new Map(), tabs: [], store: new Map(), calls: [], solo: false };
  stubBrowser();
  const log = (name: string) => (): void => void env.calls.push(name);
  vi.doMock('./matchBrowser', () => ({ refreshMyMatches: async () => {} }));
  vi.doMock('./soloCheckpoint', () => ({
    get soloSaveActive() {
      return env.solo;
    },
    saveSolo: log('saveSolo'),
    refreshHubDoor: log('refreshHubDoor'),
    restoreSolo: log('restoreSolo'),
  }));
  vi.doMock('./matchLifecycle', () => ({
    leaveMatch: log('leaveMatch'),
    startProvingGround: log('startProvingGround'),
  }));
  vi.doMock('./sectorZeroShell', () => ({ openSectorZero: log('openSectorZero') }));
  vi.doMock('./setupScreen', () => ({ openSetup: log('openSetup') }));
  vi.doMock('./helpCenter', () => ({ openCodex: () => {} }));
  vi.doMock('./eventFeed', () => ({ note: () => {} })); // лента рисует на канвасе
  const hub = await import('./hubScreen');
  const host: HubScreenHost = {
    nick: () => 'Vega',
    setNick: () => {},
    serverField: () => '',
    resolveServer: () => null,
    status: () => {},
    showConnect: (show) => env.calls.push(`connect:${show}`),
    enterBrowse: log('enterBrowse'),
    halt: log('halt'),
    refreshAccountDeletion: async () => {},
  };
  hub.initHubScreen(host);
  return hub;
}

afterEach(() => {
  for (const m of [
    './matchBrowser',
    './soloCheckpoint',
    './matchLifecycle',
    './sectorZeroShell',
    './setupScreen',
    './helpCenter',
    './eventFeed',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
});

const shown = (id: string): boolean => env.els.get(id)?.style.display === 'flex';
const active = (): string[] =>
  env.tabs.filter((b) => b.classList.contains('active')).map((b) => b.dataset.hub!);

describe('REFM-220 · вкладки хаба', () => {
  it('видна ровно одна панель; вкладка из «Ещё» подсвечивает «Ещё»', async () => {
    const hub = await load();
    hub.hubTab('rank');
    expect(shown('hp-rank')).toBe(true);
    expect(shown('hp-home')).toBe(false);
    expect(active()).toEqual(['more']);
    hub.hubTab('arsenal');
    expect(shown('hp-arsenal')).toBe(true);
    expect(shown('hp-rank')).toBe(false);
    expect(active()).toEqual(['arsenal']);
  });

  it('«Игры» прячут хаб и ведут в обозреватель партий', async () => {
    const hub = await load();
    hub.hubTab('games');
    expect(env.els.get('hub')?.style.display).toBe('none');
    expect(env.calls).toEqual(['connect:true', 'enterBrowse']);
  });
});

describe('REFM-220 · прокачка', () => {
  it('купленный узел ложится в хранилище по позывному, панель перерисована', async () => {
    const hub = await load();
    hub.saveMeta({ ...hub.loadMeta(), xp: 100_000 });
    hub.hubTab('meta');
    const panel = env.els.get('hp-meta')!;
    const id = /data-meta="([^"]+)"(?![^>]*disabled)/.exec(panel.innerHTML)?.[1];
    expect(id).toBeDefined();
    panel.fire('click', {
      target: { closest: () => ({ dataset: { meta: id }, disabled: false }) },
    });
    expect(JSON.parse(env.store.get('vd.meta.Vega')!).spent).toContain(id);
    expect(panel.innerHTML).toContain('✓ ');
  });
});

describe('REFM-220 · вход в хаб', () => {
  it('одиночную партию сохраняет и ставит на паузу; домой — с позывным и дверью обучения', async () => {
    const hub = await load();
    env.solo = true;
    hub.openHub();
    expect(env.calls.slice(0, 2)).toEqual(['saveSolo', 'halt']);
    expect(env.calls).toContain('refreshHubDoor');
    expect(env.els.get('hub-name')?.textContent).toBe('Vega');
    expect(env.els.get('hub')?.style.display).toBe('flex');
    expect(shown('hp-home')).toBe(true);
  });

  it('кнопки хаба: одиночная игра уходит из партии дверью и открывает настройку', async () => {
    await load();
    env.els.get('hub-solo')!.fire('click', {});
    expect(env.calls).toEqual(['leaveMatch', 'openSetup']);
    expect(env.els.get('hub')?.style.display).toBe('none');
  });
});
