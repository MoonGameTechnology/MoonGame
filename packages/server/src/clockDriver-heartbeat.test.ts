import { describe, expect, it } from 'vitest';
import { createDevMatch, loadShippedData } from './scenario';
import { startClockDriver, HEARTBEAT_MS } from './clockDriver';
import type { MatchRoom, RoomPeer } from './matchRoom';

// NETA2-6 (one scheduler): the live-player heartbeat used to live in an inline copy of
// this driver inside the prototype host; it now lives in the shared `startClockDriver`
// so BOTH hosts get it. These tests pin the arm logic — when the beat is added, when it
// idles — against a stub room (hermetic: it controls tick()/msUntilNextEvent()/the two
// gates exactly), then prove the end-to-end fix on a real dev match.

/** The minimal room surface the driver touches. A plain object lets each test control
 *  the two heartbeat gates + what tick()/msUntilNextEvent() report, deterministically. */
interface StubRoom {
  isClockRunning: boolean;
  peerCount: number;
  next: number | null; // msUntilNextEvent() returns this
  willProgress: boolean; // tick() returns this
  ticks: number;
  tick(): boolean;
  msUntilNextEvent(): number | null;
}

function stubRoom(init: Partial<StubRoom> = {}): StubRoom {
  return {
    isClockRunning: true,
    peerCount: 1,
    next: null,
    willProgress: true,
    ticks: 0,
    tick(): boolean {
      this.ticks += 1;
      return this.willProgress;
    },
    msUntilNextEvent(): number | null {
      return this.next;
    },
    ...init,
  };
}

/** A capturing scheduler: instead of arming a real timer, record the (fn, ms) the driver
 *  would have set — `armed` is null when the driver chose to idle. */
function capturingClock(): {
  armed: () => { fn: () => void; ms: number } | null;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (h: unknown) => void;
} {
  let armed: { fn: () => void; ms: number } | null = null;
  return {
    armed: () => armed,
    schedule: (fn, ms) => {
      armed = { fn, ms };
      return {};
    },
    cancel: () => {
      armed = null;
    },
  };
}

const asRoom = (r: StubRoom): MatchRoom => r as unknown as MatchRoom;

describe('clock driver · live-player heartbeat (NETA2-6)', () => {
  it('arms the beat for a watched, running room with an EMPTY schedule', () => {
    const clock = capturingClock();
    const room = stubRoom({ isClockRunning: true, peerCount: 1, next: null });
    startClockDriver(asRoom(room), { heartbeatMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
    // Nothing scheduled, yet the driver arms — this is the whole fix: the published clock
    // keeps moving on-screen instead of freezing on "Day 1" between actions.
    expect(clock.armed()).not.toBeNull();
    expect(clock.armed()!.ms).toBe(1000);
  });

  it('does NOT beat an unwatched room (peerCount 0) — nobody to keep on-screen', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 0, next: null });
    startClockDriver(asRoom(room), { heartbeatMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
    expect(clock.armed()).toBeNull(); // idle — a hibernating room advances only on its schedule
  });

  it('does NOT beat a frozen room (clock not running) even with peers waiting', () => {
    const clock = capturingClock();
    const room = stubRoom({ isClockRunning: false, peerCount: 2, next: null });
    startClockDriver(asRoom(room), { heartbeatMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
    expect(clock.armed()).toBeNull(); // a pre-start lobby has no live clock to publish
  });

  it('is opt-in: WITHOUT heartbeatMs a watched running room still idles on an empty schedule', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 1, next: null });
    startClockDriver(asRoom(room), { schedule: clock.schedule, cancel: clock.cancel });
    expect(clock.armed()).toBeNull(); // pre-heartbeat behavior preserved when the beat is off
  });

  it('arms for the SOONER of the next event and the next beat', () => {
    // Event sooner than the beat → arm for the event.
    const a = capturingClock();
    startClockDriver(asRoom(stubRoom({ peerCount: 1, next: 200 })), {
      heartbeatMs: 1000,
      schedule: a.schedule,
      cancel: a.cancel,
    });
    expect(a.armed()!.ms).toBe(200);

    // Beat sooner than a far event → arm for the beat (so the clock doesn't freeze meanwhile).
    const b = capturingClock();
    startClockDriver(asRoom(stubRoom({ peerCount: 1, next: 5000 })), {
      heartbeatMs: 1000,
      schedule: b.schedule,
      cancel: b.cancel,
    });
    expect(b.armed()!.ms).toBe(1000);
  });

  it('still arms for a scheduled event on an UNWATCHED room (the beat is additive, not required)', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 0, next: 300 });
    startClockDriver(asRoom(room), { heartbeatMs: 1000, schedule: clock.schedule, cancel: clock.cancel });
    expect(clock.armed()!.ms).toBe(300); // no beat (unwatched), but the event still wakes it
  });

  it('caps a far-future wait at maxDelayMs (a long sleep taken in hops)', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 0, next: 10_000_000 });
    startClockDriver(asRoom(room), { maxDelayMs: 3_600_000, schedule: clock.schedule, cancel: clock.cancel });
    expect(clock.armed()!.ms).toBe(3_600_000);
  });

  it('re-arms the beat after each tick and reports `progressed` to onTick', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 1, next: null, willProgress: true });
    const seen: boolean[] = [];
    startClockDriver(asRoom(room), {
      heartbeatMs: 1000,
      onTick: ({ progressed }) => seen.push(progressed),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    expect(clock.armed()!.ms).toBe(1000);
    clock.armed()!.fn(); // fire the beat
    expect(room.ticks).toBe(1);
    expect(seen).toEqual([true]);
    expect(clock.armed()!.ms).toBe(1000); // re-armed for the next beat
  });

  it('a no-op heartbeat (nothing due) never trips the stall guard', () => {
    // willProgress false + next null models a coalesced wake where the clock did not move
    // and nothing is due. That is NOT a stall (a stall is due-but-frozen), so the beat must
    // keep re-arming rather than backing off.
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 1, next: null, willProgress: false });
    let stalled = false;
    startClockDriver(asRoom(room), {
      heartbeatMs: 1000,
      onStall: () => {
        stalled = true;
      },
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    for (let i = 0; i < 5; i += 1) clock.armed()!.fn();
    expect(stalled).toBe(false);
    expect(room.ticks).toBe(5);
    expect(clock.armed()).not.toBeNull(); // still beating
  });

  it('a reschedule never pushes the pending wake later — a stream of actions cannot starve the beat', () => {
    const clock = capturingClock();
    let calls = 0;
    const schedule = (fn: () => void, ms: number): unknown => {
      calls += 1;
      return clock.schedule(fn, ms);
    };
    let wall = 0;
    const room = stubRoom({ peerCount: 1, next: null });
    const driver = startClockDriver(asRoom(room), {
      heartbeatMs: 1000,
      now: () => wall,
      schedule,
      cancel: clock.cancel,
    });
    expect(calls).toBe(1); // beat due at wall 1000
    for (wall = 100; wall < 1000; wall += 100) driver.reschedule(); // an order every 100 ms
    expect(calls).toBe(1); // the 1000 deadline stands; restarting it would never let it fire
    wall = 900;
    room.next = 50; // an action scheduled something sooner than the pending beat (950 < 1000)
    driver.reschedule();
    expect(calls).toBe(2);
    expect(clock.armed()!.ms).toBe(50); // re-armed EARLIER
  });

  it('stops beating when the last peer leaves (reschedule with peerCount 0 → idle)', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 1, next: null });
    const driver = startClockDriver(asRoom(room), {
      heartbeatMs: 1000,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    expect(clock.armed()!.ms).toBe(1000); // beating while watched
    room.peerCount = 0; // last peer left
    driver.reschedule(); // observe(leave) re-evaluates
    expect(clock.armed()).toBeNull(); // idles — no one to keep on-screen
  });
});

describe('clock driver · optional background heartbeat', () => {
  it('uses one timer and switches to the existing watched heartbeat without querying the background policy', () => {
    const clock = capturingClock();
    const room = stubRoom({ peerCount: 0 });
    const active = new Set<unknown>();
    let policyReads = 0;
    const driver = startClockDriver(asRoom(room), {
      heartbeatMs: 1000,
      backgroundHeartbeatMs: () => {
        policyReads++;
        return 60_000;
      },
      schedule: (fn, ms) => {
        const handle = clock.schedule(fn, ms);
        active.add(handle);
        return handle;
      },
      cancel: (handle) => {
        active.delete(handle);
        clock.cancel(handle);
      },
    });
    expect(clock.armed()!.ms).toBe(60_000);
    expect(policyReads).toBe(1);
    expect(room.peerCount).toBe(0);
    expect(active.size).toBe(1);
    room.peerCount = 1;
    driver.reschedule();
    expect(clock.armed()!.ms).toBe(1000);
    expect(policyReads).toBe(1);
    expect(active.size).toBe(1);
    driver.stop();
    expect(clock.armed()).toBeNull();
    expect(active.size).toBe(0);
  });

  it('keeps event deadlines and maximum waits ahead of a later background beat', () => {
    for (const [next, maxDelayMs, expected] of [
      [200, 90_000, 200],
      [120_000, 90_000, 60_000],
      [120_000, 30_000, 30_000],
    ] as const) {
      const clock = capturingClock();
      const driver = startClockDriver(asRoom(stubRoom({ peerCount: 0, next })), {
        backgroundHeartbeatMs: () => 60_000,
        maxDelayMs,
        schedule: clock.schedule,
        cancel: clock.cancel,
      });
      expect(clock.armed()!.ms).toBe(expected);
      driver.stop();
    }
  });

  it('never queries or arms background work for a frozen room', () => {
    const clock = capturingClock();
    let policyReads = 0;
    const driver = startClockDriver(asRoom(stubRoom({ isClockRunning: false, peerCount: 0 })), {
      heartbeatMs: 1000,
      backgroundHeartbeatMs: () => {
        policyReads++;
        return 1000;
      },
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    expect(clock.armed()).toBeNull();
    expect(policyReads).toBe(0);
    driver.stop();
  });

  it('idles when the host disables an ended match and ignores invalid intervals', () => {
    const clock = capturingClock();
    let ended = false;
    const driver = startClockDriver(asRoom(stubRoom({ peerCount: 0 })), {
      backgroundHeartbeatMs: () => (ended ? null : 60_000),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    expect(clock.armed()).not.toBeNull();
    // MatchRoom.isClockRunning describes lobby state; the host withdraws this extra beat at end.
    ended = true;
    driver.reschedule();
    expect(clock.armed()).toBeNull();
    driver.stop();

    for (const interval of [0, -1, NaN, Infinity, -Infinity]) {
      const badClock = capturingClock();
      const badDriver = startClockDriver(asRoom(stubRoom({ peerCount: 0 })), {
        backgroundHeartbeatMs: () => interval,
        schedule: badClock.schedule,
        cancel: badClock.cancel,
      });
      expect(badClock.armed()).toBeNull();
      badDriver.stop();
    }
  });
});

describe('clock driver · heartbeat on a real dev match (NETA2-6 end-to-end)', () => {
  const data = loadShippedData();
  const silentPeer: RoomPeer = { send: () => {} };

  it('advances an opted-in empty match with no peers or scheduled events; ordinary empty matches still idle', () => {
    let wall = 1000;
    const room = createDevMatch(data, { now: () => wall, time: wall, config: { timeScale: 1 } });
    const clock = capturingClock();
    const ordinary = startClockDriver(room, {
      heartbeatMs: HEARTBEAT_MS,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    expect(room.isClockRunning).toBe(true);
    expect(room.peerCount).toBe(0);
    expect(room.msUntilNextEvent()).toBeNull();
    expect(clock.armed()).toBeNull();
    ordinary.stop();

    const seen: boolean[] = [];
    const driver = startClockDriver(room, {
      heartbeatMs: HEARTBEAT_MS,
      backgroundHeartbeatMs: () => 60_000,
      onTick: ({ progressed }) => seen.push(progressed),
      now: () => wall,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });
    expect(clock.armed()!.ms).toBe(60_000);
    wall += 60_000;
    clock.armed()!.fn();
    expect(room.state.time).toBe(wall);
    expect(room.peerCount).toBe(0);
    expect(seen).toEqual([true]);
    expect(clock.armed()!.ms).toBe(60_000);
    driver.stop();
  });

  it('advances a watched fresh match with NO scheduled events and no player action', () => {
    let clock = 1000;
    const room = createDevMatch(data, { now: () => clock, time: 1000, config: { timeScale: 1 } });
    room.addPeer('green', silentPeer); // peerCount → 1

    // The plain dev match runs its clock without ever being "started" — this is exactly
    // the serverWiring case the old `isStarted` gate would have wrongly frozen.
    expect(room.isClockRunning).toBe(true);
    expect(room.isStarted).toBe(false);
    expect(room.peerCount).toBe(1);
    expect(room.msUntilNextEvent()).toBeNull(); // fresh match: empty schedule

    let armed: { fn: () => void; ms: number } | null = null;
    const driver = startClockDriver(room, {
      heartbeatMs: HEARTBEAT_MS,
      schedule: (fn, ms) => {
        armed = { fn, ms };
        return {};
      },
      cancel: () => {
        armed = null;
      },
    });
    // Armed for the beat despite an empty schedule (pre-fix this was null → frozen clock).
    expect(armed).not.toBeNull();
    expect(armed!.ms).toBe(HEARTBEAT_MS);

    const before = room.state.time;
    clock = 5000; // wall time moves on
    armed!.fn(); // the beat fires → tick() advances the world
    expect(room.state.time).toBeGreaterThan(before); // clock moved with NO player action

    driver.stop();
  });
});
