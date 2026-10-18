import { describe, it, expect } from 'vitest';
import { createKernel } from './kernel';
import type { GameModule } from './module';
import {
  createInitialState,
  type GameState,
  type Planet,
  type ScheduledEvent,
} from '../state/gameState';
import { parseGameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { deepFreeze } from '../util/clone';

const testData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
});
const ctx = (now: number): Context => ({ now, data: testData });

function sched(seq: number, at: number, type: string, payload: unknown = null): ScheduledEvent {
  return { id: `evt:${seq}`, at, type, payload, seq };
}

function makePlanet(id: string, resources: Record<string, number> = {}): Planet {
  return {
    id,
    owner: null,
    position: { x: 0, y: 0 },
    resources,
    buildings: [],
    garrison: [],
    traits: [],
  };
}

function stateWith(opts: {
  time?: number;
  scheduled?: ScheduledEvent[];
  planets?: Record<string, Planet>;
}): GameState {
  const s = createInitialState({ seed: 'adv', version: { data: '0.1.0', manifest: '1' } });
  const scheduled = opts.scheduled ?? [];
  return {
    ...s,
    time: opts.time ?? 0,
    scheduled,
    scheduleSeq: scheduled.length,
    planets: opts.planets ?? {},
  };
}

const TIME_ADVANCED = 'time.advanced';
const domainTypes = (events: { type: string }[]): string[] =>
  events.map((e) => e.type).filter((t) => t !== TIME_ADVANCED);

function okAdvance(r: ReturnType<ReturnType<typeof createKernel>['advanceTo']>) {
  if (!r.ok) throw new Error(`expected ok advance, got ${r.code}`);
  return r;
}

// --- fixtures ---

// Accrues 2 metal per ms of continuous time, for every planet.
const economyModule: GameModule = {
  id: 'economy',
  version: '1.0.0',
  setup(api) {
    api.on(TIME_ADVANCED, (event, h) => {
      const { from, to } = event.payload as { from: number; to: number };
      const elapsed = to - from;
      for (const id of Object.keys(h.state.planets)) {
        const p = h.state.planets[id];
        if (!p) continue;
        p.resources.metal = (p.resources.metal ?? 0) + 2 * elapsed;
      }
    });
  },
};

// A recurring combat tick that reschedules itself for 3 more rounds.
const tickerModule: GameModule = {
  id: 'ticker',
  version: '1.0.0',
  setup(api) {
    api.on('combat.tick', (event, h) => {
      const round = (event.payload as { round: number }).round;
      if (round < 3) {
        h.schedule(h.state.time + 100, 'combat.tick', { round: round + 1 });
      }
    });
  },
};

const diceModule: GameModule = {
  id: 'dice',
  version: '1.0.0',
  setup(api) {
    api.on('roll', (_event, h) => {
      h.emit('rolled', { value: h.rng.nextInt(1, 1_000_000) });
    });
  },
};

const boomModule: GameModule = {
  id: 'boom-adv',
  version: '1.0.0',
  setup(api) {
    api.on('boom', () => {
      throw new Error('secret internal detail that must not leak');
    });
  },
};

// Reschedules itself at the current instant → would loop forever.
const infiniteModule: GameModule = {
  id: 'infinite',
  version: '1.0.0',
  setup(api) {
    api.on('inf', (_event, h) => h.schedule(h.state.time, 'inf'));
  },
};

// On an action, schedules an event in the PAST (before the action instant). The
// kernel must clamp it UP to the step instant — never land it behind `state.time`.
const armPastModule: GameModule = {
  id: 'arm-past',
  version: '1.0.0',
  setup(api) {
    api.onAction('arm.past', (_a, h) => h.schedule(500, 'late'));
  },
};

// Schedules events from an action payload (exercises schedule() via applyAction).
const plannerModule: GameModule = {
  id: 'planner',
  version: '1.0.0',
  setup(api) {
    api.onAction('plan', (a, h) => {
      const items = a.payload as { at: number; type: string }[];
      for (const it of items) h.schedule(it.at, it.type);
    });
  },
};

const action = (type: string, payload: unknown): Action => ({
  id: `s:p1:1`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});

// ---------------------------------------------------------------------------

describe('advanceTo — real-time timeline (docs/architecture.md §4.1)', () => {
  it('fires due events in chronological order, ties broken by seq', () => {
    const kernel = createKernel([]);
    const state = stateWith({
      scheduled: [sched(0, 100, 'a'), sched(1, 50, 'b'), sched(2, 50, 'c')],
    });
    const r = okAdvance(kernel.advanceTo(state, ctx(200)));
    expect(domainTypes(r.events)).toEqual(['b', 'c', 'a']); // 50(seq1), 50(seq2), 100
    expect(r.state.time).toBe(200);
  });

  it('emits contiguous time.advanced spans covering the whole interval', () => {
    const kernel = createKernel([economyModule]);
    const planets = { p: makePlanet('p', { metal: 0 }) };

    // With an event in the middle (two spans: 0->50, 50->200).
    const withEvent = okAdvance(
      kernel.advanceTo(stateWith({ planets, scheduled: [sched(0, 50, 'x')] }), ctx(200)),
    );
    expect(withEvent.state.planets.p?.resources.metal).toBe(400); // 2 * 200

    // With no events (single span 0->200) — identical total.
    const noEvent = okAdvance(kernel.advanceTo(stateWith({ planets }), ctx(200)));
    expect(noEvent.state.planets.p?.resources.metal).toBe(400);
  });

  it('does not overshoot and leaves not-yet-due events untouched', () => {
    const kernel = createKernel([]);
    const state = stateWith({ scheduled: [sched(0, 500, 'later')] });
    const r = okAdvance(kernel.advanceTo(state, ctx(200)));
    expect(r.state.time).toBe(200);
    expect(r.state.scheduled).toHaveLength(1);
    expect(domainTypes(r.events)).toEqual([]);
  });

  it('processes a recurring tick until it stops', () => {
    const kernel = createKernel([tickerModule]);
    const state = stateWith({ scheduled: [sched(0, 100, 'combat.tick', { round: 0 })] });
    const r = okAdvance(kernel.advanceTo(state, ctx(1000)));

    const rounds = r.events
      .filter((e) => e.type === 'combat.tick')
      .map((e) => (e.payload as { round: number }).round);
    expect(rounds).toEqual([0, 1, 2, 3]); // 100, 200, 300, 400
    expect(r.state.time).toBe(1000);
    expect(r.state.scheduled).toHaveLength(0);
  });

  it('is deterministic and advances RNG state', () => {
    const kernel = createKernel([diceModule]);
    const state = stateWith({ scheduled: [sched(0, 100, 'roll')] });

    const a = okAdvance(kernel.advanceTo(state, ctx(200)));
    const b = okAdvance(kernel.advanceTo(state, ctx(200)));
    expect(a.events).toEqual(b.events);
    expect(a.state.rng).not.toEqual(state.rng);
  });

  it('dead-letters a failing event and keeps advancing (fail-secure, A10)', () => {
    const kernel = createKernel([boomModule]);
    const state = stateWith({ scheduled: [sched(0, 100, 'boom'), sched(1, 200, 'after')] });
    const r = okAdvance(kernel.advanceTo(state, ctx(300)));

    expect(r.failures).toEqual([{ at: 100, type: 'boom', code: 'E_INTERNAL' }]);
    expect(JSON.stringify(r.failures)).not.toContain('secret');
    expect(domainTypes(r.events)).toEqual(['after']); // 'boom' was discarded
    expect(r.state.time).toBe(300);
    expect(r.state.scheduled).toHaveLength(0); // both consumed, world not stuck
  });

  it('dead-letters a failing time.advanced handler: the span is lost, the clock is not', () => {
    // The accrue-failure branch: a throwing `time.advanced` subscriber must not
    // wedge the world — the span's accrual is dropped (recorded in `failures`)
    // and time still stamps forward, so later spans keep accruing normally.
    const flakyEconomy: GameModule = {
      id: 'flaky-economy',
      version: '1.0.0',
      setup(api) {
        api.on(TIME_ADVANCED, (event, h) => {
          const { from, to } = event.payload as { from: number; to: number };
          if (from < 100) throw new Error('secret accrual crash'); // only the FIRST span dies
          for (const id of Object.keys(h.state.planets)) {
            const p = h.state.planets[id];
            if (p) p.resources.metal = (p.resources.metal ?? 0) + 2 * (to - from);
          }
        });
      },
    };
    const kernel = createKernel([flakyEconomy]);
    const planets = { p: makePlanet('p', { metal: 0 }) };
    // A scheduled no-op at 100 splits the advance into spans 0→100 and 100→300.
    const state = stateWith({ planets, scheduled: [sched(0, 100, 'noop')] });
    const r = okAdvance(kernel.advanceTo(state, ctx(300)));

    expect(r.failures).toEqual([{ at: 100, type: TIME_ADVANCED, code: 'E_INTERNAL' }]);
    expect(JSON.stringify(r.failures)).not.toContain('secret'); // no detail leaks (A10)
    expect(r.state.time).toBe(300); // the clock still reached the target
    // Span 0→100 was dropped, span 100→300 accrued: 2 metal/ms × 200ms.
    expect(r.state.planets.p?.resources.metal).toBe(400);
  });

  it('yields a bounded partial advance on a same-instant runaway instead of wedging', () => {
    const kernel = createKernel([infiniteModule]);
    const state = stateWith({ scheduled: [sched(0, 50, 'inf')] });
    const r = kernel.advanceTo(state, ctx(100));
    // No longer aborts: it commits the bounded work and flags it partial. The
    // same-instant runaway leaves the clock unmoved (at 50) with 'inf' still
    // pending — the signal a caller uses to detect the stall and stop.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.partial).toBe(true);
      expect(r.state.time).toBe(50); // time did not progress → runaway
      expect(r.state.scheduled.length).toBeGreaterThan(0);
      // Re-running makes the same bounded progress again (never hangs, never wedges).
      const again = kernel.advanceTo(r.state, ctx(100));
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.state.time).toBe(50);
    }
  });

  it('catches up a long legit chain across partial advances (time progresses each call)', () => {
    // A recurring tick that reschedules itself 1ms later — a long but time-ADVANCING
    // chain (unlike the same-instant runaway). It must fully catch up over several calls.
    const recurring: GameModule = {
      id: 'recurring',
      version: '1.0.0',
      setup(api) {
        api.on('r', (_e, h) => h.schedule(h.state.time + 1, 'r'));
      },
    };
    const kernel = createKernel([recurring]);
    const target = 55_000; // > MAX_ADVANCE_STEPS worth of steps → forces ≥1 partial
    let state = stateWith({ scheduled: [sched(0, 1, 'r')] });
    let calls = 0;
    for (;;) {
      const r = kernel.advanceTo(state, ctx(target));
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      expect(r.state.time).toBeGreaterThan(state.time); // strict forward progress
      state = r.state;
      if (!r.partial) break;
      if (++calls > 20) throw new Error('did not converge — no forward progress');
    }
    expect(state.time).toBe(target); // fully caught up, no work lost
  });

  it('rejects moving the clock backwards', () => {
    const kernel = createKernel([]);
    const r = kernel.advanceTo(stateWith({ time: 500 }), ctx(200));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_TIME_BACKWARDS');
  });

  it('never mutates the input state', () => {
    const kernel = createKernel([economyModule]);
    const state = deepFreeze(
      stateWith({ planets: { p: makePlanet('p', { metal: 0 }) }, scheduled: [sched(0, 50, 'x')] }),
    );
    const r = okAdvance(kernel.advanceTo(state, ctx(200)));
    expect(r.state.planets.p?.resources.metal).toBe(400);
    expect(state.time).toBe(0); // input frozen & untouched
    expect(state.planets.p?.resources.metal).toBe(0);
  });

  it('schedule() from an action feeds the timeline', () => {
    const kernel = createKernel([plannerModule]);
    const planned = kernel.applyAction(
      stateWith({}),
      action('plan', [{ at: 100, type: 'ping' }]),
      ctx(0),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.state.scheduled).toHaveLength(1);

    const r = okAdvance(kernel.advanceTo(planned.state, ctx(150)));
    expect(domainTypes(r.events)).toEqual(['ping']);
  });

  it('KRN-2: schedule() clamps a past instant up to the step, never behind state.time', () => {
    const kernel = createKernel([armPastModule]);
    // action at t=1000 over a state still at t=0; the handler schedules at t=500
    const r = kernel.applyAction(stateWith({ time: 0 }), action('arm.past', null), ctx(1000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const late = r.state.scheduled.find((e) => e.type === 'late');
    expect(late?.at).toBe(1000); // clamped UP to the action instant, not left at 500
    expect(r.state.scheduled.every((e) => e.at >= r.state.time)).toBe(true); // none in the past
  });
});

// Регрессии батча баг-охоты 2026-07-10 (ядро/время).
describe('bug-hunt batch — time-gap guard, no clock rewind, finite schedule', () => {
  it('applyAction refuses to jump over a due scheduled event (E_TIME_GAP)', () => {
    const spans: Array<{ from: number; to: number }> = [];
    const mod: GameModule = {
      id: 'gap-test',
      version: '1.0.0',
      setup(api) {
        api.onAction('noop', () => {});
        api.on('time.advanced', (e) => {
          spans.push(e.payload as { from: number; to: number });
        });
        api.on('due.event', () => {});
      },
    };
    const kernel = createKernel([mod]);
    const state = stateWith({ time: 0, scheduled: [sched(0, 50, 'due.event')] });
    // The buggy path: applying at now=100 WITHOUT advancing first. The old kernel
    // stamped time=100 and stranded the t=50 event in the past; the next advanceTo
    // then fired it with a REWOUND clock and re-accrued the [50,200] span on top of
    // an already-lived window. Now: transient reject — the caller must advance.
    const r = kernel.applyAction(
      state,
      { id: 'a:1', type: 'noop', playerId: 'p1', payload: {}, issuedAt: 0 },
      ctx(100),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_TIME_GAP');
    // The legitimate flow (advance first, then apply) still works.
    const adv = kernel.advanceTo(state, ctx(100));
    expect(adv.ok).toBe(true);
    if (!adv.ok) return;
    const ok = kernel.applyAction(
      adv.state,
      { id: 'a:2', type: 'noop', playerId: 'p1', payload: {}, issuedAt: 0 },
      ctx(100),
    );
    expect(ok.ok).toBe(true);
  });

  it('advanceTo fires a PAST-stranded event LATE, never rewinding the clock', () => {
    const firedAt: number[] = [];
    const spans: Array<{ from: number; to: number }> = [];
    const mod: GameModule = {
      id: 'rewind-test',
      version: '1.0.0',
      setup(api) {
        api.on('due.event', (_e, h) => {
          firedAt.push(h.ctx.now);
        });
        api.on('time.advanced', (e) => {
          spans.push(e.payload as { from: number; to: number });
        });
      },
    };
    const kernel = createKernel([mod]);
    // An old persisted state that a buggy host left with a past event: time=100,
    // event stranded at t=50.
    const state = stateWith({ time: 100, scheduled: [sched(0, 50, 'due.event')] });
    const r = kernel.advanceTo(state, ctx(200));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(firedAt).toEqual([100]); // fired LATE at the committed clock, not at 50
    // Spans never start before the committed time — no re-accrual of [50,100].
    for (const s of spans) expect(s.from).toBeGreaterThanOrEqual(100);
    expect(r.state.time).toBe(200);
  });

  it('schedule(NaN/Infinity) rejects the step (E_BAD_SCHEDULE), keeping state serializable', () => {
    const mod: GameModule = {
      id: 'nan-test',
      version: '1.0.0',
      setup(api) {
        api.onAction('plant', (a, h) => {
          h.schedule((a.payload as { at: number }).at, 'zombie.event', null);
        });
      },
    };
    const kernel = createKernel([mod]);
    const state = stateWith({ time: 0 });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = kernel.applyAction(
        state,
        { id: `a:${bad}`, type: 'plant', playerId: 'p1', payload: { at: bad }, issuedAt: 0 },
        ctx(0),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_BAD_SCHEDULE');
    }
    // Nothing landed in the queue — the step failed atomically.
    expect(state.scheduled).toHaveLength(0);
  });
});

// Ход идёт одной копией мира: шаги правят её на месте. Снаружи это должно быть неотличимо
// от прежнего хода, где каждый шаг работал на своей копии.
describe('advanceTo — one copy of the world per advance', () => {
  it('a step that fails after changing the world leaves no trace; the steps before it stay', () => {
    const spoiler: GameModule = {
      id: 'spoiler',
      version: '1.0.0',
      setup(api) {
        api.on('spoil', (_event, h) => {
          h.state.planets.p!.resources.metal = -1;
          h.schedule(h.state.time + 10, 'spoiled');
          throw new Error('after the change');
        });
      },
    };
    const kernel = createKernel([economyModule, spoiler]);
    const planets = { p: makePlanet('p', { metal: 0 }) };
    const state = stateWith({
      planets,
      scheduled: [sched(0, 100, 'noop'), sched(1, 200, 'spoil'), sched(2, 250, 'noop')],
    });
    const r = okAdvance(kernel.advanceTo(state, ctx(300)));
    expect(r.failures).toEqual([{ at: 200, type: 'spoil', code: 'E_INTERNAL' }]);
    // Every span accrued (2 metal per ms × 300 ms); the failed step's −1 and timer are gone.
    expect(r.state.planets.p?.resources.metal).toBe(600);
    expect(r.state.scheduled).toEqual([]);
    expect(r.state.time).toBe(300);
  });

  it('a payload that points into the world is handed out as it was at its step', () => {
    const watcher: GameModule = {
      id: 'watcher',
      version: '1.0.0',
      setup(api) {
        api.on('look', (_event, h) => {
          const resources = h.state.planets.p!.resources; // the world's own object
          h.emit('seen', resources);
          h.schedule(h.state.time + 100, 'recall', resources);
        });
        api.on('recall', (event, h) => h.emit('recalled', event.payload));
      },
    };
    const kernel = createKernel([economyModule, watcher]);
    const state = stateWith({
      planets: { p: makePlanet('p', { metal: 0 }) },
      scheduled: [sched(0, 100, 'look')],
    });
    const r = okAdvance(kernel.advanceTo(state, ctx(400)));
    const payload = (type: string) => r.events.find((e) => e.type === type)?.payload;
    // Later spans keep accruing into the world, not into what was already handed out.
    expect(payload('seen')).toEqual({ metal: 200 });
    expect(payload('recalled')).toEqual({ metal: 200 });
    expect(r.state.planets.p?.resources.metal).toBe(800);
  });
});

// `time.stop`: подписчик хука останавливает мир внутри отрезка — там, где ему нужен шаг
// (`time.stopped`), а не на каждом событии в очереди. Подписчик только читает мир.
describe('advanceTo — time.stop cuts a span where a module needs a step', () => {
  const stopAt = (at: unknown): GameModule => ({
    id: 'stopper',
    version: '1.0.0',
    setup(api) {
      api.hook<unknown>('time.stop', (value, args) => {
        const { from, to } = args as { from: number; to: number };
        return typeof at === 'number' && at > from && at <= to
          ? Math.min(value as number, at)
          : value;
      });
      api.on('time.stopped', (event, h) => {
        h.state.planets.p!.resources.stops = (h.state.planets.p!.resources.stops ?? 0) + 1;
        h.emit('seen', { at: (event.payload as { at: number }).at, time: h.ctx.now });
      });
    },
  });
  const spans = (events: { type: string; payload: unknown }[]) =>
    events
      .filter((e) => e.type === TIME_ADVANCED || e.type === 'time.stopped')
      .map((e) =>
        e.type === TIME_ADVANCED
          ? (e.payload as { from: number; to: number })
          : { stopped: (e.payload as { at: number }).at },
      );

  it('splits the span at the stop, runs the stop step, and goes on to now', () => {
    const kernel = createKernel([economyModule, stopAt(300)]);
    const state = deepFreeze(stateWith({ planets: { p: makePlanet('p', { metal: 0 }) } }));
    const r = okAdvance(kernel.advanceTo(state, ctx(1000)));
    expect(spans(r.events)).toEqual([
      { from: 0, to: 300 },
      { stopped: 300 },
      { from: 300, to: 1000 },
    ]);
    expect(r.events.find((e) => e.type === 'seen')?.payload).toEqual({ at: 300, time: 300 });
    expect(r.state.planets.p?.resources).toEqual({ metal: 2000, stops: 1 });
    expect(r.failures).toEqual([]);
  });

  it('a stop before a queued event: the event still fires on its own instant', () => {
    const kernel = createKernel([economyModule, stopAt(300)]);
    const state = stateWith({
      planets: { p: makePlanet('p', { metal: 0 }) },
      scheduled: [sched(0, 800, 'x')],
    });
    const r = okAdvance(kernel.advanceTo(state, ctx(1000)));
    expect(spans(r.events)).toEqual([
      { from: 0, to: 300 },
      { stopped: 300 },
      { from: 300, to: 800 },
      { from: 800, to: 1000 },
    ]);
    expect(domainTypes(r.events)).toEqual(['time.stopped', 'seen', 'x']);
  });

  it('a stop on the instant of a queued event steps after that event, on either path', () => {
    // Второй прогон идёт пошагово: событие `boom` падает, и ход на месте отдаёт работу.
    const boom: GameModule = {
      id: 'boom',
      version: '1.0.0',
      setup(api) {
        api.on('boom', () => {
          throw new Error('boom');
        });
      },
    };
    for (const queue of [[sched(0, 800, 'x')], [sched(0, 100, 'boom'), sched(1, 800, 'x')]]) {
      const kernel = createKernel([economyModule, stopAt(800), boom]);
      const state = stateWith({ planets: { p: makePlanet('p', { metal: 0 }) }, scheduled: queue });
      const r = okAdvance(kernel.advanceTo(state, ctx(1000)));
      expect(domainTypes(r.events).filter((t) => t !== 'boom')).toEqual([
        'x',
        'time.stopped',
        'seen',
      ]);
      expect(spans(r.events).slice(-3)).toEqual([
        { from: queue.length === 1 ? 0 : 100, to: 800 },
        { stopped: 800 },
        { from: 800, to: 1000 },
      ]);
      expect(r.state.planets.p?.resources).toEqual({ metal: 2000, stops: 1 });
      expect(r.failures.map((f) => f.type)).toEqual(queue.length === 1 ? [] : ['boom']);
    }
  });

  it('a stop exactly at the end of the span still gets its step', () => {
    const kernel = createKernel([economyModule, stopAt(1000)]);
    const r = okAdvance(
      kernel.advanceTo(stateWith({ planets: { p: makePlanet('p', { metal: 0 }) } }), ctx(1000)),
    );
    expect(spans(r.events)).toEqual([{ from: 0, to: 1000 }, { stopped: 1000 }]);
  });

  it('ignores an instant outside the span or not a number', () => {
    for (const at of [0, -5, 1001, Number.NaN, '300']) {
      const kernel = createKernel([economyModule, stopAt(at)]);
      const r = okAdvance(
        kernel.advanceTo(stateWith({ planets: { p: makePlanet('p', { metal: 0 }) } }), ctx(1000)),
      );
      expect(spans(r.events), String(at)).toEqual([{ from: 0, to: 1000 }]);
    }
  });

  it('a subscriber that writes or throws stops nothing: recorded, and the world moves on', () => {
    const writes: GameModule = {
      id: 'writer',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('time.stop', (value, _args, h) => {
          h.schedule(500, 'sneaky');
          return value;
        });
      },
    };
    const kernel = createKernel([economyModule, writes]);
    const state = deepFreeze(stateWith({ planets: { p: makePlanet('p', { metal: 0 }) } }));
    const r = okAdvance(kernel.advanceTo(state, ctx(1000)));
    expect(r.failures).toEqual([{ at: 0, type: 'time.stop', code: 'E_INTERNAL' }]);
    expect(spans(r.events)).toEqual([{ from: 0, to: 1000 }]);
    expect(r.state.scheduled).toEqual([]);
    expect(r.state.planets.p?.resources.metal).toBe(2000);
  });
});
