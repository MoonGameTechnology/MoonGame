import type { GameState } from '../packages/shared-core/src/index';
import type { RunDifficulty } from './runDifficulty';

/** The same controllers on launch and restore. Old saves lack `ai` on the Swarm;
 *  only map inhabitants require an explicit field AI opt-in. An unpiloted NPC
 *  still participates in core combat, but never receives expansion orders. */
export function runAiSeats(state: GameState, me: string, difficulty: RunDifficulty): Map<string, RunDifficulty> {
  return new Map(Object.values(state.players)
    .filter((p) => p.id !== me && (!p.npc || p.ai === true))
    .map((p) => [p.id, difficulty]));
}
