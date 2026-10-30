import { describe, it, expect } from 'vitest';
import {
  EMPTY_STATS,
  metaLevel,
  metaLevelProgress,
  matchXp,
  parseMetaState,
  recordMatch,
  winRate,
  averagePlace,
  leagueKey,
  type MetaState,
} from './meta';
import { newGame, data } from './game';

const fresh: MetaState = { xp: 0, stats: { ...EMPTY_STATS } };

describe('commander career — XP and cosmetic levels', () => {
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
});

describe('commander career — legacy profiles', () => {
  it('persisted garbage parses to a fresh account (fail-secure)', () => {
    expect(parseMetaState(null)).toEqual(fresh);
    expect(parseMetaState('{"xp":-5,"spent":["cmd1","bogus",7]}')).toEqual(fresh);
    expect(parseMetaState('not json')).toEqual(fresh);
  });

  it('retires purchased nodes without resetting XP, rank or career statistics', () => {
    const played = recordMatch({ ...fresh, xp: 1000 }, { won: true, score: 900, place: 1 });
    const legacy = JSON.stringify({ ...played, spent: ['cmd1', 'cmd2', 'eco1', 'sci1'] });
    const restored = parseMetaState(legacy);
    expect(restored).toEqual(played);
    expect(restored).not.toHaveProperty('spent');
    expect(metaLevel(restored.xp)).toBe(6);
    expect(leagueKey(metaLevel(restored.xp))).toBe('profile.league.patrol');
  });
});

describe('commander career — counters (profile screen)', () => {
  it('folds a match into the counters; a win extends the streak', () => {
    let st = recordMatch(fresh, { won: true, score: 900, place: 1 });
    st = recordMatch(st, { won: true, score: 700, place: 1 });
    expect(st.stats).toEqual({
      matches: 2,
      wins: 2,
      placeSum: 2,
      placed: 2,
      streak: 2,
      bestStreak: 2,
      score: 1600,
    });
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
    expect(parseMetaState('{"xp":300,"spent":["cmd1"]}')).toEqual({
      xp: 300,
      stats: { ...EMPTY_STATS },
    });
  });

  it('impossible counters are repaired, not trusted (no 140% win rate)', () => {
    const st = parseMetaState(
      '{"xp":0,"spent":[],"stats":{"matches":2,"wins":9,"placed":7,"placeSum":-3,"streak":5,"bestStreak":0,"score":-8}}',
    );
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
    expect(leagueKey(10)).toBe('profile.league.squad');
    expect(leagueKey(15)).toBe('profile.league.fleet');
    expect(leagueKey(99)).toBe('profile.league.armada');
  });
});

describe('commander career — no match power', () => {
  it('legacy setup grants cannot change a new match, its resources or its council', () => {
    const setup = {
      seats: [
        { id: 'p1', name: 'Me', faction: 'azure', start: 'C1R1', ai: false },
        { id: 'p2', name: 'Bot', faction: 'crimson', start: 'C5R5', ai: true },
      ],
    };
    const legacy = {
      ...setup,
      meta: {
        tech: ['meta_drill_speed', 'meta_industry', 'industrial_automation'],
        scientistLevel: 2,
        resourceMult: 0.3,
      },
    };
    const state = newGame(legacy);
    expect(state).toEqual(newGame(setup));
    expect(state.players.p1?.scientists?.[0]?.level).toBe(1);
  });

  it('the shipped catalog cannot reactivate retired bonuses from an old completed-tech list', () => {
    for (const id of [
      'meta_drill_speed',
      'meta_drill_combat',
      'meta_drill_radar',
      'meta_drill_veteran',
      'meta_industry',
      'meta_industry_2',
    ])
      expect(data.technologies[id], id).toBeUndefined();
  });
});
