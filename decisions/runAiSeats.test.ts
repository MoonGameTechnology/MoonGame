import { describe, expect, it } from 'vitest';
import { pveState, shippedGameData } from '../packages/client/src/gameData';
import type { GameState } from '../packages/shared-core/src/index';
import { runAiSeats } from './runAiSeats';

describe('run controllers', () => {
  it('restores Swarm difficulty without waking the stationary pirates', () => {
    const saved = JSON.stringify(pveState(shippedGameData()));
    for (const difficulty of ['weak', 'strong'] as const) {
      const restored: GameState = JSON.parse(saved);
      expect([...runAiSeats(restored, 'p1', difficulty)]).toEqual([['p3', difficulty]]);
    }
  });

  it('keeps old Swarm saves working and honours explicit NPC field AI', () => {
    const state = pveState(shippedGameData());
    delete state.players.p3!.ai;
    state.players.pirates!.ai = true;
    expect([...runAiSeats(state, 'p1', 'weak')]).toEqual([['p3', 'weak'], ['pirates', 'weak']]);
  });
});
