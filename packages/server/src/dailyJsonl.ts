// PTM-0.1 (docs/playtest-telemetry-roadmap.md): an append-only JSONL journal split by
// UTC day, written OFF the hot path. A room's `observe` callback used to call
// `appendFileSync` itself — a synchronous disk write inside the action/broadcast path.
// Here `write` only queues a line; a flush appends the queue asynchronously. The queue
// is bounded: past `maxQueued` a line is DROPPED and counted, never blocks and never
// throws — telemetry losing a line is acceptable, a room stalling on a slow disk is not.
// Pure observation: nothing here feeds back into any room.

import { constants, mkdirSync } from 'node:fs';
import { open, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface DailyJsonlStats {
  written: number;
  dropped: number;
  failed: number;
}

export interface DailyJsonlOptions {
  dir: string;
  /** File name prefix: `<prefix>-YYYY-MM-DD.jsonl`. */
  prefix: string;
  /** Lines waiting for a flush before new ones are dropped. */
  maxQueued?: number;
  /** Bound queued UTF-8 bytes as well as line count. Default: 4 MiB. */
  maxQueuedBytes?: number;
  /** Stop recording this day at the byte budget; never truncate evidence. Default: 16 MiB. */
  maxFileBytes?: number;
  /** Delay before a scheduled flush (ms). 0 ⇒ next macrotask. */
  flushDelayMs?: number;
  now?: () => number;
  /** Operational telemetry only, never statutory audit evidence. Default: 30 UTC days. */
  retentionDays?: number;
}

/** `2026-10-14` for a UTC instant. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class DailyJsonl {
  private queue: Array<{ day: string; line: string }> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private readonly stats_: DailyJsonlStats = { written: 0, dropped: 0, failed: 0 };
  private readonly maxQueued: number;
  private readonly maxQueuedBytes: number;
  private readonly maxFileBytes: number;
  private queuedBytes = 0;
  private readonly flushDelayMs: number;
  private readonly now: () => number;
  private prunedDay: string | undefined;
  private pruneErrorDay: string | undefined;
  private readonly retentionDays: number;

  constructor(private readonly options: DailyJsonlOptions) {
    this.maxQueued = options.maxQueued ?? 10_000;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 4 * 1024 * 1024;
    this.maxFileBytes = options.maxFileBytes ?? 16 * 1024 * 1024;
    this.flushDelayMs = options.flushDelayMs ?? 250;
    this.now = options.now ?? Date.now;
    this.retentionDays = options.retentionDays ?? 30;
    if (
      !/^[a-z][a-z0-9-]*$/.test(options.prefix) ||
      ![this.retentionDays, this.maxQueued, this.maxQueuedBytes, this.maxFileBytes].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw new Error('E_JOURNAL_CONFIG');
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  }

  /** The file a line written right now lands in. */
  currentFile(): string {
    return this.fileFor(utcDay(this.now()));
  }

  stats(): DailyJsonlStats {
    return { ...this.stats_ };
  }

  /** Queue one record. Stamps `t` (ms) unless the record already carries one. */
  write(record: Record<string, unknown>): void {
    if (this.queue.length >= this.maxQueued) {
      this.stats_.dropped++;
      return;
    }
    let line: string;
    let day: string;
    try {
      const now = this.now();
      const t = typeof record.t === 'number' ? record.t : now;
      day = utcDay(t);
      // Caller timestamps must not create an unbounded set of daily files.
      if (day > utcDay(now) || day < utcDay(now - this.retentionDays * 86_400_000)) {
        this.stats_.dropped++;
        return;
      }
      line = JSON.stringify({ t: now, ...record }) + '\n';
    } catch {
      this.stats_.failed++;
      return;
    }
    const bytes = Buffer.byteLength(line, 'utf8');
    if (bytes > 64 * 1024 || this.queuedBytes + bytes > this.maxQueuedBytes) {
      this.stats_.dropped++;
      return;
    }
    this.queuedBytes += bytes;
    this.queue.push({ day, line });
    this.schedule();
  }

  /** Append everything queued so far. Resolves once it is on disk (or counted failed).
   *  An append already in flight finishes first, so this is also the shutdown path: await
   *  it before exit and every line lands, in order. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const prev = this.flushing ?? Promise.resolve();
    const run = prev.then(() => this.drain());
    const completion = run.finally(() => {
      if (this.flushing === completion) this.flushing = undefined;
    });
    this.flushing = completion;
    return completion;
  }

  private fileFor(day: string): string {
    return join(this.options.dir, `${this.options.prefix}-${day}.jsonl`);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch(() => undefined); // drain() counts its own failures
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  private takeByDay(): Map<string, string> {
    const byDay = new Map<string, string>();
    for (const { day, line } of this.queue) byDay.set(day, (byDay.get(day) ?? '') + line);
    this.queue = [];
    this.queuedBytes = 0;
    return byDay;
  }

  private async prune(): Promise<void> {
    const day = utcDay(this.now());
    if (this.prunedDay === day) return;
    const cutoff = utcDay(this.now() - this.retentionDays * 86_400_000);
    const names = new RegExp(`^${this.options.prefix}-([0-9]{4}-[0-9]{2}-[0-9]{2})\\.jsonl$`);
    const entries = await opendir(this.options.dir);
    for await (const entry of entries) {
      const match = names.exec(entry.name);
      if (entry.isFile() && match && match[1]! < cutoff) {
        // No symlink traversal, no recursive removal, no match on foreign prefixes.
        await unlink(join(this.options.dir, entry.name));
      }
    }
    this.prunedDay = day;
  }

  private async drain(): Promise<void> {
    for (const [day, text] of this.takeByDay()) {
      try {
        const file = await open(
          this.fileFor(day),
          constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_NOFOLLOW |
            constants.O_NONBLOCK,
          0o600,
        );
        try {
          const metadata = await file.stat();
          if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('E_JOURNAL_FILE');
          const bytes = Buffer.from(text, 'utf8');
          const remaining = Math.max(0, this.maxFileBytes - metadata.size);
          // Only complete UTF-8 JSONL records fit; a restart re-reads the actual size.
          const end =
            bytes.length <= remaining
              ? bytes.length
              : remaining === 0
                ? 0
                : bytes.lastIndexOf(10, remaining - 1) + 1;
          const accepted = bytes.subarray(0, end);
          if (accepted.length) await file.writeFile(accepted);
          const written = countLines(accepted.toString('utf8'));
          this.stats_.written += written;
          this.stats_.dropped += countLines(text) - written;
        } finally {
          await file.close();
        }
      } catch {
        this.stats_.failed += countLines(text);
      }
    }
    try {
      await this.prune();
    } catch {
      const day = utcDay(this.now());
      if (this.pruneErrorDay !== day) {
        this.pruneErrorDay = day;
        process.stderr.write('{"kind":"privacy.retention_error","code":"E_JOURNAL_RETENTION"}\n');
      }
    }
  }
}

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
