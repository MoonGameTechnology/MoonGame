import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStateFromMap, getStance, laneRoadLength, validateMatchMap } from '../../packages/shared-core/src/index';
import { data } from './gameData';
import { mapPreset, teamForStart, mapNodesFromState, type MapId } from './mapCatalog';
import { newGame, networkSeats, networkStartsOf } from './matchSetup';
import { assignSeats } from './setupSeats';
import { aiOrders } from './ai';
import { advance, order, setMatchMode } from './protoKernel';
import { HOUR } from './time';
import { regionKey } from '../../decisions/regionName';
import { ru } from '../../localization/ru';
import { en } from '../../localization/en';

/** The authored team maps: same contracts, their own size and spacing. */
const TEAM_MAPS = [
  { title: 'Broken Reach — main-game 2v2', id: 'team-2v2', mode: 'team_2v2', provinces: 85, side: 2, allyHops: 4, enemyHops: 8 },
  { title: 'Shattered Crown — main-game 3v3', id: 'team-3v3', mode: 'team_3v3', provinces: 121, side: 3, allyHops: 4, enemyHops: 8 },
] as const;

describe.each(TEAM_MAPS)('$title', ({ id, mode, provinces, side, allyHops, enemyHops }) => {
  const preset = mapPreset(id);
  const seats = networkSeats('ffa', id as MapId);
  const fresh = () => newGame({ mapId: id, seats });
  const nodes = new Map(preset.nodes.map((n) => [n.id, n]));
  const teamA = seats.filter((s) => s.team === 'A').map((s) => s.id);
  const teamB = seats.filter((s) => s.team === 'B').map((s) => s.id);
  function distances(start: string, blocked: readonly string[] = []): Map<string, number> {
    const d = new Map([[start, 0]]), queue = [start];
    for (const id of queue) for (const next of nodes.get(id)!.links) {
      if (!d.has(next) && !blocked.includes(next)) { d.set(next, d.get(id)! + 1); queue.push(next); }
    }
    return d;
  }

  beforeEach(() => setMatchMode(mode));
  afterEach(() => setMatchMode(undefined));
  it('loads the authored mosaic and all inhabitants through the core', () => {
    expect(validateMatchMap(preset.map!, data)).toEqual([]);
    expect(preset.nodes).toHaveLength(provinces);
    expect(preset.map!.paths).toBeUndefined();
    const raw = buildStateFromMap(preset.map!, data, {
      slots: Object.fromEntries(seats.map((seat, i) => [`slot_${i + 1}`, { playerId: seat.id }])),
    });
    const s = fresh();
    expect(s.modeId).toBe(mode);
    expect(Object.values(s.players).filter((p) => !p.npc)).toHaveLength(2 * side);
    expect([teamA.length, teamB.length]).toEqual([side, side]);
    for (const [npc, count] of [['pirate', 2], ['swarm', 2], ['neutral', 4]] as const) {
      const inhabitants = Object.values(s.players).filter((p) => p.npc === npc);
      expect(inhabitants).toHaveLength(count);
      for (const p of inhabitants) {
        expect(p.ai).toBe(true);
        expect(p.team).toBeUndefined();
        expect(p).toEqual(raw.players[p.id]);
        const home = Object.values(s.planets).find((h) => h.owner === p.id)!;
        expect(home.buildings).toEqual(raw.planets[home.id]!.buildings);
        expect(home.garrison).toEqual(raw.planets[home.id]!.garrison);
        expect(Object.values(s.fleets).filter((f) => f.owner === p.id))
          .toEqual(Object.values(raw.fleets).filter((f) => f.owner === p.id));
        expect(networkStartsOf(s, '5v5')[p.id]).toBeNull();
      }
    }
    expect(mapNodesFromState(JSON.parse(JSON.stringify(s)))).toHaveLength(provinces);
  });

  it('keeps every route reachable, with alternative crossings away from occupied bases', () => {
    // The black hole and the two rifts are deliberately impassable; everything else is reachable.
    const barriers = preset.nodes.filter((n) => data.sectorKinds[n.sector]?.traversable === false);
    expect(barriers.map((n) => n.sector).sort()).toEqual(['black_hole', 'rift', 'rift']);
    for (const n of barriers) expect(n.links).toEqual([]);
    expect(distances('home_1').size).toBe(preset.nodes.length - barriers.length);
    expect(nodes.get('remnant')!.links).toEqual([]);
    const inhabited = Object.keys(preset.map!.sectors).filter((id) => preset.map!.sectors[id]!.owner?.startsWith('npc-'));
    for (const start of preset.starts) {
      const d = distances(start);
      for (const base of inhabited) expect(d.get(base), `${start} -> ${base}`).toBeGreaterThanOrEqual(3);
      const bypass = distances(start, inhabited);
      for (const other of preset.starts) expect(bypass.has(other)).toBe(true);
    }
    // No single transit province can cut the starting districts apart.
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
    expect(new Set(preset.starts.map(profile)).size).toBe(2 * side);
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
        if (teamForStart(id, start) !== teamForStart(id, other)) expect(hops).toBeGreaterThanOrEqual(enemyHops);
      }
      // Every district has a teammate close by.
      const allies = preset.starts.filter((o) => o !== start && teamForStart(id, o) === teamForStart(id, start));
      expect(Math.min(...allies.map((o) => distances(start).get(o)!))).toBeLessThanOrEqual(allyHops);
    }
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.05);
  });

  it('uses the whole catalogue, and a derelict graveyard stays a rare find', () => {
    const sectors = Object.values(preset.map!.sectors);
    const has = (pick: (s: (typeof sectors)[number]) => string | undefined): string[] =>
      [...new Set(sectors.map(pick).filter((v): v is string => v !== undefined))].sort();
    // A fork fortress is never authored: it appears when a fortress is set on a road fork.
    // `empty` stays off combat maps by the owner's ruling (see mapSchema.test.ts).
    const kinds = Object.keys(data.sectorKinds).filter((k) => k !== 'fork_station' && k !== 'empty').sort();
    expect(has((s) => s.kind)).toEqual(kinds);
    expect(has((s) => s.terrain)).toEqual(Object.keys(data.sectors).sort());
    expect(has((s) => s.planetType)).toEqual(Object.keys(data.planetTypes).sort());
    expect(sectors.filter((s) => s.kind === 'graveyard')).toHaveLength(1);
    expect(sectors.filter((s) => s.terrain === 'derelict_graveyard').length).toBeLessThanOrEqual(2);
  });

  it('splits the map into named areas, every province in exactly one', () => {
    const regions = preset.map!.regions;
    expect(regions.flatMap((r) => r.sectors).sort()).toEqual(Object.keys(preset.map!.sectors).sort());
    const missing = regions
      .map((r) => regionKey(id, r.id))
      .filter((key) => !(key in ru) || !(key in en));
    expect(missing).toEqual([]);
  });

  // A guard against gross skew, not a demand for mirror-exact maps: the owner trades a
  // little balance for better-looking areas (2026-10-14).
  it('gives both teams the same prizes at comparable distances', () => {
    const fromStart = new Map(preset.starts.map((s) => [s, distances(s)]));
    const near = (team: string, node: string): number =>
      Math.min(...preset.starts.filter((s) => teamForStart(id, s) === team)
        .map((s) => fromStart.get(s)!.get(node) ?? Infinity));
    const prizes = new Map<string, { A: number[]; B: number[] }>();
    let closerA = 0, closerB = 0, sumA = 0, sumB = 0;
    for (const n of preset.nodes) {
      if (preset.starts.includes(n.id) || n.links.length === 0) continue;
      const a = near('A', n.id), b = near('B', n.id);
      sumA += a;
      sumB += b;
      if (a < b) closerA++;
      if (b < a) closerB++;
      // Every world type but the common temperate one, and the dense metal pockets.
      const prize = n.type && n.type !== 'terran' ? n.type : n.sector === 'asteroid_cluster' ? n.sector : undefined;
      if (!prize) continue;
      const list = prizes.get(prize) ?? { A: [], B: [] };
      list.A.push(a);
      list.B.push(b);
      prizes.set(prize, list);
    }
    expect(Math.abs(closerA - closerB)).toBeLessThanOrEqual(6);
    expect(Math.abs(sumA - sumB) / Math.max(sumA, sumB)).toBeLessThan(0.06);
    for (const [prize, { A, B }] of prizes) {
      const b = B.sort((x, y) => x - y);
      A.sort((x, y) => x - y).forEach((d, i) => expect([prize, Math.abs(d - b[i]!) <= 3]).toEqual([prize, true]));
    }
  });

  it.each(preset.starts)('keeps fixed sides when the player chooses %s', (start) => {
    const roles = seats.map((_, i) => (i === 0 ? 'human' : 'ai') as 'human' | 'ai');
    const assigned = assignSeats(seats.length, roles, start, preset.starts)
      .map(({ index, start }) => ({ ...seats[index]!, start, team: 'ignored' }));
    const s = newGame({ mapId: id, seats: assigned });
    for (const a of assigned) {
      expect(s.players[a.id]!.team).toBe(teamForStart(id, a.start));
      expect(JSON.parse(JSON.stringify(s)).players[a.id].team).toBe(s.players[a.id]!.team);
      expect(s.players[a.id]!.technologies!.completed).toEqual(['scout_design']);
      expect(s.fleets[`${a.id}-1`]!.units).toEqual([{ unit: 'scout', count: 1 }]);
      for (const b of assigned.filter((b) => b.id !== a.id))
        expect(getStance(s, a.id, b.id)).toBe(teamForStart(id, a.start) === teamForStart(id, b.start) ? 'alliance' : 'war');
      for (const p of Object.values(s.players).filter((p) => p.npc))
        expect(getStance(s, a.id, p.id)).toBe(p.npc === 'neutral' ? 'peace' : 'war');
    }
  });

  it('awards the surviving team a victory without requiring extermination of NPCs', () => {
    const s = fresh();
    const [first, ...rest] = teamB;
    for (const planet of Object.values(s.planets))
      if (planet.owner === first) planet.owner = null;
    expect(advance(s, HOUR).state.match.status).toBe('ongoing');
    for (const planet of Object.values(s.planets))
      if (rest.includes(planet.owner ?? '')) planet.owner = null;
    // Ordinary FFA diplomacy keeps its existing score/domination conditions.
    setMatchMode('standard');
    expect(advance(s, HOUR).state.match.status).toBe('ongoing');
    setMatchMode(mode);
    const result = advance(s, HOUR);
    expect(result.error).toBeUndefined();
    expect(result.state.match.status).toBe('ended');
    expect(result.state.match.winners).toEqual([...teamA].sort());
  });

  it('keeps human and AI teammates allied through declarations and low bot favour', () => {
    const s = fresh();
    for (const [target, stance] of [['p2', 'war'], ['p2', 'peace'], [teamB[0]!, 'peace'], [teamB[0]!, 'alliance']]) {
      const result = order(s, {
        id: `break-side-${target}-${stance}`, type: 'diplomacy.declare', playerId: 'p1',
        issuedAt: 0, payload: { target, stance },
      }, 0);
      expect(result.error).toBe('E_FORBIDDEN');
      expect(result.state.diplomacy).toEqual(s.diplomacy);
    }
    s.players.p2!.ai = true;
    (s as typeof s & { approval: Record<string, Record<string, number>> }).approval.p2 = { p1: 0 };
    const advanced = advance(s, HOUR);
    expect(advanced.error).toBeUndefined();
    expect(getStance(advanced.state, 'p1', 'p2')).toBe('alliance');
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
    expect(acted.size).toBe(8); // two pirate bases, two hives, four neutrals
    expect(swarmBuilds.size).toBe(2);
    expect(s.pve).toBeUndefined(); // inhabitants do not turn PvP into campaign waves
    expect(s.match.status).toBe('ongoing');
  });
});
