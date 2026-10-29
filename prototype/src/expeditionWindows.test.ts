/**
 * Окна экспедиции (REFM-249) — прямой тест модуля.
 *
 * Сами окна проверены у своих владельцев (`traderScreen.ts`, `allyScreen.ts`, `pirateIntro.ts`),
 * раздел торговца — у ядра, статус союзника — у `decisions/allyPanel.ts`, проводку держат
 * сторожа `traderWiring` и `allyWiring`. Здесь — то, что собирается только вместе: торговец
 * есть только у идущего забега, и кадр ведёт его кнопку рельса и окно; без связи с союзником
 * окно гаснет и прицел снимается; окно союзника называет цель именем места; воронка подсказки
 * пиратов считается только в забеге Sector Zero, а легшая на дом подсказка пересчитывает вид.
 * Окна и соседи подменены: тест подслушивает, о чём модуль их попросил. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../packages/shared-core/src/index';
import type { ExpeditionWindowsHost } from './expeditionWindows';

type Host = Record<string, (...args: never[]) => unknown>;

interface Env {
  calls: string[];
  hosts: Record<string, Host>;
  open: Record<string, boolean>;
  els: Map<string, { style: Record<string, string>; click?: () => void }>;
  run: boolean;
  sectorZero: boolean;
  trader: unknown;
  linked: boolean;
  covers: boolean;
}

let env: Env;

const world = {
  time: 0,
  planets: { H: { id: 'H', owner: 'p1', position: { x: 1, y: 2 } } },
  fleets: { F1: { location: 'W1' }, F2: { movement: { to: 'W2' } } },
} as unknown as GameState;

async function load() {
  vi.resetModules();
  env = {
    calls: [],
    hosts: {},
    open: { trader: false, ally: false },
    els: new Map(),
    run: false,
    sectorZero: false,
    trader: { goods: ['metal'] },
    linked: false,
    covers: false,
  };
  vi.stubGlobal('document', {
    getElementById: (id: string) => {
      let e = env.els.get(id);
      if (!e) {
        const el: { style: Record<string, string>; click?: () => void } = { style: {} };
        Object.assign(el, {
          addEventListener: (_t: string, fn: () => void) => {
            el.click = fn;
          },
        });
        env.els.set(id, (e = el));
      }
      return e;
    },
  });
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      void env.calls.push(`${name}:${args.map(String).join(',')}`);
  const win = (name: 'trader' | 'ally') => (host: Host) => {
    env.hosts[name] = host;
    return {
      open: () => env.calls.push(`${name}.open`),
      close: () => {
        env.open[name] = false;
        env.calls.push(`${name}.close`);
      },
      isOpen: () => env.open[name],
      refresh: () => env.calls.push(`${name}.refresh`),
    };
  };
  vi.doMock('./traderScreen', () => ({ initTrader: win('trader') }));
  vi.doMock('./allyScreen', () => ({ initAllyScreen: win('ally') }));
  vi.doMock('./pirateIntro', () => ({
    initPirateIntro: (host: Host) => {
      env.hosts.pirate = host;
      return {};
    },
  }));
  vi.doMock('../../packages/shared-core/src/index', () => ({
    traderOf: () => env.trader,
  }));
  vi.doMock('./sectorRun', () => ({
    runInProgress: () => env.run,
    isSectorZeroRun: () => env.sectorZero,
    sectorAttempt: 3,
  }));
  vi.doMock('./game', () => ({ ctx: () => ({}), data: {} }));
  vi.doMock('./battleView', () => ({ battleWindow: { open: log('battle.open') } }));
  vi.doMock('./eventFeed', () => ({ note: log('note') }));
  vi.doMock('./interaction', () => ({ allyAim: null, arm: log('arm'), drop: log('drop') }));
  vi.doMock('./mapCamera', () => ({
    defaultView: log('defaultView'),
    focusWorld: log('focus'),
    jumpTo: log('jump'),
    pirateIntroRect: () => ({}),
    world: () => ({}),
  }));
  vi.doMock('./mapFog', () => ({ fleetSeen: () => true }));
  vi.doMock('./openingView', () => ({ pickHome: () => world.planets.H }));
  vi.doMock('./orderPipeline', () => ({ playerOrder: () => true }));
  vi.doMock('./panelSlack', () => ({ cardCovers: () => env.covers }));
  vi.doMock('./platform/host', () => ({
    getPlatform: () => ({
      analytics: { emit: (e: string, p: unknown) => env.calls.push(`${e}:${JSON.stringify(p)}`) },
    }),
  }));
  const mod = await import('./expeditionWindows');
  const host: ExpeditionWindowsHost = {
    world: () => world,
    me: () => 'p1',
    placeName: (id) => `«${id}»`,
    allyLinked: () => env.linked,
  };
  mod.initExpeditionWindows(host);
  return mod;
}

afterEach(() => {
  for (const m of [
    './traderScreen',
    './allyScreen',
    './pirateIntro',
    '../../packages/shared-core/src/index',
    './sectorRun',
    './game',
    './battleView',
    './eventFeed',
    './interaction',
    './mapCamera',
    './mapFog',
    './openingView',
    './orderPipeline',
    './panelSlack',
    './platform/host',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
});

describe('REFM-249 · торговец', () => {
  it('есть только у идущего забега: вне забега кнопка спрятана, окно закрывается само', async () => {
    const mod = await load();
    env.open.trader = true;
    mod.tickTrader();
    expect(mod.runTrader()).toBeUndefined();
    expect(env.els.get('rail-trader')!.style.display).toBe('none');
    expect(env.calls).toEqual(['trader.close']);
  });

  it('в забеге кнопка видна, окно следит за курсом, кнопка открывает его', async () => {
    const mod = await load();
    env.run = true;
    mod.tickTrader();
    expect(mod.runTrader()).toEqual({ goods: ['metal'] });
    expect(env.els.get('rail-trader')!.style.display).toBe('');
    env.els.get('rail-trader')!.click!();
    expect(env.calls).toEqual(['trader.refresh', 'trader.open']);
  });
});

describe('REFM-249 · союзник', () => {
  it('без связи окно гаснет и прицел снимается; со связью — окно следит', async () => {
    const mod = await load();
    env.open.ally = true;
    mod.tickAlly();
    expect(env.calls).toEqual(['ally.close', 'drop:allyAim']);
    env.calls.length = 0;
    env.linked = true;
    mod.tickAlly();
    expect(env.calls).toEqual(['ally.refresh']);
  });

  it('цель названа именем места: мира, стоянки флота или цели его перелёта', async () => {
    await load();
    const name = env.hosts.ally!.targetName as (p?: string, f?: string) => string;
    expect([name('W9'), name(undefined, 'F1'), name(undefined, 'F2'), name()]).toEqual([
      '«W9»',
      '«W1»',
      '«W2»',
      '—',
    ]);
    (env.hosts.ally!.findFleet as (id: string) => void)('F2');
    expect(env.calls).toEqual(['jump:W2,goto']);
  });
});

describe('REFM-249 · подсказка пиратов', () => {
  it('воронка обучения считается только в забеге Sector Zero', async () => {
    await load();
    const stage = env.hosts.pirate!.onStage as (step: string) => void;
    stage('shown');
    expect(env.calls).toEqual([]);
    env.sectorZero = true;
    stage('shown');
    expect(env.calls).toEqual(['onboarding_step:{"guide":"pirates","step":"shown","attempt":3}']);
  });

  it('легла на дом — вид пересчитывается, иначе остаётся', async () => {
    await load();
    const first = env.hosts.pirate!.onFirstShow as () => void;
    first();
    expect(env.calls).toEqual([]);
    env.covers = true;
    first();
    expect(env.calls).toEqual(['defaultView:']);
  });
});
