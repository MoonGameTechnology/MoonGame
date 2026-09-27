import { describe, expect, it } from 'vitest';
import { corpConstructionProgress, parseCorpInfrastructure } from './corpInfrastructure';
import { updateCorpInfrastructure } from '../packages/server/src/corpConstruction';

function fixture() {
  const result = updateCorpInfrastructure('corp', 'head', 'head', 0, null, 0).result;
  if (!result.ok) throw new Error(result.code);
  return result.infrastructure;
}

describe('corporation infrastructure presentation', () => {
  it('rejects broken responses and never enables an unknown purchase', () => {
    const valid = fixture();
    expect(parseCorpInfrastructure(valid)).not.toBe(null);
    for (const input of [
      null,
      {},
      { ...valid, influence: -1 },
      { ...valid, buildings: [null] },
      { ...valid, construction: { buildingId: 'unknown' } },
      { ...valid, buildings: [{ ...valid.buildings[0], blocked: 'E_FUTURE' }] },
    ]) {
      expect(parseCorpInfrastructure(input)).toBe(null);
    }
  });

  it('countdown reaches zero without granting a level locally', () => {
    const data = fixture();
    data.construction = {
      buildingId: 'headquarters',
      level: 1,
      cost: 0,
      startedAt: 0,
      completesAt: 1000,
    };
    expect(corpConstructionProgress(data, 500)).toEqual({ percent: 50, remainingMs: 500 });
    expect(corpConstructionProgress(data, 5000)).toEqual({ percent: 100, remainingMs: 0 });
    expect(corpConstructionProgress(data, -100)).toEqual({ percent: 0, remainingMs: 1000 });
    expect(data.buildings[0]?.level).toBe(0);
  });
});
