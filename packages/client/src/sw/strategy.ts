/**
 * Which requests the offline shell handles, and how (CP2.2).
 *
 * The rule is DEFAULT-DENY, and that is the whole design: a same-origin request the
 * worker does not recognise as a file of this build is passed straight to the network,
 * untouched and uncached. The alternative — listing the server's routes here so they
 * can be excluded — would mean a second copy of a route table that already has fifty
 * entries and grows every week; the first route someone forgot to add would be a
 * player served yesterday's match list out of a cache. Fail-secure (invariant #4) reads
 * the same way here as it does in the reducer: the unknown case refuses, it does not pass.
 *
 * So there are exactly three answers:
 *
 *   `bypass` — the worker does not intercept at all. Anything not a GET (every write
 *              the client makes), anything off this scope (the game server is usually
 *              a different origin — `decisions/serverAddress.ts`), and every same-origin
 *              path that is not a file this build emitted. Sockets never reach a fetch
 *              handler in the first place, so live match traffic is out of reach by
 *              construction, not by rule.
 *   `shell`  — a navigation. NETWORK-FIRST, falling back to the cached document: a new
 *              build must be able to reach a client that already has one installed, and
 *              a cache-first document is exactly the soft-lock CP2.5 has to avoid.
 *   `asset`  — a file of this build. CACHE-FIRST, because the name carries a hash of
 *              the contents (`main-BpldJrhO.js`), so a cached copy can never be the
 *              wrong one. This is what makes the second start instant, online or off.
 */

export type Strategy = 'bypass' | 'shell' | 'asset';

/** The part of a `Request` the decision reads. */
export interface RequestFacts {
  /** `GET`, `POST`, … */
  method: string;
  /** `Request.mode` — `navigate` marks a document load. */
  mode: string;
  /** Absolute request URL. */
  url: string;
}

export interface ShellScope {
  /** The worker's registration scope, absolute and ending in `/`. */
  scope: string;
  /** Paths of this build, relative to the scope (`precache.ts` → `cacheablePaths`). */
  cacheable: readonly string[];
}

/**
 * The request's path relative to the scope, or `null` when it is outside it (another
 * origin, or a path above the scope). Query and hash are dropped: they address the
 * same file, and `?join=…` deep links would otherwise each look like a new asset.
 */
export function scopePath(url: string, scope: string): string | null {
  let target: URL;
  let root: URL;
  try {
    target = new URL(url);
    root = new URL(scope);
  } catch {
    return null;
  }
  if (target.origin !== root.origin) return null;
  if (!target.pathname.startsWith(root.pathname)) return null;
  return target.pathname.slice(root.pathname.length);
}

export function strategyFor(req: RequestFacts, o: ShellScope): Strategy {
  if (req.method !== 'GET') return 'bypass';
  const path = scopePath(req.url, o.scope);
  if (path === null) return 'bypass';
  if (req.mode === 'navigate') return 'shell';
  return o.cacheable.includes(path) ? 'asset' : 'bypass';
}
