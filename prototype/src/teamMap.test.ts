import { describe, expect, it } from 'vitest';
import { buildStateFromMap, getStance, laneRoadLength, validateMatchMap } from '../../packages/shared-core/src/index';
import { data } from './gameData';
import { mapPreset, teamForStart, mapNodesFromState } from './mapCatalog';
import { newGame, networkSeats, networkStartsOf } from './matchSetup';
import { assignSeats } from './setupSeats';
import { aiOrders } from './ai';
import { advance, order } from './protoKernel';
import { HOUR } from './time';

const preset = mapPreset('team-2v2');
const seats = networkSeats('ffa', 'team-2v2');
const fresh = () => newGame({ mapId: 'team-2v2', seats });
const nodes = new Map(preset.nodes.map((n) => [n.id, n]));
function distances(start: string, blocked: readonly string[] = []): Map<string, number> {
  const d = new Map([[start, 0]]), queue = [start];
  for (const id of queue) for (const next of nodes.get(id)!.links) {
    if (!d.has(next) && !blocked.includes(next)) { d.set(next, d.get(id)! + 1); queue.push(next); }
  }
  return d;
}

describe('Broken Reach — main-game 2v2', () => {
  it('loads the authored mosaic and all inhabitants through the core', () => {
    expect(validateMatchMap(preset.map!, data)).toEqual([]);
    expect(preset.nodes).toHaveLength(85);
    expect(preset.map!.paths).toBeUndefined();
    expect(preset.nodes.some((n) => n.sector === 'empty')).toBe(false);
    const raw = buildStateFromMap(preset.map!, data, {
      slots: Object.fromEntries(seats.map((seat, i) => [`slot_${i + 1}`, { playerId: seat.id }])),
    });
    const s = fresh();
    expect(s.modeId).toBe('team_2v2');
    expect(Object.values(s.players).filter((p) => !p.npc)).toHaveLength(4);
    for (const [npc, count] of [['pirate', 2], ['swarm', 2], ['neutral', 4]] as const) {
      const inhabitants = Object.values(s.players).filter((p) => p.npc === npc);
      expect(inhabitants).toHaveLength(count);
      for (const p of inhabitants) {
        expect(p.ai).toBe(true);
        expect(p).toEqual(raw.players[p.id]);
        const home = Object.values(s.planets).find((h) => h.owner === p.id)!;
        expect(home.buildings).toEqual(raw.planets[home.id]!.buildings);
        expect(home.garrison).toEqual(raw.planets[home.id]!.garrison);
        expect(Object.values(s.fleets).filter((f) => f.owner === p.id))
          .toEqual(Object.values(raw.fleets).filter((f) => f.owner === p.id));
        expect(networkStartsOf(s, '5v5')[p.id]).toBeNull();
      }
    }
    expect(mapNodesFromState(JSON.parse(JSON.stringify(s)))).toHaveLength(85);
  });

  it('keeps every route reachable, with alternative crossings away from occupied bases', () => {
    expect(distances('home_1').size).toBe(84); // the black hole is deliberately impassable
    expect(nodes.get('remnant')!.links).toEqual([]);
    const inhabited = Object.keys(preset.map!.sectors).filter((id) => preset.map!.sectors[id]!.owner?.startsWith('npc-'));
    for (const start of preset.starts) {
      const d = distances(start);
      for (const base of inhabited) expect(d.get(base), `${start} -> ${base}`).toBeGreaterThanOrEqual(3);
      const bypass = distances(start, inhabited);
      for (const other of preset.starts) expect(bypass.has(other)).toBe(true);
    }
    // No single transit province can cut the four starting districts apart.
    for (const blocked of nodes.keys()) {
      if (preset.starts.includes(blocked)) continue;
      const d = distances('home_1', [blocked]);
      for (const home of preset.starts) expect(d.has(home), blocked).toBe(true);
    }
  });

  it('gives different districts equal opening travel and nearby allies', () => {
    const s = fresh(), lengths: number[] = [];
    const profile = (id: string): string => nodes.get(id)!.links.map((next) =>
      `${nodes.get(next)!.sector}:${nodes.get(next)!.links.length}`).sort().join('|');
    expect(new Set(preset.starts.map(profile)).size).toBe(4);
    for (const start of preset.starts) {
      const worlds = nodes.get(start)!.links.filter((id) => nodes.get(id)!.sector === 'planet');
      expect(worlds).toHaveLength(2);
      for (const world of worlds) {
        expect(s.planets[world]!.owner).toBeNull();
        expect(s.planets[world]!.garrison).toEqual([{ unit: 'militia', count: 2 }]);
        lengths.push(laneRoadLength(s, start, world));
      }
      for (const other of preset.starts.filter((id) => id !== start)) {
        const hops = distances(start).get(other)!;
        if (teamForStart('team-2v2', start) === teamForStart('team-2v2', other)) expect(hops).toBeLessThanOrEqual(4);
        else expect(hops).toBeGreaterThanOrEqual(8);
      }
    }
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.05);
  });

  it.each(preset.starts)('keeps fixed 2v2 sides when the player chooses %s', (start) => {
    const assigned = assignSeats(4, ['human', 'ai', 'ai', 'ai'], start, preset.starts)
      .map(({ index, start }) => ({ ...seats[index]!, start, team: 'ignored' }));
    const s = newGame({ mapId: 'team-2v2', seats: assigned });
    for (const a of assigned) {
      expect(s.players[a.id]!.technologies!.completed).toEqual(['scout_design']);
      expect(s.fleets[`${a.id}-1`]!.units).toEqual([{ unit: 'scout', count: 1 }]);
      for (const b of assigned.filter((b) => b.id !== a.id))
        expect(getStance(s, a.id, b.id)).toBe(teamForStart('team-2v2', a.start) === teamForStart('team-2v2', b.start) ? 'alliance' : 'war');
      for (const p of Object.values(s.players).filter((p) => p.npc))
        expect(getStance(s, a.id, p.id)).toBe(p.npc === 'neutral' ? 'peace' : 'war');
    }
  });

  it('awards the surviving team a victory without requiring extermination of NPCs', () => {
    const s = fresh();
    for (const planet of Object.values(s.planets))
      if (planet.owner === 'p3') planet.owner = null;
    expect(advance(s, HOUR).state.match.status).toBe('ongoing');
    for (const planet of Object.values(s.planets))
      if (planet.owner === 'p4') planet.owner = null;
    // Ordinary FFA diplomacy keeps its existing score/domination conditions.
    expect(advance({ ...s, modeId: 'standard' }, HOUR).state.match.status).toBe('ongoing');
    const result = advance(s, HOUR);
    expect(result.error).toBeUndefined();
    expect(result.state.match.status).toBe('ended');
    expect(result.state.match.winners).toEqual(['p1', 'p2']);
  });

  it('runs all eight inhabitants, and the Swarm produces its own forms', () => {
    let s = fresh();
    const acted = new Set<string>(), swarmBuilds = new Set<string>();
    for (let hour = 0; hour <= 24; hour += 2) {
      s = advance(s, hour * HOUR).state;
      for (const p of Object.values(s.players).filter((p) => p.npc)) {
        for (const action of aiOrders(s, p.id)) {
          const result = order(s, action, s.time);
          if (!result.error) {
            acted.add(p.id);
            if (p.npc === 'swarm' && action.type === 'unit.build') {
              const unit = (action.payload as { unit: string }).unit;
              expect(data.units[unit]!.faction).toBe('swarm');
              swarmBuilds.add(p.id);
            }
          }
          s = result.state;
        }
      }
    }
    expect(acted.size).toBe(8);
    expect(swarmBuilds.size).toBe(2);
    expect(s.pve).toBeUndefined(); // inhabitants do not turn PvP into campaign waves
    expect(s.match.status).toBe('ongoing');
  });
});
