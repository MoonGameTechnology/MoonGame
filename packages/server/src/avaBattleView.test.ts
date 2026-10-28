import { describe, expect, it } from 'vitest';
import { buildStateFromMap, type GameState } from '@void/shared-core';
import { avaBattleReport, avaWarView, parseAvaBattleReport } from './avaBattleView';
import { seatAvaRoster } from './avaOrchestrator';
import { loadAvaMaps, loadShippedData } from './scenario';

// CORP-9 — the battle as a corporation sees it from the hub: the breakdown recorded with the
// result, and the war view of one side. The battle is the small 2 на 2 AvA map: nine
// capturable provinces, two seats a side, the target's second seat a bot.

const data = loadShippedData();
const { retired } = loadAvaMaps(data);
const rules = { scoreLimit: 600, coalitionFactor: 0.7, dominationPercent: 0.6 };
const logins = { 'acc-a1': 'alpha', 'acc-a2': 'beta', 'acc-b1': 'gamma' };

function battle(mapId = 'ava-2v2-1'): { state: GameState; seats: Record<string, string> } {
  const map = retired.find((m) => m.id === mapId)!;
  const roster =
    mapId === 'ava-duel-1'
      ? { challenger: ['acc-a1'], target: ['acc-b1'] }
      : { challenger: ['acc-a1', 'acc-a2'], target: ['acc-b1'] };
  const { slots, seats } = seatAvaRoster(map, roster);
  return { state: buildStateFromMap(map, data, { slots, crossTeamStart: 'peace' }), seats };
}

/** Day N of the 2 на 2: the challenger took a province each and the bot's home, the bot is
 *  out, the target's player took one. */
function midWar(): { state: GameState; seats: Record<string, string> } {
  const b = battle();
  const { state } = b;
  state.planets.west!.owner = 'slot_a1';
  state.planets.home_b2!.owner = 'slot_a2';
  state.planets.east!.owner = 'slot_b1';
  state.players['bot:slot_b2']!.status = 'defeated';
  const score = (total: number) => ({ controlledPlanets: 0, fleets: 0, units: 0, total });
  state.match.scores = {
    slot_a1: score(300.4),
    slot_a2: score(150),
    slot_b1: score(200),
    'bot:slot_b2': score(100.6),
  };
  return b;
}

describe('avaBattleReport (CORP-9) — the breakdown recorded with the result', () => {
  it('lists every seat with its score and provinces, and both sides’ totals', () => {
    const { state, seats } = midWar();
    state.match.status = 'ended';
    state.match.reason = 'elimination';
    expect(avaBattleReport(state, data, seats, logins, 777)).toEqual({
      reason: 'elimination',
      warAt: 777,
      provinces: 9,
      sides: {
        challenger: { score: 450, provinces: 4 },
        target: { score: 301, provinces: 2 },
      },
      seats: [
        { side: 'target', accountId: null, login: null, score: 101, provinces: 0, out: true },
        {
          side: 'challenger',
          accountId: 'acc-a1',
          login: 'alpha',
          score: 300,
          provinces: 2,
          out: false,
        },
        {
          side: 'challenger',
          accountId: 'acc-a2',
          login: 'beta',
          score: 150,
          provinces: 2,
          out: false,
        },
        {
          side: 'target',
          accountId: 'acc-b1',
          login: 'gamma',
          score: 200,
          provinces: 2,
          out: false,
        },
      ],
    });
  });

  it('keeps no reason the battle cannot end by, and no war it never had', () => {
    const { state, seats } = midWar();
    state.match.reason = 'pve-cleared';
    const report = avaBattleReport(state, data, seats, {});
    expect(report?.reason).toBeNull();
    expect(report).not.toHaveProperty('warAt');
    expect(report?.seats.map((seat) => seat.login)).toEqual([null, null, null, null]);
  });

  it('is no breakdown for a state that is not a two-sided battle', () => {
    const { state, seats } = midWar();
    delete state.players.slot_b1!.team;
    delete state.players['bot:slot_b2']!.team;
    expect(avaBattleReport(state, data, seats, logins)).toBeNull();
  });
});

describe('parseAvaBattleReport (CORP-9) — what the corporations accept with a settlement', () => {
  const { state, seats } = midWar();
  state.match.reason = 'score';
  const report = avaBattleReport(state, data, seats, logins, 5)!;

  it('takes a breakdown as it is and drops unknown fields', () => {
    expect(parseAvaBattleReport(report)).toEqual(report);
    const extra = { ...report, note: 'x', seats: report.seats.map((s) => ({ ...s, extra: 1 })) };
    expect(parseAvaBattleReport(extra)).toEqual(report);
  });

  it('refuses anything else, whole', () => {
    const seat = report.seats[1]!;
    for (const bad of [
      null,
      undefined,
      'report',
      { ...report, reason: 'pve-cleared' },
      { ...report, provinces: -1 },
      { ...report, seats: [{ ...seat, score: '300' }] },
      { ...report, seats: [{ ...seat, side: 'neutral' }] },
      { ...report, seats: [{ ...seat, login: 'x'.repeat(97) }] },
      { ...report, seats: Array.from({ length: 41 }, () => seat) },
      { ...report, sides: { challenger: report.sides.challenger } },
    ]) {
      expect(parseAvaBattleReport(bad)).toBeNull();
    }
  });
});

describe('avaWarView (CORP-9) — the war of one side, from the hub', () => {
  it('in peace: the side’s own course, and only how many rivals signed up', () => {
    const { state, seats } = midWar();
    const view = avaWarView({
      matchupId: 'mu',
      side: 'challenger',
      session: { seats, warAt: 9_000 },
      state,
      rules,
      data,
      logins,
    });
    expect(view).toEqual({
      matchupId: 'mu',
      side: 'challenger',
      phase: 'peace',
      warAt: 9_000,
      score: 450,
      scoreGoal: 840, // 600 × 2 seats × 0.7
      provinces: 4,
      capturable: 9,
      dominationPercent: 0.6,
      mine: [
        { accountId: 'acc-a1', login: 'alpha', score: 300, provinces: 2, out: false },
        { accountId: 'acc-a2', login: 'beta', score: 150, provinces: 2, out: false },
      ],
      rivals: { count: 1 },
    });
  });

  it('at war: who the rivals are and who is out, never their score or land', () => {
    const { state, seats } = midWar();
    const view = avaWarView({
      matchupId: 'mu',
      side: 'challenger',
      session: { seats, warAt: 9_000, warDeclaredAt: 9_100 },
      state,
      rules,
      data,
      logins,
    });
    expect(view?.phase).toBe('war');
    expect(view?.warAt).toBe(9_100);
    expect(view?.rivals).toEqual({
      count: 1,
      seats: [
        { bot: true, login: null, out: true },
        { bot: false, login: 'gamma', out: false },
      ],
    });
  });

  it('the other side sees its own bot among its seats and both challengers as rivals', () => {
    const { state, seats } = midWar();
    state.match.status = 'ended';
    const view = avaWarView({
      matchupId: 'mu',
      side: 'target',
      session: { seats, warAt: 9_000, warDeclaredAt: 9_100 },
      state,
      rules,
      data,
      logins,
    });
    expect(view).toMatchObject({
      phase: 'ended',
      score: 301,
      provinces: 2,
      mine: [
        { accountId: null, login: null, score: 101, provinces: 0, out: true },
        { accountId: 'acc-b1', login: 'gamma', score: 200, provinces: 2, out: false },
      ],
      rivals: {
        count: 2,
        seats: [
          { bot: false, login: 'alpha', out: false },
          { bot: false, login: 'beta', out: false },
        ],
      },
    });
  });

  it('a side of one races to the score limit itself', () => {
    const { state, seats } = battle('ava-duel-1');
    const view = avaWarView({
      matchupId: 'mu',
      side: 'target',
      session: { seats },
      state,
      rules,
      data,
      logins,
    });
    expect(view).toMatchObject({ phase: 'peace', scoreGoal: 600, rivals: { count: 1 } });
    expect(view).not.toHaveProperty('warAt');
  });
});
