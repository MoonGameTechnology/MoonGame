import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import { provinceBuildingScore } from './sectorKind';
const data = parseGameData({
  version: 'score-test',
  resources: ['metal'],
  units: {},
  factions: {},
  events: {},
  buildings: { mine: { name: 'Mine', scoreValue: 4 }, yard: { name: 'Yard', scoreValue: 6 } },
  scoring: { buildingDivisor: 3 },
});
describe('reduced building score', () => {
  it('divides aggregate building worth by three after counting levels', () => {
    expect(
      provinceBuildingScore(data, {
        buildings: [
          { type: 'mine', level: 3 },
          { type: 'yard', level: 2 },
        ],
      }),
    ).toBe(8);
  });
  it('rounds once per province, not once per building', () => {
    expect(
      provinceBuildingScore(data, {
        buildings: [
          { type: 'mine', level: 1 },
          { type: 'mine', level: 2 },
        ],
      }),
    ).toBe(4);
    expect(provinceBuildingScore(data, { buildings: [{ type: 'mine', level: 2 }] })).toBe(2);
  });
  it('keeps territory out of the reduction and ignores unknown structures', () => {
    expect(provinceBuildingScore(data, { buildings: [{ type: 'unknown', level: 100 }] })).toBe(0);
  });
  it('keeps a saved divisor, including legacy unscaled scores', () => {
    const planet = { buildings: [{ type: 'mine', level: 6 }] };
    expect(provinceBuildingScore(data, planet, 1)).toBe(24);
    expect(provinceBuildingScore({ ...data, scoring: { buildingDivisor: 4 } }, planet, 3)).toBe(8);
  });
  it.each([0, -1, 1.5, Infinity, NaN])('refuses an invalid divisor %s', (buildingDivisor) => {
    expect(() => parseGameData({ ...data, scoring: { buildingDivisor } })).toThrow();
  });
});
