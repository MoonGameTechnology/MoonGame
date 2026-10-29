/** Pure corporation battle parsing and presentation decisions; no DOM or requests. */
import catalog from '../data/avaFormats.json';
import type {
  CorpBattleChallenge,
  CorpBattleReport,
  CorpBattleResult,
  CorpBattleSeat,
  CorpBattleTally,
  CorpBattlesView,
  CorpWarView,
} from '../packages/protocol/src/corpBattles';

export const CORP_BATTLE_TABS = ['now', 'challenges', 'opponents', 'history', 'ready'] as const;
export type CorpBattleTab = (typeof CORP_BATTLE_TABS)[number];
export const BATTLE_FORMATS = catalog.formats.map(({ format, cost, reward, minPlayers }) => ({
  format,
  cost,
  reward,
  minPlayers,
}));
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 256;
const count = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const points = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1_000_000_000;
const side = (x: unknown): x is 'challenger' | 'target' => x === 'challenger' || x === 'target';
const format = (x: unknown): x is number => BATTLE_FORMATS.some((f) => f.format === x);
const list = (x: unknown): x is unknown[] => Array.isArray(x) && x.length <= 10_000;
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
const optionalTime = (x: unknown): boolean => x === undefined || count(x);
const statuses = ['pending', 'accepted', 'declined', 'expired', 'locked', 'cancelled', 'ended'];
function challenge(x: unknown): x is CorpBattleChallenge {
  return (
    object(x) &&
    text(x.id) &&
    text(x.challengerCorp) &&
    text(x.targetCorp) &&
    x.challengerCorp !== x.targetCorp &&
    format(x.format) &&
    count(x.cost) &&
    typeof x.status === 'string' &&
    statuses.includes(x.status) &&
    count(x.createdAt) &&
    count(x.expiresAt) &&
    optionalTime(x.pauseEndsAt)
  );
}
function seat(x: unknown): x is CorpBattleSeat {
  return (
    object(x) &&
    side(x.side) &&
    (x.accountId === undefined || text(x.accountId)) &&
    (x.login === null || text(x.login)) &&
    bool(x.bot) &&
    points(x.score) &&
    count(x.provinces) &&
    bool(x.out)
  );
}
function report(x: unknown): x is CorpBattleReport {
  const total = (v: unknown): boolean => object(v) && points(v.score) && count(v.provinces);
  return (
    object(x) &&
    (x.reason === null ||
      (typeof x.reason === 'string' &&
        ['domination', 'elimination', 'score', 'timeout'].includes(x.reason))) &&
    optionalTime(x.warAt) &&
    count(x.provinces) &&
    object(x.sides) &&
    total(x.sides.challenger) &&
    total(x.sides.target) &&
    Array.isArray(x.seats) &&
    x.seats.length <= 40 &&
    x.seats.every(seat)
  );
}
function result(x: unknown): x is CorpBattleResult {
  return (
    object(x) &&
    text(x.matchupId) &&
    text(x.challengerCorp) &&
    text(x.targetCorp) &&
    x.challengerCorp !== x.targetCorp &&
    (x.winnerCorp === null || x.winnerCorp === x.challengerCorp || x.winnerCorp === x.targetCorp) &&
    count(x.at) &&
    format(x.format) &&
    side(x.side) &&
    (x.report === undefined || report(x.report))
  );
}
function tally(x: unknown): x is CorpBattleTally {
  return (
    object(x) &&
    text(x.opponent) &&
    format(x.format) &&
    count(x.wins) &&
    count(x.losses) &&
    count(x.draws)
  );
}

/** A failed read never enables an action or turns into a misleading empty history. */
export function parseCorpBattles(raw: unknown, corpId: string): CorpBattlesView | null {
  if (
    !object(raw) ||
    raw.corpId !== corpId ||
    !object(raw.ready) ||
    !bool(raw.ready.corp) ||
    !bool(raw.ready.player) ||
    !list(raw.ready.formats) ||
    !raw.ready.formats.every(format) ||
    !list(raw.ready.players) ||
    !raw.ready.players.every(text) ||
    !list(raw.challenges) ||
    !raw.challenges.every(challenge) ||
    !list(raw.results) ||
    !raw.results.every(result) ||
    !list(raw.tally) ||
    !raw.tally.every(tally) ||
    !object(raw.names) ||
    !Object.values(raw.names).every(text)
  )
    return null;
  if (
    raw.challenges.some((c) => c.challengerCorp !== corpId && c.targetCorp !== corpId) ||
    raw.results.some((r) => (r.side === 'challenger' ? r.challengerCorp : r.targetCorp) !== corpId)
  )
    return null;
  return {
    corpId,
    ready: {
      corp: raw.ready.corp,
      player: raw.ready.player,
      formats: [...new Set(raw.ready.formats)],
      players: [...new Set(raw.ready.players)],
    },
    challenges: raw.challenges,
    results: raw.results,
    tally: raw.tally,
    names: Object.fromEntries(Object.entries(raw.names)) as Record<string, string>,
  };
}

export function parseCorpWar(raw: unknown, matchupId: string): CorpWarView | null {
  if (
    !object(raw) ||
    raw.matchupId !== matchupId ||
    !side(raw.side) ||
    (raw.phase !== 'peace' && raw.phase !== 'war' && raw.phase !== 'ended') ||
    !optionalTime(raw.warAt) ||
    !points(raw.score) ||
    !points(raw.scoreGoal) ||
    raw.scoreGoal <= 0 ||
    !count(raw.provinces) ||
    !count(raw.capturable) ||
    typeof raw.dominationPercent !== 'number' ||
    !Number.isFinite(raw.dominationPercent) ||
    raw.dominationPercent <= 0 ||
    raw.dominationPercent > 1 ||
    !Array.isArray(raw.mine) ||
    raw.mine.length > 20 ||
    !raw.mine.every(
      (s) =>
        object(s) &&
        (s.accountId === null || text(s.accountId)) &&
        (s.login === null || text(s.login)) &&
        points(s.score) &&
        count(s.provinces) &&
        bool(s.out),
    ) ||
    !object(raw.rivals) ||
    !count(raw.rivals.count)
  )
    return null;
  const rivals: CorpWarView['rivals'] = { count: raw.rivals.count };
  if (raw.phase !== 'peace' && raw.rivals.seats !== undefined) {
    if (
      !Array.isArray(raw.rivals.seats) ||
      raw.rivals.seats.length > 20 ||
      !raw.rivals.seats.every(
        (s) => object(s) && bool(s.bot) && (s.login === null || text(s.login)) && bool(s.out),
      )
    )
      return null;
    rivals.seats = raw.rivals.seats.map((s) => ({
      bot: s.bot as boolean,
      login: s.login as string | null,
      out: s.out as boolean,
    }));
  }
  return {
    matchupId,
    side: raw.side,
    phase: raw.phase,
    ...(raw.warAt === undefined ? {} : { warAt: raw.warAt as number }),
    score: raw.score,
    scoreGoal: raw.scoreGoal,
    provinces: raw.provinces,
    capturable: raw.capturable,
    dominationPercent: raw.dominationPercent,
    mine: raw.mine.map((s) => ({
      accountId: s.accountId as string | null,
      login: s.login as string | null,
      score: s.score as number,
      provinces: s.provinces as number,
      out: s.out as boolean,
    })),
    rivals,
  };
}

export function battlePhase(
  c: CorpBattleChallenge,
  war: Pick<CorpWarView, 'phase'> | null,
): 'roster' | 'preparing' | 'peace' | 'war' | 'settling' {
  if (c.status === 'accepted') return 'roster';
  return war?.phase === 'ended' ? 'settling' : (war?.phase ?? 'preparing');
}
export function challengeGroups(
  rows: readonly CorpBattleChallenge[],
  corpId: string,
): {
  incoming: CorpBattleChallenge[];
  outgoing: CorpBattleChallenge[];
  closed: CorpBattleChallenge[];
} {
  return {
    incoming: rows.filter((r) => r.status === 'pending' && r.targetCorp === corpId),
    outgoing: rows.filter((r) => r.status === 'pending' && r.challengerCorp === corpId),
    closed: rows.filter((r) => ['declined', 'expired', 'cancelled'].includes(r.status)),
  };
}
export function formatLimit(
  view: {
    buildings: ReadonlyArray<{ level: number; levels: ReadonlyArray<{ maxFormat?: number }> }>;
  } | null,
): number {
  return Math.max(
    catalog.baseMaxFormat,
    ...(view?.buildings.map((b) => b.levels[b.level - 1]?.maxFormat ?? 0) ?? []),
  );
}
export function battleStats(
  tallies: readonly CorpBattleTally[],
  wanted: number,
): { played: number; wins: number; losses: number; draws: number } {
  return tallies
    .filter((r) => !wanted || r.format === wanted)
    .reduce(
      (a, r) => ({
        played: a.played + r.wins + r.losses + r.draws,
        wins: a.wins + r.wins,
        losses: a.losses + r.losses,
        draws: a.draws + r.draws,
      }),
      { played: 0, wins: 0, losses: 0, draws: 0 },
    );
}
export function topCorpFighters(
  results: readonly CorpBattleResult[],
  wanted: number,
): Array<{ accountId: string; login: string | null; score: number; battles: number }> {
  const totals = new Map<
    string,
    { accountId: string; login: string | null; score: number; battles: number }
  >();
  for (const r of results) {
    if (wanted && r.format !== wanted) continue;
    for (const s of r.report?.seats ?? []) {
      if (s.side !== r.side || s.bot || !s.accountId) continue;
      const old = totals.get(s.accountId);
      totals.set(s.accountId, {
        accountId: s.accountId,
        login: old?.login ?? s.login,
        score: (old?.score ?? 0) + s.score,
        battles: (old?.battles ?? 0) + 1,
      });
    }
  }
  return [...totals.values()]
    .sort(
      (a, b) =>
        b.score - a.score || b.battles - a.battles || a.accountId.localeCompare(b.accountId),
    )
    .slice(0, 5);
}

export type CorpOpponentOffer =
  | { kind: 'challenge'; format: number; cost: number }
  | { kind: 'head' | 'ready' | 'format' | 'influence' | 'answer' | 'sent' | 'active' };
export function opponentOffer(p: {
  corpId: string;
  opponent: string;
  head: boolean;
  ready: boolean;
  mine: readonly number[];
  theirs: readonly number[];
  format: number;
  maxFormat: number;
  influence: number;
  challenges: readonly CorpBattleChallenge[];
  now: number;
}): CorpOpponentOffer {
  const related = p.challenges.filter(
    (c) =>
      (c.challengerCorp === p.corpId && c.targetCorp === p.opponent) ||
      (c.targetCorp === p.corpId && c.challengerCorp === p.opponent),
  );
  if (related.some((c) => c.status === 'accepted' || c.status === 'locked'))
    return { kind: 'active' };
  const pending = related.find((c) => c.status === 'pending' && c.expiresAt > p.now);
  if (pending) return { kind: pending.targetCorp === p.corpId ? 'answer' : 'sent' };
  if (!p.head) return { kind: 'head' };
  if (!p.ready) return { kind: 'ready' };
  const f = BATTLE_FORMATS.find(
    (f) =>
      (!p.format || f.format === p.format) &&
      f.format <= p.maxFormat &&
      p.theirs.includes(f.format),
  );
  if (!f) return { kind: 'format' };
  if (p.influence < f.cost) return { kind: 'influence' };
  return { kind: 'challenge', format: f.format, cost: f.cost };
}
