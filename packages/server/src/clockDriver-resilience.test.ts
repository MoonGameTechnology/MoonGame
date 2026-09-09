import { describe, expect, it } from 'vitest';
import { startClockDriver } from './clockDriver';
import type { MatchRoom } from './matchRoom';

// Регрессия плейтеста (тот же класс, что и замершая карта клиента): перевзвод следующего
// тика стоял ПОСЛЕДНЕЙ строкой самого тика, поэтому любое исключение изнутри означало, что
// следующего тика не будет никогда — часы матча вставали для всех, кто в нём, а брошенное
// из колбэка таймера исключение вдобавок роняло процесс со всеми остальными матчами.

describe('clock driver · один сорвавшийся тик не убивает часы матча', () => {
  it('исключение из tick() не выходит наружу, и драйвер поднимается заново', () => {
    let armed: { fn: () => void; ms: number } | null = null;
    const schedule = (fn: () => void, ms: number): unknown => {
      armed = { fn, ms };
      return {};
    };
    const cancel = (): void => {
      armed = null;
    };

    let broken = true;
    let ticks = 0;
    const room = {
      tick: () => {
        ticks += 1;
        if (broken) throw new Error('broken tick');
        return true;
      },
      msUntilNextEvent: () => 10,
      isClockRunning: true,
      peerCount: 1,
    } as unknown as MatchRoom;

    const driver = startClockDriver(room, { schedule, cancel });
    expect(armed).not.toBeNull();

    // Тик бросает. Наружу это выходить не должно: колбэк таймера некому ловить.
    expect(() => armed!.fn()).not.toThrow();
    expect(ticks).toBe(1);

    // Драйвер ушёл в простой — но не умер: reschedule() (например, действие игрока)
    // поднимает его, и мир продолжает идти.
    broken = false;
    driver.reschedule();
    expect(armed).not.toBeNull();
    armed!.fn();
    expect(ticks).toBe(2);

    driver.stop();
  });
});
