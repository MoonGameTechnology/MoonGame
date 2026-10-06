import { describe, expect, it, vi } from 'vitest';
import { createInitialState, parseGameData, type Fleet, type GameState, type Planet } from '@void/shared-core';
import { renderMap } from './mapRender';
import { drawMineShape } from './mineShape';
import { drawShipShape } from './shipShapes';
import { drawFleetCount } from './fleetCountBadge';

vi.mock('./spaceBackdrop', () => ({ drawSpaceBackdrop: vi.fn() }));
vi.mock('./holoDraw', async (original) => ({
  ...(await original<typeof import('./holoDraw')>()),
  blitGlow: vi.fn(),
  blitSphere: vi.fn(),
}));
vi.mock('./mineShape', () => ({ drawMineShape: vi.fn() }));
vi.mock('./shipShapes', async (original) => ({
  ...(await original<typeof import('./shipShapes')>()),
  drawShipShape: vi.fn(),
}));
vi.mock('./fleetCountBadge', () => ({ drawFleetCount: vi.fn(), fleetCountWidth: () => 0 }));

/**
 * Мина — отряд (SM-3.6, SM-3.7a), но не корабль. Новый клиент рисовал каждый отряд
 * корабельным силуэтом, и ракетная мина выходила крейсером со счётчиком «1» (замечание
 * Codex на #1499). Мине — свой знак, без корпуса и без счётчика кораблей.
 */
const data = parseGameData({
  version: '1',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 100, attack: 5, defense: 5, speed: 5 } },
    mine: {
      faction: 'neutral',
      stats: { hp: 20, attack: 0, defense: 0, speed: 0 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine'],
    },
    rocket_mine: {
      faction: 'neutral',
      stats: { hp: 20, attack: 0, defense: 0, speed: 0 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine', 'rocketMine'],
    },
  },
});

function planet(id: string, x: number, links: string[]): Planet {
  return { id, owner: null, position: { x, y: 200 }, links, resources: {}, buildings: [], garrison: [], traits: [] };
}
function fleet(id: string, units: Fleet['units'], at: Pick<Fleet, 'location' | 'edge'>): Fleet {
  return { id, owner: 'p1', movement: null, traits: [], units, ...at } as Fleet;
}
function world(): GameState {
  const s = createInitialState({ seed: 'mines', version: { data: 't', manifest: 't' } });
  s.players.p1 = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} };
  s.planets = { A: planet('A', 100, ['B']), B: planet('B', 500, ['A']) };
  s.fleets = {
    contact: fleet('contact', [{ unit: 'mine', count: 3 }], { location: 'A' }),
    rocket: fleet('rocket', [{ unit: 'rocket_mine', count: 1 }], {
      location: null,
      edge: { from: 'A', to: 'B', t: 0.5 },
    }),
    ships: fleet('ships', [{ unit: 'ship', count: 5 }], { location: 'B' }),
  };
  return s;
}

describe('новый клиент рисует мину знаком мины, а не кораблём (замечание Codex на #1499)', () => {
  it('контактная и ракетная мины — знак мины без счётчика; корабли — силуэт и счётчик', () => {
    const g = new Proxy({ globalAlpha: 1 }, {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    }) as unknown as CanvasRenderingContext2D;
    renderMap(g, world(), { x: 0, y: 0, scale: 1 }, { left: 0, top: 0, right: 800, bottom: 600 },
      { minX: 0, minY: 0, maxX: 700, maxY: 400 }, { data, now: 0, dpr: 1 });
    expect(drawMineShape).toHaveBeenCalledTimes(2);
    expect(drawShipShape).toHaveBeenCalledTimes(1);
    expect(vi.mocked(drawFleetCount).mock.calls.map((call) => call[3])).toEqual([5]);
  });
});
