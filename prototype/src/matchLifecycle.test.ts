/**
 * Жизненный цикл матча (REFM-219) — прямой тест выходов.
 *
 * Установку партии и запуски держат сторожа по тексту (`firstStepFog`, `soloRoads`,
 * `trainingRange`, `aiProfile`, `netSession`, `mapRadar` и соседи) и роботы
 * (`smoke:browser`, `smoke:sector-zero`, `smoke:net`): им нужен живой мир, канвас и экраны.
 * Здесь — то, что собирается только вместе и обходится без них: дверь выхода зовёт каждого
 * владельца, итоговый экран ведёт игрока по его выбору, ⌂ в идущей экспедиции спрашивает.
 * Владельцы, к которым модуль обращается, подменены: тест подслушивает, что у них спросили.
 * Каждый тест — свежая загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MatchLifecycleHost } from './matchLifecycle';

type Listener = (ev: unknown) => void;

interface Env {
  calls: string[];
  listeners: Map<string, Listener>;
  run: { training: boolean; sectorZero: boolean; inProgress: boolean };
}

let env: Env;

/** Владельцы, которых зовёт модуль: каждый вызов пишется в журнал теста. */
function mockOwners(): void {
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      void env.calls.push(args.length ? `${name}:${args.map((a) => String(a)).join(',')}` : name);
  vi.doMock('./sectorRun', () => ({
    saveRun: log('saveRun'),
    isTraining: () => env.run.training,
    isSectorZeroRun: () => env.run.sectorZero,
    runInProgress: () => env.run.inProgress,
  }));
  vi.doMock('./netSession', () => ({ leaveNetwork: log('leaveNetwork') }));
  vi.doMock('./seatNicks', () => ({ clearSeatNicks: log('clearSeatNicks') }));
  vi.doMock('./guideFlow', () => ({
    stopFirstGoals: log('stopFirstGoals'),
    activeTour: { stop: log('tour.stop') },
  }));
  vi.doMock('./sectorZeroShell', () => ({
    openSectorZero: log('openSectorZero'),
    openAbandon: (reason: string) => env.calls.push(`openAbandon:${reason}`),
  }));
  vi.doMock('./setupScreen', () => ({ openSetup: log('openSetup') }));
  // Соседи, которые трогают канвас и DOM при импорте; выходам они не нужны.
  for (const m of [
    './chainComposer',
    './eventFeed',
    './groupOrders',
    './helpCenter',
    './interaction',
    './mapCamera',
    './mapEffects',
    './mapFog',
    './mapInput',
    './mapLoading',
    './mapRadar',
    './matchJoin',
    './matchTopBar',
    './orderPipeline',
    './sandbox',
    './sectorProfile',
    './soloCheckpoint',
    './trainingScenario',
  ])
    vi.doMock(m, () => ({}));
}

async function load() {
  vi.resetModules();
  env = {
    calls: [],
    listeners: new Map(),
    run: { training: false, sectorZero: false, inProgress: false },
  };
  vi.stubGlobal('__PLAYER_BUILD__', false);
  vi.stubGlobal('document', {
    getElementById: (id: string) => ({
      addEventListener: (type: string, fn: Listener) => {
        if (type === 'click') env.listeners.set(id, fn);
      },
      click: () => env.listeners.get(id)?.({ isTrusted: false, currentTarget: null }),
    }),
  });
  mockOwners();
  const life = await import('./matchLifecycle');
  const host = {
    stopSim: () => env.calls.push('stopSim'),
    halt: () => env.calls.push('halt'),
    openHub: () => env.calls.push('openHub'),
    hubTab: (tab: string) => env.calls.push(`hubTab:${tab}`),
  } as unknown as MatchLifecycleHost;
  life.initMatchLifecycle(host);
  return life;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('REFM-219 · дверь выхода', () => {
  it('сохраняет забег, останавливает мир и сеть, гасит ники мест, первые цели и тур', async () => {
    const life = await load();
    life.leaveMatch();
    expect(env.calls).toEqual([
      'saveRun',
      'stopSim',
      'halt',
      'leaveNetwork',
      'clearSeatNicks',
      'stopFirstGoals',
      'tour.stop',
    ]);
  });
});

describe('REFM-219 · итоговый экран ведёт по выбору игрока', () => {
  const after = (calls: string[]) => calls.slice(calls.indexOf('tour.stop') + 1);

  it('сеть: «Ещё раз» — в браузер матчей, «В меню» — в хаб', async () => {
    const life = await load();
    life.leaveFromEnd('again', true);
    expect(after(env.calls)).toEqual(['openHub', 'hubTab:games']);
    env.calls.length = 0;
    life.leaveFromEnd('menu', true);
    expect(after(env.calls)).toEqual(['openHub']);
  });

  it('соло: «Ещё раз» — в настройку схватки', async () => {
    const life = await load();
    life.leaveFromEnd('again', false);
    expect(after(env.calls)).toEqual(['openSetup:hub']);
  });

  it('забег Sector Zero: в меню Sector Zero — с подготовкой или сразу в главу', async () => {
    const life = await load();
    env.run.sectorZero = true;
    life.leaveFromEnd('replay', false);
    expect(after(env.calls)).toEqual(['openSectorZero:false,true']);
    env.calls.length = 0;
    life.leaveFromEnd('again', false);
    expect(after(env.calls)).toEqual(['openSectorZero:true,false']);
  });

  it('полигон: «В меню» — в меню Sector Zero', async () => {
    const life = await load();
    env.run.training = true;
    life.leaveFromEnd('menu', false);
    expect(after(env.calls)).toEqual(['openSectorZero']);
  });
});

describe('REFM-219 · ⌂ и «Покинуть сессию»', () => {
  it('живой тап по ⌂ в идущей экспедиции спрашивает и никуда не уходит', async () => {
    await load();
    env.run.inProgress = true;
    env.listeners.get('tomenu')!({ isTrusted: true });
    expect(env.calls).toEqual(['openAbandon:exit']);
  });

  it('программный ⌂ уходит сразу: из забега — в меню Sector Zero, из схватки — в хаб', async () => {
    await load();
    env.run.inProgress = true;
    env.run.sectorZero = true;
    env.listeners.get('tomenu')!({ isTrusted: false });
    expect(env.calls.at(0)).toBe('saveRun');
    expect(env.calls.at(-1)).toBe('openSectorZero');
    env.calls.length = 0;
    env.run = { training: false, sectorZero: false, inProgress: false };
    env.listeners.get('tomenu')!({ isTrusted: true });
    expect(env.calls.at(-1)).toBe('openHub');
  });

  it('«Покинуть сессию» в экспедиции спрашивает, вне её — тот же выход, что ⌂', async () => {
    await load();
    env.run.inProgress = true;
    env.listeners.get('rail-exit')!({ currentTarget: null });
    expect(env.calls).toEqual(['openAbandon:exit']);
    env.calls.length = 0;
    env.run.inProgress = false;
    env.listeners.get('rail-exit')!({ currentTarget: null });
    expect(env.calls.at(-1)).toBe('openHub');
  });
});
