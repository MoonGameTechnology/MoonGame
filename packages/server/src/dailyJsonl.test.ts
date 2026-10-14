import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DailyJsonl, utcDay } from './dailyJsonl';

const DAY1 = Date.UTC(2026, 9, 14, 23, 59, 0);
const DAY2 = Date.UTC(2026, 9, 15, 0, 1, 0);

let dirs: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'daily-jsonl-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const readLines = (file: string): Array<Record<string, unknown>> =>
  readFileSync(file, 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('DailyJsonl', () => {
  it('utcDay is the UTC calendar day', () => {
    expect(utcDay(DAY1)).toBe('2026-10-14');
    expect(utcDay(DAY2)).toBe('2026-10-15');
  });

  it('write does not touch the disk until a flush', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 60_000 });
    log.write({ kind: 'join', playerId: 'p1' });
    expect(readdirSync(dir)).toEqual([]);
    await log.flush();
    expect(readLines(join(dir, 'match-2026-10-14.jsonl'))).toEqual([
      { t: DAY1, kind: 'join', playerId: 'p1' },
    ]);
    expect(log.stats()).toEqual({ written: 1, dropped: 0, failed: 0 });
  });

  it('splits lines by the UTC day of their own timestamp', async () => {
    const dir = tempDir();
    let now = DAY1;
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => now, flushDelayMs: 60_000 });
    log.write({ kind: 'a' });
    now = DAY2;
    log.write({ kind: 'b' });
    log.write({ kind: 'c', t: DAY1 }); // a record that carries its own time keeps its day
    await log.flush();
    expect(readdirSync(dir).sort()).toEqual(['match-2026-10-14.jsonl', 'match-2026-10-15.jsonl']);
    expect(readLines(join(dir, 'match-2026-10-14.jsonl')).map((r) => r.kind)).toEqual(['a', 'c']);
    expect(readLines(join(dir, 'match-2026-10-15.jsonl')).map((r) => r.kind)).toEqual(['b']);
    expect(log.currentFile()).toBe(join(dir, 'match-2026-10-15.jsonl'));
  });

  it('a full queue drops and counts instead of blocking or throwing', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({
      dir,
      prefix: 'match',
      now: () => DAY1,
      maxQueued: 2,
      flushDelayMs: 60_000,
    });
    for (let i = 0; i < 5; i++) log.write({ i });
    await log.flush();
    expect(readLines(join(dir, 'match-2026-10-14.jsonl')).map((r) => r.i)).toEqual([0, 1]);
    expect(log.stats()).toEqual({ written: 2, dropped: 3, failed: 0 });
  });

  it('an unserializable record is counted, not thrown', () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 60_000 });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => log.write(cyclic)).not.toThrow();
    expect(log.stats().failed).toBe(1);
  });

  it('a failing append is counted, not thrown', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 60_000 });
    rmSync(dir, { recursive: true, force: true }); // the directory vanished under us
    log.write({ kind: 'x' });
    await expect(log.flush()).resolves.toBeUndefined();
    expect(log.stats()).toEqual({ written: 0, dropped: 0, failed: 1 });
  });

  it('flushes on its own after the delay', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 0 });
    log.write({ kind: 'x' });
    await new Promise((r) => setTimeout(r, 20));
    await log.flush();
    expect(readLines(join(dir, 'match-2026-10-14.jsonl'))).toHaveLength(1);
  });

  it('flushSync writes the queue at once (shutdown path)', () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 60_000 });
    log.write({ kind: 'summary' });
    log.flushSync();
    expect(readLines(join(dir, 'match-2026-10-14.jsonl')).map((r) => r.kind)).toEqual(['summary']);
  });

  it('concurrent flushes keep line order', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 60_000 });
    log.write({ i: 1 });
    const a = log.flush();
    log.write({ i: 2 });
    const b = log.flush();
    await Promise.all([a, b]);
    expect(readLines(join(dir, 'match-2026-10-14.jsonl')).map((r) => r.i)).toEqual([1, 2]);
  });
});
