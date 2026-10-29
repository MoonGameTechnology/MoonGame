import {
  writeFileSync,
  statSync,
  symlinkSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
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
  it('caps queued UTF-8 bytes and releases the budget after flush', async () => {
    const dir = tempDir();
    const record = { t: DAY1, text: 'Я🚀' };
    const bytes = Buffer.byteLength(JSON.stringify(record) + '\n');
    const log = new DailyJsonl({
      dir,
      prefix: 'match',
      now: () => DAY1,
      maxQueuedBytes: bytes,
      flushDelayMs: 60_000,
    });
    log.write(record);
    log.write(record);
    await log.flush();
    log.write(record);
    await log.flush();
    expect(log.stats()).toEqual({ written: 2, dropped: 1, failed: 0 });
  });

  it('keeps complete records within the file budget across process restarts', async () => {
    const dir = tempDir();
    const record = { t: DAY1, text: 'Я🚀' };
    const bytes = Buffer.byteLength(JSON.stringify(record) + '\n');
    const options = {
      dir,
      prefix: 'match',
      now: () => DAY1,
      maxFileBytes: bytes * 2 + 1,
      flushDelayMs: 60_000,
    };
    const first = new DailyJsonl(options);
    first.write(record);
    await first.flush();
    const restarted = new DailyJsonl(options);
    restarted.write(record);
    restarted.write(record);
    await restarted.flush();
    expect(readLines(first.currentFile())).toEqual([record, record]);
    expect(statSync(first.currentFile()).size).toBe(bytes * 2);
    expect(restarted.stats()).toEqual({ written: 1, dropped: 1, failed: 0 });
  });

  it('preserves an already oversized file and resumes logging on the next UTC day', async () => {
    const dir = tempDir();
    let now = DAY1;
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => now, maxFileBytes: 128 });
    const existing = 'existing evidence\n'.repeat(100);
    const file = log.currentFile();
    writeFileSync(file, existing);
    log.write({ event: 'full' });
    await log.flush();
    expect(readFileSync(file, 'utf8')).toBe(existing);
    now = DAY2;
    log.write({ event: 'new-day' });
    await log.flush();
    expect(readLines(log.currentFile())[0]?.event).toBe('new-day');
    expect(log.stats()).toEqual({ written: 1, dropped: 1, failed: 0 });
  });

  it('cannot create unbounded daily files using old, future or invalid timestamps', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1 });
    log.write({ t: DAY1 - 100 * 86_400_000 });
    log.write({ t: DAY2 });
    expect(() => log.write({ t: NaN })).not.toThrow();
    await log.flush();
    expect(readdirSync(dir)).toEqual([]);
    expect(log.stats()).toEqual({ written: 0, dropped: 2, failed: 1 });
  });

  it('refuses symlinks and hardlinks without modifying their target', async () => {
    for (const link of [symlinkSync, linkSync]) {
      const dir = tempDir();
      const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1 });
      const target = join(dir, 'evidence.txt');
      writeFileSync(target, 'unchanged');
      link(target, log.currentFile());
      log.write({ event: 'must-not-append' });
      await log.flush();
      expect(readFileSync(target, 'utf8')).toBe('unchanged');
      expect(log.stats().failed).toBe(1);
    }
  });

  it('rejects invalid resource budgets at construction', () => {
    for (const maxFileBytes of [0, -1, Infinity, 1.5]) {
      expect(() => new DailyJsonl({ dir: tempDir(), prefix: 'match', maxFileBytes })).toThrow(
        'E_JOURNAL_CONFIG',
      );
    }
  });
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

  it('shutdown mid-append: the final summary lands after the in-flight lines', async () => {
    const dir = tempDir();
    const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1, flushDelayMs: 60_000 });
    log.write({ kind: 'a' });
    const inFlight = log.flush();
    await Promise.resolve(); // the batch has left the queue, its append is pending
    log.write({ kind: 'summary' });
    await log.flush(); // what shutdown awaits
    await inFlight;
    expect(readLines(join(dir, 'match-2026-10-14.jsonl')).map((r) => r.kind)).toEqual([
      'a',
      'summary',
    ]);
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

it('expires only its own old telemetry files and keeps new files private', async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'match-2026-09-01.jsonl'), 'old');
  writeFileSync(join(dir, 'client-2026-09-01.jsonl'), 'foreign');
  writeFileSync(join(dir, 'evidence.txt'), 'hold');
  symlinkSync(join(dir, 'evidence.txt'), join(dir, 'match-2026-09-02.jsonl'));
  const log = new DailyJsonl({ dir, prefix: 'match', now: () => DAY1 });
  log.write({ kind: 'today' });
  log.write({ oversized: 'x'.repeat(64 * 1024) });
  await log.flush();
  expect(readdirSync(dir).sort()).toEqual([
    'client-2026-09-01.jsonl',
    'evidence.txt',
    'match-2026-09-02.jsonl',
    'match-2026-10-14.jsonl',
  ]);
  expect(statSync(log.currentFile()).mode & 0o777).toBe(0o600);
  expect(log.stats().dropped).toBe(1);
});
