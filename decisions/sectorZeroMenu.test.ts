import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState, pveModeId } from '../packages/client/src/gameData';
import { parseRunSave, RUN_SAVE_VERSION } from './runSave';
import { sectorZeroRunPreview } from './sectorZeroMenu';

describe('Sector Zero Continue offer', () => {
  it('never offers an ended or foreign-mode save, and can read an old live run without meta fields', () => {
    const state = pveState(shippedGameData());
    state.pve = { waveNumber: 3, totalWaves: 10, npcPlayerId: 'p3' };
    const save = { v: RUN_SAVE_VERSION, mode: pveModeId()!, difficulty: 'strong', state };
    expect(sectorZeroRunPreview(save, save.mode)).toEqual({
      wave: 3,
      total: 10,
      difficulty: 'strong',
    });
    expect(sectorZeroRunPreview(save, 'other')).toBeNull();
    state.match.status = 'ended';
    expect(sectorZeroRunPreview(save, save.mode)).toBeNull();
    expect(
      sectorZeroRunPreview(
        parseRunSave('{"v":1,"mode":"pve_waves","difficulty":"weak","state":{}}'),
        'pve_waves',
      ),
    ).toBeNull();
  });
});
