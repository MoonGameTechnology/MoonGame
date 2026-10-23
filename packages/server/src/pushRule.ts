import type { DomainEvent } from '@void/shared-core';
import type { PushKind } from './store';

/**
 * UIX-4.3 · WHEN a push is worth sending, and what it carries. Pielot (2014): every
 * needless notification costs the player stress, so the rule only lets through what is
 * the player's OWN and URGENT:
 *
 * 1. **An attack on me** — a battle started where I am the defending side.
 * 2. **The end of my battle** — won or lost. A draw names neither side, so the event
 *    cannot tell whether I fought; it is left out rather than guessed.
 * 3. **My building finished** (built or upgraded) and **my research finished.**
 *
 * Everything else (arrivals, other players' wars, construction starts) stays in the
 * in-game log. A batch of events becomes ONE push: the most urgent item leads, the rest
 * is a number (`more`), so a busy hour never fires a burst. No quiet hours (owner's
 * decision 2026-10-20): the per-kind switches arrive with the client subscription
 * (UIX-4.4).
 *
 * **No prose here** (the CLAUDE.md trap for `packages/server`): the server has no
 * player locale. A push carries a localization KEY and raw ids; the client's service
 * worker (UIX-4.4) turns them into text in the player's own language.
 */

/** Localization keys the client resolves (`/localization`, UIX-4.4). */
export type PushKey =
  'push.attacked' | 'push.battle-won' | 'push.battle-lost' | 'push.built' | 'push.researched';

export interface PushNotice {
  key: PushKey;
  /** Raw ids only (planet, building, technology) — names are the client's job. */
  params: Record<string, string>;
  /** Map node to focus when the push is tapped. */
  anchor?: string;
}

export interface PushNoticePayload extends PushNotice {
  matchId: string;
  /** How many more notices this push stands for. */
  more: number;
}

/** Which settings switch governs a key (UIX-4.4): won and lost are one switch, «battles». */
export const KIND_OF: Record<PushKey, PushKind> = {
  'push.attacked': 'attacked',
  'push.battle-won': 'battle',
  'push.battle-lost': 'battle',
  'push.built': 'built',
  'push.researched': 'researched',
};

/** Lower is more urgent: an attack outranks a finished battle, which outranks economy. */
const RANK: Record<PushKey, number> = {
  'push.attacked': 0,
  'push.battle-lost': 1,
  'push.battle-won': 1,
  'push.built': 2,
  'push.researched': 2,
};

const rec = (p: unknown): Record<string, unknown> =>
  p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const has = (list: unknown, who: string): boolean => Array.isArray(list) && list.includes(who);

/** One event → the notice it means for `seat`, or `null` when it is not theirs or not urgent. */
function noticeOf(ev: DomainEvent, seat: string): PushNotice | null {
  const p = rec(ev.payload);
  if (ev.type === 'battle.started') {
    const at = str(p.location);
    if (p.defender !== seat || !at) return null; // rule 1
    return { key: 'push.attacked', params: { place: at }, anchor: at };
  }
  if (ev.type === 'battle.resolved') {
    const at = str(p.location);
    if (!at) return null;
    // rule 2: a draw has neither winners nor losers — it says nothing about me.
    const key = has(p.winners, seat)
      ? 'push.battle-won'
      : has(p.losers, seat)
        ? 'push.battle-lost'
        : null;
    return key ? { key, params: { place: at }, anchor: at } : null;
  }
  if (ev.type === 'building.constructed' || ev.type === 'building.upgraded') {
    const at = str(p.planetId);
    const building = str(p.building);
    if (p.owner !== seat || !at || !building) return null; // rule 3
    return { key: 'push.built', params: { place: at, building }, anchor: at };
  }
  if (ev.type === 'technology.researched') {
    const technology = str(p.technology);
    if (p.playerId !== seat || !technology) return null; // rule 3
    return { key: 'push.researched', params: { technology } };
  }
  return null;
}

/** The urgent, own notices a batch holds for `seat`, most urgent first (stable within a rank). */
export function pushNotices(events: readonly DomainEvent[], seat: string): PushNotice[] {
  return events
    .map((ev, i) => ({ n: noticeOf(ev, seat), i }))
    .filter((x): x is { n: PushNotice; i: number } => x.n !== null)
    .sort((a, b) => RANK[a.n.key] - RANK[b.n.key] || a.i - b.i)
    .map((x) => x.n);
}

/** A batch's notices folded into ONE push; nothing to say → `null` (send nothing). */
export function groupedPush(
  notices: readonly PushNotice[],
  matchId: string,
): PushNoticePayload | null {
  const top = notices[0];
  if (!top) return null;
  return { ...top, matchId, more: notices.length - 1 };
}
