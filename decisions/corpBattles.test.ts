import { describe, expect, it } from 'vitest';
import {
  battlePostPath,
  pairRepeats,
  battleRating,
  winBonus,
  battleAttention,
  battlePhase,
  battleStats,
  challengeGroups,
  formatLimit,
  opponentOffer,
  parseCorpBattles,
  parseCorpWar,
  topCorpFighters,
} from './corpBattles';
import type {
  CorpBattleChallenge,
  CorpBattlesView,
  CorpBattleResult,
} from '../packages/protocol/src/corpBattles';

const challenge: CorpBattleChallenge = {
  id: 'm',
  challengerCorp: 'a',
  targetCorp: 'b',
  format: 3,
  cost: 150,
  status: 'accepted',
  createdAt: 1,
  expiresAt: 20,
  pauseEndsAt: 50,
};
const view: CorpBattlesView = {
  corpId: 'a',
  ready: { corp: true, formats: [2, 3], player: false, players: ['one'] },
  challenges: [challenge],
  results: [],
  tally: [],
  names: { b: 'Beta' },
};
const result: CorpBattleResult = {
  matchupId: 'old',
  challengerCorp: 'a',
  targetCorp: 'b',
  winnerCorp: 'a',
  format: 2,
  at: 100,
  side: 'challenger',
};

describe('corporation battle decisions', () => {
  it('reads only its corporation, requires complete readiness and rejects malformed responses', () => {
    expect(parseCorpBattles(view, 'a')).toEqual(view);
    for (const raw of [
      null,
      {},
      { ...view, corpId: 'b' },
      { ...view, ready: { ...view.ready, player: 'false' } },
      { ...view, challenges: [{ ...challenge, format: 30 }] },
      { ...view, results: [{ ...result, winnerCorp: 'outsider' }] },
    ])
      expect(parseCorpBattles(raw, 'a')).toBeNull();
  });
  it('keeps old results without inventing a battle breakdown', () => {
    const parsed = parseCorpBattles({ ...view, results: [result] }, 'a');
    expect(parsed?.results[0]).toEqual(result);
    expect(parsed?.results[0]?.report).toBeUndefined();
  });
  it('never treats a locked but unraised or unreachable match as an ongoing war', () => {
    expect(battlePhase(challenge, null)).toBe('roster');
    expect(battlePhase({ ...challenge, status: 'locked' }, null)).toBe('preparing');
    expect(battlePhase({ ...challenge, status: 'locked' }, { phase: 'peace' })).toBe('peace');
    expect(battlePhase({ ...challenge, status: 'locked' }, { phase: 'war' })).toBe('war');
    expect(battlePhase({ ...challenge, status: 'locked' }, { phase: 'ended' })).toBe('settling');
  });
  it('separates incoming, outgoing and closed calls, retaining server statuses', () => {
    const rows = [
      { ...challenge, status: 'pending' as const },
      { ...challenge, id: 'in', challengerCorp: 'c', targetCorp: 'a', status: 'pending' as const },
      { ...challenge, id: 'past', status: 'expired' as const },
      challenge,
    ];
    expect(challengeGroups(rows, 'a')).toEqual({
      incoming: [rows[1]],
      outgoing: [rows[0]],
      closed: [rows[2]],
    });
  });
  it('gates challenges by membership, readiness, format, existing matchup and influence', () => {
    const offer = (over = {}) =>
      opponentOffer({
        corpId: 'a',
        opponent: 'b',
        head: true,
        ready: true,
        mine: [2, 3],
        theirs: [3, 4],
        format: 0,
        maxFormat: 3,
        influence: 200,
        challenges: [],
        now: 10,
        ...over,
      });
    expect(offer()).toEqual({ kind: 'challenge', format: 3, cost: 150 });
    // Incoming preferences do not constrain an outgoing challenge accepted by the server.
    expect(offer({ mine: [2], theirs: [3] })).toEqual({ kind: 'challenge', format: 3, cost: 150 });
    expect(offer({ head: false }).kind).toBe('head');
    expect(offer({ ready: false }).kind).toBe('ready');
    expect(offer({ theirs: [4] }).kind).toBe('format');
    expect(offer({ influence: 149 }).kind).toBe('influence');
    expect(offer({ challenges: [challenge] }).kind).toBe('active');
    expect(offer({ challenges: [{ ...challenge, status: 'pending' }] }).kind).toBe('sent');
    expect(
      offer({
        challenges: [{ ...challenge, challengerCorp: 'b', targetCorp: 'a', status: 'pending' }],
      }).kind,
    ).toBe('answer');
    expect(offer({ challenges: [{ ...challenge, status: 'pending', expiresAt: 5 }] }).kind).toBe(
      'challenge',
    );
  });
  it('opens only formats granted by built levels, never an ordered future level', () => {
    expect(formatLimit(null)).toBe(3);
    expect(
      formatLimit({ buildings: [{ level: 1, levels: [{ maxFormat: 5 }, { maxFormat: 10 }] }] }),
    ).toBe(5);
  });
  it('uses the full tally for totals, and excludes bots and opposing seats from best fighters', () => {
    const tally = [
      { opponent: 'b', format: 2, wins: 3, losses: 1, draws: 1 },
      { opponent: 'b', format: 3, wins: 1, losses: 2, draws: 0 },
    ];
    expect(battleStats(tally, 0)).toEqual({ played: 8, wins: 4, losses: 3, draws: 1 });
    expect(battleStats(tally, 2).played).toBe(5);
    const seat = {
      side: 'challenger' as const,
      accountId: 'one',
      login: 'One',
      score: 10,
      provinces: 2,
      out: false,
      bot: false,
    };
    const report = {
      reason: null,
      provinces: 10,
      sides: { challenger: { score: 10, provinces: 2 }, target: { score: 1, provinces: 1 } },
      seats: [
        seat,
        { ...seat, accountId: undefined, bot: true, score: 900 },
        { ...seat, side: 'target' as const, accountId: 'foe', score: 100 },
      ],
    };
    expect(
      topCorpFighters(
        [
          { ...result, report },
          { ...result, matchupId: 'new', report },
        ],
        0,
      ),
    ).toEqual([{ accountId: 'one', login: 'One', score: 20, battles: 2 }]);
  });
  it('strips extra opponent data and never exposes the roster before war', () => {
    const war = {
      matchupId: 'm',
      side: 'challenger',
      phase: 'peace',
      score: 5,
      scoreGoal: 100,
      provinces: 2,
      capturable: 10,
      dominationPercent: 0.7,
      mine: [],
      rivals: { count: 1, seats: [{ login: 'Hidden', bot: false, out: false, score: 999 }] },
    };
    expect(parseCorpWar(war, 'm')?.rivals).toEqual({ count: 1 });
    expect(parseCorpWar({ ...war, phase: 'war' }, 'm')?.rivals.seats).toEqual([
      { login: 'Hidden', bot: false, out: false },
    ]);
    expect(parseCorpWar({ ...war, scoreGoal: 0 }, 'm')).toBeNull();
    expect(parseCorpWar(war, 'different')).toBeNull();
  });

  it('marks what waits on the member: a forming battle to join, a seat in a running one, a call to answer', () => {
    const base = { corpId: 'a', accountId: 'me', head: false, now: 10 };
    const forming = { ...challenge, id: 'f' };
    const running = { ...challenge, id: 'r', status: 'locked' as const };
    const call = {
      ...challenge,
      id: 'c',
      status: 'pending' as const,
      challengerCorp: 'z',
      targetCorp: 'a',
    };
    const rows = [forming, running, call];
    // Rosters not read yet: both battles count, the call only for the head.
    expect(battleAttention({ ...base, challenges: rows, rosters: {} })).toEqual({
      now: 2,
      challenges: 0,
    });
    expect(battleAttention({ ...base, head: true, challenges: rows, rosters: {} })).toEqual({
      now: 2,
      challenges: 1,
    });
    // Joined the forming one, no seat in the running one: nothing left to do.
    const joined = { f: { mine: [{ accountId: 'me' }] }, r: { mine: [{ accountId: 'x' }] } };
    expect(battleAttention({ ...base, challenges: rows, rosters: joined })).toEqual({
      now: 0,
      challenges: 0,
    });
    // A closed roster window and an expired call need nobody.
    expect(
      battleAttention({ ...base, head: true, now: 60, challenges: [forming, call], rosters: {} }),
    ).toEqual({ now: 0, challenges: 0 });
  });
});

describe('battlePostPath — маршрут кнопки битвы без тела', () => {
  it('готовность, ответ на вызов и вход в состав', () => {
    expect(battlePostPath('ready-corp', '')).toBe('/ava/ready/corp');
    expect(battlePostPath('ready-player-clear', '')).toBe('/ava/ready/player/clear');
    expect(battlePostPath('ava-withdraw', 'c/1')).toBe('/ava/challenge/c%2F1/withdraw');
    expect(battlePostPath('ava-join', 'm1')).toBe('/ava/matchup/m1/join');
  });
  it('прочие действия — не его', () => {
    expect(battlePostPath('ava-challenge', 'x')).toBeNull();
    expect(battlePostPath('ready-x', '')).toBeNull();
  });
});

describe('the win bonus a challenge promises (CORP-19)', () => {
  it('is the stake against an equal, more against a stronger corp, less against a weaker', () => {
    expect(winBonus(100)).toBe(100);
    expect(winBonus(100, 1000, 1200)).toBe(150);
    expect(winBonus(100, 1000, 1800)).toBe(200); // at most double
    expect(winBonus(100, 1600, 1000)).toBe(50); // at least half
    expect(battleRating(undefined)).toBe(1000);
  });
  it('a rematch inside the week promises half, the third one nothing', () => {
    const week = 7 * 24 * 3600 * 1000;
    const fought = [
      { challengerCorp: 'a', targetCorp: 'b', at: 100 },
      { challengerCorp: 'b', targetCorp: 'a', at: 200 },
      { challengerCorp: 'a', targetCorp: 'c', at: 300 },
    ];
    expect(pairRepeats(fought, 'a', 'b', 1000)).toBe(2);
    expect(pairRepeats(fought.slice(0, 1), 'a', 'b', 1000)).toBe(1);
    expect(pairRepeats(fought, 'a', 'b', 200 + week)).toBe(0);
    expect(winBonus(100, 1000, 1000, 1)).toBe(50);
    expect(winBonus(100, 1000, 1000, 2)).toBe(0);
  });
});
