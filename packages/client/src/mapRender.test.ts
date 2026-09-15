import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type GameData, type GameState, type Player } from '@void/shared-core';
import { ownerColors, renderMap } from './mapRender';
import { blitGlow, blitSphere } from './holoDraw';
import { centerOn } from './camera';

vi.mock('./spaceBackdrop', () => ({ drawSpaceBackdrop: vi.fn() }));
vi.mock('./holoDraw', async (original) => ({
  ...await original<typeof import('./holoDraw')>(), blitGlow: vi.fn(), blitSphere: vi.fn(),
}));

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function stateWith(ids: string[]): GameState {
  const s = createInitialState({ seed: 'map', version: { data: 't', manifest: 't' } });
  for (const id of ids) s.players[id] = player(id);
  return s;
}

describe('mapRender — ownerColors (the pure seat-colour assignment)', () => {
  it('assigns stable colours by join order and cycles past the palette', () => {
    const colors = ownerColors(stateWith(['a', 'b', 'c', 'd', 'e']));
    expect(colors.size).toBe(5);
    // Join order is the assignment order; the 5th seat wraps to the 1st colour.
    expect(colors.get('e')).toBe(colors.get('a'));
    // The first four are the distinct seat palette.
    expect(new Set([colors.get('a'), colors.get('b'), colors.get('c'), colors.get('d')]).size).toBe(4);
  });

  it('an empty seat list yields an empty map (no phantom entries)', () => {
    expect(ownerColors(stateWith([])).size).toBe(0);
  });
});

it('the shared renderer drops expensive overview art, preserves selection and restores detail', () => {
  vi.mocked(blitSphere).mockClear();
  vi.mocked(blitGlow).mockClear();
  const state = stateWith(['p1']);
  for (const [id, x, peer] of [['a', 480, 'b'], ['b', 520, 'a']] as const) {
    state.planets[id] = { id, owner: 'p1', position: { x, y: 500 }, kind: 'planet',
      links: [peer], resources: {}, buildings: [], garrison: [], traits: [] };
  }
  const before = JSON.stringify(state);
  const text = vi.fn();
  const alpha: number[] = [];
  const context = { globalAlpha: 1, fillText: text,
    save: () => alpha.push(context.globalAlpha), restore: () => { context.globalAlpha = alpha.pop() ?? 1; } };
  const g = new Proxy(context, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) }) as unknown as CanvasRenderingContext2D;
  const vp = { left: 0, top: 0, right: 400, bottom: 400 };
  const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const opts = { data: {} as GameData, now: 0, dpr: 2, selected: 'a' };
  renderMap(g, state, { x: 0, y: 0, scale: 1 }, vp, bounds, opts);
  expect(blitSphere).not.toHaveBeenCalled();
  expect(blitGlow).not.toHaveBeenCalled();
  expect(text.mock.calls.map(([label]) => label)).toEqual(['a']);
  const near = centerOn({ x: 0, y: 0, scale: 1 }, { x: 500, y: 500 }, 6, vp, bounds);
  renderMap(g, state, near, vp, bounds, opts);
  expect(blitSphere).toHaveBeenCalledTimes(2);
  expect(text.mock.calls.some(([label]) => label === 'b')).toBe(true);
  expect(JSON.stringify(state)).toBe(before);
});
