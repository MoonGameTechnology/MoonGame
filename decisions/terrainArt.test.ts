import { describe, expect, it } from 'vitest';
import { terrainArtKind } from './terrainArt';

describe('new terrain profiles decorate their real body kinds', () => {
  it('shows the shipped dust/depletion combinations without replacing body identity', () => {
    expect(terrainArtKind('asteroid', 'dust_lane')).toBe('dust_lane');
    expect(terrainArtKind('dead_world', 'dust_lane')).toBe('dust_lane');
    for (const kind of ['planet', 'dead_world', 'asteroid']) {
      expect(terrainArtKind(kind, 'depleted_system')).toBe('depleted_system');
    }
    expect(terrainArtKind('asteroid_cluster', 'asteroid_cluster')).toBe('asteroid_cluster');
    expect(terrainArtKind('rift', 'empty_space')).toBe('rift');
    expect(terrainArtKind('black_hole', 'depleted_system')).toBe('black_hole');
  });

  it('preserves all established kind/profile render choices and unknown fallbacks', () => {
    for (const [kind, terrain] of [
      ['planet', 'empty_space'], ['empty', 'deep_void'], ['asteroid', 'asteroid_field'],
      ['nebula', 'nebula'], ['dense_nebula', 'dense_nebula'], ['ion_storm', 'ion_storm'],
      ['solar_flare', 'solar_flare_zone'], ['graveyard', 'derelict_graveyard'],
      ['debris_field', 'deep_void'], ['dead_world', 'deep_void'],
      ['void_station', 'empty_space'], ['unknown', 'unknown'],
    ] as const) {
      expect(terrainArtKind(kind, terrain)).toBe(kind);
      expect(terrainArtKind(kind)).toBe(kind);
    }
  });
});
