import { describe, expect, it } from 'vitest';
import type {
  Action,
  DomainEvent,
  GameState,
  StateDelta,
} from '../../packages/shared-core/src/index';
import { declareWar, moveFleet } from '../../decisions/actions';
import { parseSoloSave, type SoloSave } from '../../decisions/soloSave';
import { approvalLedger, type ApprovalLedger } from './botFavour';
import { HOUR } from './time';
import { DEFAULT_SETUP, networkSeats, newGame } from './matchSetup';
import { order } from './protoKernel';
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
function threadPort(tap?: (reply: SimReply) => void): SimPort {
  let listener: (reply: SimReply) => void = () => {};
  const host = createSimHost((reply) => {
    tap?.(reply);
    listener(structuredClone(reply));
  });
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
      expect(link.frame()).toBe(hour * HOUR);
      const sync = link.take();
      shown = sync!.state;
      ref.step(hour * HOUR, true, AI, NONE);
      expect(shown).toEqual(screenView(ref.state(), 'p1'));
    }
    expect(Object.keys(shown.fleets).length).toBeGreaterThan(0);
  });

  it('шаги, которых кадр ещё не взял, идут от цели прошлого шага; взятие отдаёт их разом', () => {
    const start = newGame();
    const link = startSimLink(threadPort(), start, 'p1', undefined);
    const ref = createSoloSim(structuredClone(start), 'p1');
    const events: DomainEvent[] = [];
    expect(link.time).toBe(start.time);
    for (let hour = 1; hour <= 3; hour++) {
      link.step(link.time + HOUR, true, AI, NONE, hour * 1000);
      // Кадр, который увидел пришедший шаг, но мир не взял: часы картинки получают время мира
      // потока с приходом шага.
      expect(link.frame()).toBe(start.time + hour * HOUR);
      events.push(...ref.step(start.time + hour * HOUR, true, AI, NONE).events);
    }
    expect(link.frame()).toBeNull(); // новых шагов нет
    expect(link.time).toBe(start.time + 3 * HOUR);
    const sync = link.take()!;
    expect(sync.state).toEqual(screenView(ref.state(), 'p1'));
    expect(events.length).toBeGreaterThan(0);
    expect(sync.events).toEqual(events);
    expect(link.take()).toBeNull();
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
    expect(link.frame()).toBeNull(); // приказ — не шаг: часам картинки нечего отсчитывать
    let sync = link.take()!;
    expect(sync.state.fleets[id]?.movement).not.toBeNull();
    listener(replies.shift()!);
    expect(link.busy).toBe(false);
    expect(link.frame()).toBe(HOUR);
    sync = link.take()!;
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

  it('из стола симпатий копии идёт только мнение ботов об игроке, сохранению — весь стол', () => {
    // Человек и ДВА бота в войне друг с другом: их мнения друг о друге тают каждый отрезок.
    const seats = [...DEFAULT_SETUP.seats, { ...networkSeats('ffa')[2]!, id: 'p3', ai: true }];
    const start = order(newGame({ seats }), declareWar('p2', 'p3'), 0).state;
    const ai = new Map([
      ['p2', 'weak' as const],
      ['p3', 'weak' as const],
    ]);
    const deltas: StateDelta[] = [];
    const port = threadPort((reply) => {
      if (reply.kind === 'sync') deltas.push(reply.delta);
    });
    const link = startSimLink(port, start, 'p1', undefined);
    const ref = createSoloSim(structuredClone(start), 'p1');
    let shown = start;
    for (let hour = 1; hour <= 6; hour++) {
      link.step(hour * HOUR, true, ai, NONE, hour * 20_000);
      ref.step(hour * HOUR, true, ai, NONE);
      shown = link.take()!.state;
      expect(shown).toEqual(screenView(ref.state(), 'p1'));
    }
    // Весь стол за эти часы менялся, а в разностях не было ни одного мнения о другом месте.
    expect(approvalLedger(ref.state())).not.toEqual(approvalLedger(start));
    for (const delta of deltas) {
      const ledger = (delta.meta?.approval ?? {}) as ApprovalLedger;
      for (const meter of Object.values(ledger)) expect(Object.keys(meter)).toEqual(['p1']);
    }
    expect(Object.keys(approvalLedger(shown)!.p2!)).toEqual(['p1']);
    // Сохранение и мир, который кадр подхватит при сбое потока, — со всем столом.
    expect(approvalLedger(link.saved(shown))).toEqual(approvalLedger(ref.state()));
  });

  it('строку сохранения собирает поток: его полный мир и политики экрана', () => {
    const start = newGame();
    const link = startSimLink(threadPort(), start, 'p1', undefined);
    const ref = createSoloSim(structuredClone(start), 'p1');
    for (let hour = 1; hour <= 6; hour++) {
      link.step(hour * HOUR, true, AI, NONE, 0);
      ref.step(hour * HOUR, true, AI, NONE);
    }
    link.take();
    const planet = Object.keys(start.planets)[0]!;
    const host: Omit<SoloSave, 'state'> = {
      ai: [['p2', 'strong']],
      normalSpeed: 50,
      fastSpeed: 150,
      autoAssault: ['f1'],
      memory: [[planet, { owner: null, garrison: 3, buildings: [] }]],
    };
    const raws: Array<string | null> = [];
    link.save(host, 'rules-1', (raw) => raws.push(raw));
    expect(raws).toHaveLength(1);
    const save = parseSoloSave(raws[0]!, 'rules-1')!;
    // Мир — полный мир потока: память тумана всех мест, а не только своя, как у копии экрана.
    expect(save.state).toEqual(JSON.parse(JSON.stringify(ref.state())));
    expect(Object.keys(save.state.fog ?? {}).length).toBeGreaterThan(1);
    expect({ ...save, state: undefined }).toEqual({ ...host, state: undefined });
    // Чужая сверка правил строку не примет.
    expect(parseSoloSave(raws[0]!, 'rules-2')).toBeNull();
  });

  it('кончившуюся партию поток в слот не отдаёт', () => {
    const start = newGame();
    const ended = { ...start, match: { ...start.match, status: 'ended' as const, winner: 'p1' } };
    const link = startSimLink(threadPort(), ended, 'p1', undefined);
    const raws: Array<string | null> = [];
    link.save({ ai: [], normalSpeed: 1, fastSpeed: 2, autoAssault: [], memory: [] }, 'r', (raw) =>
      raws.push(raw),
    );
    expect(raws).toEqual([null]);
  });

  it('остановленный поток строку не отдаёт', () => {
    const replies: SimReply[] = [];
    const host = createSimHost((reply) => replies.push(structuredClone(reply)));
    let listener: (reply: SimReply) => void = () => {};
    const port: SimPort = {
      post: (request) => host(structuredClone(request)),
      listen: (handler) => {
        listener = handler;
      },
      close: () => {},
    };
    const link = startSimLink(port, newGame(), 'p1', undefined);
    const raws: Array<string | null> = [];
    link.save({ ai: [], normalSpeed: 1, fastSpeed: 2, autoAssault: [], memory: [] }, 'r', (raw) =>
      raws.push(raw),
    );
    link.stop();
    for (const reply of replies.splice(0)) listener(reply);
    expect(raws).toEqual([]);
  });

  it('сломавшийся поток сообщает об этом', () => {
    const link = startSimLink(threadPort(), newGame(), 'p1', 'no-such-mode');
    expect(link.failed).toMatch(/E_UNKNOWN_MODE/);
  });
});
