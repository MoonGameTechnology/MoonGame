/**
 * The client-side build-queue vocabulary (REFM-4).
 *
 * These types describe how the PROTOTYPE talks about construction orders: the two
 * lanes a world builds in parallel (buildings / units), the queued orders waiting
 * behind the active one, and the shape `main.ts` reads back off a scheduled
 * `construction.complete` event. They lived inside `main.ts` until the dossier
 * module needed the same words; a shared home keeps one truth instead of two
 * structurally-identical declarations drifting apart.
 *
 * Types only — the queue itself (`buildQueues`) stays the host's live state.
 */

/** A world builds in two parallel lanes; each has its own active order + queue. */
export type BuildLane = 'buildings' | 'units';

/** What an order does: raise a new building, level an existing one, or train units. */
export type BuildKind = 'building' | 'upgrade' | 'unit';

/** One order waiting in a lane (`count` > 1 only for units). */
export interface QueuedBuild {
  kind: BuildKind;
  id: string;
  count: number;
}

/** Both lanes of one world's queue. */
export interface PlanetBuildQueue {
  buildings: QueuedBuild[];
  units: QueuedBuild[];
}

/** The payload of a scheduled `construction.complete` event, as the UI reads it —
 *  every field optional because it arrives from state, not from a typed builder. */
export interface ConstructionPayload {
  kind?: 'building' | 'unit' | 'upgrade';
  planetId?: string;
  building?: string;
  unit?: string;
  count?: number;
  level?: number;
}

/** The order currently running in a lane: when it lands, its scheduling seq, payload. */
export interface ActiveBuild {
  at: number;
  seq: number;
  payload: ConstructionPayload;
}
