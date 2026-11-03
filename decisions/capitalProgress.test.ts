import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { capitalProgress } from './capitalProgress';

function state() {
  const s = createInitialState({ seed: 'progress', version: { data: 'test', manifest: 'test' } });
  s.modeId = 'capital_2v2';
  for (let i = 1; i <= 4; i++) {
    const id = `p${i}`;
    s.players[id] = {
      id,
      name: id,
      faction: '',
      resources: {},
      status: 'active',
      team: i <= 2 ? 'A' : 'B',
    };
  }
  return s;
}
describe('capital progress', () => {
  it('shows both targets before the first scoreboard update', () => {
    expect(capitalProgress(state(), 'p1')).toEqual({ captured: 0, total: 2 });
  });
  it('counts captures by both teammates from public goals without reading the fogged map', () => {
    const s = state();
    s.match.capitalObjectives = {
      p1: { planetId: 'a', owner: 'p1' },
      p2: { planetId: 'b', owner: 'p2' },
      p3: { planetId: 'c', owner: 'p1' },
      p4: { planetId: 'd', owner: 'p2' },
    };
    expect(capitalProgress(s, 'p1')).toEqual({ captured: 2, total: 2 });
    expect(capitalProgress(s, 'p2')).toEqual({ captured: 2, total: 2 });
    expect(capitalProgress(s, 'p3')).toEqual({ captured: 0, total: 2 });
    s.match.capitalObjectives.p3!.owner = 'p4';
    expect(capitalProgress(s, 'p1')).toEqual({ captured: 1, total: 2 });
  });
});
