/**
 * The offline shell's behaviour (CP2.2), written against INJECTED effects so it can be
 * tested without a browser — the same split `session.ts` uses for the HTTP half, and for
 * the same reason: a Service Worker is otherwise reachable only from a real browser
 * serving a real build over a real network, which is not a thing the gate can do.
 *
 * `strategy.ts` decides WHAT to do with a request; this file does it. The one rule worth
 * repeating here is the cache name: it carries the build id, so an update installs into a
 * cache of its own and `activateShell` drops every older one. Nothing ever mixes files
 * from two builds — the failure mode that makes hand-rolled caching notorious.
 */
import { strategyFor, type Strategy } from './strategy';

/** Caches this worker owns. Anything else in `caches` belongs to someone else. */
export const CACHE_PREFIX = 'void-shell-';

/** The slice of `Cache` used here. */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  addAll(requests: string[]): Promise<void>;
}

/** The slice of `CacheStorage` used here. */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface ShellDeps {
  caches: CacheStorageLike;
  fetch: (req: Request) => Promise<Response>;
  /** Registration scope: absolute, ends with `/`. Every path is resolved against it. */
  scope: string;
  /** This build's id (`precache.ts` → `buildId`) — the cache is named after it. */
  build: string;
  /** Downloaded at install time. */
  precache: readonly string[];
  /** May be cached on demand. */
  cacheable: readonly string[];
}

const cacheName = (build: string): string => CACHE_PREFIX + build;

/**
 * Where the document lives in the cache. ONE entry, not one per visited URL: `/`,
 * `/?join=<ws url>` and any future deep link are the same shell, and keying them apart
 * would mean the first offline start after a deep link found nothing.
 */
export const shellKey = (scope: string): string => new URL('index.html', scope).href;

/** Fill this build's cache. Rejecting here aborts the install — a half-filled shell
 *  never becomes the active worker. */
export async function installShell(d: ShellDeps): Promise<void> {
  const cache = await d.caches.open(cacheName(d.build));
  await cache.addAll(d.precache.map((p) => new URL(p, d.scope).href));
}

/** Drop the caches of previous builds. Only ours — the prefix is the ownership mark. */
export async function activateShell(d: ShellDeps): Promise<void> {
  const keep = cacheName(d.build);
  const names = await d.caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== keep).map((n) => d.caches.delete(n)),
  );
}

/** The synchronous half: a `fetch` listener must decide whether to answer before it
 *  awaits anything, so the strategy is picked from the request alone. */
export function shellStrategy(d: ShellDeps, req: Request): Strategy {
  return strategyFor(
    { method: req.method, mode: req.mode, url: req.url },
    { scope: d.scope, cacheable: d.cacheable },
  );
}

/**
 * Answer a request the strategy claimed. Throws what the network threw when there is
 * nothing cached to fall back on — the browser then shows its own offline page, which
 * is honest, rather than a blank one from a worker that swallowed the failure.
 */
export async function respond(
  d: ShellDeps,
  req: Request,
  strategy: Exclude<Strategy, 'bypass'>,
): Promise<Response> {
  const cache = await d.caches.open(cacheName(d.build));
  if (strategy === 'asset') {
    const hit = await cache.match(req.url);
    if (hit) return hit;
    const res = await d.fetch(req);
    // A 404/500 is an answer, not a file: caching it would freeze the mistake in place.
    if (res.ok) await cache.put(req.url, res.clone());
    return res;
  }
  try {
    const res = await d.fetch(req);
    if (res.ok) await cache.put(shellKey(d.scope), res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(shellKey(d.scope));
    if (hit) return hit;
    throw err;
  }
}
