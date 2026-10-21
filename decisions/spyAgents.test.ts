import { describe, expect, it } from 'vitest';
import { spyAgents } from './spyAgents';

describe('spyAgents', () => {
  it('free = network minus agents still away (a returned one is home already)', () => {
    const r = spyAgents([{ until: 10 }, { until: 5, lost: true }, { until: 3 }], 3, 4);
    expect(r.free).toBe(1);
    expect(r.away).toEqual([{ until: 5, lost: true }, { until: 10 }]);
  });

  it('a network smaller than the agents away shows zero, not a negative', () => {
    expect(spyAgents([{ until: 9 }, { until: 9 }], 1, 0).free).toBe(0);
  });

  it('no agents away → the whole network is free', () => {
    expect(spyAgents(undefined, 3, 0)).toEqual({ free: 3, total: 3, away: [] });
  });
});
