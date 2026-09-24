import { describe, expect, it } from 'vitest';

import type { GameState } from '../packages/shared-core/src/index';
import { metaUnlocks, pveOutcomeEvent } from './runAnalytics';
import type { SectorZeroProgress } from './sectorZeroProgress';

const HOUR = 3_600_000;
const run = { chapter: 'landing', attempt: 4 };

/** Только поля, которые читает решение: остальной мир ему не нужен. */
function ended(winners: string[], waveNumber = 7, time = 44 * HOUR): GameState {
  return {
    time,
    pve: { waveNumber, totalWaves: 10 },
    match: { status: 'ended', winner: winners[0] ?? null, winners },
  } as unknown as GameState;
}

function profile(p: Partial<SectorZeroProgress> = {}): SectorZeroProgress {
  return {
    chaptersWon: [],
    heroes: {},
    modules: [],
    stars: {},
    moduleRarity: {},
    ...p,
  } as unknown as SectorZeroProgress;
}

describe('YAG-5.1 — исход забега для аналитики', () => {
  it('игрок среди победителей — `pve_completed` с главой, попыткой, волнами и часами', () => {
    expect(pveOutcomeEvent(ended(['p1']), 'p1', run)).toEqual({
      event: 'pve_completed',
      props: { chapter: 'landing', attempt: 4, waves: 7, totalWaves: 10, hours: 44 },
    });
  });

  it('победил Рой — `pve_failed`', () => {
    expect(pveOutcomeEvent(ended(['p2']), 'p1', run)?.event).toBe('pve_failed');
  });

  it('мир не доигран или это не забег — события нет', () => {
    const live = { ...ended(['p1']), match: { status: 'running' } } as unknown as GameState;
    expect(pveOutcomeEvent(live, 'p1', run)).toBeNull();
    const noPve = { ...ended(['p1']), pve: undefined } as unknown as GameState;
    expect(pveOutcomeEvent(noPve, 'p1', run)).toBeNull();
  });
});

describe('YAG-5.1 — что профиль открыл за запись (`meta_unlock`)', () => {
  it('новая глава, герой, модуль, звезда и редкость — по событию на каждое', () => {
    const before = profile({
      chaptersWon: ['landing'],
      modules: ['radar_module'],
      stars: { radar_module: 1 },
    });
    const after = profile({
      chaptersWon: ['landing', 'rift'],
      heroes: { vega: {} as never },
      modules: ['radar_module', 'shield_booster'],
      stars: { radar_module: 2 },
      moduleRarity: { radar_module: 'unique' },
    });
    expect(metaUnlocks(before, after)).toEqual([
      { kind: 'chapter', id: 'rift' },
      { kind: 'hero', id: 'vega' },
      { kind: 'module', id: 'shield_booster' },
      { kind: 'star', id: 'radar_module', stars: 2 },
      { kind: 'rarity', id: 'radar_module', rarity: 'unique' },
    ]);
  });

  it('редкость — только подъём: следующая ступень открывается, та же и ниже — нет', () => {
    const unique = profile({ moduleRarity: { radar_module: 'unique' } });
    const mythic = profile({ moduleRarity: { radar_module: 'mythic' } });
    expect(metaUnlocks(unique, mythic)).toEqual([
      { kind: 'rarity', id: 'radar_module', rarity: 'mythic' },
    ]);
    expect(metaUnlocks(mythic, unique)).toEqual([]);
  });

  it('та же запись второй раз и откат ничего не открывают', () => {
    const p = profile({
      chaptersWon: ['landing'],
      stars: { radar_module: 2 },
      moduleRarity: { radar_module: 'unique' },
    });
    expect(metaUnlocks(p, p)).toEqual([]);
    expect(metaUnlocks(p, profile())).toEqual([]);
  });
});
