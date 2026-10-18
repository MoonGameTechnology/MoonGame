import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonlTail, tailCount } from './jsonlTail';

describe('bounded operator journal', () => {
  it('accepts only counts 1..200, with a default only for missing input', () => {
    expect(tailCount(undefined)).toBe(20);
    for (const value of ['1', '20', '200']) expect(tailCount(value)).toBe(Number(value));
    for (const value of ['-1', '0.5', '0', 'NaN', '201', '1e2', '', ' 2', ['1', '2'], null])
      expect(tailCount(value)).toBeNull();
  });
  it('bounds a large journal, survives corrupt records and excludes torn records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tail-'));
    const file = join(dir, 'log');
    try {
      await writeFile(file, 'x'.repeat(2 * 1024 * 1024) + '\n{"i":1}\nbroken\n{"i":2}\n{"torn":');
      const result = await jsonlTail(file, 3);
      expect(result).toEqual({ total: 3, recent: [{ i: 1 }, { i: 2 }], truncated: true });
      await writeFile(file, '{"i":1}\n{"i":2}\n');
      expect(await jsonlTail(file, 1)).toEqual({ total: 2, recent: [{ i: 2 }], truncated: false });
      await expect(jsonlTail(file, -1)).rejects.toThrow('E_BAD_REQUEST');
      await writeFile(file, 'x'.repeat(2 * 1024 * 1024));
      expect((await jsonlTail(file, 20)).recent).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
