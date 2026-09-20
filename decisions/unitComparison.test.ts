import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
const data = shippedGameData();
import { unitComparison } from './unitComparison';

describe('unit comparison', () => {
  it('reads both sides from the current catalog without changing it', () => {
    const snapshot = JSON.stringify(data);
    const ids = Object.keys(data.units);
    const a = ids[0]!;
    const b = data.modes.pve_waves!.pve!.waveFleet![0]!.unit;
    expect(b).toBeDefined();
    const rows = unitComparison(data, a, b);
    expect(rows.find(r => r.label === 'loadout.stat.hp')).toEqual({ label: 'loadout.stat.hp', left: data.units[a]!.stats.hp, right: data.units[b]!.stats.hp });
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(unitComparison(data, 'absent', b)).toEqual([]);
  });
});
