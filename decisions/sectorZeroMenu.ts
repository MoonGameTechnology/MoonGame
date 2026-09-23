import type { GameState } from '../packages/shared-core/src/index';
import { parseRunDifficulty, type RunDifficulty } from './runDifficulty';
import type { RunSave } from './runSave';
import type { PortableRunSave } from './portableRun';

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

/**
 * Карточка «Продолжить» по ДЕСКРИПТОРУ забега (`YAG-2.1`) — когда полного снимка нет или
 * он не читается (игру обновили, форма мира сменилась). Только для выбранной миссии:
 * дескриптор принадлежит своей. `totalWaves` — длина забега из текущих данных режима; её
 * нет (режим пропал из данных) — карточки нет. Забег, дошедший до последней волны, не
 * продолжают: его место — расчёт награды, а не запуск.
 */
export function portableRunPreview(
  save: PortableRunSave | null,
  mode: string,
  totalWaves: number,
): RunPreview | null {
  if (!save || save.mode !== mode || !(totalWaves > 0) || save.wave >= totalWaves) return null;
  return { wave: save.wave, total: totalWaves, difficulty: parseRunDifficulty(save.difficulty) };
}
