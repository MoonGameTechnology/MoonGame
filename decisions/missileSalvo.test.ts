import { describe, expect, it } from 'vitest';
import { missileSalvoSize } from './missileSalvo';

const base = { targetHp: 250, warhead: 100, incoming: 0, available: 12, max: 12 };

describe('missileSalvoSize', () => {
  it('covers the target hull plus one for its point defence', () => {
    expect(missileSalvoSize(base)).toBe(4);
  });

  it('counts missiles already flying at the target', () => {
    expect(missileSalvoSize({ ...base, incoming: 3 })).toBe(1);
    expect(missileSalvoSize({ ...base, incoming: 4 })).toBe(0);
    expect(missileSalvoSize({ ...base, incoming: 9 })).toBe(0);
  });

  it('never fires more than the squadron holds or one order allows', () => {
    expect(missileSalvoSize({ ...base, targetHp: 5000, available: 7 })).toBe(7);
    expect(missileSalvoSize({ ...base, targetHp: 5000, max: 12, available: 30 })).toBe(12);
  });

  it('fires nothing without a warhead or a target', () => {
    expect(missileSalvoSize({ ...base, warhead: 0 })).toBe(0);
    expect(missileSalvoSize({ ...base, targetHp: 0 })).toBe(0);
  });
});
