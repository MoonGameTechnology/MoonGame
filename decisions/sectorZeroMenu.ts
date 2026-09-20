import type { GameState } from '../packages/shared-core/src/index';
import { parseRunDifficulty, type RunDifficulty } from './runDifficulty';
import type { RunSave } from './runSave';

/** Only live runs of the installed PvE mode get a Continue action. A saved match
 * must never be installed merely to draw its menu card: that starts the clock and
 * can open a boon picker over the menu. Full restoration belongs to the host. */
export interface RunPreview {
  wave: number;
  total: number;
  difficulty: RunDifficulty;
}

export function sectorZeroRunPreview(save: RunSave | null, mode: string): RunPreview | null {
  if (!save || save.mode !== mode) return null;
  const state = save.state as Partial<GameState>;
  const pve = state.pve;
  if (
    !pve ||
    !state.players?.p1 ||
    !state.planets ||
    !state.fleets ||
    !Array.isArray(state.scheduled) ||
    !Number.isFinite(state.time) ||
    !state.match ||
    state.match.status === 'ended' ||
    !Number.isInteger(pve.waveNumber) ||
    !Number.isInteger(pve.totalWaves) ||
    pve.waveNumber < 0 ||
    pve.totalWaves < 1 ||
    pve.waveNumber > pve.totalWaves
  )
    return null;
  return {
    wave: pve.waveNumber,
    total: pve.totalWaves,
    difficulty: parseRunDifficulty(save.difficulty),
  };
}
