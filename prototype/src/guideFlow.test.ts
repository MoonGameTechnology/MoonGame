/**
 * Хозяин обучения (REFM-221) — прямой тест модуля на живом мире прототипа.
 *
 * Чистые части проверены у своих владельцев: флаг и воронка — `onboarding.ts`, цели —
 * `firstGoals.ts`, счёт целей — `goalTally.ts`, разметка списка — `goalsPanel.ts`, цепочка
 * гида — `firstMatchTour.ts`. Здесь — то, что собирается только вместе: шов `__vdTour`,
 * ведомый первый матч (дверь сетапа до старта, гид — когда HUD ожил), исход тура в флаге по
 * позывному, награда списка целей ровно один раз и кнопки хаба. Движок туров и экран
 * сетапа подменены, как и лента, камера и лист (они рисуют): тест подслушивает, что модуль у них спросил. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../packages/shared-core/src/index';
import type { TourEnd } from './spotlight';
import type { MetaState } from './meta';

/** Узел без браузера: классы, разметка и слушатели — то, что трогает модуль. */
class El {
  readonly id: string;
  innerHTML = '';
  style: Record<string, string> = {};
  readonly listeners: Array<[string, (ev: unknown) => void]> = [];
  private readonly classes = new Set<string>();
  readonly classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
  };
  constructor(id: string) {
    this.id = id;
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.push([type, fn]);
  }
  querySelector(): null {
    return null;
  }
  /** Нажатие по узлу; `inside` — id узла внутри, по которому попали. */
  click(inside?: string): void {
    const target = { closest: (sel: string) => (inside && sel === `#${inside}` ? {} : null) };
    for (const [type, fn] of this.listeners) if (type === 'click') fn({ target });
  }
}

interface Env {
  els: Map<string, El>;
  store: Map<string, string>;
  frames: Array<() => void>;
  tours: Array<{ steps: unknown[]; end?: TourEnd; stopped: boolean }>;
  calls: string[];
}

function stubBrowser(): Env {
  const env: Env = { els: new Map(), store: new Map(), frames: [], tours: [], calls: [] };
  const el = (id: string): El => {
    let e = env.els.get(id);
    if (!e) env.els.set(id, (e = new El(id)));
    return e;
  };
  vi.stubGlobal('__PLAYER_BUILD__', false);
  vi.stubGlobal('document', {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { classList: { contains: () => false } },
  });
  vi.stubGlobal('window', {});
  vi.stubGlobal('innerWidth', 1600);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => env.store.get(k) ?? null,
    setItem: (k: string, v: string) => void env.store.set(k, v),
  });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    env.frames.push(fn);
    return env.frames.length;
  });
  return env;
}

let env: Env;

async function load(world: () => GameState) {
  vi.resetModules();
  env = stubBrowser();
  vi.doMock('./spotlightDom', () => ({
    startTour: (steps: unknown[], end?: TourEnd) => {
      const tour = { steps, end, stopped: false };
      env.tours.push(tour);
      return {
        notifyAction: () => {},
        stop: () => {
          tour.stopped = true;
          end?.({ completed: false, skipped: true, stopped: false, reachedStep: 0 });
        },
        get active() {
          return !tour.stopped;
        },
        holdsClock: false,
        stage: undefined,
      };
    },
  }));
  // Лента, камера и лист рисуют на канвасе и в DOM — их владельцы подменены.
  vi.doMock('./eventFeed', () => ({ note: (text: string) => env.calls.push(`note:${text}`) }));
  vi.doMock('./mapCamera', () => ({ focusWorld: () => {}, world: () => null }));
  vi.doMock('./sidePanel', () => ({
    invalidatePanel: () => {},
    renderPanel: () => {},
    planetTab: 'buildings',
    setPlanetTab: () => {},
  }));
  // Полоса скорости и дверь хаба — владельцы со своими хуками; модуль только зовёт их.
  vi.doMock('./matchTopBar', () => ({
    applyTimeSpeed: (x: number) => env.calls.push(`speed:${x}`),
  }));
  vi.doMock('./soloCheckpoint', () => ({ refreshHubDoor: () => env.calls.push('hubdoor') }));
  vi.doMock('./setupScreen', () => ({
    prepareGuidedSetup: () => env.calls.push('prepareGuidedSetup'),
    buildSetupConfig: () => ({ guided: true }),
  }));
  const guide = await import('./guideFlow');
  let meta: MetaState = { xp: 0, unlocked: [] } as unknown as MetaState;
  guide.initGuideFlow({
    world,
    me: () => 'p1',
    callsign: () => 'Vega',
    mobile: () => false,
    panelExpanded: () => false,
    loadMeta: () => meta,
    saveMeta: (st) => {
      meta = st;
      env.calls.push(`xp:${st.xp}`);
    },
    showHub: (show) => env.calls.push(`hub:${show}`),
    showConnect: (show) => env.calls.push(`connect:${show}`),
    startMatch: (setup, persist) => env.calls.push(`start:${JSON.stringify(setup)}:${persist}`),
    sheetExpanded: () => false,
    collapseSheet: () => {},
    refreshSheet: () => {},
    openMarket: (good) => env.calls.push(`market:${good}`),
    tutorialEnded: (run) => env.calls.push(`medal:${run.completed}:${run.assaultWon}`),
    devUi: () => false,
  });
  return guide;
}

let game: typeof import('./game');

beforeAll(async () => {
  game = await import('./game');
});

afterEach(() => {
  vi.doUnmock('./spotlightDom');
  vi.doUnmock('./setupScreen');
  for (const m of [
    './eventFeed',
    './mapCamera',
    './sidePanel',
    './matchTopBar',
    './soloCheckpoint',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
});

const onboard = () =>
  JSON.parse(env.store.get('vd.onboard.Vega') ?? '{}') as Record<string, unknown>;

describe('REFM-221 · обучение — шов туров', () => {
  it('`__vdTour` запускает один тур, гасит его и отвечает, идёт ли он', async () => {
    const s = game.newGame();
    const guide = await load(() => s);
    const seam = (
      window as unknown as { __vdTour: { start(): void; stop(): void; active: boolean } }
    ).__vdTour;
    expect(seam.active).toBe(false);
    seam.start();
    expect(seam.active).toBe(true);
    expect(guide.activeTour).not.toBeNull();
    seam.stop();
    expect(seam.active).toBe(false);
    expect(guide.activeTour).toBeNull(); // конец тура сам отпускает живую ссылку
  });

  it('очередь гида стартует по оживлению HUD, один раз', async () => {
    const s = game.newGame();
    const guide = await load(() => s);
    let runs = 0;
    guide.setPendingGuide(() => runs++);
    guide.maybeStartPendingTour();
    guide.maybeStartPendingTour(); // второй кадр очереди уже не видит
    env.frames.forEach((f) => f());
    expect(runs).toBe(1);
  });
});

describe('REFM-221 · ведомый первый матч и цели', () => {
  it('сетап готовится дверью экрана до старта; гид и список целей ждут живого HUD', async () => {
    let s = game.newGame();
    const guide = await load(() => s);
    guide.startGuidedMatch();
    expect(env.calls.slice(0, 5)).toEqual([
      'prepareGuidedSetup',
      'hub:false',
      'connect:false',
      'start:{"guided":true}:false',
      'speed:300', // урок без ботов ускоряет настоящие часы стройки, науки и пути
    ]);
    expect(env.tours).toHaveLength(0);
    s = game.newGame();
    guide.maybeStartPendingTour();
    env.frames.forEach((f) => f());
    expect(env.tours).toHaveLength(1);
    expect(env.els.get('goals')?.classList.contains('show')).toBe(true);
  });

  it('все четыре цели — похвала и XP ровно один раз; флаг помнит награду по позывному', async () => {
    let s = game.newGame();
    const guide = await load(() => s);
    guide.startGuidedMatch();
    guide.maybeStartPendingTour();
    env.frames.forEach((f) => f());
    env.calls.length = 0;
    const next = structuredClone(s);
    const home = Object.values(next.planets).find((p) => p.owner === 'p1' && p.kind === 'planet')!;
    home.buildings.find((b) => b.type === 'mine')!.level += 1;
    const other = Object.values(next.planets).find((p) => p.owner !== 'p1' && p.kind === 'planet')!;
    other.owner = 'p1';
    Object.values(next.fleets)
      .find((f) => f.owner === 'p1')!
      .units.push({ unit: 'frigate', count: 1 });
    next.match.scores.p1 = { controlledPlanets: 2, fleets: 1, units: 1, total: 1_000 };
    s = next;
    guide.updateGoals();
    guide.updateGoals();
    expect(env.calls.filter((c) => c.startsWith('xp:'))).toHaveLength(1);
    expect(onboard().goalsRewarded).toBe(true);
    guide.stopFirstGoals();
    expect(env.els.get('goals')?.classList.contains('show')).toBe(false);
  });

  it('исход тура ложится во флаг: пропуск запомнен навсегда', async () => {
    const s = game.newGame();
    const guide = await load(() => s);
    guide.startGuidedMatch();
    guide.maybeStartPendingTour();
    env.frames.forEach((f) => f());
    guide.activeTour?.stop();
    expect(onboard()).toMatchObject({ skipped: true });
    expect(env.calls).toContain('medal:false:false'); // медаль решает сама: курс не пройден
    expect(env.els.get('goals')?.classList.contains('show')).toBe(false);
  });

  it('кнопки хаба: «Пропустить» пишет флаг, «Начать обучение» отмечает старт и ведёт в гид', async () => {
    const s = game.newGame();
    await load(() => s);
    env.els.get('ob-skip')!.click();
    expect(onboard()).toMatchObject({ started: true, skipped: true });
    expect(env.calls).toContain('hubdoor'); // предложение в хабе гаснет сразу
    env.store.clear();
    env.els.get('ob-start')!.click();
    expect(onboard()).toMatchObject({ started: true });
    expect(env.calls).toContain('prepareGuidedSetup');
  });

  it('список сворачивается в лоток и обратно по нажатию шапки', async () => {
    const s = game.newGame();
    const guide = await load(() => s);
    guide.startGuidedMatch();
    guide.maybeStartPendingTour();
    env.frames.forEach((f) => f());
    const goals = env.els.get('goals')!;
    const full = goals.innerHTML;
    goals.click('gl-tg');
    expect(goals.innerHTML).not.toBe(full);
    goals.click('gl-tray');
    expect(goals.innerHTML).toBe(full);
  });
});
