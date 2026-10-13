import { describe, expect, it } from 'vitest';
import { MAP_IDS, mapPreset, mapNodesFromState, scoreLimitFor } from './mapCatalog';
import { newGame, networkSeats } from './matchSetup';
import { laneRoadLength } from '../../packages/shared-core/src/index';

describe('Frontier 50', () => {
  it('keeps 50 starts two provinces apart, three provinces inside the rim, and bases buffered', () => {
    const map = mapPreset('frontier-50');
    const nodes = new Map(map.nodes.map((n) => [n.id, n]));
    expect(map.starts).toHaveLength(50);
    expect(new Set(map.starts).size).toBe(50);
    expect(nodes.size).toBe(831);
    expect(nodes.size).toBeLessThanOrEqual(1675 / 2);
    const distances = (start: string) => {
      const d = new Map([[start, 0]]);
      const queue = [start];
      for (const id of queue)
        for (const next of nodes.get(id)!.links) {
          if (!d.has(next)) {
            d.set(next, d.get(id)! + 1);
            queue.push(next);
          }
        }
      return d;
    };
    for (const n of nodes.values())
      for (const id of n.links) expect(nodes.get(id)!.links).toContain(n.id);
    for (const start of map.starts) {
      const d = distances(start);
      expect(d.size).toBe(nodes.size - 1);
      expect(nodes.get(start)!.sector).toBe('planet');
      for (const other of map.starts)
        if (other !== start) expect(d.get(other)).toBeGreaterThanOrEqual(3);
      for (const edge of map.boundary) expect(d.get(edge)).toBeGreaterThanOrEqual(3);
    }
    for (const kind of ['pirate_base', 'neutral_base']) {
      const bases = map.nodes.filter((n) => n.sector === kind);
      expect(bases).toHaveLength(6);
      for (const base of bases) {
        expect(base.links.length).toBeGreaterThan(0);
        for (const id of base.links) {
          expect(map.starts).not.toContain(id);
          expect(['pirate_base', 'neutral_base', 'black_hole']).not.toContain(
            nodes.get(id)!.sector,
          );
        }
      }
    }
    const hole = map.nodes.filter((n) => n.sector === 'black_hole');
    expect(hole).toHaveLength(1);
    expect(hole[0]).toMatchObject({ x: 5000, y: 5000, links: [], owner: null });
  });

  it('seeds 50 playable seats plus 12 NPCs and survives JSON restoration', () => {
    const seats = networkSeats('ffa', 'frontier-50');
    expect(seats).toHaveLength(50);
    const state = newGame({ mapId: 'frontier-50', seats });
    expect(Object.values(state.players).filter((p) => !p.npc)).toHaveLength(50);
    expect(Object.values(state.players).filter((p) => p.npc && p.ai)).toHaveLength(12);
    expect(new Set(seats.map((s) => s.start)).size).toBe(50);
    const restored = JSON.parse(JSON.stringify(state));
    expect(mapNodesFromState(restored).map((n) => [n.id, n.x, n.y, n.links])).toEqual(
      mapPreset('frontier-50').nodes.map((n) => [n.id, n.x, n.y, n.links]),
    );
    expect(scoreLimitFor(restored)).toBeGreaterThan(scoreLimitFor(newGame()));
  });

  it('offers only duel and four-player FFA but preserves existing 100-seat snapshots', () => {
    expect(MAP_IDS).toEqual(['duel-1', 'ffa-4']);
    const old = newGame({ mapId: 'frontier-100', seats: networkSeats('ffa', 'frontier-100') });
    expect(Object.keys(old.planets)).toHaveLength(1675);
    expect(mapPreset('frontier-100').starts).toHaveLength(100);
    expect(mapNodesFromState(JSON.parse(JSON.stringify(old)))).toHaveLength(1675);
    expect(scoreLimitFor(old)).toBe(15000);
    expect(mapPreset('frontier-50').scoreLimit).toBe(7500);
  });

  it('preserves the existing map and rejects unknown presets', () => {
    expect(mapPreset().starts).toHaveLength(10);
    expect(newGame().mapId).toBe('nexus');
    expect(() => mapPreset('missing')).toThrow('E_UNKNOWN_MAP');
  });
});

describe('published match maps', () => {
  it.each([
    ['duel-1', 2],
    ['ffa-4', 4],
  ] as const)('%s has the same valid geometry locally and online', (id, capacity) => {
    const preset = mapPreset(id);
    const seats = networkSeats('5v5', id); // The environment cannot override map capacity.
    expect(seats).toHaveLength(capacity);
    expect(new Set(seats.map((s) => s.start)).size).toBe(capacity);
    const online = newGame({ mapId: id, seats });
    const local = newGame({ mapId: id, seats: seats.map((s, i) => ({ ...s, ai: i !== 0 })) });
    expect(local.planets).toEqual(online.planets);
    expect(Object.keys(online.players)).toHaveLength(capacity);
    expect(Object.keys(online.capital ?? {})).toHaveLength(capacity);
    expect(online.version.data).not.toBe('0.1.0');
    for (const seat of seats) {
      const home = online.planets[seat.start]!;
      expect(home.owner).toBe(seat.id);
      expect(home.kind).toBe('planet');
      expect(home.links!.length).toBeGreaterThanOrEqual(2);
      expect(home.buildings.some((b) => b.type === 'shipyard' && b.level === 2)).toBe(true);
    }
    for (const node of preset.nodes) {
      expect([...online.planets[node.id]!.links!].sort()).toEqual([...node.links].sort());
      expect(online.planets[node.id]!.terrain).toBe(preset.map!.sectors[node.id]!.terrain);
    }
    expect(Object.values(online.diplomacy!)).toEqual(
      Array((capacity * (capacity - 1)) / 2).fill(id === 'duel-1' ? 'war' : 'peace'),
    );
    expect(
      mapNodesFromState(JSON.parse(JSON.stringify(online)))
        .map((n) => n.id)
        .sort(),
    ).toEqual(preset.nodes.map((n) => n.id).sort());
  });

  it.each(MAP_IDS)('%s has distinct start surroundings and fair opening access', (id) => {
    const map = mapPreset(id);
    const nodes = new Map(map.nodes.map((n) => [n.id, n]));
    const state = newGame({ mapId: id, seats: networkSeats('ffa', id) });
    const distances = (start: string, blocked?: string) => {
      const d = new Map([[start, 0]]);
      const queue = [start];
      for (const current of queue)
        for (const next of nodes.get(current)!.links) {
          if (next !== blocked && !d.has(next)) {
            d.set(next, d.get(current)! + 1);
            queue.push(next);
          }
        }
      return d;
    };
    // Different topology/terrain around each home, not a repeated quadrant with jitter.
    const profile = (node: string, depth: number): string => {
      const n = nodes.get(node)!;
      return depth === 0 ? n.sector
        : `${n.sector}(${n.links.map((next) => profile(next, depth - 1)).sort().join(',')})`;
    };
    expect(new Set(map.starts.map((start) => profile(start, 2))).size).toBe(map.starts.length);
    expect(map.map!.paths).toBeUndefined(); // All lanes come from the real mosaic.
    expect(map.nodes.every((n) => n.sector !== 'empty')).toBe(true);
    const openingLengths: number[] = [];
    for (const start of map.starts) {
      const d = distances(start);
      expect(d.size).toBe(nodes.size);
      const worlds = nodes.get(start)!.links.filter((n) => nodes.get(n)!.sector === 'planet');
      expect(worlds).toHaveLength(2);
      for (const world of worlds) {
        expect(map.starts).not.toContain(world);
        expect(state.planets[world]!.planetType).toBe('terran');
        expect(state.planets[world]!.garrison).toEqual([{ unit: 'militia', count: 2 }]);
        openingLengths.push(laneRoadLength(state, start, world));
      }
      for (const other of map.starts)
        if (other !== start) expect(d.get(other)).toBeGreaterThanOrEqual(5);
    }
    // The two starting conquests take similar travel distances at every seat.
    expect(Math.max(...openingLengths) / Math.min(...openingLengths)).toBeLessThan(1.15);
    const kits = map.starts.map((start) => map.map!.sectors[start]!);
    for (const kit of kits) {
      expect(kit.buildings).toEqual(kits[0]!.buildings);
      expect(kit.garrison).toEqual(kits[0]!.garrison);
      expect(map.map!.slots[kit.owner!]!.resources).toEqual(
        map.map!.slots[kits[0]!.owner!]!.resources,
      );
    }
    // No single province is the only connection between two parts of either map.
    for (const blocked of nodes.keys()) {
      const start = map.nodes.find((n) => n.id !== blocked)!.id;
      expect(distances(start, blocked).size).toBe(nodes.size - 1);
    }
    if (id === 'ffa-4')
      expect(networkSeats('ffa', id).every((s) => s.team === undefined)).toBe(true);
  });
});
