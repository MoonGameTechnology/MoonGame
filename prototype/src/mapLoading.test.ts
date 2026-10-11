/**
 * Экран загрузки карты (REFM-241) — прямой тест владельца заставки.
 *
 * Сама подготовка по заданиям (`MapPreparation`) проверена в `mapPreparation.test.ts`. Здесь —
 * то, что держит заставка: когда она встаёт и когда снова не встаёт, что показывает (цитата
 * по кругу, прогресс, подпись), куда уводит «Отмена», какие клавиши она глотает, пока
 * закрывает карту, и что бывает при сбое задания. Страница поддельная, кадры отдаёт тест.
 * Каждый тест — свежая загрузка модуля.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../localization/runtime';
import type { MapLoadingHost } from './mapLoading';
import type { PreparationJob } from './mapPreparation';

type Listener = (ev: unknown) => void;

/** Кадры `requestAnimationFrame`, которые ещё не отданы. */
let frames: Array<(at: number) => void> = [];

beforeEach(() => {
  vi.resetModules();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: (at: number) => void) => frames.push(cb));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Отдать накопленные кадры и дождаться всего, что они запустили. */
async function frame(): Promise<void> {
  for (const cb of frames.splice(0)) cb(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
/** Кадр за кадром, пока подготовка их просит. */
async function finish(): Promise<void> {
  while (frames.length) await frame();
}

/** Холст `#map`, заставка `#maploading` с её частями и окно с перехватом клавиш. */
function fakePage() {
  const doc = { activeElement: null as unknown };
  const focusable = <T extends object>(el: T) =>
    Object.assign(el, {
      focusOptions: [] as unknown[],
      focus(this: { focusOptions: unknown[] }, options?: unknown) {
        this.focusOptions.push(options);
        doc.activeElement = this;
      },
    });
  const attrs = new Map<string, string>();
  const canvas = focusable({
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
    busy: () => attrs.get('aria-busy') ?? null,
  });
  const screen = { style: { display: 'none' } };
  const bar = { max: 1, value: 0 };
  const status = { textContent: '' };
  const percent = { textContent: '' };
  const quote = { textContent: '' };
  const clicks: Listener[] = [];
  const cancel = focusable({
    addEventListener: (type: string, fn: Listener) => {
      if (type === 'click') clicks.push(fn);
    },
    click: () => clicks.forEach((fn) => fn({})),
  });
  const els: Record<string, unknown> = {
    map: canvas,
    maploading: screen,
    'maploading-progress': bar,
    'maploading-status': status,
    'maploading-percent': percent,
    'maploading-quote': quote,
    'maploading-cancel': cancel,
  };
  const keys: Array<{ type: string; fn: Listener; capture: unknown }> = [];
  vi.stubGlobal('document', {
    getElementById: (id: string) => els[id] ?? null,
    get activeElement() {
      return doc.activeElement;
    },
  });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: Listener, capture?: unknown) =>
      keys.push({ type, fn, capture }),
  });
  /** Нажать клавишу на странице; что сделал перехват. */
  const press = (key: string, target: unknown = null) => {
    const ev = { key, target, prevented: false, stopped: false };
    const e = Object.assign(ev, {
      preventDefault: () => (ev.prevented = true),
      stopImmediatePropagation: () => (ev.stopped = true),
    });
    for (const l of keys) if (l.type === 'keydown') l.fn(e);
    return { prevented: ev.prevented, stopped: ev.stopped };
  };
  return { doc, canvas, screen, bar, status, percent, quote, cancel, keys, press };
}

/** Игра вокруг заставки: вход, окно и задания меняет тест. */
function fakeGame() {
  const ran: string[] = [];
  const job = (label: string): PreparationJob => ({ label, run: () => void ran.push(label) });
  const game = {
    inMatch: true,
    view: '1600:900:1:true',
    recipe: [job('фон'), job('карта'), job('готово')] as PreparationJob[],
    jobsAsked: 0,
    failed: 0,
    left: 0,
  };
  const host: MapLoadingHost = {
    entered: () => game.inMatch,
    viewport: () => game.view,
    jobs: () => {
      game.jobsAsked++;
      return game.recipe;
    },
    failed: () => void game.failed++,
    leave: () => void game.left++,
  };
  return { game, host, ran, job };
}

async function boot() {
  const page = fakePage();
  const env = fakeGame();
  const mod = await import('./mapLoading');
  mod.initMapLoading(env.host);
  return { page, ...env, mod };
}

const QUOTES = [
  t('map-loading.quote.fleet'),
  t('map-loading.quote.frontier'),
  t('map-loading.quote.silence'),
];

describe('REFM-241 — когда заставка встаёт', () => {
  it('вне матча заставки нет: карта не готовится и не считается открытой', async () => {
    const { page, game, mod } = await boot();
    game.inMatch = false;
    expect(mod.prepareEnteringMap()).toBe(false);
    expect(page.screen.style.display).toBe('none');
    expect(page.canvas.busy()).toBeNull();
    expect(game.jobsAsked).toBe(0);
    expect(mod.mapWasEntered).toBe(false);
    expect(mod.mapPreparation.active).toBe(false);
  });

  it('вход: заставка закрывает карту, первая цитата, фокус на «Отмене», рецепт по порядку', async () => {
    const { page, game, ran, mod } = await boot();
    expect(mod.prepareEnteringMap()).toBe(true);
    expect(mod.mapWasEntered).toBe(true);
    expect(page.screen.style.display).toBe('flex');
    expect(page.canvas.busy()).toBe('true');
    expect(page.quote.textContent).toBe(QUOTES[0]);
    expect(page.doc.activeElement).toBe(page.cancel);
    expect(page.cancel.focusOptions).toEqual([{ preventScroll: true }]);
    // До первого кадра — только нулевой прогресс и подпись первого задания.
    expect([page.bar.value, page.bar.max]).toEqual([0, 3]);
    expect(page.percent.textContent).toBe(t('map-loading.progress', { n: 0 }));
    expect(page.status.textContent).toBe('фон');
    expect(ran).toEqual([]);

    await finish();
    expect(ran).toEqual(['фон', 'карта', 'готово']);
    expect([page.bar.value, page.bar.max]).toEqual([3, 3]);
    expect(page.percent.textContent).toBe(t('map-loading.progress', { n: 100 }));
    expect(page.status.textContent).toBe('готово');
    // Готово: кадр больше не ждёт, а заставку снимает он сам после первого полного кадра.
    expect(mod.prepareEnteringMap()).toBe(false);
    expect(page.screen.style.display).toBe('flex');
    expect(game.jobsAsked).toBe(1);
  });

  it('процент округлён, подпись — следующего задания', async () => {
    const { page, game, job, mod } = await boot();
    game.recipe = [job('а'), job('б'), job('в')];
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10)); // кадр после каждого
    mod.prepareEnteringMap();
    await frame();
    expect(page.bar.value).toBe(1);
    expect(page.percent.textContent).toBe(t('map-loading.progress', { n: 33 }));
    expect(page.status.textContent).toBe('б');
    await frame();
    expect(page.percent.textContent).toBe(t('map-loading.progress', { n: 67 }));
    expect(page.status.textContent).toBe('в');
  });

  it('снятие заставки: прячет её, снимает «занято» и возвращает фокус карте', async () => {
    const { page, mod } = await boot();
    mod.prepareEnteringMap();
    await finish();
    mod.hideMapLoading();
    expect(page.screen.style.display).toBe('none');
    expect(page.canvas.busy()).toBeNull();
    expect(page.doc.activeElement).toBe(page.canvas);
    expect(page.canvas.focusOptions).toEqual([{ preventScroll: true }]);
    expect(mod.mapPreparation.active).toBe(false);
  });

  it('фокус не на «Отмене» — снятие заставки его не трогает', async () => {
    const { page, mod } = await boot();
    mod.prepareEnteringMap();
    const other = { name: 'чат' };
    page.doc.activeElement = other;
    mod.hideMapLoading();
    expect(page.doc.activeElement).toBe(other);
    expect(page.canvas.focusOptions).toEqual([]);
  });

  it('вторично в ту же карту заставка не встаёт; новая карта — встаёт со следующей цитатой', async () => {
    const { page, game, mod } = await boot();
    mod.prepareEnteringMap();
    await finish();
    mod.hideMapLoading();
    expect(mod.prepareEnteringMap()).toBe(false);
    expect(page.screen.style.display).toBe('none');
    expect(game.jobsAsked).toBe(1);

    mod.needMapPreparation();
    expect(mod.prepareEnteringMap()).toBe(true);
    expect(page.screen.style.display).toBe('flex');
    expect(page.quote.textContent).toBe(QUOTES[1]);
    expect(game.jobsAsked).toBe(2);
    // Заказ исполнен: следующий кадр не начинает подготовку заново.
    expect(mod.prepareEnteringMap()).toBe(true);
    expect(game.jobsAsked).toBe(2);
  });

  it('выход из матча снимает заставку и забывает вход; цитаты идут по кругу', async () => {
    const { page, game, mod } = await boot();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      game.inMatch = true;
      expect(mod.prepareEnteringMap()).toBe(true);
      seen.push(page.quote.textContent);
      game.inMatch = false;
      expect(mod.prepareEnteringMap()).toBe(false);
      expect(page.screen.style.display).toBe('none');
      expect(page.canvas.busy()).toBeNull();
      expect(mod.mapPreparation.active).toBe(false);
      expect(mod.mapWasEntered).toBe(false);
    }
    expect(seen).toEqual([...QUOTES, QUOTES[0]]);
  });

  it('вне матча без подготовки снимать нечего: заставку не трогают', async () => {
    const { page, game, mod } = await boot();
    page.screen.style.display = 'flex'; // её показал кто-то другой
    game.inMatch = false;
    mod.prepareEnteringMap();
    expect(page.screen.style.display).toBe('flex');
  });

  it('окно сменилось посреди подготовки — заново, без новой цитаты и без кражи фокуса', async () => {
    const { page, game, job, ran, mod } = await boot();
    mod.prepareEnteringMap();
    const other = { name: 'чат' };
    page.doc.activeElement = other;
    game.view = '390:844:2:true';
    game.recipe = [job('новое окно')];
    expect(mod.prepareEnteringMap()).toBe(true);
    expect(game.jobsAsked).toBe(2);
    expect(page.quote.textContent).toBe(QUOTES[0]);
    expect(page.doc.activeElement).toBe(other);
    await finish();
    expect(ran).toEqual(['новое окно']); // старая подготовка брошена
    // То же окно в следующем кадре — не перезапуск.
    expect(mod.prepareEnteringMap()).toBe(false);
    expect(game.jobsAsked).toBe(2);
    // Следующий вход берёт следующую цитату: перезапуск её не тратил.
    game.inMatch = false;
    mod.prepareEnteringMap();
    game.inMatch = true;
    mod.prepareEnteringMap();
    expect(page.quote.textContent).toBe(QUOTES[1]);
  });

  it('окно сменилось после снятия заставки — карта не готовится заново', async () => {
    const { game, mod } = await boot();
    mod.prepareEnteringMap();
    await finish();
    mod.hideMapLoading();
    game.view = '390:844:2:true';
    expect(mod.prepareEnteringMap()).toBe(false);
    expect(game.jobsAsked).toBe(1);
  });

  it('сбой задания: карта забывает выпечку, заставка снимается, ошибка — в консоль', async () => {
    const { page, game, job, mod } = await boot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = new Error('decode');
    game.recipe = [
      job('фон'),
      {
        label: 'карта',
        run: () => {
          throw boom;
        },
      },
    ];
    mod.prepareEnteringMap();
    await finish();
    expect(game.failed).toBe(1);
    expect(warn).toHaveBeenCalledWith('map preparation failed', boom);
    expect(page.screen.style.display).toBe('none');
    expect(page.canvas.busy()).toBeNull();
    expect(mod.mapPreparation.active).toBe(false);
    expect(game.left).toBe(0);
  });
});

describe('REFM-241 — «Отмена» и клавиши', () => {
  it('«Отмена» снимает заставку и уводит в меню тем же путём, что кнопка HUD', async () => {
    const { page, game, mod } = await boot();
    mod.prepareEnteringMap();
    page.cancel.click();
    expect(game.left).toBe(1);
    expect(page.screen.style.display).toBe('none');
    expect(mod.mapPreparation.active).toBe(false);
    expect(page.doc.activeElement).toBe(page.canvas);
  });

  it('дверь ухода — та же «Отмена»: её зовёт слой «Назад»', async () => {
    const { page, game, mod } = await boot();
    mod.prepareEnteringMap();
    mod.leaveLoadingMap();
    expect(game.left).toBe(1);
    expect(page.screen.style.display).toBe('none');
  });

  it('перехват клавиш висит на окне в фазе захвата', async () => {
    const { page } = await boot();
    expect(page.keys.map((k) => [k.type, k.capture])).toEqual([['keydown', true]]);
  });

  it('пока карта готовится, её горячие клавиши не доходят до спрятанного HUD', async () => {
    const { page, mod } = await boot();
    mod.prepareEnteringMap();
    expect(page.press('h')).toEqual({ prevented: true, stopped: true });
    expect(page.press('Enter')).toEqual({ prevented: true, stopped: true });
    expect(page.press(' ')).toEqual({ prevented: true, stopped: true });
  });

  it('Escape проходит к слою «Назад», а Enter и пробел на «Отмене» её нажимают', async () => {
    const { page, mod } = await boot();
    mod.prepareEnteringMap();
    expect(page.press('Escape')).toEqual({ prevented: false, stopped: false });
    expect(page.press('Enter', page.cancel)).toEqual({ prevented: false, stopped: true });
    expect(page.press(' ', page.cancel)).toEqual({ prevented: false, stopped: true });
    expect(page.press('h', page.cancel)).toEqual({ prevented: true, stopped: true });
  });

  it('без подготовки клавиши свободны', async () => {
    const { page, mod } = await boot();
    expect(page.press('h')).toEqual({ prevented: false, stopped: false });
    mod.prepareEnteringMap();
    await finish();
    mod.hideMapLoading();
    expect(page.press('h')).toEqual({ prevented: false, stopped: false });
  });
});

describe('REFM-241 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('./mapLoading.ts', import.meta.url), 'utf8');
  const init = /initMapLoading\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки — вход после допуска, ключ окна, рецепт, сброс выпечки, уход кнопкой HUD', () => {
    for (const hook of [
      'entered: () => inMatch() && (!NET || netAdmitted),',
      'viewport: () => `${VW}:${VH}:${DPR}:${holographicMapOn()}`,',
      "label: t('map-loading.background')",
      "label: t('map-loading.geometry')",
      "label: t('map-loading.terrain')",
      "label: t('map-loading.ready')",
      "mapLayerContent = '';",
      "leave: () => $('tomenu').click(),",
    ])
      expect(init).toContain(hook);
  });

  it('новую подготовку заказывают дверью: вход с фанфарами, новая геометрия, новый матч', () => {
    expect(MAIN.match(/needMapPreparation\(\);/g)).toHaveLength(3);
    expect(MAIN).toMatch(/if \(fanfare\) needMapPreparation\(\);/);
    expect(MAIN).not.toMatch(/mapNeedsPreparation/);
  });

  it('кадр и слой «Назад» читают подготовку модуля', () => {
    expect(MAIN).toMatch(/const preparingMap = prepareEnteringMap\(\);/);
    expect(MAIN).toMatch(/if \(mapPreparation\.active && mapPreparation\.ready && /);
    expect(MAIN).toMatch(
      /\{ id: 'maploading', isOpen: \(\) => mapPreparation\.active, close: leaveLoadingMap \}/,
    );
  });

  it('заставка уехала целиком; модуль не тянет main.ts', () => {
    for (const fn of ['prepareEnteringMap', 'hideMapLoading', 'leaveLoadingMap'])
      expect(MAIN).not.toMatch(new RegExp(`function ${fn}\\(`));
    for (const name of ['mapWasEntered', 'mapLoadingViewport', 'mapQuoteIndex'])
      expect(MAIN).not.toMatch(new RegExp(`\\blet ${name}\\b`));
    expect(MAIN).not.toMatch(/new MapPreparation\(/);
    expect(MAIN).not.toMatch(/\$\('maploading-/);
    expect(SRC).not.toMatch(/from '\.\/main'/);
  });
});
