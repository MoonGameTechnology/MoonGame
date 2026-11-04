import { describe, expect, it } from 'vitest';
import { newMatchSummary } from './newMatchSettings';

describe('настройки нового матча', () => {
  it('обычная карта: каждый сам за себя, порог очков и доля карты', () => {
    expect(
      newMatchSummary({ seats: 4, victory: { scoreLimit: 790, dominationPercent: 0.8 } }),
    ).toEqual({
      players: { key: 'browser.create.players', params: { n: 4 } },
      mode: { key: 'browser.create.ffa' },
      goals: [
        { key: 'browser.description.score', params: { n: 790 } },
        { key: 'browser.description.domination', params: { p: 80 } },
      ],
    });
  });

  it('без доли карты остаётся только порог', () => {
    expect(newMatchSummary({ seats: 6, modeId: 'team_3v3', victory: { scoreLimit: 3000 } }).goals)
      .toEqual([{ key: 'browser.description.score', params: { n: 3000 } }]);
  });

  it('режим карты называется по данным', () => {
    expect(newMatchSummary({ seats: 6, modeId: 'team_3v3', victory: { scoreLimit: 1 } }).mode)
      .toEqual({ dataName: 'team_3v3' });
  });

  it('захват столиц заменяет порог очков и долю карты', () => {
    expect(
      newMatchSummary({
        seats: 4,
        modeId: 'capital_2v2',
        victory: { scoreLimit: 2200, dominationPercent: 0.6, capitalCapture: true },
      }).goals,
    ).toEqual([{ key: 'browser.description.capitals' }]);
  });
});
