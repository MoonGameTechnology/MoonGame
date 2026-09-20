/** Local dev host only. Pull the pending event forward; the kernel still owns
 * spawning, wave scaling, boons and arming the following wave. Never a net action. */
import type { GameState } from '../../packages/shared-core/src/index';

export function pullNextDevWave(state: GameState): GameState | null {
  if (!state.pve || state.match.status === 'ended' || state.pve.waveNumber >= state.pve.totalWaves)
    return null;
  const event = state.scheduled.find(e => e.type === 'pve.wave');
  if (!event) return null;
  return {
    ...state,
    pve: { ...state.pve, nextWaveAt: state.time },
    scheduled: state.scheduled.map(e => e === event ? { ...e, at: state.time } : e),
  };
}
