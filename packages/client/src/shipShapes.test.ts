import { afterEach, describe, expect, it, vi } from 'vitest';
import { shippedGameData } from '../../../data/bundle';
import { pveState } from './gameData';
import { dominantUnit, unitGlyphSvg, unitShape } from './shipGlyphs';
import { drawShipShape, SHIP_SHAPES, shipPaths, UNIT_SHAPE } from './shipShapes';

const data = shippedGameData();
afterEach(() => vi.unstubAllGlobals());
it('gives the brood producer its Matriarch silhouette', () => {
  expect(unitShape(data.units.swarm_brood_mother!, 'swarm_brood_mother', 'swarm')).toBe('swarmMatriarch');
});

describe('approved ship hulls', () => {
  it('skins the shipped PvE enemy by its owner, even while waves use shared unit definitions', () => {
    const state = pveState(data);
    const fleet = state.fleets.p3_2!;
    const dom = dominantUnit(fleet.units, data)!;
    expect(dom.def.faction).toBe('vanguard');
    expect(unitShape(dom.def, dom.unit, state.players[fleet.owner]!.faction)).toBe('swarmHunter');
    expect(unitShape(dom.def, dom.unit, 'vanguard')).toBe('cruiser');
    const svg = unitGlyphSvg(dom.def, {
      unitId: dom.unit,
      ownerFaction: 'swarm',
      color: '#3ad17a',
      shield: true,
    });
    expect(svg).toContain('data-hull="swarmHunter"');
    expect(svg).toContain(SHIP_SHAPES.swarmHunter.hull);
    expect(svg).toContain('#3ad17a'); // faction must not overwrite the owner colour
    expect(svg).toContain('stroke-dasharray');
  });

  it('gives the eight Swarm forms distinct silhouettes without reskinning ground cargo', () => {
    const forms = [
      ['scout_drone', 'swarmScout'],
      ['frigate', 'swarmFlock'],
      ['cruiser', 'swarmHunter'],
      ['landing_shuttle', 'swarmDevourer'],
      ['shuttle_carrier', 'swarmSporeCarrier'],
      ['siege_lance', 'swarmDestroyer'],
      ['swarm_brood_mother', 'swarmMatriarch'],
      ['hero', 'swarmLeviathan'],
    ] as const;
    for (const [unit, shape] of forms) {
      expect(unitShape(data.units[unit]!, unit, 'swarm')).toBe(shape);
    }
    expect(new Set(forms.map(([, shape]) => SHIP_SHAPES[shape].hull)).size).toBe(8);
    expect(unitShape(data.units.tank!, 'tank', 'swarm')).toBeNull();
    expect(unitGlyphSvg(data.units.tank!, { ownerFaction: 'swarm', color: '#fff' })).toBe('');
    expect(dominantUnit([{ unit: 'unknown', count: 1 }], data)).toBeNull();
  });

  it('uses organic role fallbacks for new Swarm units and explicit ownership for transferred hulls', () => {
    const swarmCruiser = { ...data.units.cruiser!, faction: 'swarm' };
    expect(unitShape(swarmCruiser)).toBe('swarmHunter');
    expect(unitShape({ ...swarmCruiser, traits: ['hero'] })).toBe('swarmLeviathan');
    expect(unitShape({ ...data.units.shuttle_carrier!, faction: 'swarm' })).toBe('swarmDevourer');
    expect(unitShape({ ...data.units.scout!, faction: 'swarm' })).toBe('swarmScout');
    expect(unitShape(swarmCruiser, 'cruiser', 'vanguard')).toBe('cruiser');
    expect(unitShape(swarmCruiser, undefined, 'vanguard')).toBe('cruiser');
  });

  it('distinguishes the frigate and the wide landing craft from combat triangles', () => {
    expect(unitShape(data.units.frigate!, 'frigate')).toBe('frigate');
    expect(unitShape(data.units.landing_shuttle!, 'landing_shuttle')).toBe('dropship');
    expect(unitShape(data.units.bomber!, 'bomber')).toBe('strikeCraft');
    expect(unitShape(data.units.interceptor!, 'interceptor')).toBe('fighter');
    expect(unitShape(data.units.tank!, 'tank')).toBeNull();
    expect(unitGlyphSvg(data.units.frigate!, { unitId: 'frigate', color: '#ff5a4d' })).toContain(
      SHIP_SHAPES.frigate.hull,
    );
  });

  it('gives the landing shuttle its own picture, the Carrier the freighter (owner, 2026-09-26)', () => {
    // The carrier and the landing ship became one hull, the Carrier; the dropship art was
    // the landing shuttle's all along and no ship borrows it any more.
    expect(data.units.strike_carrier).toBeUndefined();
    expect(unitShape(data.units.shuttle_carrier!, 'shuttle_carrier')).toBe('transport');
    expect(Object.entries(UNIT_SHAPE).filter(([, s]) => s === 'dropship').map(([id]) => id)).toEqual([
      'landing_shuttle',
    ]);
  });

  it('keeps fleet identity stable when cargo or stack order changes', () => {
    const ships = [
      { unit: 'frigate', count: 1 },
      { unit: 'interceptor', count: 10 },
    ];
    expect(dominantUnit(ships, data)?.unit).toBe('frigate');
    expect(dominantUnit([...ships].reverse(), data)?.unit).toBe('frigate');
    expect(dominantUnit([...ships, { unit: 'tank', count: 50 }], data)?.unit).toBe('frigate');
    expect(dominantUnit([{ unit: 'unknown', count: 1 }], data)).toBeNull();
  });

  it('reuses vector paths across frames and keeps the same contour at both LODs', () => {
    const ctor = vi.fn(function (this: { source: string }, source: string) {
      this.source = source;
    });
    vi.stubGlobal('Path2D', ctor);
    const g = { fill: vi.fn(), stroke: vi.fn(), shadowBlur: 6 };
    drawShipShape(g as unknown as CanvasRenderingContext2D, 'frigate', true);
    const paths = shipPaths('frigate');
    expect(ctor).toHaveBeenCalledTimes(3);
    expect(g.stroke.mock.calls.map((c) => c[0])).toEqual([paths.hull, paths.detail, paths.engines]);
    g.stroke.mockClear();
    drawShipShape(g as unknown as CanvasRenderingContext2D, 'frigate', false);
    expect(g.stroke.mock.calls.map((c) => c[0])).toEqual([paths.hull]);
    expect(g.fill).toHaveBeenLastCalledWith(paths.hull, 'evenodd');
    expect(ctor).toHaveBeenCalledTimes(3);
  });

  it('caches all organic contours and retains their identity at distance', () => {
    const ctor = vi.fn(function (this: { source: string }, source: string) {
      this.source = source;
    });
    vi.stubGlobal('Path2D', ctor);
    const g = { fill: vi.fn(), stroke: vi.fn(), shadowBlur: 6 };
    for (const id of Object.keys(SHIP_SHAPES) as Array<keyof typeof SHIP_SHAPES>) {
      if (!id.startsWith('swarm')) continue;
      drawShipShape(g as unknown as CanvasRenderingContext2D, id, true);
      const paths = shipPaths(id);
      g.stroke.mockClear();
      drawShipShape(g as unknown as CanvasRenderingContext2D, id, false);
      expect(g.stroke.mock.calls.map((c) => c[0])).toEqual([paths.hull]);
      expect(g.fill).toHaveBeenLastCalledWith(paths.hull, 'evenodd');
    }
    expect(ctor).toHaveBeenCalledTimes(8 * 3);
  });
});
