/**
 * The main-game economy session, without a screen: read `/meta-economy/me` + the store's
 * offers, and send one command at a time. Two screens draw it — «Снабжение» (materials,
 * season, store) and «Арсенал» (the workshop: craft, goal, salvage) — each with its own
 * instance, so neither owns the other's buttons.
 *
 * The rules came with it unchanged from the supply screen, where they were first written:
 * - nothing is cached in the browser; every view is the server's;
 * - a write retries under the SAME request id until the server confirms it, so an
 *   ambiguous failure (committed, then disconnected) is never applied twice;
 * - a write sent for one account never runs for another: a switched session drops the
 *   view and every pending request id;
 * - a confirmed write drops the view before re-reading it, so a failed re-read leaves
 *   no stale controls behind;
 * - a response the screen cannot draw never replaces a valid view (`accept` throws).
 */
import type { CommerceOffer } from '../../packages/protocol/src/commerce';
import type { MetaEconomyView } from '../../packages/protocol/src/metaEconomyView';
import { hasKey } from '../../localization/runtime';
import { refusalKeyOf } from '../../decisions/refusalText';

export interface MetaSession {
  base: string;
  token: string;
}

/** What the last read or write ended with — each screen words it its own way. */
export type MetaEconomyStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** No session: the screen shows its sign-in state. */
  | { kind: 'guest' }
  /** The read failed; there is no view. */
  | { kind: 'unavailable' }
  | { kind: 'pending' }
  /** A write was confirmed and re-read; `key` is the success text the caller asked for. */
  | { kind: 'done'; key: string | null }
  /** A write failed: `key` is the localized refusal when one exists. */
  | { kind: 'failed'; key: string | null };

export interface MetaEconomyClientHost {
  authorizedBase(): Promise<MetaSession | null>;
  /** Called at every state change: the screen repaints from the client's getters. */
  paint(): void;
  /** Draw the response before it is accepted; a throw keeps the previous state. */
  accept?(view: MetaEconomyView, offers: readonly CommerceOffer[]): void;
  /** After a confirmed write and its re-read (refresh what depends on the account). */
  changed?(): Promise<void>;
  requestId?(): string;
}

export interface MetaEconomyClient {
  view(): MetaEconomyView | null;
  offers(): readonly CommerceOffer[];
  busy(): boolean;
  status(): MetaEconomyStatus;
  refresh(): Promise<void>;
  mutate(path: string, body: Record<string, unknown>, successKey?: string): Promise<void>;
}

const sameSession = (a: MetaSession | null, b: MetaSession | null): boolean =>
  a?.base === b?.base && a?.token === b?.token;

export function createMetaEconomyClient(host: MetaEconomyClientHost): MetaEconomyClient {
  let view: MetaEconomyView | null = null;
  let offers: CommerceOffer[] = [];
  let session: MetaSession | null = null;
  let generation = 0;
  let busy = false;
  let status: MetaEconomyStatus = { kind: 'idle' };
  const attempts = new Map<string, string>();

  const json = async (auth: MetaSession, path: string, body?: object): Promise<unknown> => {
    const res = await fetch(auth.base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${auth.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value: unknown = await res.json();
    if (!res.ok || (typeof value === 'object' && value && 'ok' in value && value.ok === false)) {
      const failure = value as { error?: unknown; code?: unknown } | null;
      const code = failure?.error ?? failure?.code;
      throw new Error(typeof code === 'string' && /^E_[A-Z_]+$/.test(code) ? code : 'E_NETWORK');
    }
    return value;
  };

  const load = async (auth: MetaSession, current: number): Promise<void> => {
    const [raw, commerce] = await Promise.all([
      json(auth, '/meta-economy/me'),
      json(auth, '/commerce/offers').catch(() => ({ offers: [] })),
    ]);
    if (current !== generation) return;
    if (!sameSession(auth, await host.authorizedBase())) {
      view = null;
      attempts.clear();
      throw new Error('E_AUTH');
    }
    const next = raw as MetaEconomyView;
    if (
      !next ||
      !Array.isArray(next.materials) ||
      !Array.isArray(next.recipes) ||
      !Array.isArray(next.items) ||
      !Array.isArray(next.salvageableItemIds) ||
      !Array.isArray(next.seasons)
    )
      throw new Error('E_NETWORK');
    const nextOffers = (commerce as { offers?: CommerceOffer[] } | null)?.offers;
    const safeOffers = Array.isArray(nextOffers) ? nextOffers : [];
    host.accept?.(next, safeOffers);
    view = next;
    offers = safeOffers;
  };

  const refresh = async (): Promise<void> => {
    if (busy) return;
    const current = ++generation;
    busy = true;
    view = null;
    status = { kind: 'loading' };
    host.paint();
    try {
      const auth = await host.authorizedBase();
      if (!sameSession(session, auth)) attempts.clear();
      session = auth;
      if (!auth) {
        status = { kind: 'guest' };
        return;
      }
      await load(auth, current);
      status = { kind: 'idle' };
    } catch {
      status = { kind: 'unavailable' };
    } finally {
      if (current === generation) {
        busy = false;
        host.paint();
      }
    }
  };

  const mutate = async (
    path: string,
    body: Record<string, unknown>,
    successKey?: string,
  ): Promise<void> => {
    if (busy || !view) return;
    busy = true;
    status = { kind: 'pending' };
    host.paint();
    try {
      const auth = await host.authorizedBase();
      if (!auth || !sameSession(auth, session)) {
        view = null;
        attempts.clear();
        status = { kind: 'guest' };
        return;
      }
      const key = path + JSON.stringify(body);
      const requestId = attempts.get(key) ?? host.requestId?.() ?? crypto.randomUUID();
      attempts.set(key, requestId);
      const response = (await json(auth, path, { ...body, requestId })) as { ok?: boolean } | null;
      if (response?.ok !== true) throw new Error('E_NETWORK');
      attempts.delete(key);
      view = null; // A confirmed write must never leave stale controls after a failed refresh.
      await load(auth, generation);
      status = { kind: 'done', key: successKey ?? null };
      await host.changed?.().catch(() => undefined);
    } catch (e) {
      const key = refusalKeyOf(e instanceof Error ? e.message : 'E_NETWORK');
      status = { kind: 'failed', key: hasKey(key) ? key : null };
    } finally {
      busy = false;
      host.paint();
    }
  };

  return {
    view: () => view,
    offers: () => offers,
    busy: () => busy,
    status: () => status,
    refresh,
    mutate,
  };
}
