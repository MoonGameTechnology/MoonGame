import { describe, expect, it } from 'vitest';

import { BLEND_MS, LEAD_MS, NET_VIEW_IDLE, netViewAt, netViewSnapshot } from './netViewClock';

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
});
