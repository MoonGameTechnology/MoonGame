import { describe, expect, it, vi } from 'vitest';
import type { TerrainEnvironment, TerrainEnvironmentTile } from '../../../decisions/terrainEnvironment';
import { drawTerrainEnvironment, drawTerrainEnvironmentTile } from './terrainEnvironmentDraw';

const tile: TerrainEnvironmentTile = {
  id: '0,0', x: 0, y: 0, size: 256,
  box: { x: 238, y: 10, width: 48, height: 40 }, fingerprint: 'test',
  clipPolygons: [
    [[0, 0], [256, 0], [256, 256], [0, 256]],
    [[256, 0], [512, 0], [512, 256], [256, 256]],
  ],
  features: [
    { id: 'rock', family: 'asteroid', color: '#95b8c5', detail: 'major',
      paths: [{ points: [[240, 20], [280, 20], [270, 40]], closed: true, alpha: 0.4, width: 0.8 }] },
    { id: 'pebble', family: 'asteroid', color: '#95b8c5', detail: 'minor',
      paths: [{ points: [[250, 20], [255, 20], [252, 24]], closed: true, alpha: 0.3, width: 0.6 }] },
  ],
};

function recorder(): {
  g: CanvasRenderingContext2D;
  paths: number[][][];
  clips: number[][][];
  calls: { save: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>; clip: ReturnType<typeof vi.fn> };
} {
  let path: number[][] = [];
  const paths: number[][][] = [];
  const clips: number[][][] = [];
  const calls = { save: vi.fn(), restore: vi.fn(), clip: vi.fn(() => clips.push(path)) };
  const g = {
    ...calls, beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => path.push([x, y]),
    lineTo: (x: number, y: number) => path.push([x, y]),
    closePath: () => {}, stroke: () => paths.push(path), fill: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { g, paths, clips, calls };
}

describe('continuous terrain painter', () => {
  it('clips once against the union and preserves an entire silhouette across provinces and tile grid', () => {
    const r = recorder();
    drawTerrainEnvironmentTile(r.g, tile, { scale: 2, x: -20, y: 7 });
    expect(r.calls.clip).toHaveBeenCalledExactlyOnceWith('nonzero');
    expect(r.clips[0]).toHaveLength(8);
    expect(r.paths[0]).toEqual([[460, 47], [540, 47], [520, 87]]);
    expect(r.calls.save).toHaveBeenCalledTimes(1);
    expect(r.calls.restore).toHaveBeenCalledTimes(1);
  });

  it('removes only micro-detail in simplified mode without moving the major outline', () => {
    const full = recorder(), simple = recorder();
    const at = { scale: 1, x: 0, y: 0 };
    drawTerrainEnvironmentTile(full.g, tile, at, 1);
    drawTerrainEnvironmentTile(simple.g, tile, at, 0);
    expect(full.paths).toHaveLength(2);
    expect(simple.paths).toEqual([full.paths[0]]);
  });

  it('culls by complete feature extent, so an object outside its anchor tile stays visible', () => {
    const r = recorder();
    const field: TerrainEnvironment = { tiles: [tile], clipPolygons: tile.clipPolygons, signature: 't' };
    drawTerrainEnvironment(r.g, field, { scale: 1, x: 0, y: 0 }, 1,
      { x: 270, y: 0, width: 30, height: 100 });
    expect(r.paths).toHaveLength(2);
    const far = recorder();
    drawTerrainEnvironment(far.g, field, { scale: 1, x: 0, y: 0 }, 1,
      { x: 500, y: 0, width: 30, height: 100 });
    expect(far.paths).toHaveLength(0);
  });

  it('has no unmasked fallback when known geometry is absent', () => {
    const r = recorder();
    drawTerrainEnvironmentTile(r.g, { ...tile, clipPolygons: [] }, { scale: 1, x: 0, y: 0 });
    expect(r.paths).toHaveLength(0);
    expect(r.calls.save).not.toHaveBeenCalled();
  });
});
