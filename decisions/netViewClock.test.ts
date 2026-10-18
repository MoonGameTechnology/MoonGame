import { describe, expect, it } from 'vitest';

import {
  BLEND_MS,
  LEAD_MS,
  NET_VIEW_IDLE,
  SETTLE_CAP_MS,
  SNAP_MS,
  netViewAt,
  netViewFollow,
  netViewSettled,
  netViewSnapshot,
  type NetViewShown,
} from './netViewClock';

/** Снимки раз в `every` реальных мс при мире, идущем со скоростью `rate`. */
function feed(n: number, every: number, rate: number, t0 = 1_000_000, real0 = 0) {
  let clock = NET_VIEW_IDLE;
  for (let i = 0; i < n; i++) clock = netViewSnapshot(clock, t0 + i * every * rate, real0 + i * every);
  return clock;
}

describe('netViewClock', () => {
  it('до первого снимка рисует запасное время', () => {
    expect(netViewAt(NET_VIEW_IDLE, 500, 42)).toBe(42);
  });

  it('первый снимок: скорость ещё не известна — картинка стоит на его времени', () => {
    const c = netViewSnapshot(NET_VIEW_IDLE, 1000, 50);
    expect(netViewAt(c, 900, 0)).toBe(1000);
  });

  it('правило 1: между снимками раз в секунду картинка идёт со скоростью мира', () => {
    const c = feed(3, 1000, 1); // последний снимок: t = 1_002_000 в реальные 2000
    expect(netViewAt(c, 2500, 0)).toBeCloseTo(1_002_500, 6);
    expect(netViewAt(c, 2999, 0)).toBeCloseTo(1_002_999, 6);
  });

  it('правило 1: скорость — из снимков, в том числе ускоренный мир', () => {
    const c = feed(4, 1000, 60); // минута игры за секунду
    expect(c.rate).toBeCloseTo(60, 6);
    expect(netViewAt(c, 3000 + 500, 0) - (c.t ?? 0)).toBeCloseTo(30_000, 3);
  });

  it('правило 1: пауза — скорость сразу ноль, картинка стоит', () => {
    let c = feed(3, 1000, 1);
    c = netViewSnapshot(c, c.t!, 3000);
    expect(c.rate).toBe(0);
    expect(netViewAt(c, 3900, 0)).toBe(c.t);
  });

  it('частые снимки подряд (событие сразу за пульсом) не портят оценку скорости', () => {
    let c = feed(3, 1000, 1);
    c = netViewSnapshot(c, c.t! + 20, 2020);
    expect(c.rate).toBeCloseTo(1, 6);
  });

  it('правило 2: без снимков досчёт останавливается через LEAD_MS', () => {
    const c = feed(3, 1000, 1);
    const cap = netViewAt(c, 2000 + LEAD_MS, 0);
    expect(netViewAt(c, 2000 + LEAD_MS * 5, 0)).toBe(cap);
    expect(cap - c.t!).toBeCloseTo(LEAD_MS, 6);
  });

  it('правило 3: опоздавший снимок не двигает картинку назад, невязка гаснет', () => {
    const c = feed(3, 1000, 1); // ждём снимок в 3000, он приходит в 3100
    const before = netViewAt(c, 3100, 0);
    const next = netViewSnapshot(c, c.t! + 1000, 3100);
    expect(netViewAt(next, 3100, 0)).toBeCloseTo(before, 6);
    let prev = before;
    for (let now = 3100; now <= 3100 + BLEND_MS + 200; now += 16) {
      const v = netViewAt(next, now, 0);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = v;
    }
    // Погашено: дальше картинка идёт ровно от снимка.
    expect(netViewAt(next, 3100 + BLEND_MS + 100, 0)).toBeCloseTo(next.t! + (BLEND_MS + 100) * next.rate, 6);
  });

  it('правило 3: ранний снимок — картинка догоняет, а не прыгает', () => {
    const c = feed(3, 1000, 1);
    const before = netViewAt(c, 2900, 0);
    const next = netViewSnapshot(c, c.t! + 1000, 2900); // снимок впереди досчёта на 100
    expect(netViewAt(next, 2900, 0)).toBeCloseTo(before, 6);
    expect(netViewAt(next, 2900 + BLEND_MS, 0)).toBeCloseTo(next.t! + BLEND_MS * next.rate, 6);
  });

  it('правило 4: время назад (другая партия) — часы с нуля', () => {
    const c = feed(3, 1000, 1);
    const fresh = netViewSnapshot(c, 5, 4000);
    expect(fresh.rate).toBe(0);
    expect(netViewAt(fresh, 4500, 0)).toBe(5);
  });

  it('правило 5: опоздавший приветственный снимок не завышает скорость', () => {
    // Мир идёт ×1, снимки раз в секунду, но приветствие разбирали 400 мс — оно «пришло» в 400.
    let c = netViewSnapshot(NET_VIEW_IDLE, 1_000_000, 400);
    c = netViewSnapshot(c, 1_001_000, 1000);
    expect(c.rate).toBe(0); // второй снимок только начинает отсчёт
    c = netViewSnapshot(c, 1_002_000, 2000);
    expect(c.rate).toBeCloseTo(1, 6);
  });

  it('правило 6: карта ждёт калибровки, но не дольше SETTLE_CAP_MS', () => {
    let c = netViewSnapshot(NET_VIEW_IDLE, 1_000_000, 0);
    expect(netViewSettled(NET_VIEW_IDLE, 0)).toBe(false);
    expect(netViewSettled(c, 1500)).toBe(false);
    c = netViewSnapshot(c, 1_001_000, 1000);
    c = netViewSnapshot(c, 1_002_000, 2000);
    expect(netViewSettled(c, 2000)).toBe(true);
    const paused = netViewSnapshot(NET_VIEW_IDLE, 5, 0);
    expect(netViewSettled(paused, SETTLE_CAP_MS - 1)).toBe(false);
    expect(netViewSettled(paused, SETTLE_CAP_MS)).toBe(true);
  });

  it('правило 7: кадр не едет назад и не замирает на неровных снимках', () => {
    // Снимки ×1 раз в ~1 с с разбросом ±150 мс, кадр каждые 16 мс.
    let c = feed(3, 1000, 1);
    let shown: NetViewShown | null = null;
    let worstStall = 0;
    let stall = 0;
    const jitter = [150, -120, 90, -150, 60, 140, -80, 0, 130, -140];
    let next = 3000 + jitter[0]!;
    let k = 0;
    for (let now = 2000; now < 13_000; now += 16) {
      if (now >= next) {
        c = netViewSnapshot(c, 1_000_000 + (3000 + k * 1000), now);
        k++;
        next = 3000 + k * 1000 + jitter[k % jitter.length]!;
      }
      const prevTime: number = shown === null ? -Infinity : (shown as NetViewShown).time;
      shown = netViewFollow(shown, c, now, 0);
      expect(shown.time).toBeGreaterThanOrEqual(prevTime);
      stall = shown.time - prevTime < 1 ? stall + 16 : 0;
      worstStall = Math.max(worstStall, stall);
    }
    expect(worstStall).toBeLessThan(100);
    // И держится рядом с правдой: не дальше трёх десятых секунды хода мира.
    expect(Math.abs(shown!.time - netViewAt(c, 13_000, 0))).toBeLessThan(300);
  });

  it('правило 7: большой разрыв и стоящий мир — скачок к оценке', () => {
    const c = feed(3, 1000, 1);
    const far: NetViewShown = { time: c.t! - SNAP_MS * 2, at: 1990 };
    expect(netViewFollow(far, c, 2000, 0).time).toBeCloseTo(netViewAt(c, 2000, 0), 6);
    const paused = netViewSnapshot(c, c.t!, 3000);
    const ahead: NetViewShown = { time: c.t! + 500, at: 2990 };
    expect(netViewFollow(ahead, paused, 3000, 0).time).toBe(paused.t);
    expect(netViewFollow(null, c, 2000, 0).time).toBeCloseTo(netViewAt(c, 2000, 0), 6);
  });
});
