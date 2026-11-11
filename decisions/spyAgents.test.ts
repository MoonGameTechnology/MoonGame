import { describe, expect, it } from 'vitest';
import { spyAgents } from './spyAgents';

describe('spyAgents', () => {
  it('free = resting or waiting; the rest are away, the soonest back first', () => {
    const r = spyAgents([
      { id: 1, gen: 1, state: 'rest', location: 'H' },
      { id: 2, gen: 1, state: 'travel', location: 'B', op: 'theft', arrivesAt: 10 },
      { id: 3, gen: 2, state: 'recruit', location: 'H', arrivesAt: 5 },
      { id: 4, gen: 1, state: 'wait', location: 'N' },
    ]);
    expect(r.free).toBe(2);
    expect(r.total).toBe(4);
    expect(r.away).toEqual([
      { until: 5, lost: true },
      { until: 10, op: 'theft', planetId: 'B' },
    ]);
  });

  it('a spy on post has no end and goes last', () => {
    const r = spyAgents([
      { id: 1, gen: 1, state: 'work', location: 'B', op: 'counter', posted: true },
      { id: 2, gen: 1, state: 'return', location: 'H', arrivesAt: 7 },
    ]);
    expect(r.away).toEqual([
      { until: 7 },
      { until: Number.MAX_SAFE_INTEGER, op: 'counter', planetId: 'B', posted: true },
    ]);
  });

  it('nobody busy → the whole network is free', () => {
    expect(spyAgents([{ id: 1, gen: 1, state: 'rest', location: 'H' }])).toEqual({
      free: 1,
      total: 1,
      away: [],
    });
  });
});
