import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type GameData, type Planet } from '@void/shared-core';
import { buildTerrainEnvironment } from '../../../decisions/terrainEnvironment';
import { drawTerrainEnvironment } from './terrainEnvironmentDraw';
import { renderMap } from './mapRender';

vi.mock('../../../decisions/terrainEnvironment', async original => ({
  ...await original<typeof import('../../../decisions/terrainEnvironment')>(),
  buildTerrainEnvironment: vi.fn(() => ({ tiles: [], clipPolygons: [], signature: 'test' })),
}));
vi.mock('./terrainEnvironmentDraw', () => ({ drawTerrainEnvironment: vi.fn() }));
vi.mock('./spaceBackdrop', () => ({ drawSpaceBackdrop: vi.fn() }));
vi.mock('./holoDraw', async original => ({
  ...await original<typeof import('./holoDraw')>(), blitGlow: vi.fn(), blitSphere: vi.fn(),
}));

const planet = (id: string, x: number, size: number): Planet => ({
  id, owner: null, position: { x, y: 100 }, size, kind: 'asteroid', terrain: 'asteroid_field',
  links: [], resources: {}, buildings: [], garrison: [], traits: [],
});
const bounds = { minX: 0, minY: 0, maxX: 600, maxY: 300 };
const vp = { left: 0, top: 0, right: 900, bottom: 600 };
const opts = { data: { units: {} } as unknown as GameData, now: 0, dpr: 1 };
const context = () => new Proxy({ globalAlpha: 1 }, {
  get: (target, key) => Reflect.get(target, key) ?? (() => {}),
}) as unknown as CanvasRenderingContext2D;

describe('client environment integration', () => {
  it('reuses world geography through captures, camera moves, traversal order and resize', () => {
    vi.mocked(buildTerrainEnvironment).mockClear();
    vi.mocked(drawTerrainEnvironment).mockClear();
    const s = createInitialState({ seed: 'map', version: { data: 't', manifest: 't' } });
    s.planets = { a: planet('a', 120, 1), b: planet('b', 380, 2), c: planet('c', 570, 1) };
    const g = context();
    renderMap(g, s, { x: 0, y: 0, scale: 1 }, vp, bounds, opts);
    const original = JSON.stringify(vi.mocked(buildTerrainEnvironment).mock.calls[0]![0]);
    s.planets.a!.owner = 'p1';
    s.planets = { c: s.planets.c!, b: s.planets.b!, a: s.planets.a! };
    const before = JSON.stringify(s);
    renderMap(g, s, { x: -120, y: 40, scale: 4 }, vp, bounds, opts);
    renderMap(g, s, { x: 70, y: -30, scale: 2 },
      { left: 0, top: 0, right: 390, bottom: 844 }, bounds, opts);
    expect(buildTerrainEnvironment).toHaveBeenCalledTimes(1);
    expect(drawTerrainEnvironment).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(vi.mocked(buildTerrainEnvironment).mock.calls[0]![0])).toBe(original);
    expect(JSON.stringify(s)).toBe(before);

    s.planets.b!.terrain = 'dense_nebula';
    renderMap(g, s, { x: 0, y: 0, scale: 1 }, vp, bounds, opts);
    expect(buildTerrainEnvironment).toHaveBeenCalledTimes(2);
    s.planets.a!.links = ['b'];
    s.planets.b!.links = ['a'];
    renderMap(g, s, { x: 0, y: 0, scale: 1 }, vp, bounds, opts);
    expect(buildTerrainEnvironment).toHaveBeenCalledTimes(3);
  });

  it('passes only viewer geography and omits fortress fork sites from the mosaic', () => {
    vi.mocked(buildTerrainEnvironment).mockClear();
    const s = createInitialState({ seed: 'fog', version: { data: 't', manifest: 't' } });
    const hidden = planet('hidden', 380, 1);
    delete hidden.kind;
    delete hidden.terrain;
    s.planets = { a: planet('a', 120, 1), hidden,
      fortress: { ...planet('fortress', 220, 1), fork: { province: 'a', trail: 0 } } };
    renderMap(context(), s, { x: 0, y: 0, scale: 1 }, vp, bounds, opts);
    const input = vi.mocked(buildTerrainEnvironment).mock.calls[0]![0];
    expect(input.cells.map(cell => cell.id)).toEqual(['a', 'hidden']);
    expect(input.cells.find(cell => cell.id === 'hidden')).toMatchObject({
      known: false, kind: undefined, terrain: undefined,
    });
    expect(input.cells.find(cell => cell.id === 'a')?.known).toBe(true);
  });

  it('places a reused local mosaic at the new world origin when maps have translated geometry', () => {
    vi.mocked(buildTerrainEnvironment).mockClear();
    const s = createInitialState({ seed: 'translated', version: { data: 't', manifest: 't' } });
    s.planets = { a: planet('a', 120, 1), b: planet('b', 380, 2) };
    const g = context();
    renderMap(g, s, { x: 0, y: 0, scale: 1 }, vp, bounds, opts);
    const original = vi.mocked(buildTerrainEnvironment).mock.calls[0]![0].cells;
    for (const p of Object.values(s.planets)) {
      p.position.x += 1000;
      p.position.y -= 600;
    }
    renderMap(g, s, { x: 0, y: 0, scale: 1 }, vp,
      { minX: 1000, minY: -600, maxX: 1600, maxY: -300 }, opts);
    expect(buildTerrainEnvironment).toHaveBeenCalledTimes(2);
    const translated = vi.mocked(buildTerrainEnvironment).mock.calls[1]![0].cells;
    expect(translated.map(cell => cell.poly)).toEqual(original.map(cell =>
      cell.poly.map(([x, y]) => [x + 1000, y - 600])));
  });
});
