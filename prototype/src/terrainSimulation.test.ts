import { expect, it } from 'vitest';
import {
  hashState, mosaicFrame, resolveMatchConfig, SEED_WEIGHT, visibleState,
  type Action, type GameState,
} from '../../packages/shared-core/src/index';
import { computePowerCells } from '../../packages/client/src/territory';
import { buildTerrainEnvironment } from '../../decisions/terrainEnvironment';
import { roadStrokes, forkMarks } from '../../decisions/roadNetwork';
import { buildUnit, moveFleet, researchTech } from '../../decisions/actions';
import { MAP_IDS, mapPreset } from './mapCatalog';
import { newGame, networkSeats } from './matchSetup';
import { data } from './gameData';
import { kernel } from './protoKernel';
import { HOUR } from './time';

/** Exercise the real planner on the same public mosaic and permitted data as the client. */
function prepareViewerScene(state: GameState): number {
  const view = visibleState(state, 'p1', data);
  const planets = Object.values(view.planets);
  const frame = mosaicFrame(planets.map(p => ({ id: p.id, ...p.position, size: p.size ?? 1 })));
  const cells = computePowerCells(planets.map(p => ({ ...p.position, owner: p.owner,
    kind: p.kind ?? 'unknown', w: (p.size ?? 1) * SEED_WEIGHT })), [
    [frame.x0, frame.y0], [frame.x1, frame.y0], [frame.x1, frame.y1], [frame.x0, frame.y1],
  ]);
  const scene = buildTerrainEnvironment({
    seed: state.mapId,
    cells: cells.map(cell => {
      const p = planets[cell.idx]!;
      return { id: p.id, kind: p.kind, terrain: p.terrain, poly: cell.poly,
        known: p.kind !== undefined || p.terrain !== undefined };
    }),
    roads: roadStrokes(view.planets),
    markers: [...planets.map(p => ({ ...p.position, kind: 'capture' as const })),
      ...forkMarks(view.planets).map(mark => ({ ...mark.at, kind: 'fork' as const }))],
  });
  expect(scene.clipPolygons.length).toBeGreaterThan(0);
  return scene.tiles.reduce((count, tile) => count + tile.features.length, 0);
}

const geography = (state: GameState) => Object.values(state.planets).map(p => ({
  id: p.id, position: p.position, size: p.size, kind: p.kind, terrain: p.terrain,
  planetType: p.planetType, links: p.links, roads: p.roads,
}));

it.each(MAP_IDS)('AC15: %s simulation is identical with environment preparation between steps', mapId => {
  const initial = newGame({ mapId, seats: networkSeats('ffa', mapId) });
  const home = Object.values(initial.planets).find(p => p.owner === 'p1')!;
  // Send the starting scout to the nearest unowned decorated environment, so all
  // three cases exercise actual features rather than only the empty home-world scene.
  const queue = [home.id], seen = new Set(queue);
  const material = new Set(['asteroid', 'nebula', 'dense_nebula', 'graveyard', 'ion_storm', 'dead_world']);
  let destination = '';
  for (const id of queue) {
    const p = initial.planets[id]!;
    if (p.owner === null && material.has(p.kind ?? '')) { destination = id; break; }
    for (const next of p.links ?? []) if (!seen.has(next) &&
      (initial.planets[next]!.owner === null || initial.planets[next]!.owner === 'p1')) {
      seen.add(next); queue.push(next);
    }
  }
  expect(destination).not.toBe('');
  const resolved = resolveMatchConfig(data, {
    timeScale: 1, modeId: initial.modeId,
    victory: { scoreLimit: mapPreset(mapId).scoreLimit, endsAt: 48 * HOUR },
  });
  if (!resolved.ok) throw new Error(resolved.code);
  // Build the action log once: both runs consume the exact same action ids/payloads.
  const opening = [buildUnit('p1', home.id, 'frigate'), researchTech('p1', 'frigate_design'),
    moveFleet('p1', 'p1-1', destination)];
  const production = buildUnit('p1', home.id, 'frigate');
  const run = (environment: boolean) => {
    let state = structuredClone(initial), features = 0;
    const results: unknown[] = [], hashes: string[] = [];
    const observe = () => {
      const before = hashState(state);
      if (environment) features += prepareViewerScene(state);
      expect(hashState(state)).toBe(before);
      hashes.push(before);
    };
    const act = (action: Action) => {
      const result = kernel.applyAction(state, action, { now: state.time, data, config: resolved.config });
      results.push(result);
      if (result.ok) state = result.state;
      observe();
      return result;
    };
    const advance = (now: number) => {
      const result = kernel.advanceTo(state, { now, data, config: resolved.config });
      results.push(result);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      expect(result.partial).not.toBe(true);
      state = result.state;
      observe();
    };
    observe();
    expect(act(opening[0]!)).toMatchObject({ ok: false, code: 'E_TECH_LOCKED' });
    expect(act(opening[1]!).ok).toBe(true);
    expect(act(opening[2]!).ok).toBe(true);
    advance(2 * HOUR);
    expect(act(production).ok).toBe(true);
    advance(48 * HOUR);
    expect(state.match.status).toBe('ended');
    expect(geography(state)).toEqual(geography(initial));
    return { results, hashes, state, features };
  };
  const plain = run(false), decorated = run(true);
  expect(decorated.features).toBeGreaterThan(0);
  expect(decorated.results).toEqual(plain.results);
  expect(decorated.hashes).toEqual(plain.hashes);
  expect(decorated.state).toEqual(plain.state);
  expect(decorated.state.match).toEqual(plain.state.match);
});
