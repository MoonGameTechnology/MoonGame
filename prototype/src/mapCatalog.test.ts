import { describe, expect, it } from 'vitest';
import { mapPreset, mapNodesFromState, scoreLimitFor } from './mapCatalog';
import { newGame, networkSeats } from './matchSetup';

describe('Frontier 100', () => {
  it('keeps 100 starts two provinces apart, three provinces inside the rim, and bases buffered', () => {
    const map = mapPreset('frontier-100');
    const nodes = new Map(map.nodes.map((n) => [n.id, n]));
    expect(map.starts).toHaveLength(100);
    expect(new Set(map.starts).size).toBe(100);
    expect(nodes.size).toBe(1675);
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
      expect(bases).toHaveLength(12);
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

  it('seeds 100 playable seats plus 24 NPCs and survives JSON restoration', () => {
    const seats = networkSeats('ffa', 'frontier-100');
    expect(seats).toHaveLength(100);
    const state = newGame({ mapId: 'frontier-100', seats });
    expect(Object.values(state.players).filter((p) => !p.npc)).toHaveLength(100);
    expect(Object.values(state.players).filter((p) => p.npc && p.ai)).toHaveLength(24);
    expect(new Set(seats.map((s) => s.start)).size).toBe(100);
    const restored = JSON.parse(JSON.stringify(state));
    expect(mapNodesFromState(restored).map((n) => [n.id, n.x, n.y, n.links])).toEqual(
      mapPreset('frontier-100').nodes.map((n) => [n.id, n.x, n.y, n.links]),
    );
    expect(scoreLimitFor(restored)).toBeGreaterThan(scoreLimitFor(newGame()));
  });

  it('preserves the existing map and rejects unknown presets', () => {
    expect(mapPreset().starts).toHaveLength(10);
    expect(newGame().mapId).toBe('nexus');
    expect(() => mapPreset('missing')).toThrow('E_UNKNOWN_MAP');
  });
});
