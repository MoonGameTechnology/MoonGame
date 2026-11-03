import { describe, expect, it } from 'vitest';
import { eloDelta, liveShare, settleBattle, strengthFactor } from './avaEconomy';
import { AVA_FORMATS } from './avaFormats';
import type { AvaBattleReport, AvaSide } from './store/types';

const e = AVA_FORMATS.economy;
const even = { challenger: 1000, target: 1000 };
const weakChallenger = { challenger: 1000, target: 1400 };
const strongChallenger = { challenger: 1400, target: 1000 };
const base = { cost: 100, pairBattles: 0, bonusToday: 0, liveShare: 1 };

/** Net influence of each side from a 2 на 2 battle (stake 100), as the CORP-19 table. */
function net(winner: AvaSide | null, ratings: Record<AvaSide, number>, extra = {}): [number, number] {
  const out = settleBattle(e, { ...base, winner, ratings, ...extra });
  const challenger = -100 + out.refund + (winner === 'challenger' ? out.bonus : 0);
  const target = winner === 'target' ? out.bonus : 0;
  return [challenger, target];
}

describe('battle economy (CORP-19)', () => {
  it('pays the scenarios of the economy table', () => {
    expect(net('challenger', even)).toEqual([100, 0]);
    expect(net('target', even)).toEqual([-100, 50]);
    expect(net('challenger', weakChallenger)).toEqual([200, 0]); // the weak beat the strong
    expect(net('target', weakChallenger)).toEqual([-100, 25]);
    expect(net('challenger', strongChallenger)).toEqual([50, 0]); // the strong beat the weak
    expect(net('target', strongChallenger)).toEqual([-100, 100]);
    expect(net(null, even)).toEqual([-50, 0]); // a draw returns half the stake
  });

  it('k grows with the loser’s strength and stays within 0.5…2', () => {
    expect(strengthFactor(e, 1000, 1000)).toBe(1);
    expect(strengthFactor(e, 1000, 1200)).toBe(1.5);
    expect(strengthFactor(e, 1000, 2000)).toBe(2);
    expect(strengthFactor(e, 2000, 1000)).toBe(0.5);
  });

  it('a repeated pair earns 100 %, 50 %, then nothing; the stake still comes back', () => {
    expect(net('challenger', even, { pairBattles: 1 })).toEqual([50, 0]);
    expect(net('challenger', even, { pairBattles: 2 })).toEqual([0, 0]);
    expect(net('challenger', even, { pairBattles: 9 })).toEqual([0, 0]);
  });

  it('stops at the daily cap, which never takes back what was already won', () => {
    const at = (bonusToday: number) =>
      settleBattle(e, { ...base, cost: 500, winner: 'challenger', ratings: even, bonusToday }).bonus;
    expect(at(0)).toBe(500);
    expect(at(1800)).toBe(200);
    expect(at(2500)).toBe(0);
  });

  it('bots in the losing side’s seats shrink the bonus by its share of players', () => {
    expect(net('challenger', even, { liveShare: 0.5 })).toEqual([50, 0]);
    const report = (bots: number): AvaBattleReport => ({
      reason: 'domination',
      provinces: 10,
      sides: { challenger: { score: 1, provinces: 6 }, target: { score: 0, provinces: 4 } },
      seats: [0, 1, 2, 3].map((i) => ({
        side: 'target' as const,
        accountId: i < bots ? null : `p${i}`,
        login: null,
        score: 0,
        provinces: 1,
        out: false,
      })),
    });
    expect(liveShare(report(1), 'target')).toBe(0.75);
    expect(liveShare(report(0), 'target')).toBe(1);
    expect(liveShare(null, 'target')).toBe(1);
  });

  it('moves the ratings by Elo: zero-sum, more for an upset', () => {
    const out = settleBattle(e, { ...base, winner: 'challenger', ratings: weakChallenger });
    expect(out.rating.challenger).toBe(29);
    expect(out.rating.target).toBe(-29);
    expect(eloDelta(e, 1000, 1000, 1)).toBe(16);
    expect(eloDelta(e, 1000, 1000, 0.5)).toBe(0);
    expect(settleBattle(e, { ...base, winner: null, ratings: weakChallenger }).rating.challenger).toBe(13);
  });
});
