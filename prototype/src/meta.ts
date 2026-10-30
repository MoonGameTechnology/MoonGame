/**
 * Commander XP, cosmetic ranks and career statistics. These never grant match power.
 * The retired command/economy/science trees are not read from legacy saved profiles.
 * Pure module: no DOM or storage access; the hub persists the profile and mirrors XP.
 */

/** Career counters behind the profile screen (docs/main-menu.md §4.2 «Профиль /
 *  статистика»). Observation only — nothing here feeds the simulation.
 *
 *  Kept as SUMS, not averages: an average is derivable (`placeSum / matches`) but a
 *  stored average can't be updated without the count anyway, and a sum survives a
 *  partially-written blob without lying about the past.
 *
 *  Per-device by construction: it lives in the same localStorage blob as the XP mirror,
 *  because the server has nowhere to put it yet — `CommanderStore` stores XP alone
 *  (`packages/server/src/store/types.ts`). Making it account-wide means extending that
 *  store and `/commander/me`; until then a second device starts from zero. */
export interface MetaStats {
  /** Finished matches counted (only ones that reached a terminal `match.status`). */
  matches: number;
  wins: number;
  /** Σ of finishing places — `placeSum / matches` is the average place shown. */
  placeSum: number;
  /** Matches with a recorded place; the divisor for the average, since a match may
   *  finish without one (the dev `endMatch` hook doesn't fill `rewards`). */
  placed: number;
  /** Current consecutive-win run; a loss or a draw resets it to 0. */
  streak: number;
  bestStreak: number;
  /** Σ of final scores — the season total on the profile card. */
  score: number;
}

export interface MetaState {
  xp: number;
  /** Career counters (see {@link MetaStats}). Always present after `parseMetaState`. */
  stats: MetaStats;
}

export const EMPTY_STATS: MetaStats = {
  matches: 0,
  wins: 0,
  placeSum: 0,
  placed: 0,
  streak: 0,
  bestStreak: 0,
  score: 0,
};

/** XP needed to go from `level` to `level+1`: 100, 150, 200, … — early ranks land
 *  fast (a match or two), the tail is a season-long grind. */
export function xpToNext(level: number): number {
  return 100 + (Math.max(1, level) - 1) * 50;
}

/** Commander level for a lifetime XP total (level 1 at 0 XP). */
export function metaLevel(xp: number): number {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return level;
}

/** XP progress inside the current level: [earned, needed]. */
export function metaLevelProgress(xp: number): [number, number] {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return [rest, xpToNext(level)];
}

/** Fold one FINISHED match into the career counters (see {@link MetaStats}).
 *  Pure: returns a new state, mutates nothing. The caller is responsible for
 *  calling it exactly once per match — the prototype does that behind the same
 *  localStorage marker that guards the XP award. */
export function recordMatch(
  state: MetaState,
  result: { won: boolean; score: number; place?: number },
): MetaState {
  const prev = state.stats;
  // A place is optional: the dev `endMatch` hook ends a match without filling
  // `match.rewards`, and an average must not be skewed by counting those as 0.
  const hasPlace =
    typeof result.place === 'number' && Number.isFinite(result.place) && result.place >= 1;
  const streak = result.won ? prev.streak + 1 : 0;
  return {
    ...state,
    stats: {
      matches: prev.matches + 1,
      wins: prev.wins + (result.won ? 1 : 0),
      placeSum: prev.placeSum + (hasPlace ? Math.floor(result.place!) : 0),
      placed: prev.placed + (hasPlace ? 1 : 0),
      streak,
      bestStreak: Math.max(prev.bestStreak, streak),
      score: prev.score + Math.max(0, Math.floor(result.score)),
    },
  };
}

/** Win rate in percent (0 when nothing is played — never NaN on the card). */
export function winRate(stats: MetaStats): number {
  return stats.matches > 0 ? Math.round((stats.wins / stats.matches) * 100) : 0;
}

/** Average finishing place, or null when no match reported one (the card prints «—»). */
export function averagePlace(stats: MetaStats): number | null {
  return stats.placed > 0 ? stats.placeSum / stats.placed : null;
}

/** Commander LEAGUE — a cosmetic band derived from the level, nothing more: it
 *  gates no content and grants no power (docs/account-level.md — «уровень = доступ
 *  и престиж, никогда не сила»). Returned as a locale KEY, not a word. */
export function leagueKey(level: number): string {
  if (level >= 20) return 'profile.league.armada';
  if (level >= 15) return 'profile.league.fleet';
  if (level >= 10) return 'profile.league.squad';
  if (level >= 5) return 'profile.league.patrol';
  return 'profile.league.recon';
}

/** XP for one finished match: showing up + the scoreboard + the win. Tuned so an
 *  average match is ~a level early on: 40 base, score tops out around +100. */
export function matchXp(result: { won: boolean; score: number }): number {
  return 40 + Math.min(100, Math.floor(Math.max(0, result.score) / 10)) + (result.won ? 160 : 0);
}

/** A non-negative integer field, or 0 for anything else (strings, NaN, negatives). */
function counter(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** Normalize the career counters. Beyond per-field sanity it repairs pairs that must
 *  agree, because a half-written blob otherwise prints impossible cards (a 140% win
 *  rate, an average place of 0.4): wins ≤ matches, placed ≤ matches, and the average
 *  place stays ≥ 1 per counted match. */
function parseStats(v: unknown): MetaStats {
  if (typeof v !== 'object' || v === null) return { ...EMPTY_STATS };
  const raw = v as Record<string, unknown>;
  const matches = counter(raw.matches);
  const wins = Math.min(counter(raw.wins), matches);
  const placed = Math.min(counter(raw.placed), matches);
  const streak = Math.min(counter(raw.streak), matches);
  return {
    matches,
    wins,
    placed,
    placeSum: Math.max(counter(raw.placeSum), placed),
    streak,
    bestStreak: Math.max(Math.min(counter(raw.bestStreak), matches), streak),
    score: counter(raw.score),
  };
}

/** Parse a persisted blob (fail-secure: garbage → a fresh account). */
export function parseMetaState(raw: string | null): MetaState {
  if (!raw) return { xp: 0, stats: { ...EMPTY_STATS } };
  try {
    const v = JSON.parse(raw) as { xp?: unknown; stats?: unknown };
    const xp =
      typeof v.xp === 'number' && Number.isFinite(v.xp) && v.xp >= 0 ? Math.floor(v.xp) : 0;
    // Blobs written before the profile screen carry no `stats` — they read as a fresh
    // career rather than as corruption. Legacy `spent` is discarded; XP/stats survive.
    return { xp, stats: parseStats(v.stats) };
  } catch {
    return { xp: 0, stats: { ...EMPTY_STATS } };
  }
}
