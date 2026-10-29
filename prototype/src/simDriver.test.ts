/**
 * Драйвер потока расчёта соло-мира (REFM-245) — прямой тест модуля.
 *
 * Связь с потоком проверена у `simLink.ts`, часы шага и взятия — у `decisions/simClock.ts`,
 * часы картинки — у `decisions/netViewClock.ts`, откуда поднимать поток — у
 * `decisions/simWorker.ts`. Здесь — то, что собирается только вместе: поток поднимается
 * лишь под обычную схватку, ведёт шаги вместо кадра, присланное ложится через конвейер
 * приказа, сломавшийся поток отдаёт мир кадру и больше не поднимается, а уход из схватки его
 * гасит. Связь и соседи подменены: тест подслушивает, о чём модуль их попросил. Каждый
 * тест — свежая загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../packages/shared-core/src/index';
import type { SimDriverHost } from './simDriver';

interface FakeLink {
  busy: boolean;
  failed: string | null;
  time: number;
  arrived: number | null;
  sync: { state: GameState; events: unknown[]; driverOrders: unknown[]; refused: unknown[] } | null;
}

interface Env {
  calls: string[];
  link: FakeLink | null;
  inMatch: boolean;
  net: boolean;
  world: GameState;
}

let env: Env;

const world = (time: number, pve = false) => ({ time, pve }) as unknown as GameState;

async function load() {
  vi.resetModules();
  env = { calls: [], link: null, inMatch: true, net: false, world: world(1_000) };
  vi.stubGlobal('__PLAYER_BUILD__', true);
  vi.stubGlobal('__SIM_WORKER_URL__', 'sim-worker.js');
  vi.stubGlobal('location', { protocol: 'https:', search: '' });
  vi.doMock('./simLink', () => ({
    workerPort: () => ({}),
    startSimLink: (_port: unknown, state: GameState, me: string, mode: string | undefined) => {
      env.calls.push(`start:${state.time}:${me}:${mode}`);
      const link: FakeLink = {
        busy: false,
        failed: null,
        time: state.time,
        arrived: null,
        sync: null,
      };
      env.link = link;
      return {
        get busy() {
          return link.busy;
        },
        get failed() {
          return link.failed;
        },
        get time() {
          return link.time;
        },
        step: (target: number, drivers: boolean) => {
          env.calls.push(`step:${target}:${drivers}`);
          link.time = target;
          link.busy = true;
        },
        forward: (action: { type: string }) => env.calls.push(`forward:${action.type}`),
        frame: () => link.arrived,
        take: () => link.sync,
        saved: (state: GameState) => ({ ...state, saved: true }),
        save: (_host: unknown, rules: string) => env.calls.push(`save:${rules}`),
        stop: () => env.calls.push('stop'),
      };
    },
  }));
  vi.doMock('./orderPipeline', () => ({
    apply: (out: { state: GameState }) => {
      env.calls.push(`apply:${out.state.time}`);
      env.world = out.state;
    },
    settleOrder: (type: string, error?: string) => env.calls.push(`settle:${type}:${error ?? ''}`),
  }));
  vi.doMock('./netSession', () => ({
    get netWorld() {
      return env.net ? {} : null;
    },
  }));
  vi.doMock('./soloCheckpoint', () => ({ soloSaveActive: true }));
  vi.doMock('./sandbox', () => ({ sandboxConfig: { enabled: false } }));
  vi.doMock('./mapLayer', () => ({ mapMoving: () => false }));
  vi.doMock('./groupOrders', () => ({ soloAutoAssault: new Set<string>() }));
  vi.doMock('./game', () => ({ HOUR: 1_000, matchMode: () => 'skirmish' }));
  const sim = await import('./simDriver');
  const host: SimDriverHost = {
    world: () => env.world,
    me: () => 'p1',
    inMatch: () => env.inMatch,
    aiPlayers: () => new Map(),
    comicBusy: () => false,
  };
  sim.initSimDriver(host);
  return sim;
}

afterEach(() => {
  for (const m of [
    './simLink',
    './orderPipeline',
    './netSession',
    './soloCheckpoint',
    './sandbox',
    './mapLayer',
    './groupOrders',
    './game',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
});

describe('REFM-245 · поток поднимается только под обычную схватку', () => {
  it('схватка на экране — поток поднят и ведёт шаги вместо кадра', async () => {
    const sim = await load();
    sim.syncSim(0);
    expect(env.calls).toEqual(['start:1000:p1:skirmish']);
    expect(sim.simOn()).toBe(true);
    expect(sim.stepSim(16, 1, 0)).toBe(true);
    expect(env.calls.at(-1)).toMatch(/^step:\d+:true$/);
    env.calls.length = 0;
    expect(sim.stepSim(16, 1, 16)).toBe(true); // шаг в пути — следующий копится, не уходит
    expect(env.calls).toEqual([]);
  });

  it('вне матча, в сети и в PvE поток не поднимается — мир ведёт кадр', async () => {
    const sim = await load();
    env.inMatch = false;
    sim.syncSim(0);
    env.inMatch = true;
    env.net = true;
    sim.syncSim(0);
    env.net = false;
    env.world = world(1_000, true);
    sim.syncSim(0);
    expect(env.calls).toEqual([]);
    expect(sim.simOn()).toBe(false);
    expect(sim.stepSim(16, 1, 0)).toBe(false);
  });

  it('уход из схватки гасит поток', async () => {
    const sim = await load();
    sim.syncSim(0);
    env.inMatch = false;
    sim.syncSim(16);
    expect(env.calls.at(-1)).toBe('stop');
    expect(sim.simOn()).toBe(false);
  });
});

describe('REFM-245 · присланное и отказ потока', () => {
  it('присланный мир ложится через конвейер, исходы своих приказов — каждый', async () => {
    const sim = await load();
    sim.syncSim(0);
    env.link!.arrived = 2_000;
    env.link!.sync = {
      state: world(2_000),
      events: [],
      driverOrders: [{ type: 'fleet.move' }],
      refused: [{ type: 'fleet.attack', error: 'E_NO_ROUTE' }],
    };
    sim.syncSim(500);
    expect(env.calls.slice(1)).toEqual([
      'apply:2000',
      'settle:fleet.move:',
      'settle:fleet.attack:E_NO_ROUTE',
    ]);
  });

  it('сломавшийся поток отдаёт мир кадру и до перезагрузки не поднимается', async () => {
    const sim = await load();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sim.syncSim(0);
    env.link!.failed = 'boom';
    sim.syncSim(16);
    expect(env.calls.slice(1)).toEqual(['apply:1000', 'stop']);
    expect((env.world as unknown as { saved?: boolean }).saved).toBe(true);
    env.calls.length = 0;
    sim.syncSim(32);
    expect(env.calls).toEqual([]);
    expect(sim.stepSim(16, 1, 32)).toBe(false);
  });
});

describe('REFM-245 · сохранение, приказы и часы картинки', () => {
  it('без потока сохранение собирает экран; с потоком — поток, и приказы уходят ему', async () => {
    const sim = await load();
    const host = {} as Parameters<typeof sim.saveSimInBackground>[0];
    expect(sim.saveSimInBackground(host, 'r', () => {})).toBe(false);
    expect(sim.simSaved(env.world)).toBe(env.world);
    sim.syncSim(0);
    expect(sim.saveSimInBackground(host, 'r', () => {})).toBe(true);
    expect((sim.simSaved(env.world) as unknown as { saved?: boolean }).saved).toBe(true);
    sim.forwardToSim({ type: 'fleet.move' } as Parameters<typeof sim.forwardToSim>[0]);
    expect(env.calls.slice(1)).toEqual(['save:r', 'forward:fleet.move']);
  });

  it('на паузе картинка стоит на мире', async () => {
    const sim = await load();
    sim.syncSim(0);
    sim.settleSimClock(100, false);
    expect(sim.simShownTime()).toBe(env.world.time);
  });
});
