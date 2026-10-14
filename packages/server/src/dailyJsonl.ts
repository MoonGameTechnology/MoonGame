// PTM-0.1 (docs/playtest-telemetry-roadmap.md): an append-only JSONL journal split by
// UTC day, written OFF the hot path. A room's `observe` callback used to call
// `appendFileSync` itself — a synchronous disk write inside the action/broadcast path.
// Here `write` only queues a line; a flush appends the queue asynchronously. The queue
// is bounded: past `maxQueued` a line is DROPPED and counted, never blocks and never
// throws — telemetry losing a line is acceptable, a room stalling on a slow disk is not.
// Pure observation: nothing here feeds back into any room.

import { mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
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
  /** Delay before a scheduled flush (ms). 0 ⇒ next macrotask. */
  flushDelayMs?: number;
  now?: () => number;
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
  private readonly flushDelayMs: number;
  private readonly now: () => number;

  constructor(private readonly options: DailyJsonlOptions) {
    this.maxQueued = options.maxQueued ?? 10_000;
    this.flushDelayMs = options.flushDelayMs ?? 250;
    this.now = options.now ?? Date.now;
    mkdirSync(options.dir, { recursive: true });
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
    try {
      line = JSON.stringify({ t: this.now(), ...record }) + '\n';
    } catch {
      this.stats_.failed++;
      return;
    }
    const t = typeof record.t === 'number' ? record.t : this.now();
    this.queue.push({ day: utcDay(t), line });
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
    this.flushing = run.finally(() => {
      if (this.flushing === run) this.flushing = undefined;
    });
    return run;
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
    return byDay;
  }

  private async drain(): Promise<void> {
    for (const [day, text] of this.takeByDay()) {
      try {
        await appendFile(this.fileFor(day), text);
        this.stats_.written += countLines(text);
      } catch {
        this.stats_.failed += countLines(text);
      }
    }
  }
}

function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
