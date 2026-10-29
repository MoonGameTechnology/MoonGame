import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresArchiveCatalog } from './matchArchiveCatalog';

describe('PostgreSQL archive catalog resource and ownership boundary', () => {
  it('binds the authenticated owner and real deadline while selecting only bounded metadata', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const catalog = new PostgresArchiveCatalog({ query } as unknown as Pool);
    const login = "owner' OR true --";
    expect(await catalog.list(login, 1234)).toEqual([]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('m.archive_meta');
    expect(sql).toContain('mine.nick=$2');
    expect(sql).toContain('m.ended_at>$1');
    expect(sql).toMatch(/LIMIT \d+/);
    expect(sql).not.toMatch(/\bstate\b/);
    expect(sql).not.toContain(login);
    expect(values).toEqual([new Date(1234), login]);
  });
});
