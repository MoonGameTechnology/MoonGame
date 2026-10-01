import type { GameState } from './gameState';

/**
 * Canonical, deterministic digest of ANY JSON-serializable value — order-
 * independent (object keys are sorted, so two logically-equal values with
 * differently-ordered keys hash the same), pure, and platform-stable (no
 * `Date`, no `Math.random`, no Node built-ins, only integer ops — identical
 * on the server and in the browser). Not cryptographic; it is a fingerprint
 * for detecting divergence/tampering, not a security signature.
 */
export function hashJson(value: unknown): string {
  return new CanonicalHash(value).step(Infinity) as string;
}

/**
 * {@link hashJson} in slices, for a caller that must not stall: `step(budget)` walks at
 * most `budget` more values (array items and object entries) and returns the digest
 * once the walk is over, `null` until then. The digest is exactly `hashJson(value)`.
 * The value must not change before the digest is out — a `GameState` never does: every
 * change produces a new object.
 */
export interface HashJob {
  step(budget: number): string | null;
}

export function hashJsonJob(value: unknown): HashJob {
  return new CanonicalHash(value);
}

/**
 * Canonical, deterministic digest of a {@link GameState} — the primitive for
 * desync detection: the server and a client compare `hashState(...)`, and a
 * mismatch means their worlds diverged (force a full resync + alert). This makes
 * "determinism" verifiable instead of assumed (CR-0.3 / sprint-1.md S1.6).
 *
 * It is **not** cryptographic. Two states that are *logically* equal must hash
 * equally even if their object keys were inserted in different orders — e.g. the
 * server holds a state built by `applyAction`, while the client rebuilt the same
 * state by `applyDelta`, which need not preserve key order. So keys are sorted
 * before hashing. Array order is preserved (it is semantically meaningful in the
 * state: schedule order, garrison stacks, lanes, …).
 */
export function hashState(state: GameState): string {
  return hashJson(state);
}

/** {@link hashState} in slices ({@link hashJsonJob}). */
export function hashStateJob(state: GameState): HashJob {
  return hashJsonJob(state);
}

/**
 * Order-independent serialization, fed straight into the digest — the text itself is
 * never built (a whole world as one string cost tens of milliseconds and as much
 * garbage): object keys are sorted and `undefined`-valued keys are dropped (matching
 * JSON / deep-equal semantics, so `{a:undefined}` and `{}` serialize alike); arrays keep
 * their order; strings are JSON-escaped; numbers and booleans read as `String(value)`;
 * anything else (undefined in an array, a function) reads as `null`.
 *
 * The digest is cyrb53 — a compact, well-distributed 53-bit non-cryptographic hash. Two
 * 32-bit lanes mixed per UTF-16 code unit of that text, then avalanched. Uses only
 * `Math.imul` and uint32 ops, so it is bit-for-bit identical across JS engines. Returns
 * a fixed 14-char hex string. If the serialization or the algorithm ever changes, the
 * golden test fails (it invalidates any cross-version hash comparison) — change
 * deliberately.
 */
class CanonicalHash implements HashJob {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;
  private started = false;
  private digest: string | null = null;
  // Open containers, innermost last: the container, its sorted keys (`null` for an
  // array) and the index of its next item.
  private readonly open: unknown[] = [];
  private readonly keys: (string[] | null)[] = [];
  private readonly next: number[] = [];

  constructor(private readonly root: unknown) {}

  step(budget: number): string | null {
    if (this.digest !== null) return this.digest;
    if (!this.started) {
      this.started = true;
      this.visit(this.root);
    }
    const { open, keys, next } = this;
    for (; budget > 0 && open.length > 0; budget--) {
      const top = open.length - 1;
      const i = next[top] as number;
      const sorted = keys[top] as string[] | null;
      const size = sorted === null ? (open[top] as unknown[]).length : sorted.length;
      if (i >= size) {
        this.char(sorted === null ? 93 : 125); // ] }
        open.pop();
        keys.pop();
        next.pop();
        continue;
      }
      next[top] = i + 1;
      if (i > 0) this.char(44); // ,
      if (sorted === null) {
        this.visit((open[top] as unknown[])[i]);
      } else {
        const key = sorted[i] as string;
        this.quoted(key);
        this.char(58); // :
        this.visit((open[top] as Record<string, unknown>)[key]);
      }
    }
    if (open.length > 0) return null;
    this.digest = finish(this.h1, this.h2);
    return this.digest;
  }

  private visit(value: unknown): void {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      this.text(String(value));
    } else if (typeof value === 'string') {
      this.quoted(value);
    } else if (Array.isArray(value)) {
      this.char(91); // [
      this.open.push(value);
      this.keys.push(null);
      this.next.push(0);
    } else if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      this.char(123); // {
      this.open.push(obj);
      this.keys.push(Object.keys(obj).filter((k) => obj[k] !== undefined).sort());
      this.next.push(0);
    } else {
      // undefined / function / symbol — never part of a JSON-serializable GameState.
      this.text('null');
    }
  }

  private text(s: string): void {
    let h1 = this.h1;
    let h2 = this.h2;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    this.h1 = h1;
    this.h2 = h2;
  }

  /** `JSON.stringify(s)`, fed without building it when nothing needs escaping. */
  private quoted(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      // Quote, backslash, control characters and surrogates are escaped (or checked
      // for pairing) by JSON.stringify: let it spell those out.
      if (ch < 32 || ch === 34 || ch === 92 || (ch >= 0xd800 && ch <= 0xdfff)) {
        this.text(JSON.stringify(s));
        return;
      }
    }
    this.char(34);
    this.text(s);
    this.char(34);
  }

  private char(ch: number): void {
    this.h1 = Math.imul(this.h1 ^ ch, 2654435761);
    this.h2 = Math.imul(this.h2 ^ ch, 1597334677);
  }
}

function finish(a: number, b: number): string {
  let h1 = Math.imul(a ^ (a >>> 16), 2246822507);
  h1 ^= Math.imul(b ^ (b >>> 13), 3266489909);
  let h2 = Math.imul(b ^ (b >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}
