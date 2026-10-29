/**
 * Проводка окна настроек (REFM-248) — прямой тест модуля.
 *
 * Само окно (вкладки, разметка, нажатия) проверено у `settingsOverlay.ts`, графика — у
 * `graphicsPrefs.ts`, цвета сторон — у `mapPalette.ts`, push — у `pushSetup.ts`. Здесь — то,
 * что собирается только вместе: прозрачность окон встаёт на `body` сразу и после изменения,
 * снимок окна несёт вкладки там, где они есть (панель телефона, единица дохода, push),
 * изменения уходят хозяевам игры, окно согласия перерисовывает открытые настройки, а
 * диагностика рендера читает канвас и счётчики кадра. Окно и соседи подменены: тест
 * подслушивает, о чём модуль их попросил. Каждый тест — свежая загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SettingsHost } from './settingsOverlay';
import type { SettingsViewHost } from './settingsView';

type Listener = () => void;

interface Env {
  calls: string[];
  host: SettingsHost | null;
  push: { changed: () => void } | null;
  pushView: unknown;
  shown: boolean;
  listeners: Map<string, Listener>;
  vars: Map<string, string>;
  opacity: number;
}

let env: Env;

async function load(over: Partial<SettingsViewHost> = {}, sectorZeroOnly = false) {
  vi.resetModules();
  env = {
    calls: [],
    host: null,
    push: null,
    pushView: null,
    shown: false,
    listeners: new Map(),
    vars: new Map(),
    opacity: 80,
  };
  const node = (id: string) => ({
    classList: { contains: (c: string) => c === 'show' && env.shown },
    addEventListener: (_t: string, fn: Listener) => void env.listeners.set(id, fn),
  });
  vi.stubGlobal('__SECTOR_ZERO_ONLY__', sectorZeroOnly);
  vi.stubGlobal('document', {
    getElementById: node,
    body: {
      style: { setProperty: (k: string, v: string) => void env.vars.set(k, v) },
      classList: { contains: (c: string) => c === 'holo-available' },
    },
  });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14)' });
  vi.stubGlobal('window', { devicePixelRatio: 3, visualViewport: { scale: 1 } });
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      void env.calls.push(`${name}:${args.map(String).join(',')}`);
  vi.doMock('./settingsOverlay', () => ({
    initSettings: (host: SettingsHost) => {
      env.host = host;
      return { open: () => env.calls.push('open'), render: () => env.calls.push('render') };
    },
  }));
  vi.doMock('./pushSetup', () => ({
    initPush: (host: { changed: () => void }) => {
      env.push = host;
      return {
        view: () => env.pushView,
        refresh: async () => void env.calls.push('push.refresh'),
        setEnabled: async () => {},
        setKind: async () => {},
      };
    },
  }));
  vi.doMock('./graphicsPrefs', () => ({
    glowOn: () => true,
    mapSharpOn: () => true,
    motionOn: () => true,
    pcUi: () => false,
    setGlowFx: log('glow'),
    setMapSharp: log('mapSharp'),
    setMotion: log('motion'),
    setShowFps: log('fps'),
    setStarfield: log('starfield'),
    setUiScale: log('uiScale'),
    setWindowOpacity: (pct: number) => {
      env.opacity = pct;
    },
    showFpsOn: () => false,
    starfieldOn: () => true,
    uiScalePct: () => 100,
    windowAlpha: (pct: number) => pct / 100,
    windowOpacityPct: () => env.opacity,
  }));
  vi.doMock('./canvasCompatibility', () => ({
    canvasCompatibilityActive: () => false,
    canvasCompatibilityRequested: () => true,
    setCanvasCompatibility: log('compat'),
  }));
  vi.doMock('./hubScreen', () => ({ hubAuthorizedBase: () => null }));
  vi.doMock('./mapCamera', () => ({ cam: { scale: 1.5 } }));
  vi.doMock('./mapLayer', () => ({
    backgroundContextEvents: { lost: 0 },
    bgx: { getContextAttributes: () => ({ alpha: false }), isContextLost: () => false },
    mapContextEvents: { lost: 1 },
  }));
  vi.doMock('./mapPalette', () => ({
    neutralColor: '#888',
    rivalPaletteId: 'classic',
    setSideColors: log('colors'),
    youColor: '#0ff',
  }));
  vi.doMock('./mapRadar', () => ({ setSweepOpacity: log('sweep'), sweepOpacity: 0.5 }));
  vi.doMock('./updater', () => ({ currentBuild: () => 'b1' }));
  const view = await import('./settingsView');
  const host: SettingsViewHost = {
    ownPings: () => true,
    setOwnPings: log('ownPings'),
    sound: {
      enabled: () => true,
      volume: () => 0.4,
      setEnabled: log('sound'),
      setVolume: log('volume'),
      play: log('play'),
    } as unknown as SettingsViewHost['sound'],
    speedKeys: () => false,
    screenDpr: () => 3,
    mobile: () => true,
    phoneBar: () => ['map', 'fleets'] as unknown as ReturnType<SettingsViewHost['phoneBar']>,
    setPhoneBar: log('phoneBar'),
    rateUnit: () => 'hour' as ReturnType<SettingsViewHost['rateUnit']>,
    setRateUnit: log('rateUnit'),
    resize: log('resize'),
    probe: () => ({
      canvas: {
        width: 1170,
        height: 2532,
        getBoundingClientRect: () => ({ width: 390, height: 844 }),
      } as unknown as HTMLCanvasElement,
      cx: {
        getContextAttributes: () => ({ alpha: false }),
        isContextLost: () => false,
      } as unknown as CanvasRenderingContext2D,
      vw: 390,
      vh: 844,
      dpr: 3,
      frameErrors: 2,
      fps: 59.6,
    }),
    ...over,
  };
  view.initSettingsView(host);
  return view;
}

afterEach(() => {
  for (const m of [
    './settingsOverlay',
    './pushSetup',
    './graphicsPrefs',
    './canvasCompatibility',
    './hubScreen',
    './mapCamera',
    './mapLayer',
    './mapPalette',
    './mapRadar',
    './updater',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
});

describe('REFM-248 · прозрачность окон', () => {
  it('встаёт на body сразу и после изменения, процент сохраняется', async () => {
    await load();
    expect(env.vars.get('--holo-window-alpha')).toBe('0.8');
    env.host!.setWindowOpacity!(0.55);
    expect(env.opacity).toBe(55);
    expect(env.vars.get('--holo-window-alpha')).toBe('0.55');
  });
});

describe('REFM-248 · снимок окна', () => {
  it('телефон — с нижней панелью; основная игра — с единицей дохода; push — где есть', async () => {
    await load();
    let snap = env.host!.view();
    expect(snap.phoneBar).toEqual(['map', 'fleets']);
    expect(snap.rateUnit).toBe('hour');
    expect(snap.push).toBeUndefined();
    expect(snap.windowOpacity).toBe(0.8);
    expect(snap.mapSharp).toBe(true); // экран с плотностью 3 есть что понижать
    env.pushView = { enabled: false };
    snap = env.host!.view();
    expect(snap.push).toEqual({ enabled: false });
  });

  it('ПК без телефонной раскладки — без панели; архив площадки — без единицы дохода и push', async () => {
    await load({ mobile: () => false }, true);
    const snap = env.host!.view();
    expect(snap.phoneBar).toBeUndefined();
    expect(snap.rateUnit).toBeUndefined();
    expect(env.push).toBeNull();
  });
});

describe('REFM-248 · изменения уходят хозяевам', () => {
  it('чёткость карты пересчитывает экран, остальное — двери игры', async () => {
    await load();
    const h = env.host!;
    h.setMapSharp!(false);
    h.setRateUnit!('day');
    h.setPhoneBar!(['map'] as unknown as Parameters<NonNullable<SettingsHost['setPhoneBar']>>[0]);
    h.setOwnPings(false);
    h.resetColors();
    expect(env.calls).toEqual([
      'mapSharp:false',
      'resize:',
      'rateUnit:day',
      'phoneBar:map',
      'ownPings:false',
      expect.stringMatching(/^colors:.*,classic$/),
    ]);
  });
});

describe('REFM-248 · окно и push', () => {
  it('кнопки хаба и рельса открывают окно и перечитывают push', async () => {
    await load();
    for (const id of ['hub-settings', 'hub-gear', 'rail-settings']) env.listeners.get(id)!();
    await Promise.resolve();
    expect(env.calls.filter((c) => c === 'open')).toHaveLength(3);
    expect(env.calls.filter((c) => c === 'push.refresh')).toHaveLength(3);
  });

  it('окно согласия перерисовывает настройки, только пока они открыты', async () => {
    await load();
    env.push!.changed();
    expect(env.calls).toEqual([]);
    env.shown = true;
    env.push!.changed();
    expect(env.calls).toEqual(['render']);
  });
});

describe('REFM-248 · диагностика рендера', () => {
  it('отчёт читает канвас, контексты, счётчики кадра и камеру', async () => {
    await load();
    const report = JSON.parse(env.host!.renderingReport!()) as Record<string, unknown>;
    expect(report).toMatchObject({
      schema: 1,
      build: 'b1',
      compatibility: { active: false, requested: true, restartPending: true },
      viewport: { width: 390, height: 844, devicePixelRatio: 3, renderDpr: 3 },
      canvas: { width: 1170, cssWidth: 390, events: { lost: 1 } },
      background: { contextLost: false, events: { lost: 0 } },
      frameErrors: 2,
      estimatedFps: 60,
      cameraScale: 1.5,
    });
  });
});
