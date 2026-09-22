/**
 * The last known world, kept across launches (CP2.3 — docs/cross-platform-roadmap.md).
 *
 * CP2.2 made the SHELL start instantly offline; this makes the shell have something to
 * show. Without it an offline launch is an empty map and a spinner, and even online the
 * first paint waits for a full `welcome` snapshot to cross the network — on a phone that
 * is the difference between "the game is up" and "the game is loading".
 *
 * **What is stored is a PICTURE, never an authority.** The cached state is drawn and
 * then replaced wholesale by the first server snapshot; nothing is ever simulated from
 * it and no order is ever built on it. That is not a nicety — the client sends intent
 * and never state (invariant #5), and a cache that fed the reducer would be a client
 * inventing a world.
 *
 * **No credentials are stored.** The dial URL carries a join token or a seat ticket
 * (`decisions/netDial.ts`), and neither belongs in a cache: the token is minted per
 * match and would be expired by the time anyone read it back, and the ticket is the key
 * to a seat. Only `base` + `matchId` are kept — enough to recognise the match the player
 * is dialling, useless to anyone who reads the store.
 *
 * **When the cache is refused** it degrades to "no instant paint", never to a crash —
 * so every path here is guarded and a blocked store (private mode, cleared site data,
 * an old browser) simply behaves as an empty one, exactly as `session.ts` treats
 * localStorage.
 */
import {
  hashGameDataBundle,
  type GameData,
  type GameState,
  type PlayerId,
} from '@void/shared-core';

/** One remembered world. JSON-serialisable end to end — it goes through structured
 *  clone into IndexedDB, and `GameState` is already required to survive JSONB. */
export interface CachedWorld {
  matchId: string;
  /** The socket origin the match lives on (`wss://host`) — no path, no query, no secret. */
  base: string;
  playerId?: PlayerId;
  /** Server sequence this picture was taken at. Kept for diagnostics: the catch-up is a
   *  full `welcome`, so nothing here is ever replayed forward from it. */
  seq: number;
  state: GameState;
  remembered?: readonly string[];
}

/** The slice of persistence this module needs. Injected so the rules can be tested
 *  without a browser — IndexedDB has no Node implementation the gate could use. */
export interface SnapshotStore {
  read(): Promise<CachedWorld | null>;
  write(world: CachedWorld): Promise<void>;
  clear(): Promise<void>;
}

/**
 * May this build DRAW that world?
 *
 * Mirrors what the server does when it resumes a persisted match (MP-4,
 * `GameVersion.dataHash`): re-hash the currently deployed bundle and refuse on a
 * mismatch, because swapped content means swapped rules. The client needs it for a
 * smaller but real reason — the renderer and the HUD models resolve unit, building and
 * planet ids against the SHIPPED catalogue, so a world built from different content
 * draws with holes.
 *
 * One deliberate difference from the server: a state with NO `dataHash` is refused here,
 * while the core accepts it and skips the check. The core is being kind to matches
 * persisted before the field existed — refusing those would lose a live game. A cache
 * has nothing to lose: the cost of refusing is one missing instant paint, so the
 * fail-secure reading wins (invariant #4).
 */
export function isRestorable(
  world: CachedWorld | null,
  data: GameData,
  matchId?: string,
): world is CachedWorld {
  if (world === null) return false;
  if (matchId !== undefined && world.matchId !== matchId) return false;
  const version = world.state.version;
  if (version.data !== data.version) return false;
  return version.dataHash === hashGameDataBundle(data);
}

const DB_NAME = 'void-client';
const STORE_NAME = 'world';
/** One record: the world the player was last looking at. A per-match history would
 *  grow without bound for a gain nobody asked for — you resume the match you left. */
const KEY = 'last';

/** A store that remembers nothing. What every guard below falls back to. */
const NO_STORE: SnapshotStore = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null); // storage blocked outright
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A request that never settles (a blocked upgrade from another tab) would hang the
    // first paint, and the first paint is the entire point of this module.
    request.onblocked = () => resolve(null);
  });
}

/** Run one transaction, resolving to `fallback` on any refusal. */
function inStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (db === null) {
          resolve(fallback);
          return;
        }
        try {
          const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
          request.onsuccess = () => resolve((request.result as T) ?? fallback);
          request.onerror = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      }),
  );
}

/** The real browser store. Falls back to {@link NO_STORE} where IndexedDB is absent. */
export function indexedDbStore(): SnapshotStore {
  if (typeof indexedDB === 'undefined') return NO_STORE;
  return {
    read: () => inStore<CachedWorld | null>('readonly', (s) => s.get(KEY), null),
    write: (world) =>
      inStore('readwrite', (s) => s.put(world, KEY), undefined).then(() => undefined),
    clear: () => inStore('readwrite', (s) => s.delete(KEY), undefined).then(() => undefined),
  };
}

/**
 * A writer that keeps up with the match instead of queueing behind it.
 *
 * Snapshots arrive as fast as the world turns, and each one is the whole state. Awaiting
 * every write would pile transactions up behind the slowest one, on the thread that
 * draws the map. So: one write in flight, and only the NEWEST world waits — an
 * intermediate picture that was superseded before it reached disk was never worth
 * writing. The only record that matters is the last one.
 */
export function rememberLatest(store: SnapshotStore): (world: CachedWorld) => void {
  let pending: CachedWorld | null = null;
  let writing = false;
  const flush = (): void => {
    if (writing || pending === null) return;
    const world = pending;
    pending = null;
    writing = true;
    void store
      .write(world)
      .catch(() => undefined)
      .then(() => {
        writing = false;
        flush();
      });
  };
  return (world) => {
    pending = world;
    flush();
  };
}
