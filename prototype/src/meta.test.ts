import { describe, it, expect } from 'vitest';
import {
  META_TREE,
  EMPTY_STATS,
  metaLevel,
  metaLevelProgress,
  metaPoints,
  canUnlock,
  unlockNode,
  matchXp,
  metaGrant,
  parseMetaState,
  recordMatch,
  winRate,
  averagePlace,
  leagueKey,
  type MetaState,
} from './meta';
import { newGame, data } from './game';

const fresh: MetaState = { xp: 0, spent: [], stats: { ...EMPTY_STATS } };

describe('meta-progression — XP, levels and points', () => {
  it('levels rise on growing thresholds (100, then +50 per level)', () => {
    expect(metaLevel(0)).toBe(1);
    expect(metaLevel(99)).toBe(1);
    expect(metaLevel(100)).toBe(2); // 100
    expect(metaLevel(249)).toBe(2);
    expect(metaLevel(250)).toBe(3); // 100+150
    expect(metaLevelProgress(120)).toEqual([20, 150]);
  });

  it('a match pays for showing up, the scoreboard and the win', () => {
    expect(matchXp({ won: false, score: 0 })).toBe(40);
    expect(matchXp({ won: false, score: 500 })).toBe(90);
    expect(matchXp({ won: true, score: 5000 })).toBe(40 + 100 + 160); // score capped
  });

  it('points = levels earned minus tiers spent', () => {
    const st: MetaState = { xp: 1000, spent: [], stats: { ...EMPTY_STATS } }; // 100+150+200+250+300 = 1000 → level 6 → 5 pts
    expect(metaLevel(st.xp)).toBe(6);
    expect(metaPoints(st)).toBe(5);
    expect(metaPoints({ ...st, spent: ['cmd1', 'cmd2'] })).toBe(2); // 5 − (1+2)
  });
});

describe('meta-progression — straight-track unlock rules', () => {
  it('tier 1 unlocks with a point; tier 2 needs its predecessor', () => {
    expect(canUnlock(fresh, 'cmd1')).toBe(false); // no points at level 1
    const rich: MetaState = { xp: 1000, spent: [], stats: { ...EMPTY_STATS } };
    expect(canUnlock(rich, 'cmd1')).toBe(true);
    expect(canUnlock(rich, 'cmd2')).toBe(false); // cmd1 not owned yet
    const next = unlockNode(rich, 'cmd1')!;
    expect(next.spent).toEqual(['cmd1']);
    expect(canUnlock(next, 'cmd2')).toBe(true);
    expect(unlockNode(next, 'cmd1')).toBeNull(); // no double-buy
  });

  it('persisted garbage parses to a fresh account (fail-secure)', () => {
    expect(parseMetaState(null)).toEqual(fresh);
    expect(parseMetaState('{"xp":-5,"spent":["cmd1","bogus",7]}')).toEqual({ xp: 0, spent: ['cmd1'], stats: { ...EMPTY_STATS } });
    expect(parseMetaState('not json')).toEqual(fresh);
  });

  it('unlocking a node keeps the career counters (they are a separate ledger)', () => {
    const played = recordMatch({ xp: 1000, spent: [], stats: { ...EMPTY_STATS } }, { won: true, score: 900, place: 1 });
    expect(unlockNode(played, 'cmd1')?.stats).toEqual(played.stats);
  });
});

describe('meta-progression — career counters (profile screen)', () => {
  it('folds a match into the counters; a win extends the streak', () => {
    let st = recordMatch(fresh, { won: true, score: 900, place: 1 });
    st = recordMatch(st, { won: true, score: 700, place: 1 });
    expect(st.stats).toEqual({ matches: 2, wins: 2, placeSum: 2, placed: 2, streak: 2, bestStreak: 2, score: 1600 });
    expect(winRate(st.stats)).toBe(100);
    expect(averagePlace(st.stats)).toBe(1);
  });

  it('a loss resets the streak but keeps the best one', () => {
    let st = recordMatch(fresh, { won: true, score: 100, place: 1 });
    st = recordMatch(st, { won: false, score: 50, place: 4 });
    expect(st.stats.streak).toBe(0);
    expect(st.stats.bestStreak).toBe(1);
    expect(st.stats.matches).toBe(2);
    expect(winRate(st.stats)).toBe(50);
    expect(averagePlace(st.stats)).toBe(2.5);
  });

  it('a match with no reported place still counts, but not toward the average', () => {
    // The dev endMatch hook ends a match without `match.rewards` — counting that as
    // place 0 would drag the average below 1 and read as a bug on the card.
    const st = recordMatch(fresh, { won: false, score: 10 });
    expect(st.stats.matches).toBe(1);
    expect(st.stats.placed).toBe(0);
    expect(averagePlace(st.stats)).toBeNull();
  });

  it('an empty career never divides by zero', () => {
    expect(winRate(EMPTY_STATS)).toBe(0);
    expect(averagePlace(EMPTY_STATS)).toBeNull();
  });

  it('a blob written before the profile screen reads as a fresh career, XP intact', () => {
    expect(parseMetaState('{"xp":300,"spent":["cmd1"]}')).toEqual({ xp: 300, spent: ['cmd1'], stats: { ...EMPTY_STATS } });
  });

  it('impossible counters are repaired, not trusted (no 140% win rate)', () => {
    const st = parseMetaState('{"xp":0,"spent":[],"stats":{"matches":2,"wins":9,"placed":7,"placeSum":-3,"streak":5,"bestStreak":0,"score":-8}}');
    expect(st.stats.wins).toBe(2); // wins ≤ matches
    expect(st.stats.placed).toBe(2); // placed ≤ matches
    expect(st.stats.placeSum).toBeGreaterThanOrEqual(st.stats.placed); // avg place ≥ 1
    expect(st.stats.bestStreak).toBeGreaterThanOrEqual(st.stats.streak);
    expect(st.stats.score).toBe(0);
    expect(winRate(st.stats)).toBe(100);
  });

  it('the league is a cosmetic band over the level, and every band has a key', () => {
    expect(leagueKey(1)).toBe('profile.league.recon');
    expect(leagueKey(4)).toBe('profile.league.recon');
    expect(leagueKey(5)).toBe('profile.league.patrol');
    expect(leagueKey(10)).toBe('profile.league.squadron');
    expect(leagueKey(15)).toBe('profile.league.fleet');
    expect(leagueKey(99)).toBe('profile.league.armada');
  });
});

describe('meta-progression — the grant lands in a real match', () => {
  it('every tech a node grants exists in the game data', () => {
    for (const n of META_TREE) for (const id of n.tech ?? []) expect(data.technologies[id], id).toBeDefined();
  });

  it('metaGrant composes the unlocked nodes into one snapshot', () => {
    const g = metaGrant({ xp: 0, spent: ['cmd1', 'eco1', 'sci1'], stats: { ...EMPTY_STATS } });
    expect(g).toEqual({ tech: ['meta_drill_speed'], scientistLevel: 1, resourceMult: 0.1 });
  });

  it('newGame applies the meta grant to the human seat only', () => {
    const g = metaGrant({ xp: 0, spent: ['cmd1', 'eco1', 'eco2', 'sci1'], stats: { ...EMPTY_STATS } });
    const s = newGame({
      seats: [
        { id: 'p1', name: 'Me', faction: 'azure', start: 'C1R1', ai: false },
        { id: 'p2', name: 'Bot', faction: 'crimson', start: 'C5R5', ai: true },
      ],
      meta: g,
    });
    expect(s.players.p1?.technologies?.completed).toEqual(expect.arrayContaining(['meta_drill_speed', 'meta_industry']));
    expect(s.players.p2?.technologies?.completed ?? []).toHaveLength(0);
    expect(s.players.p1?.scientists?.[0]?.level).toBe(2);
    const plain = newGame();
    const base = plain.players.p1?.resources.credits ?? 0;
    expect(s.players.p1?.resources.credits).toBe(Math.round(base * 1.1));
    expect(s.players.p2?.resources.credits).toBe(plain.players.p2?.resources.credits);
  });
});
