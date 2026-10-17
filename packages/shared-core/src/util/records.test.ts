import { describe, expect, it } from 'vitest';
import { recordValues } from './records';
import { deepClone } from './clone';

describe('recordValues — Object.values through the keys', () => {
  it('returns the same entities in the same order, on a record large enough for dictionary mode', () => {
    const record: Record<string, { id: string }> = {};
    for (let i = 0; i < 900; i++) record[`n${(i * 7919) % 1000}`] = { id: `n${(i * 7919) % 1000}` };
    // Deleted and re-added keys, and an integer-like key (property order puts it first).
    delete record.n0;
    delete record.n500;
    record.n0 = { id: 'n0' };
    record['42'] = { id: '42' };
    for (const rec of [record, deepClone(record)]) {
      const values = recordValues(rec);
      expect(values).toEqual(Object.values(rec));
      Object.values(rec).forEach((entity, i) => expect(values[i]).toBe(entity));
    }
    expect(recordValues({})).toEqual([]);
  });
});
