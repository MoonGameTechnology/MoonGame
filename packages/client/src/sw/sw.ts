/**
 * The Service Worker itself (CP2.2) — wiring, and nothing else. Every rule it follows
 * lives in `strategy.ts` and `swCore.ts`, where the gate can reach it; this file exists
 * to hand the worker's globals to those and to answer the update message.
 *
 * It is built separately from the app (see `voidServiceWorker` in `vite.config.ts`) and
 * emitted as `dist/sw.js` under a FIXED name: the browser identifies a worker by its
 * URL, so a hashed name would register a second worker on every deploy instead of
 * updating the one that is installed. The three `__VOID_*` constants are injected by
 * that same plugin — the file list only exists once the build has run.
 *
 * The Service Worker globals are declared here rather than pulled in from TypeScript's
 * `WebWorker` lib: that lib redeclares several hundred names this package already gets
 * from `DOM`, and switching the whole package over for one file is not a trade worth
 * making. Only what this file touches is described.
 */
import { activateShell, installShell, respond, shellStrategy, type ShellDeps } from './swCore';

/** Injected by the build — see `vite.config.ts`. */
declare const __VOID_BUILD__: string;
declare const __VOID_PRECACHE__: readonly string[];
declare const __VOID_CACHEABLE__: readonly string[];

interface ExtendableEventLike {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface MessageEventLike {
  readonly data: unknown;
}
interface WorkerScope {
  readonly registration: { readonly scope: string };
  readonly clients: { claim(): Promise<void> };
  readonly caches: ShellDeps['caches'];
  fetch(req: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', cb: (e: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', cb: (e: FetchEventLike) => void): void;
  addEventListener(type: 'message', cb: (e: MessageEventLike) => void): void;
}

const sw = self as unknown as WorkerScope;

const deps: ShellDeps = {
  caches: sw.caches,
  fetch: (req) => sw.fetch(req),
  scope: sw.registration.scope,
  build: __VOID_BUILD__,
  precache: __VOID_PRECACHE__,
  cacheable: __VOID_CACHEABLE__,
};

sw.addEventListener('install', (e) => {
  // No `skipWaiting()` here on purpose: an update must not swap the files under a page
  // that is already running on the old ones. The page asks for the swap when the player
  // agrees to it (`appUpdate.ts`), which is what "controlled update" means in CP2.2.
  e.waitUntil(installShell(deps));
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(activateShell(deps).then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (e) => {
  const strategy = shellStrategy(deps, e.request);
  if (strategy === 'bypass') return; // untouched: the browser fetches it as if no worker existed
  e.respondWith(respond(deps, e.request, strategy));
});

sw.addEventListener('message', (e) => {
  const type = (e.data as { type?: unknown } | null)?.type;
  if (type === 'skip-waiting') void sw.skipWaiting();
});
