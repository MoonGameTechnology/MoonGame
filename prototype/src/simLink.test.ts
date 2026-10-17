import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';
import { HOUR } from './time';
import { newGame } from './matchSetup';
import { createSimHost } from './simHost';
import { startSimLink, type SimPort } from './simLink';
import { screenView, type SimReply, type SimRequest } from './simProtocol';
import { createSoloSim } from './soloSim';

/**
 * Отдельный поток расчёта проверяется в процессе: хозяин мира (`simHost.ts`) стоит за
 * каналом, который копирует каждое сообщение так же, как `postMessage` (structured clone),
 * — общих ссылок между копией экрана и миром потока нет, как и в игре. Эталон — тот же
 * соло-мир (`soloSim.ts`), прогнанный теми же шагами напрямую.
 */
function threadPort(): SimPort {
  let listener: (reply: SimReply) => void = () => {};
  const host = createSimHost((reply) => listener(structuredClone(reply)));
  return {
    post: (request) => host(structuredClone(request)),
    listen: (handler) => {
      listener = handler;
    },
    close: () => {},
  };
}

const AI = new Map([['p2', 'weak' as const]]);
const NONE = new Set<string>();

function myFleet(state: GameState): { id: string; to: string } {
  const fleet = Object.values(state.fleets).find(
    (f) => f.owner === 'p1' && f.location && f.units.some((u) => u.count > 0),
  )!;
  const to = state.planets[fleet.location!]!.links![0]!;
  return { id: fleet.id, to };
}

describe('отдельный поток расчёта соло-мира', () => {
  it('копия экрана после каждого шага совпадает с миром потока (кроме чужой памяти тумана)', () => {
    const start = newGame();
    const link = startSimLink(threadPort(), start, 'p1', undefined);
    const ref = createSoloSim(structuredClone(start), 'p1');
    let shown = start;
    for (let hour = 1; hour <= 30; hour++) {
      link.step(hour * HOUR, true, AI, NONE, hour * 1000);
      const sync = link.take();
      expect(sync?.stepped).toBe(true);
      shown = sync!.state;
      ref.step(hour * HOUR, true, AI, NONE);
      expect(shown).toEqual(screenView(ref.state(), 'p1'));
    }
    expect(Object.keys(shown.fleets).length).toBeGreaterThan(0);
  });

  it('приказ игрока виден сразу и совпадает с тем, как его применил поток', () => {
    const start = newGame();
    const link = startSimLink(threadPort(), start, 'p1', undefined);
    const ref = createSoloSim(structuredClone(start), 'p1');
    link.step(2 * HOUR, true, AI, NONE, 0);
    ref.step(2 * HOUR, true, AI, NONE);
    const before = link.take()!.state;
    const { id, to } = myFleet(before);
    const action: Action = moveFleet('p1', id, to);
    link.forward(action);
    expect(ref.order(action).error).toBeUndefined();
    const sync = link.take()!;
    expect(sync.refused).toEqual([]);
    expect(sync.events).toEqual([]); // приказ игрока экран рассказал сам, в момент нажатия
    expect(sync.state.fleets[id]?.movement).not.toBeNull();
    expect(sync.state).toEqual(screenView(ref.state(), 'p1'));
  });

  it('приказ, который поток ещё не подтвердил, накладывается на свежий шаг', () => {
    const start = newGame();
    const replies: SimReply[] = [];
    const requests: SimRequest[] = [];
    // Канал, который придерживает ответы: шаг и приказ ушли, ответ на приказ ещё в пути.
    const host = createSimHost((reply) => replies.push(structuredClone(reply)));
    let listener: (reply: SimReply) => void = () => {};
    const port: SimPort = {
      post: (request) => {
        requests.push(request);
        host(structuredClone(request));
      },
      listen: (handler) => {
        listener = handler;
      },
      close: () => {},
    };
    const link = startSimLink(port, start, 'p1', undefined);
    const { id, to } = myFleet(start);
    link.forward(moveFleet('p1', id, to));
    link.step(HOUR, true, AI, NONE, 0);
    expect(link.busy).toBe(true);
    // Пришла только первая разность (приказ); вторая (шаг) ещё в пути.
    listener(replies.shift()!);
    let sync = link.take()!;
    expect(sync.state.fleets[id]?.movement).not.toBeNull();
    listener(replies.shift()!);
    expect(link.busy).toBe(false);
    sync = link.take()!;
    expect(sync.stepped).toBe(true);
    expect(sync.state.time).toBe(HOUR);
    expect(requests.map((r) => r.kind)).toEqual(['init', 'order', 'step', 'full']);
  });

  it('приказ, который экран принял, а поток отверг, возвращается отказом', () => {
    let listener: (reply: SimReply) => void = () => {};
    const port: SimPort = {
      post: () => {},
      listen: (handler) => {
        listener = handler;
      },
      close: () => {},
    };
    const start = newGame();
    const link = startSimLink(port, start, 'p1', undefined);
    const { id, to } = myFleet(start);
    link.forward(moveFleet('p1', id, to));
    listener({
      kind: 'sync',
      delta: { changed: {}, removed: {} },
      events: [],
      driverOrders: [],
      orders: [{ id: 1, error: 'E_NO_ROUTE' }],
      stepped: false,
      ms: 0,
    });
    const sync = link.take()!;
    expect(sync.refused).toEqual([{ type: 'fleet.move', error: 'E_NO_ROUTE' }]);
    // Отвергнутый приказ больше не накладывается: экран показывает мир потока.
    expect(sync.state.fleets[id]?.movement).toBeNull();
  });

  it('для сохранения память тумана всех мест берётся у потока', () => {
    const start = newGame();
    const link = startSimLink(threadPort(), start, 'p1', undefined);
    const ref = createSoloSim(structuredClone(start), 'p1');
    for (let hour = 1; hour <= 6; hour++) {
      // Память всех мест экран просит не чаще раза в FULL_EVERY_MS реального времени.
      link.step(hour * HOUR, true, AI, NONE, hour * 20_000);
      ref.step(hour * HOUR, true, AI, NONE);
    }
    const shown = link.take()!.state;
    expect(Object.keys(shown.fog ?? {})).toEqual(['p1']);
    const saved = link.saved(shown);
    expect(saved.fog).toEqual(ref.state().fog);
    expect(saved.swarmIntel).toEqual(ref.state().swarmIntel);
  });

  it('сломавшийся поток сообщает об этом', () => {
    const link = startSimLink(threadPort(), newGame(), 'p1', 'no-such-mode');
    expect(link.failed).toMatch(/E_UNKNOWN_MODE/);
  });
});
