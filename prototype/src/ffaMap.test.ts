import { describe, expect, it } from 'vitest';
import {
  buildStateFromMap,
  getStance,
  laneRoadLength,
  validateMatchMap,
} from '../../packages/shared-core/src/index';
import { dataKey } from '../../localization/index';
import { data } from './gameData';
import {
  MAP_IDS,
  mapPreset,
  mapNodesFromState,
  scoreLimitFor,
  seatsByCount,
  type MapId,
} from './mapCatalog';
import { newGame, networkSeats, networkStartsOf } from './matchSetup';
import { aiOrders } from './ai';
import { advance, order } from './protoKernel';
import { HOUR } from './time';
import { regionKey } from '../../decisions/regionName';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';

/** The big free-for-all maps (`scripts/generate-ffa.mjs`): same contracts, their own scale. */
const FFA_MAPS = [
  {
    title: 'Twenty Lights — 20-player FFA',
    id: 'ffa-20',
    provinces: 320,
    seats: 20,
    pirates: 3,
    hives: 2,
    neutrals: 4,
  },
  {
    title: 'Fifty Suns — 50-player FFA',
    id: 'ffa-50',
    provinces: 800,
    seats: 50,
    pirates: 6,
    hives: 4,
    neutrals: 8,
  },
] as const;

describe.each(FFA_MAPS)(
  '$title',
  ({ id, provinces, seats: capacity, pirates, hives, neutrals }) => {
    const preset = mapPreset(id);
    const seats = networkSeats('ffa', id as MapId);
    const nodes = new Map(preset.nodes.map((n) => [n.id, n]));
    const state = newGame({ mapId: id, seats });
    const barriers = preset.nodes.filter((n) => data.sectorKinds[n.sector]?.traversable === false);
    function distances(
      start: string,
      blocked: ReadonlySet<string> = new Set(),
    ): Map<string, number> {
      const d = new Map([[start, 0]]),
        queue = [start];
      for (const at of queue)
        for (const next of nodes.get(at)!.links) {
          if (!d.has(next) && !blocked.has(next)) {
            d.set(next, d.get(at)! + 1);
            queue.push(next);
          }
        }
      return d;
    }
    const fromStart = new Map(preset.starts.map((s) => [s, distances(s)]));

    it('is offered for new matches and loads through the core with every inhabitant', () => {
      expect(MAP_IDS).toContain(id);
      expect(validateMatchMap(preset.map!, data)).toEqual([]);
      expect(preset.nodes).toHaveLength(provinces);
      expect(preset.map!.paths).toBeUndefined(); // lanes come from the real mosaic
      expect(seats).toHaveLength(capacity);
      expect(new Set(seats.map((s) => s.start)).size).toBe(capacity);
      expect(seats.every((s) => s.team === undefined)).toBe(true);
      expect(seatsByCount(id)).toBe(true); // the setup screen asks for a bot count, not 50 rows
      const raw = buildStateFromMap(preset.map!, data, {
        slots: Object.fromEntries(seats.map((seat, i) => [`slot_${i + 1}`, { playerId: seat.id }])),
      });
      expect(Object.values(state.players).filter((p) => !p.npc)).toHaveLength(capacity);
      for (const [npc, count] of [
        ['pirate', pirates],
        ['swarm', hives],
        ['neutral', neutrals],
      ] as const) {
        const inhabitants = Object.values(state.players).filter((p) => p.npc === npc);
        expect(inhabitants).toHaveLength(count);
        for (const p of inhabitants) {
          expect(p.ai).toBe(true);
          expect(p).toEqual(raw.players[p.id]);
          expect(dataKey(p.name) in ru && dataKey(p.name) in en).toBe(true);
          const home = Object.values(state.planets).find((h) => h.owner === p.id)!;
          expect(home.buildings).toEqual(raw.planets[home.id]!.buildings);
          expect(home.garrison).toEqual(raw.planets[home.id]!.garrison);
          expect(networkStartsOf(state, 'ffa')[p.id]).toBeNull();
        }
      }
      expect(mapNodesFromState(JSON.parse(JSON.stringify(state)))).toHaveLength(provinces);
      expect(scoreLimitFor(state)).toBeGreaterThan(scoreLimitFor({ mapId: 'ffa-4' }));
    });

    it('starts every seat at peace, at war only with pirates and the Swarm', () => {
      const humans = seats.map((s) => s.id);
      for (const a of humans.slice(0, 5)) {
        for (const b of humans.filter((b) => b !== a)) expect(getStance(state, a, b)).toBe('peace');
        for (const p of Object.values(state.players).filter((p) => p.npc))
          expect(getStance(state, a, p.id)).toBe(p.npc === 'neutral' ? 'peace' : 'war');
      }
    });

    it('keeps every route reachable, with crossings around inhabited bases', () => {
      expect(barriers.filter((n) => n.sector === 'black_hole')).toHaveLength(1);
      expect(barriers.some((n) => n.sector === 'rift')).toBe(true);
      for (const n of barriers) expect(n.links).toEqual([]);
      expect(distances(preset.starts[0]!).size).toBe(provinces - barriers.length);
      const inhabited = new Set(
        Object.keys(preset.map!.sectors).filter((s) =>
          preset.map!.sectors[s]!.owner?.startsWith('npc-'),
        ),
      );
      expect(inhabited.size).toBe(pirates + hives + neutrals);
      for (const start of preset.starts) {
        for (const base of inhabited)
          expect(fromStart.get(start)!.get(base), `${start} -> ${base}`).toBeGreaterThanOrEqual(3);
        // The other starts are reachable without passing an inhabited base.
        expect(preset.starts.every((other) => distances(start, inhabited).has(other))).toBe(true);
      }
      // No single province cuts the starts apart.
      for (const blocked of nodes.keys()) {
        if (preset.starts.includes(blocked) || nodes.get(blocked)!.links.length === 0) continue;
        const d = distances(
          preset.starts[0] === blocked ? preset.starts[1]! : preset.starts[0]!,
          new Set([blocked]),
        );
        expect(
          preset.starts.every((home) => d.has(home)),
          blocked,
        ).toBe(true);
      }
    });

    it('gives every seat the same kit, two opening worlds at equal travel, and room', () => {
      const lengths: number[] = [];
      const kits = preset.starts.map((start) => preset.map!.sectors[start]!);
      for (const kit of kits) {
        expect(kit.buildings).toEqual(kits[0]!.buildings);
        expect(kit.garrison).toEqual(kits[0]!.garrison);
        expect(preset.map!.slots[kit.owner!]!.resources).toEqual(
          preset.map!.slots[kits[0]!.owner!]!.resources,
        );
      }
      for (const start of preset.starts) {
        const worlds = nodes.get(start)!.links.filter((n) => nodes.get(n)!.sector === 'planet');
        expect(worlds).toHaveLength(2);
        for (const world of worlds) {
          expect(preset.starts).not.toContain(world);
          expect(state.planets[world]!.owner).toBeNull();
          expect(state.planets[world]!.garrison).toEqual([{ unit: 'militia', count: 2 }]);
          lengths.push(laneRoadLength(state, start, world));
        }
        for (const other of preset.starts)
          if (other !== start) expect(fromStart.get(start)!.get(other)).toBeGreaterThanOrEqual(4);
      }
      expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.05);
      // Not a repeated quadrant: no two starts share their surroundings two lanes deep.
      const profile = (node: string, depth: number): string => {
        const n = nodes.get(node)!;
        return depth === 0
          ? n.sector
          : `${n.sector}(${n.links
              .map((next) => profile(next, depth - 1))
              .sort()
              .join(',')})`;
      };
      expect(new Set(preset.starts.map((start) => profile(start, 2))).size).toBe(capacity);
      // A guard against gross skew, not a demand for equal shares: provinces closer to a
      // seat than to any other seat (ties split). The rim and the terrain make some seats
      // roomier — the owner trades a little balance for a living map (2026-10-14).
      const share = preset.starts.map(() => 0);
      for (const n of nodes.keys()) {
        const hops = preset.starts.map((s) => fromStart.get(s)!.get(n) ?? Infinity);
        const best = Math.min(...hops);
        if (best === Infinity) continue;
        const tied = hops.filter((h) => h === best).length;
        hops.forEach((h, i) => {
          if (h === best) share[i]! += 1 / tied;
        });
      }
      expect(Math.max(...share) / Math.min(...share)).toBeLessThan(2.5);
    });

    it('uses the whole catalogue, and wrecks stay a rare find', () => {
      const sectors = Object.values(preset.map!.sectors);
      const has = (pick: (s: (typeof sectors)[number]) => string | undefined): string[] =>
        [...new Set(sectors.map(pick).filter((v): v is string => v !== undefined))].sort();
      const kinds = Object.keys(data.sectorKinds)
        .filter((k) => k !== 'fork_station' && k !== 'empty')
        .sort();
      expect(has((s) => s.kind)).toEqual(kinds);
      expect(has((s) => s.terrain)).toEqual(Object.keys(data.sectors).sort());
      expect(has((s) => s.planetType)).toEqual(Object.keys(data.planetTypes).sort());
      expect(sectors.filter((s) => s.kind === 'graveyard')).toHaveLength(1);
      expect(sectors.filter((s) => s.kind === 'debris_field')).toHaveLength(1);
      expect(sectors.filter((s) => s.terrain === 'derelict_graveyard').length).toBeLessThanOrEqual(
        2,
      );
    });

    it('splits the map into named areas, every province in exactly one', () => {
      const regions = preset.map!.regions;
      expect(regions.flatMap((r) => r.sectors).sort()).toEqual(
        Object.keys(preset.map!.sectors).sort(),
      );
      expect(regions.length).toBeGreaterThanOrEqual(capacity);
      const missing = regions
        .map((r) => regionKey(id, r.id))
        .filter((key) => !(key in ru) || !(key in en));
      expect(missing).toEqual([]);
    });
  },
);

describe('Twenty Lights — inhabitants', () => {
  it('runs every inhabitant: pirates, hives and neutrals all give orders', () => {
    let s = newGame({ mapId: 'ffa-20', seats: networkSeats('ffa', 'ffa-20') });
    const npcs = Object.values(s.players)
      .filter((p) => p.npc)
      .map((p) => p.id);
    const acted = new Set<string>();
    for (let hour = 0; hour <= 12; hour += 2) {
      s = advance(s, hour * HOUR).state;
      for (const id of npcs) {
        for (const action of aiOrders(s, id)) {
          const result = order(s, action, s.time);
          if (!result.error) acted.add(id);
          s = result.state;
        }
      }
    }
    expect([...acted].sort()).toEqual([...npcs].sort());
    expect(s.match.status).toBe('ongoing');
  }, 30_000);
});
