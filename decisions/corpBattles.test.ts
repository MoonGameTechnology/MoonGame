import { describe, expect, it } from 'vitest';
import {
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
});
