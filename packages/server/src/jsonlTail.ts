import { open } from 'node:fs/promises';

/** Strict decimal count: no negative, fractional, repeated or coercible input. */
export function tailCount(value: unknown): number | null {
  if (value === undefined) return 20;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const n = Number(value);
  return n <= 200 ? n : null;
}

/** Read at most 1 MiB, asynchronously. Discard a leading partial line and a torn
 * final record. `total` describes the inspected window, never the entire journal. */
export async function jsonlTail(file: string, n: number): Promise<{
  total: number; recent: unknown[]; truncated: boolean;
}> {
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('E_BAD_REQUEST');
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - 1024 * 1024);
    const buffer = Buffer.alloc(size - start);
    let read = 0;
    while (read < buffer.length) {
      const part = await handle.read(buffer, read, buffer.length - read, start + read);
      if (part.bytesRead === 0) break;
      read += part.bytesRead;
    }
    let text = buffer.subarray(0, read).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    const end = text.lastIndexOf('\n');
    const lines = end < 0 ? [] : text.slice(0, end).split('\n').filter(Boolean);
    const recent = lines.slice(-n).flatMap((line) => {
      try { return [JSON.parse(line) as unknown]; } catch { return []; }
    });
    return { total: lines.length, recent, truncated: start > 0 };
  } finally {
    await handle.close();
  }
}
