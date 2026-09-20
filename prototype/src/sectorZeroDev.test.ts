import { afterEach, describe, expect, it } from 'vitest';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
import { data } from './gameData';
import { advance, setMatchMode } from './protoKernel';
import { pullNextDevWave } from './sectorZeroDev';

afterEach(() => setMatchMode(undefined));
function run() {
  setMatchMode(pveModeId());
  return advance(pveState(data), 1).state;
}
describe('Sector Zero dev waves', () => {
  it('pulls one event forward without editing the source or skipping world time', () => {
    const state = run();
    const before = JSON.stringify(state);
    const next = pullNextDevWave(state)!;
    expect(JSON.stringify(state)).toBe(before);
    expect(next.time).toBe(state.time);
    expect(next.scheduled.filter(e => e.type !== 'pve.wave')).toEqual(state.scheduled.filter(e => e.type !== 'pve.wave'));
    const fired = advance(next, next.time + 1);
    expect(fired.error).toBeUndefined();
    expect(fired.state.pve!.waveNumber).toBe(1);
    expect(fired.state.fleets['pve:wave:1']).toBeDefined();
    expect(fired.events.filter(e => e.type === 'pve.wave.spawned')).toHaveLength(1);
    expect(fired.state.scheduled.filter(e => e.type === 'pve.wave')).toHaveLength(1);
    expect(fired.state.pve!.nextWaveAt).toBeGreaterThan(fired.state.time);
    const second = pullNextDevWave(fired.state)!;
    expect(advance(second, second.time + 1).state.pve!.waveNumber).toBe(2);
  });
  it('refuses terminal, non-PvE, exhausted and unarmed runs', () => {
    const state = run();
    expect(pullNextDevWave({ ...state, pve: undefined })).toBeNull();
    expect(pullNextDevWave({ ...state, match: { ...state.match, status: 'ended' } })).toBeNull();
    expect(pullNextDevWave({ ...state, scheduled: [] })).toBeNull();
    expect(pullNextDevWave({ ...state, pve: { ...state.pve!, waveNumber: state.pve!.totalWaves } })).toBeNull();
  });
});
