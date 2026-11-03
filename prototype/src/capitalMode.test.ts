import { describe, expect, it } from 'vitest';
import { advance, data, newGame, DAY } from './game';
import { ctx, kernel } from './protoKernel';
import { scoreParts } from './scoreParts';
import { victoryFor } from './mapCatalog';
import { networkSeats } from './matchSetup';

describe('authored capital modes and saved rules', () => {
  it.each(['duel-1', 'team-2v2'] as const)(
    '%s starts with capitals, a named mode and reduced building scoring',
    (mapId) => {
      const s = newGame({ mapId, seats: networkSeats(mapId === 'duel-1' ? '1v1' : '2v2', mapId) });
      expect(s.modeId).toBe(mapId === 'duel-1' ? 'capital_duel' : 'capital_2v2');
      expect(victoryFor(s).capitalCapture).toBe(true);
      expect(s.match.buildingScoreDivisor).toBe(3);
      expect(Object.keys(s.capital ?? {})).toHaveLength(mapId === 'duel-1' ? 2 : 4);
      const restored = JSON.parse(JSON.stringify(s));
      expect(ctx(0, restored).config?.victory?.capitalCapture).toBe(true);
      const action = {
        id: 'locked',
        playerId: 'p1',
        type: 'capital.designate',
        payload: { planetId: s.capital!.p1 },
        issuedAt: 0,
      };
      expect(kernel.applyAction(restored, action, ctx(0, restored))).toMatchObject({
        ok: false,
        code: 'E_CAPITAL_LOCKED',
      });
    },
  );
  it('restores old mode ids and the old score scale instead of replacing a live contest', () => {
    const s = newGame({ mapId: 'team-2v2', seats: networkSeats('2v2', 'team-2v2') });
    s.modeId = 'team_2v2';
    delete s.match.buildingScoreDivisor;
    expect(ctx(0, s).config?.victory?.capitalCapture).toBeUndefined();
    expect(victoryFor(s).capitalCapture).toBeUndefined();
    const next = advance(s, DAY).state;
    const parts = scoreParts(next, data);
    for (const [id, score] of Object.entries(next.match.scores))
      expect(parts[id]?.total).toBe(score.total);
  });
});
