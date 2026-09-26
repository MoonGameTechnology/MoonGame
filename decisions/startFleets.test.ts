import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import { freshSectorZeroProgress, prepareSectorZeroRun } from './sectorZeroProgress';
import { startFleetMerges } from './startFleets';

const data = shippedGameData();
const start = (mission: number) =>
  prepareSectorZeroRun(pveState(data, mission), freshSectorZeroProgress(data), data);

describe('стартовые флоты главы — одним флотом (решение владельца 2026-09-26)', () => {
  it('флоты у дома вливаются в корабль героя', () => {
    const s = start(0);
    const merges = startFleetMerges(s, 'p1');
    const into = new Set(merges.map((m) => m.into));
    expect([...into]).toEqual(['sector-zero:flagship']);
    expect(merges.map((m) => m.from).sort()).toEqual(['p1_1', 'p1_2']);
  });

  it('флот в другой точке остаётся своим — у конвоя своя задача', () => {
    const s = start(1);
    const merges = startFleetMerges(s, 'p1');
    expect(merges.some((m) => m.from === 'p1_evac' || m.into === 'p1_evac')).toBe(false);
    expect(merges.length).toBeGreaterThan(0);
  });

  it('без героя — в первый по id; одинокий флот не трогается', () => {
    const s = start(0);
    delete s.fleets['sector-zero:flagship'];
    for (const h of Object.values(s.heroes ?? {})) h.alive = false;
    expect(startFleetMerges(s, 'p1')).toEqual([{ from: 'p1_2', into: 'p1_1' }]);
    delete s.fleets.p1_2;
    expect(startFleetMerges(s, 'p1')).toEqual([]);
  });
});
