/**
 * Structural helpers for the immutable-state contract of the core.
 *
 * `GameState` is JSON-serializable by design (it is persisted as JSONB — see
 * docs/architecture.md §4.3), so a structural deep clone is sufficient and
 * fully deterministic. We deliberately avoid the `structuredClone` global,
 * which is not guaranteed on every target runtime (older Hermes on React
 * Native, for example).
 */

/** Marks a subtree {@link deepClone} may SHARE instead of copying (see {@link shareImmutable}). */
const SHARED = Symbol('void.shared');
type Marked = { [SHARED]?: true };

/**
 * Deep-clones a JSON-shaped value (primitives, plain objects, arrays). A subtree marked by
 * {@link shareImmutable} is handed back as is: it is frozen, so the copy could never differ.
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if ((value as Marked)[SHARED] === true) {
    return value;
  }
  if (Array.isArray(value)) {
    const src = value as unknown[];
    const out = new Array<unknown>(src.length);
    for (let i = 0; i < src.length; i++) {
      out[i] = deepClone(src[i]);
    }
    return out as unknown as T;
  }
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    out[key] = deepClone(src[key]);
  }
  return out as T;
}

/**
 * Structural equality over JSON-shaped values, mirroring `hashState`'s notion
 * of logical equality: object keys holding `undefined` count as absent (so
 * `{a: undefined}` equals `{}`), key ORDER is ignored, arrays compare by
 * position. Replaces `JSON.stringify(a) === JSON.stringify(b)` on hot paths —
 * it short-circuits on the first difference and allocates nothing.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  let yDefined = 0;
  for (const key of Object.keys(y)) {
    if (y[key] !== undefined) yDefined++;
  }
  let xDefined = 0;
  for (const key of Object.keys(x)) {
    if (x[key] === undefined) {
      continue; // JSON semantics: an undefined value = an absent key
    }
    xDefined++;
    // Own-key lookup so a key like `constructor` can never match via the prototype.
    const yValue = Object.prototype.hasOwnProperty.call(y, key) ? y[key] : undefined;
    if (!deepEqual(x[key], yValue)) {
      return false;
    }
  }
  return xDefined === yDefined; // no extra defined keys on the other side
}

/**
 * Freezes a JSON-shaped value deeply and marks it shareable: {@link deepClone} then hands
 * back the SAME object instead of copying it. Meant for data that never changes for the
 * whole match — the road network (ROADS-7). On the 831-province solo map it is about eleven
 * thousand small objects, and copying them on every kernel step made the step ~55% slower
 * (measured: a clone of 3.9 ms against 2.1 ms with the network shared).
 *
 * Sharing is safe precisely because the value is frozen: nothing can mutate it through the
 * draft, so the reducer still never mutates its input (invariant #2). The mark is a symbol —
 * invisible to `Object.keys`, `JSON.stringify` and `hashJson` — so the state stays
 * JSON-shaped and hashes the same. A JSON round trip drops it: the copy is plain again and
 * is cloned like everything else (slower, never wrong). A value someone froze WITHOUT the
 * mark (`deepFreeze` in the purity tests) stays unmarked and is still copied.
 */
export function shareImmutable<T>(value: T): T {
  if (value === null || typeof value !== 'object' || (value as Marked)[SHARED] === true) {
    return value;
  }
  for (const key of Object.keys(value)) {
    shareImmutable((value as Record<string, unknown>)[key]);
  }
  if (!Object.isFrozen(value)) {
    Object.defineProperty(value, SHARED, { value: true });
    Object.freeze(value);
  }
  return value;
}

/**
 * Recursively freezes an object graph. Used in tests to assert the reducer
 * never mutates its input, and available to callers that want a hard
 * immutability guarantee on a snapshot.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  Object.freeze(value);
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return value;
}
