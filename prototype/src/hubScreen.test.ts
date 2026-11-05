/**
 * Хозяин хаба (REFM-220) — прямой тест модуля.
 *
 * Экраны вкладок проверены у своих владельцев (`friendsScreen`, `rankScreen`,
 * `arsenalScreen`, `shopScreen`, `newsScreen` и соседи), карьера — `meta.ts`, разметка
 * хаба — сторожа `hubHome` и `rankScreen`, вход в хаб вживую — робот `smoke:startup`. Здесь —
 * то, что собирается только вместе: хаб показывает ровно одну панель, вкладки из «Ещё»
 * подсвечивают «Ещё», «Игры» уводят в обозреватель, старая карьера сохраняет XP и статистику,
 * а вход в хаб ставит одиночную партию на паузу. Экраны вкладок подменены:
 * тест подслушивает, что модуль у них спросил. Каждый тест — свежая загрузка модулей.
 */
import { readFileSync } from 'node:fs';
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
  let browsing = false;
  const host: HubScreenHost = {
    nick: () => 'Vega',
    setNick: () => {},
    serverField: () => '',
    resolveServer: () => null,
    status: () => {},
    showConnect: (show) => {
      env.calls.push(`connect:${show}`);
      hub.showBrowserHub(show && browsing);
    },
    enterBrowse: () => {
      browsing = true;
      env.calls.push('enterBrowse');
    },
    halt: log('halt'),
    refreshAccountDeletion: async () => {},
    openNewsSettings: () => {},
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

  it('«Игры» оставляют навигацию хаба; переход домой закрывает только обозреватель', async () => {
    const hub = await load();
    hub.hubTab('games');
    expect(env.els.get('hub')?.style.display).toBe('flex');
    expect(shown('hp-games')).toBe(true);
    expect(active()).toEqual(['games']);
    expect(env.calls).toEqual(['enterBrowse', 'connect:true']);
    hub.hubTab('home');
    expect(env.els.get('hub')?.style.display).toBe('flex');
    expect(shown('hp-games')).toBe(false);
    expect(shown('hp-home')).toBe(true);
    expect(active()).toEqual(['home']);
    expect(env.calls.at(-1)).toBe('connect:false');
  });

  it('впуск в матч убирает оболочку игр, но скрытие входа не закрывает другие вкладки', async () => {
    const hub = await load();
    hub.showBrowserHub(true);
    hub.showBrowserHub(false);
    expect(env.els.get('hub')?.style.display).toBe('none');
    hub.hubTab('arsenal');
    hub.showBrowserHub(false);
    expect(env.els.get('hub')?.style.display).toBe('flex');
    expect(active()).toEqual(['arsenal']);
  });
});

describe('REFM-220 · карьера без дерева усилений', () => {
  it('старый профиль сохраняет карьеру, а упразднённая вкладка возвращает домой', async () => {
    const hub = await load();
    const stats = { ...hub.loadMeta().stats, matches: 1, wins: 1, score: 900 };
    env.store.set(
      'vd.meta.Vega',
      JSON.stringify({ xp: 100_000, stats, spent: ['cmd1', 'eco1', 'sci1'] }),
    );
    expect(hub.loadMeta()).toEqual({ xp: 100_000, stats });
    hub.saveMeta(hub.loadMeta());
    expect(JSON.parse(env.store.get('vd.meta.Vega')!)).toEqual({ xp: 100_000, stats });
    hub.hubTab('meta');
    expect(shown('hp-home')).toBe(true);
    expect(active()).toEqual(['home']);
    expect(env.els.has('hp-meta')).toBe(false);
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

describe('страница Sector Zero', () => {
  // Её собирает тот же клиент, что и игру, а разметка своя: в ней нет двери новостей, и лента,
  // поднятая без кнопки, роняла запуск страницы целиком (нашёл `smoke:sector-zero`).
  it('ленту новостей не поднимает: двери новостей в её разметке нет', () => {
    const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
    const hub = readFileSync(new URL('./hubScreen.ts', import.meta.url), 'utf8');
    expect(build).toMatch(/entry === 'sector-zero' \? '' : `<button class="hub-news" id="hub-news"/);
    expect(hub).toMatch(/document\.body\.dataset\.entry !== 'sector-zero'\) news = createHubNews\(\)/);
  });
});
