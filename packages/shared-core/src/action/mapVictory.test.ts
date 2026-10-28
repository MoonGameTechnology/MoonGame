import { describe, expect, it } from 'vitest';
import { MAP_SCORE_LIMITS, mapVictoryRules } from './mapVictory';

describe('mapVictoryRules — правила победы карты, одна таблица на все хосты', () => {
  it('отдаёт порог карты и её долю захвата, если она своя', () => {
    expect(mapVictoryRules('team-2v2')).toEqual({ scoreLimit: MAP_SCORE_LIMITS['team-2v2'] });
    expect(mapVictoryRules('duel-1')).toEqual({
      scoreLimit: MAP_SCORE_LIMITS['duel-1'],
      dominationPercent: 0.8,
    });
  });

  it('карта вне таблицы правил не задаёт: остаются режим и ядро', () => {
    for (const mapId of [undefined, 'custom-map', 'toString', '__proto__']) {
      expect(mapVictoryRules(mapId)).toBeUndefined();
    }
  });
});
