import type { PushStore, PushSubscriptionRecord } from './store';
import type { RoomObservation } from './matchRoom';
import type { SendPushResult } from './push';
import {
  groupedPush,
  KIND_OF,
  pushNotices,
  type PushNotice,
  type PushNoticePayload,
} from './pushRule';

/**
 * UIX-4.3 · the trigger side of Web Push: reads each room's observation stream and sends
 * the push `pushRule.ts` decides on. It never feeds back into a room.
 *
 * - **Only to who is away.** A seat with a live connection sees the news on screen; a
 *   push on top would be the same news twice. Connections are counted per seat (`join`
 *   +1, `leave` −1), so a second tab closing does not mark the player away.
 * - **Only to an account.** The seat → account link comes from the `join` the handshake
 *   proved; nick-mode seats and bots have no account and get nothing.
 * - **Only the kinds the player allowed** (`kinds` on the subscription, UIX-4.4).
 * - **A dead endpoint is dropped** (`gone`), the same as the explicit unsubscribe.
 *
 * Sends are fire-and-forget: a slow push service never holds a room's event loop.
 */
export interface PushDispatchDeps {
  store: Pick<PushStore, 'of' | 'remove'>;
  send: (sub: PushSubscriptionRecord, payload: PushNoticePayload) => Promise<SendPushResult>;
  /** Failure reporter (stderr in the host). */
  onError?: (message: string) => void;
}

interface MatchSeats {
  account: Map<string, string>;
  online: Map<string, number>;
}

export function createPushDispatcher(
  deps: PushDispatchDeps,
): (matchId: string, event: RoomObservation) => void {
  const matches = new Map<string, MatchSeats>();
  const seatsOf = (matchId: string): MatchSeats => {
    let m = matches.get(matchId);
    if (!m) matches.set(matchId, (m = { account: new Map(), online: new Map() }));
    return m;
  };
  const deliver = async (
    accountId: string,
    matchId: string,
    notices: readonly PushNotice[],
  ): Promise<void> => {
    const sub = await deps.store.of(accountId);
    if (!sub) return;
    // The player's switches (UIX-4.4): a browser must show every push it gets, so a kind
    // they turned off is dropped here, before grouping — `more` counts only what is allowed.
    const allowed = sub.kinds
      ? notices.filter((n) => sub.kinds!.includes(KIND_OF[n.key]))
      : notices;
    const payload = groupedPush(allowed, matchId);
    if (!payload) return;
    const r = await deps.send(sub, payload);
    if (!r.ok && r.gone) await deps.store.remove(accountId);
  };
  return (matchId, event) => {
    if (event.kind === 'join') {
      const m = seatsOf(matchId);
      if (event.accountId) m.account.set(event.playerId, event.accountId);
      m.online.set(event.playerId, (m.online.get(event.playerId) ?? 0) + 1);
      return;
    }
    if (event.kind === 'leave') {
      const m = seatsOf(matchId);
      m.online.set(event.playerId, Math.max(0, (m.online.get(event.playerId) ?? 0) - 1));
      return;
    }
    if (event.kind === 'end') {
      matches.delete(matchId);
      return;
    }
    if (event.kind !== 'events') return;
    const m = matches.get(matchId);
    if (!m) return;
    for (const [seat, accountId] of m.account) {
      if ((m.online.get(seat) ?? 0) > 0) continue;
      const notices = pushNotices(event.events, seat);
      if (notices.length === 0) continue;
      void deliver(accountId, matchId, notices).catch((err: unknown) =>
        deps.onError?.(
          `push to ${accountId} failed — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  };
}
