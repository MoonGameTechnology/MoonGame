import { describe, expect, it } from 'vitest';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';
import { parseGameData, type GameData } from '../data/schemas';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState, type Player } from '../state/gameState';
import {
  MAX_RESEARCH_QUEUE,
  queueableTechnology,
  researchQueueCascade,
  researchQueueView,
  technologyModule,
} from './technology';

// RQ-1 — очередь исследований: правила из шапки раздела в `technology.ts`.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: { scout: { faction: 'x', stats: { attack: 2, defense: 1, speed: 10, hp: 6 } } },
  factions: {},
  buildings: { mine: { name: 'Mine', produces: { metal: 10 } } },
  events: {},
  technologies: {
    // Корень ветки и два потомка: потомок второго колена — для каскада снятия.
    optics: { name: 'Optics', cost: { metal: 10 }, researchTimeHours: 2 },
    lasers: {
      name: 'Lasers',
      cost: { metal: 10 },
      researchTimeHours: 1,
      prerequisites: ['optics'],
    },
    masers: {
      name: 'Masers',
      cost: { metal: 10 },
      researchTimeHours: 1,
      prerequisites: ['lasers'],
    },
    // Дорогая тема без предков — для правила «очередь — приоритет».
    reactor: { name: 'Reactor', cost: { metal: 100 }, researchTimeHours: 3 },
    mining: { name: 'Mining', cost: { metal: 5 }, researchTimeHours: 1 },
    smelting: { name: 'Smelting', cost: { metal: 5 }, researchTimeHours: 1 },
    blockade: { name: 'Blockade', cost: { metal: 10 }, researchTimeHours: 1, dayGate: 2 },
    outposts: {
      name: 'Outposts',
      cost: { metal: 10 },
      researchTimeHours: 1,
      conditions: [{ type: 'own_sectors', min: 1 }],
    },
    gift: { name: 'Gift', grantOnly: true },
    t1: { name: 'T1', cost: { metal: 1 }, researchTimeHours: 1 },
    t2: { name: 'T2', cost: { metal: 1 }, researchTimeHours: 1 },
    t3: { name: 'T3', cost: { metal: 1 }, researchTimeHours: 1 },
    t4: { name: 'T4', cost: { metal: 1 }, researchTimeHours: 1 },
    t5: { name: 'T5', cost: { metal: 1 }, researchTimeHours: 1 },
    t6: { name: 'T6', cost: { metal: 1 }, researchTimeHours: 1 },
    t7: { name: 'T7', cost: { metal: 1 }, researchTimeHours: 1 },
    t8: { name: 'T8', cost: { metal: 1 }, researchTimeHours: 1 },
  },
});

const kernel = createKernel([technologyModule]);
const ctx = (now: number): Context => ({ now, data });

function seat(resources: Record<string, number>, technologies?: Player['technologies']): Player {
  return {
    id: 'p1',
    name: 'p1',
    faction: 'x',
    status: 'active',
    resources,
    ...(technologies ? { technologies } : {}),
  };
}

function world(p: Player, time = 0): GameState {
  const s = createInitialState({ seed: 'rq', version: { data: '0.1.0', manifest: '1' } });
  return { ...s, time, players: { p1: p } };
}

let n = 0;
function order(type: string, payload: Record<string, unknown>): Action {
  return { id: `s:p1:${++n}`, type, playerId: 'p1', payload, issuedAt: 0 };
}
const enqueue = (technology: string): Action => order('technology.queue', { technology });
const dequeue = (technology: string): Action => order('technology.dequeue', { technology });
const move = (technology: string, to: number): Action =>
  order('technology.queue.move', { technology, to });

function ok(r: ApplyResult | AdvanceResult): GameState {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.state;
}
function code(r: ApplyResult): string {
  if (r.ok) throw new Error('expected a rejection');
  return r.code;
}
/** Применить приказы по очереди в момент `now`. */
function apply(s: GameState, now: number, ...actions: Action[]): GameState {
  return actions.reduce((acc, a) => ok(kernel.applyAction(acc, a, ctx(now))), s);
}

const tech = (s: GameState) => s.players.p1!.technologies!;
const running = (s: GameState) => (tech(s).active ?? []).map((a) => a.technology);

describe('очередь исследований (RQ-1)', () => {
  it('свободный слот и деньги — тема из очереди стартует сразу и платит на старте', () => {
    const r = kernel.applyAction(world(seat({ metal: 30 })), enqueue('optics'), ctx(0));
    const s = ok(r);
    expect(running(s)).toEqual(['optics']);
    expect(tech(s).queue).toBeUndefined();
    expect(s.players.p1!.resources.metal).toBe(20);
    expect(r.ok && r.events.find((e) => e.type === 'technology.research.started')?.payload).toEqual(
      { playerId: 'p1', technology: 'optics', completesAt: 2 * HOUR, fromQueue: true },
    );
  });

  it('слоты заняты — тема ждёт бесплатно и стартует, когда слот освобождается', () => {
    const s = apply(
      world(seat({ metal: 40 })),
      0,
      enqueue('optics'),
      enqueue('mining'),
      enqueue('smelting'),
    );
    expect(running(s)).toEqual(['optics', 'mining']);
    expect(tech(s).queue).toEqual(['smelting']);
    expect(s.players.p1!.resources.metal).toBe(25); // ждущая тема не оплачена

    const after = ok(kernel.advanceTo(s, ctx(HOUR))); // mining готов → слот свободен
    expect(tech(after).completed).toEqual(['mining']);
    expect(running(after)).toEqual(['optics', 'smelting']);
    expect(tech(after).queue).toBeUndefined();
    expect(after.players.p1!.resources.metal).toBe(20);
  });

  it('предок выше в очереди: потомок ждёт его и стартует сам по завершении', () => {
    let s = apply(world(seat({ metal: 125 })), 0, enqueue('reactor'), enqueue('mining'));
    s = apply(s, 0, enqueue('optics'), enqueue('lasers'));
    expect(tech(s).queue).toEqual(['optics', 'lasers']);

    s = ok(kernel.advanceTo(s, ctx(HOUR))); // mining готов → optics в слот
    expect(running(s)).toEqual(['reactor', 'optics']);
    expect(tech(s).queue).toEqual(['lasers']);
    s = ok(kernel.advanceTo(s, ctx(3 * HOUR))); // reactor и optics готовы → lasers
    expect(running(s)).toEqual(['lasers']);
  });

  it('предок в работе — тоже план; предка нет нигде — отказ E_PREREQUISITE', () => {
    const base = world(seat({ metal: 100 }));
    expect(code(kernel.applyAction(base, enqueue('lasers'), ctx(0)))).toBe('E_PREREQUISITE');
    const s = apply(base, 0, enqueue('optics'), enqueue('lasers'));
    expect(running(s)).toEqual(['optics']);
    expect(tech(s).queue).toEqual(['lasers']);
  });

  it('ожидание предка не держит слот: его берёт следующая готовая тема', () => {
    const s = apply(
      world(seat({ metal: 100 })),
      0,
      enqueue('optics'),
      enqueue('lasers'),
      enqueue('mining'),
    );
    expect(running(s)).toEqual(['optics', 'mining']);
    expect(tech(s).queue).toEqual(['lasers']);
  });

  it('очередь — приоритет: голова ждёт денег, дешёвая за ней не обгоняет', () => {
    let s = apply(world(seat({ metal: 20 })), 0, enqueue('reactor'), enqueue('mining'));
    expect(running(s)).toEqual([]);
    expect(tech(s).queue).toEqual(['reactor', 'mining']);
    expect(researchQueueView(s, 'p1', data, 2)).toEqual([
      { technology: 'reactor', wait: 'resources' },
      { technology: 'mining', wait: 'queue' },
    ]);
    // Повтор раз в час: деньги пришли — голова стартует при ближайшей проверке, а за ней
    // и дешёвая тема во второй слот.
    s.players.p1!.resources.metal = 110;
    const early = ok(kernel.advanceTo(s, ctx(HOUR - 1)));
    expect(running(early)).toEqual([]);
    s = ok(kernel.advanceTo(early, ctx(HOUR)));
    expect(running(s)).toEqual(['reactor', 'mining']);
    expect(s.players.p1!.resources.metal).toBe(5);
  });

  it('повтор не плодится: одна проверка на игрока, сколько бы приказов ни пришло', () => {
    const s = apply(
      world(seat({ metal: 0 })),
      0,
      enqueue('optics'),
      enqueue('mining'),
      dequeue('mining'),
    );
    expect(s.scheduled.filter((e) => e.type === 'technology.queue.pump')).toHaveLength(1);
  });

  it('день узла ещё не наступил — тема ждёт и стартует с его приходом', () => {
    let s = apply(world(seat({ metal: 30 })), 0, enqueue('blockade'));
    expect(tech(s).queue).toEqual(['blockade']);
    expect(researchQueueView(s, 'p1', data, 2)).toEqual([{ technology: 'blockade', wait: 'day' }]);
    s = ok(kernel.advanceTo(s, ctx(2 * DAY - 1)));
    expect(running(s)).toEqual([]);
    s = ok(kernel.advanceTo(s, ctx(2 * DAY)));
    expect(running(s)).toEqual(['blockade']);
  });

  it('условие узла не выполнено — ставится, ждёт и называет причину', () => {
    const s = apply(world(seat({ metal: 30 })), 0, enqueue('outposts'));
    expect(running(s)).toEqual([]);
    expect(researchQueueView(s, 'p1', data, 2)).toEqual([
      { technology: 'outposts', wait: 'conditions' },
    ]);
  });

  it('снятие темы снимает и тех, кто без неё остался без предка', () => {
    let s = apply(
      world(seat({ metal: 0 })),
      0,
      enqueue('mining'),
      enqueue('optics'),
      enqueue('lasers'),
    );
    s = apply(s, 0, enqueue('masers'), enqueue('smelting'));
    expect(researchQueueCascade(s, 'p1', data, 'optics')).toEqual(['optics', 'lasers', 'masers']);
    const r = kernel.applyAction(s, dequeue('optics'), ctx(0));
    s = ok(r);
    expect(tech(s).queue).toEqual(['mining', 'smelting']);
    expect(r.ok && r.events.find((e) => e.type === 'technology.dequeued')?.payload).toEqual({
      playerId: 'p1',
      technology: 'optics',
      removed: ['optics', 'lasers', 'masers'],
    });
    expect(code(kernel.applyAction(s, dequeue('optics'), ctx(0)))).toBe('E_NOT_QUEUED');
  });

  it('снятие головы, ждущей денег, пускает следующую', () => {
    const s = apply(
      world(seat({ metal: 20 })),
      0,
      enqueue('reactor'),
      enqueue('mining'),
      dequeue('reactor'),
    );
    expect(running(s)).toEqual(['mining']);
    expect(tech(s).queue).toBeUndefined();
  });

  it('перестановка: наверх — можно и сразу запускает; выше предка — E_QUEUE_ORDER', () => {
    let s = apply(
      world(seat({ metal: 20 })),
      0,
      enqueue('reactor'),
      enqueue('optics'),
      enqueue('lasers'),
    );
    expect(tech(s).queue).toEqual(['reactor', 'optics', 'lasers']);
    expect(code(kernel.applyAction(s, move('lasers', 0), ctx(0)))).toBe('E_QUEUE_ORDER');
    expect(code(kernel.applyAction(s, move('optics', 2), ctx(0)))).toBe('E_QUEUE_ORDER');
    expect(code(kernel.applyAction(s, move('mining', 0), ctx(0)))).toBe('E_NOT_QUEUED');
    // optics наверх: на неё хватает — она стартует, реактор снова голова и ждёт денег.
    s = apply(s, 0, move('optics', 0));
    expect(running(s)).toEqual(['optics']);
    expect(tech(s).queue).toEqual(['reactor', 'lasers']);
    // Место за краем — к краю, а не отказ.
    s = apply(s, 0, move('reactor', 7));
    expect(tech(s).queue).toEqual(['lasers', 'reactor']);
  });

  it('ручной старт темы из очереди убирает её из очереди', () => {
    let s = apply(world(seat({ metal: 0 })), 0, enqueue('mining'), enqueue('smelting'));
    s.players.p1!.resources.metal = 5;
    s = apply(s, 0, order('technology.research', { technology: 'smelting' }));
    expect(running(s)).toEqual(['smelting']);
    expect(tech(s).queue).toEqual(['mining']);
  });

  it('отказы постановки: дубль, изучено, грант-узел, неизвестная, полная очередь', () => {
    const s = apply(world(seat({ metal: 0 }, { completed: ['mining'] })), 0, enqueue('optics'));
    expect(code(kernel.applyAction(s, enqueue('optics'), ctx(0)))).toBe('E_RESEARCH_QUEUED');
    expect(code(kernel.applyAction(s, enqueue('mining'), ctx(0)))).toBe('E_ALREADY_RESEARCHED');
    expect(code(kernel.applyAction(s, enqueue('gift'), ctx(0)))).toBe('E_GRANT_ONLY');
    expect(code(kernel.applyAction(s, enqueue('nope'), ctx(0)))).toBe('E_UNKNOWN_TECHNOLOGY');
    expect(code(kernel.applyAction(s, order('technology.queue', {}), ctx(0)))).toBe(
      'E_BAD_PAYLOAD',
    );

    const full = apply(
      world(seat({ metal: 0 })),
      0,
      ...['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'].map(enqueue),
    );
    expect(tech(full).queue).toHaveLength(MAX_RESEARCH_QUEUE);
    expect(queueableTechnology(full, 'p1', data, 'optics')).toBe('E_QUEUE_FULL');
    expect(code(kernel.applyAction(full, enqueue('optics'), ctx(0)))).toBe('E_QUEUE_FULL');
  });

  it('тема, ставшая невозможной, выпадает из очереди с причиной', () => {
    // Потомок в очереди, а его предка изъяли из плана мимо приказа (старое сохранение,
    // ручная правка): насос не держит мёртвую тему вечно.
    const s = world(seat({ metal: 50 }, { completed: [], queue: ['lasers', 'mining'] }));
    const r = kernel.applyAction(s, enqueue('smelting'), ctx(0));
    const after = ok(r);
    expect(tech(after).queue).toBeUndefined();
    expect(running(after)).toEqual(['mining', 'smelting']);
    expect(r.ok && r.events.find((e) => e.type === 'technology.queue.dropped')?.payload).toEqual({
      playerId: 'p1',
      technology: 'lasers',
      code: 'E_PREREQUISITE',
    });
  });

  it('вид очереди: слоты заняты и предок в работе называются по-разному', () => {
    const s = apply(world(seat({ metal: 100 })), 0, enqueue('optics'), enqueue('mining'));
    const more = apply(s, 0, enqueue('lasers'), enqueue('smelting'));
    expect(researchQueueView(more, 'p1', data, 2)).toEqual([
      { technology: 'lasers', wait: 'prerequisite' },
      { technology: 'smelting', wait: 'slot' },
    ]);
    // Третий слот (учёный) — вид говорит «стартует», а не «ждёт слота».
    expect(researchQueueView(more, 'p1', data, 3)).toEqual([
      { technology: 'lasers', wait: 'prerequisite' },
      { technology: 'smelting', wait: 'starting' },
    ]);
  });

  it('детерминизм: один и тот же сценарий даёт одно и то же состояние', () => {
    const run = (): GameState => {
      let s = apply(
        world(seat({ metal: 60 })),
        0,
        enqueue('reactor'),
        enqueue('optics'),
        enqueue('lasers'),
      );
      s.players.p1!.resources.metal = 200;
      s = ok(kernel.advanceTo(s, ctx(5 * HOUR)));
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
