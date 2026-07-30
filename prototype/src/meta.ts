/**
 * META-PROGRESSION (прокачка командующего) — the account-level tech trees.
 *
 * Players EARN experience by finishing matches (participation + score + victory)
 * and SPEND progression points in three branches. This is the Bytro-genre rank
 * ladder: progress comes only from play — it is never sold (docs/main-menu.md §5:
 * premium buys convenience/cosmetics, NEVER combat power; these trees are not
 * purchasable).
 *
 * Design:
 *  - XP → commander LEVEL (rising thresholds); each level past 1 grants ONE point.
 *  - A node costs its TIER in points and requires the previous node of its branch —
 *    three straight tracks, no webs (readable on a phone, no respec in v1).
 *  - Node effects reuse EXISTING session seams, no new engine code: hidden session
 *    technologies granted as `completed` at match start (their bonuses ride the
 *    normal tech hooks), a scientist-council level bump, and a starting-treasury
 *    multiplier. Everything is snapshotted at newGame — deterministic, replay-safe.
 *  - Persistence v1 is per-callsign localStorage (the prototype's guest identity);
 *    the server account (SE-1.x) takes over when the meta-layer lands there.
 *
 * Pure module: no DOM, no storage access — main.ts feeds it state and persists.
 */

export type MetaBranch = 'command' | 'economy' | 'science';

export interface MetaNode {
  id: string;
  branch: MetaBranch;
  /** 1..4 within the branch — also the node's cost in points. */
  tier: number;
  /** Russian source strings (the i18n msgid convention) — render through t(). */
  name: string;
  desc: string;
  /** Hidden session technologies granted as `completed` at match start. */
  tech?: string[];
  /** +N to the scientist council's level at match start. */
  scientistLevel?: number;
  /** Starting-treasury multiplier bonus (0.1 = +10%), summed across nodes. */
  startResources?: number;
}

/** Career counters behind the profile screen (docs/main-menu.md §4.2 «Профиль /
 *  статистика»). Observation only — nothing here feeds the simulation.
 *
 *  Kept as SUMS, not averages: an average is derivable (`placeSum / matches`) but a
 *  stored average can't be updated without the count anyway, and a sum survives a
 *  partially-written blob without lying about the past.
 *
 *  Per-device by construction: it lives in the same localStorage blob as the XP tree,
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
  /** Unlocked node ids, in unlock order. */
  spent: string[];
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

export const META_BRANCH_RU: Record<MetaBranch, string> = {
  command: 'meta.branch.command',
  economy: 'meta.branch.economy',
  science: 'meta.branch.science',
};

/** The three progression tracks. Costs total 1+2+3+4 = 10 points per branch —
 *  a full tree is a long campaign, the first nodes land within a few matches. */
export const META_TREE: MetaNode[] = [
  // --- Командование: флотоводец растёт от манёвра к удару ------------------------
  { id: 'cmd1', branch: 'command', tier: 1, name: 'meta.node.cmd1.name', desc: 'meta.node.cmd1.desc', tech: ['meta_drill_speed'] },
  { id: 'cmd2', branch: 'command', tier: 2, name: 'meta.node.cmd2.name', desc: 'meta.node.cmd2.desc', tech: ['meta_drill_combat'] },
  { id: 'cmd3', branch: 'command', tier: 3, name: 'meta.node.cmd3.name', desc: 'meta.node.cmd3.desc', tech: ['meta_drill_radar'] },
  { id: 'cmd4', branch: 'command', tier: 4, name: 'meta.node.cmd4.name', desc: 'meta.node.cmd4.desc', tech: ['meta_drill_veteran'] },
  // --- Экономика: тыл решает --------------------------------------------------------
  { id: 'eco1', branch: 'economy', tier: 1, name: 'meta.node.eco1.name', desc: 'meta.node.eco1.desc', startResources: 0.1 },
  { id: 'eco2', branch: 'economy', tier: 2, name: 'meta.node.eco2.name', desc: 'meta.node.eco2.desc', tech: ['meta_industry'] },
  { id: 'eco3', branch: 'economy', tier: 3, name: 'meta.node.eco3.name', desc: 'meta.node.eco3.desc', startResources: 0.2 },
  { id: 'eco4', branch: 'economy', tier: 4, name: 'meta.node.eco4.name', desc: 'meta.node.eco4.desc', tech: ['meta_industry_2'] },
  // --- Наука: совет учёных набирает вес ---------------------------------------------
  { id: 'sci1', branch: 'science', tier: 1, name: 'meta.node.sci1.name', desc: 'meta.node.sci1.desc', scientistLevel: 1 },
  { id: 'sci2', branch: 'science', tier: 2, name: 'meta.node.sci2.name', desc: 'meta.node.sci2.desc', tech: ['industrial_automation'] },
  { id: 'sci3', branch: 'science', tier: 3, name: 'meta.node.sci3.name', desc: 'meta.node.sci3.desc', scientistLevel: 1 },
  { id: 'sci4', branch: 'science', tier: 4, name: 'meta.node.sci4.name', desc: 'meta.node.sci4.desc', tech: ['orbital_logistics'] },
];

const byId = new Map(META_TREE.map((n) => [n.id, n]));

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

/** Points earned over a lifetime (one per level past 1) minus points spent. */
export function metaPoints(state: MetaState): number {
  const earned = metaLevel(state.xp) - 1;
  const spent = state.spent.reduce((a, id) => a + (byId.get(id)?.tier ?? 0), 0);
  return earned - spent;
}

/** Can this node be unlocked NOW? Straight track: needs the previous tier of its
 *  branch, not already owned, and enough free points. */
export function canUnlock(state: MetaState, nodeId: string): boolean {
  const node = byId.get(nodeId);
  if (!node || state.spent.includes(nodeId)) return false;
  if (node.tier > 1) {
    const prev = META_TREE.find((n) => n.branch === node.branch && n.tier === node.tier - 1);
    if (!prev || !state.spent.includes(prev.id)) return false;
  }
  return metaPoints(state) >= node.tier;
}

/** Unlock a node (validated; returns the NEW state or null if not allowed). */
export function unlockNode(state: MetaState, nodeId: string): MetaState | null {
  if (!canUnlock(state, nodeId)) return null;
  // Spread, don't rebuild field-by-field: a hand-written literal here silently
  // dropped `stats` when it was added, and the loss only showed up a match later.
  return { ...state, spent: [...state.spent, nodeId] };
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
  const hasPlace = typeof result.place === 'number' && Number.isFinite(result.place) && result.place >= 1;
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
  if (level >= 10) return 'profile.league.squadron';
  if (level >= 5) return 'profile.league.patrol';
  return 'profile.league.recon';
}

/** XP for one finished match: showing up + the scoreboard + the win. Tuned so an
 *  average match is ~a level early on: 40 base, score tops out around +100. */
export function matchXp(result: { won: boolean; score: number }): number {
  return 40 + Math.min(100, Math.floor(Math.max(0, result.score) / 10)) + (result.won ? 160 : 0);
}

/** What the unlocked tree grants a match at newGame — the ONLY bridge into the
 *  session (snapshot semantics, like scientists/templates: no live account reads). */
export function metaGrant(state: MetaState): {
  tech: string[];
  scientistLevel: number;
  resourceMult: number;
} {
  const out = { tech: [] as string[], scientistLevel: 0, resourceMult: 0 };
  for (const id of state.spent) {
    const n = byId.get(id);
    if (!n) continue;
    for (const tid of n.tech ?? []) if (!out.tech.includes(tid)) out.tech.push(tid);
    out.scientistLevel += n.scientistLevel ?? 0;
    out.resourceMult += n.startResources ?? 0;
  }
  return out;
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
  if (!raw) return { xp: 0, spent: [], stats: { ...EMPTY_STATS } };
  try {
    const v = JSON.parse(raw) as { xp?: unknown; spent?: unknown; stats?: unknown };
    const xp = typeof v.xp === 'number' && Number.isFinite(v.xp) && v.xp >= 0 ? Math.floor(v.xp) : 0;
    const spent = Array.isArray(v.spent) ? v.spent.filter((x): x is string => typeof x === 'string' && byId.has(x)) : [];
    // Blobs written before the profile screen carry no `stats` — they read as a fresh
    // career rather than as corruption, so an existing commander keeps their XP tree.
    return { xp, spent, stats: parseStats(v.stats) };
  } catch {
    return { xp: 0, spent: [], stats: { ...EMPTY_STATS } };
  }
}
