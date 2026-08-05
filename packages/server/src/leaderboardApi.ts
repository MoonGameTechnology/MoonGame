import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Identity } from './matchApi';
import type { CommanderStore, CorpStore, CorpSummary, UserStore } from './store';

/**
 * RANK-1 — the leaderboard HTTP API behind the hub's «Рейтинги» tab.
 *
 *   GET /leaderboard   →  { players: {...}, corps: {...} }
 *
 * Two boards, one request: the screen shows them as tabs and switching must not
 * cost a round-trip. Session-gated like the friends/corp APIs — the caller's own
 * standing is part of the answer, and that is per-account, so there is no
 * anonymous form of this route.
 *
 * TWO RULES ARE WORTH STATING because they are what makes a board honest:
 *
 *  1. **Ties share a rank.** `rank` is «how many are strictly above me, +1», not
 *     «my index in the sorted page». With equal scores the index depends on the
 *     tiebreaker, so two players with identical XP would see different places —
 *     the board would be lying about a difference that does not exist.
 *  2. **Own standing is computed over EVERYONE, not over the page.** `me.rank`
 *     comes from a full-population query (`CommanderStore.standingOf`), so a
 *     player outside the top page still learns their true place instead of
 *     «не в списке». `rank: null` means «нет места» — never finished a match —
 *     which is honestly different from last place.
 */

/** How many rows one board page carries. A phone shows ~10 at a time; 50 is a
 *  few flicks of scroll and still one small response. */
export const BOARD_PAGE = 50;

export interface BoardRow {
  rank: number;
  /** Display name: a player's callsign or a corp's name. */
  name: string;
  /** The ranked number itself — lifetime XP for players, influence for corps. */
  score: number;
  /** Extra number the corp board prints (headcount); absent on the player board. */
  members?: number;
  /** True on the caller's own row — the screen highlights it in place. */
  me?: boolean;
}

export interface BoardView {
  rows: BoardRow[];
  /** The caller's own standing over the WHOLE population (see rule 2). */
  me: { rank: number | null; score: number; name: string | null };
  /** How many entries the board ranks in total — the «из N» denominator. */
  total: number;
}

/** Rank corps by influence — the pure half, so the rule is testable without a
 *  server. Ties share a rank (see rule 1); the tiebreaker for ORDER is the name,
 *  which keeps equal rows from shuffling between refreshes. */
export function rankCorps(
  corps: readonly CorpSummary[],
  myCorpId: string | null,
  limit: number = BOARD_PAGE,
): BoardView {
  const sorted = [...corps].sort(
    (a, b) => b.influence - a.influence || a.name.localeCompare(b.name),
  );
  const rankOf = (influence: number): number =>
    sorted.filter((c) => c.influence > influence).length + 1;
  const mine = myCorpId ? (sorted.find((c) => c.corpId === myCorpId) ?? null) : null;
  return {
    rows: sorted.slice(0, Math.max(0, limit)).map((c) => ({
      rank: rankOf(c.influence),
      name: c.name,
      score: c.influence,
      members: c.members,
      ...(c.corpId === myCorpId ? { me: true } : {}),
    })),
    me: {
      rank: mine ? rankOf(mine.influence) : null,
      score: mine?.influence ?? 0,
      name: mine?.name ?? null,
    },
    total: sorted.length,
  };
}

export interface LeaderboardApiDeps {
  commanders: CommanderStore;
  users: UserStore;
  /** Absent ⇒ the corp board is empty rather than missing (a server without corps
   *  still answers the route, so the screen never has to special-case it). */
  corps?: CorpStore;
  /** Resolve the caller from the session token — REQUIRED, no anonymous fallback. */
  identify(request: FastifyRequest): Promise<Identity | null>;
  limit?: number;
}

export function registerLeaderboardApi(app: FastifyInstance, deps: LeaderboardApiDeps): void {
  const limit = deps.limit ?? BOARD_PAGE;

  app.get('/leaderboard', async (request, reply) => {
    const who = await deps.identify(request);
    if (!who) {
      void reply.code(401);
      return { error: 'E_UNAUTHORIZED' as const };
    }

    const top = await deps.commanders.topXp(limit);
    // One round-trip for the whole page's callsigns instead of one per row.
    const logins = await deps.users.loginsOf(top.map((r) => r.accountId));
    const standing = await deps.commanders.standingOf(who.accountId);
    // Counting «строго выше» inside the PAGE is exact for the page's own rows:
    // the page holds the N highest, so anybody above a row in it is also in it.
    const rankOf = (xp: number): number => top.filter((r) => r.xp > xp).length + 1;
    const players: BoardView = {
      // An id with no account left is dropped, not printed as a blank row: the
      // account is gone, so there is nobody to put on the board.
      rows: top
        .filter((r) => logins[r.accountId] !== undefined)
        .map((r) => ({
          rank: rankOf(r.xp),
          name: logins[r.accountId]!,
          score: r.xp,
          ...(r.accountId === who.accountId ? { me: true } : {}),
        })),
      me: { rank: standing.rank, score: standing.xp, name: who.login },
      total: standing.total,
    };

    const membership = deps.corps ? await deps.corps.membershipOf(who.accountId) : null;
    const corps = deps.corps
      ? rankCorps(await deps.corps.listCorps(), membership?.corpId ?? null, limit)
      : { rows: [], me: { rank: null, score: 0, name: null }, total: 0 };

    return { players, corps };
  });
}
