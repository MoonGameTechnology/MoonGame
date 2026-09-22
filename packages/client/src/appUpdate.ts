/**
 * The page's half of the offline shell (CP2.2): install the worker, and offer an update
 * instead of performing one.
 *
 * An installed Service Worker keeps serving the build it was installed with until it is
 * replaced, and replacing it under a running page swaps the files beneath code that is
 * already executing. So the worker never calls `skipWaiting()` by itself (`sw.ts`);
 * it waits, this module notices it waiting, and the player is the one who says when —
 * which is the "controlled update" the brick asks for. Mid-match that matters: the swap
 * costs a reload, and a reload in the middle of a fleet order is a lost order.
 *
 * Two things the wiring must not get wrong, both invisible until they bite:
 *
 * 1. **The very first install offers nothing.** There is no older version to replace,
 *    and the page is working fine. An "update available" banner on a player's first
 *    ever visit is a bug that reads as one.
 * 2. **Only a page that WAS controlled reloads.** `clients.claim()` fires a controller
 *    change on that first install too; reloading on it would make every first visit
 *    flash and reload for no reason.
 *
 * Effects are injected for the same reason as in `session.ts`: the gate has no browser.
 */

/** The slice of `ServiceWorker` this module touches. */
export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', cb: () => void): void;
}

/** The slice of `ServiceWorkerRegistration` this module touches. */
export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', cb: () => void): void;
}

export interface UpdateIo {
  /** Resolves to `null` when the browser has no Service Workers (or refuses this one). */
  register(url: string): Promise<RegistrationLike | null>;
  /** Is a worker already driving this page? */
  controlled(): boolean;
  onControllerChange(cb: () => void): void;
  reload(): void;
}

/** Where the worker is served from. Relative on purpose: the build is `--base=./`, so
 *  the app must survive being hosted under a sub-path, and the scope follows the file. */
export const SW_URL = './sw.js';

/**
 * Register the worker and call `onReady` once a NEW build is installed and waiting.
 * `onReady` receives the trigger that applies it; the page reloads on its own once the
 * new worker takes over.
 */
export async function watchForUpdate(
  io: UpdateIo,
  onReady: (apply: () => void) => void,
): Promise<void> {
  const wasControlled = io.controlled();
  let reloading = false;
  io.onControllerChange(() => {
    if (!wasControlled || reloading) return;
    reloading = true;
    io.reload();
  });

  // A failed registration is not an error the player can act on — the app simply runs
  // online-only, exactly as it did before this brick.
  const reg = await io.register(SW_URL).catch(() => null);
  if (!reg) return;

  const offer = (worker: WorkerLike | null): void => {
    if (!worker || !wasControlled) return;
    onReady(() => worker.postMessage({ type: 'skip-waiting' }));
  };

  offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });
}

/** The real browser effects. `null` registration when the API is absent — an http://
 *  origin that is not localhost, an old browser, or a locked-down profile. */
export function browserUpdateIo(): UpdateIo {
  const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  return {
    register: async (url) =>
      container ? ((await container.register(url)) as unknown as RegistrationLike) : null,
    controlled: () => Boolean(container?.controller),
    onControllerChange: (cb) => container?.addEventListener('controllerchange', cb),
    reload: () => location.reload(),
  };
}
