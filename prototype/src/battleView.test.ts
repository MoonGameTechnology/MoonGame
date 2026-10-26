/**
 * Проводка окна боя (REFM-246) — прямой тест модуля.
 *
 * Разметка окна, раскрытые стороны и перерисовка проверены у `battleScreen.ts`, модель боя —
 * у `createBattleModel` клиента, разбор сторон — у `battleReadout.ts` ядра, прогноз — у
 * `decisions/battleForecast.ts`. Здесь — то, что собирается только вместе: «Отступить всем»
 * взводит прицел по первому флоту и помнит бой, разбор боя не пересчитывается чаще раза в
 * 250 мс, плитки окна открывают карточку корабля или справку, а стороны названы именем места.
 * Окно и соседи подменены: тест подслушивает, о чём модуль их попросил. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import type { BattleWindowHost } from './battleScreen';

type Listener = (ev: unknown) => void;

interface Env {
  calls: string[];
  host: BattleWindowHost | null;
  listeners: Listener[];
  shown: Set<string>;
  inspected: number;
  now: number;
}

let env: Env;

async function load() {
  vi.resetModules();
  env = { calls: [], host: null, listeners: [], shown: new Set(['show']), inspected: 0, now: 0 };
  const root = {
    classList: { remove: (c: string) => void env.shown.delete(c) },
    addEventListener: (_type: string, fn: Listener) => void env.listeners.push(fn),
  };
  vi.stubGlobal('document', { getElementById: () => root });
  vi.spyOn(performance, 'now').mockImplementation(() => env.now);
  const log =
    (name: string) =>
    (...args: unknown[]) =>
      void env.calls.push(`${name}:${args.map(String).join(',')}`);
  vi.doMock('./battleScreen', () => ({
    initBattleWindow: (host: BattleWindowHost) => {
      env.host = host;
      return { open: () => {}, ended: () => {}, repaint: () => {}, isOpen: () => true };
    },
    battleRetreats: () => ['F1', 'F2'],
  }));
  vi.doMock('../../packages/client/src/index', () => ({
    createBattleModel: () => ({ ok: true, sides: [{ key: 'a' }, { key: undefined }] }),
  }));
  vi.doMock('../../packages/shared-core/src/state/battleReadout', () => ({
    inspectBattle: () => {
      env.inspected += 1;
      return { a: { inspected: env.inspected } };
    },
  }));
  vi.doMock('./game', () => ({ ctx: () => ({}), data: {} }));
  vi.doMock('./protoKernel', () => ({ kernel: {} }));
  vi.doMock('./interaction', () => ({ arm: log('arm') }));
  vi.doMock('./eventFeed', () => ({ note: log('note') }));
  vi.doMock('./sidePanel', () => ({ invalidatePanel: log('invalidate') }));
  vi.doMock('./helpCenter', () => ({ openShipCard: log('shipcard'), openCodex: log('codex') }));
  vi.doMock('./orderPipeline', () => ({
    playerOrder: (action: { type: string; payload: unknown }) =>
      void env.calls.push(`order:${action.type}`),
  }));
  vi.doMock('./fleetCard', () => ({ unitTileHtml: () => '' }));
  vi.doMock('./groupOrders', () => ({ autoRetreatAt: () => null }));
  vi.doMock('./worldQueries', () => ({ timeLeft: () => '' }));
  vi.doMock('./mapPalette', () => ({ ownerColor: () => '#fff' }));
  const view = await import('./battleView');
  view.initBattleView({
    world: () => ({ time: 0 }) as unknown as GameState,
    me: () => 'p1',
    seatName: (owner) => (owner === 'p2' ? 'Vega' : undefined),
    placeName: (id) => `«${id}»`,
  });
  return view;
}

afterEach(() => {
  for (const m of [
    './battleScreen',
    '../../packages/client/src/index',
    '../../packages/shared-core/src/state/battleReadout',
    './game',
    './protoKernel',
    './interaction',
    './eventFeed',
    './sidePanel',
    './helpCenter',
    './orderPipeline',
    './fleetCard',
    './groupOrders',
    './worldQueries',
    './mapPalette',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('REFM-246 · отступление из окна боя', () => {
  it('«Отступить всем» взводит прицел по первому флоту, гасит окно и помнит бой', async () => {
    const view = await load();
    env.host!.retreatAll!('B1');
    expect(env.calls).toEqual([
      'arm:retreatAim,F1',
      `note:${t('hint.pick-retreat')}`,
      'invalidate:',
    ]);
    expect(env.shown.has('show')).toBe(false);
    expect(view.battleRetreatAim()).toBe('B1');
    view.clearBattleRetreatAim();
    expect(view.battleRetreatAim()).toBeNull();
  });

  it('отступление одного флота — прицел без памяти о бое', async () => {
    const view = await load();
    env.host!.retreatAll!('B1');
    env.host!.retreat('F9');
    expect(env.calls.at(-3)).toBe('arm:retreatAim,F9');
    expect(view.battleRetreatAim()).toBeNull();
  });

  it('«Атаковать» уходит приказом игрока', async () => {
    await load();
    env.host!.attack!('B1', 'a');
    expect(env.calls).toEqual(['order:battle.attack']);
  });
});

describe('REFM-246 · разбор боя', () => {
  it('тот же бой пересчитывается не чаще раза в 250 мс, другой — сразу', async () => {
    await load();
    const readout = () =>
      env.host!.model('B1')!.sides[0]!.readout as unknown as { inspected: number };
    expect(readout().inspected).toBe(1);
    env.now = 249;
    expect(readout().inspected).toBe(1);
    env.now = 250;
    expect(readout().inspected).toBe(2);
    env.host!.model('B2');
    expect(env.inspected).toBe(3);
    expect(env.host!.model('B2')!.sides[1]!.readout).toBeUndefined(); // сторона без ключа
  });
});

describe('REFM-246 · плитки и имена', () => {
  it('плитка своего корабля открывает его карточку, чужая — справку', async () => {
    await load();
    const tap = (dataset: Record<string, string>) => {
      const target = { closest: () => ({ dataset }) };
      for (const fn of env.listeners) fn({ target });
    };
    tap({ shipcard: 'F|x|2' }); // id флота сам может нести «|»
    tap({ codex: 'u:frigate' });
    expect(env.calls).toEqual(['shipcard:F|x,2', 'codex:u:frigate']);
  });

  it('сторона названа именем места, без имени — самим местом, ничья — нейтральной', async () => {
    await load();
    const name = env.host!.view!.ownerName!;
    expect([name('p2'), name('p3'), name(null)]).toEqual(['Vega', 'p3', t('side.neutral')]);
    expect(env.host!.view!.placeName!('W1')).toBe('«W1»');
  });
});
