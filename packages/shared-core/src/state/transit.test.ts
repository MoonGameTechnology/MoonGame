import { describe, it, expect } from 'vitest';
import { parseMatchMap, type MatchMap } from '../data/mapSchema';
import { buildStateFromMap, validateMatchMap } from './buildFromMap';
import { planRoute } from './route';
import { loadGameData } from '../data/loadGameData';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(path.join(repoRoot, p), 'utf8'));
const data = loadGameData((name) => readJson('data/' + name));

/**
 * A crossroads: two lanes that physically cross at `mid` — north↔south and west↔east.
 * With `transit` declared they cross WITHOUT meeting; without it `mid` is the full
 * interchange every sector used to be.
 */
const crossing = (transit?: Array<[string, string]>): MatchMap =>
  parseMatchMap({
    id: 'x',
    seed: 'x',
    sectors: {
      north: { position: { x: 0, y: -200 }, kind: 'planet', terrain: 'empty_space' },
      south: { position: { x: 0, y: 200 }, kind: 'planet', terrain: 'empty_space' },
      west: { position: { x: -200, y: 0 }, kind: 'planet', terrain: 'empty_space' },
      east: { position: { x: 200, y: 0 }, kind: 'planet', terrain: 'empty_space' },
      mid: { position: { x: 0, y: 0 }, kind: 'empty', terrain: 'empty_space', ...(transit ? { transit } : {}) },
      // a long way round, so "no through-route" is distinguishable from "no route"
      rim: { position: { x: -260, y: -260 }, kind: 'planet', terrain: 'empty_space' },
    },
    paths: [
      ['north', 'mid'],
      ['south', 'mid'],
      ['west', 'mid'],
      ['east', 'mid'],
      ['north', 'rim'],
      ['west', 'rim'],
    ],
  });

const LANES: Array<[string, string]> = [
  ['north', 'south'],
  ['west', 'east'],
];

const route = (map: MatchMap, from: string, to: string): string[] | null =>
  planRoute(buildStateFromMap(map, data), from, to);

describe('MAP-TRANSIT — parallel lanes through one province', () => {
  it('without transit the crossing is a full interchange, as every sector used to be', () => {
    expect(validateMatchMap(crossing(), data)).toEqual([]);
    expect(route(crossing(), 'north', 'east')).toEqual(['mid', 'east']);
  });

  it('with transit a fleet running one lane cannot switch to the other in passing', () => {
    const map = crossing(LANES);
    expect(validateMatchMap(map, data)).toEqual([]);
    // north→south is a declared lane: still a straight run through `mid`.
    expect(route(map, 'north', 'south')).toEqual(['mid', 'south']);
    // west→east likewise.
    expect(route(map, 'west', 'east')).toEqual(['mid', 'east']);
    // But north→east would have to CHANGE lanes inside `mid`, which these two do not
    // do — so the route goes the long way round instead of cutting through.
    expect(route(map, 'north', 'east')).toEqual(['rim', 'west', 'mid', 'east']);
  });

  it('the fleet may still STOP at the crossing and leave by any lane', () => {
    // Departing is not passing through: the honest cost of the rule is one extra
    // order plus the arrival time, not an absolute wall.
    const map = crossing(LANES);
    expect(route(map, 'mid', 'east')).toEqual(['east']);
    expect(route(map, 'mid', 'south')).toEqual(['south']);
  });

  it('arriving AT the crossing is never blocked, whichever lane you come by', () => {
    const map = crossing(LANES);
    expect(route(map, 'north', 'mid')).toEqual(['mid']);
    expect(route(map, 'east', 'mid')).toEqual(['mid']);
  });
});

describe('MAP-TRANSIT — the map may not lie about its lanes', () => {
  const withTransit = (t: Array<[string, string]>): string[] =>
    validateMatchMap(crossing(t), data);

  it('a pair must name real neighbours', () => {
    expect(withTransit([['north', 'rim']])).toContain('E_TRANSIT_NOT_NEIGHBOR:mid:rim');
  });

  it('a pair may not name the same sector twice', () => {
    expect(withTransit([['north', 'north']])).toContain('E_TRANSIT_SELF:mid:north');
  });

  it('the same pair may not be declared twice', () => {
    expect(withTransit([['north', 'south'], ['south', 'north']])).toContain(
      'E_TRANSIT_DUPLICATE:mid:north|south',
    );
  });

  it('transit may not strand a sector that the plain graph says is connected', () => {
    // `south` hangs off `mid` alone. Declare a lane set that never lets anyone leave
    // toward it and the map is still "connected" by the undirected BFS — but no fleet
    // could ever get there. Caught the way a fleet actually travels.
    const issues = withTransit([['north', 'west'], ['north', 'east']]);
    expect(issues.some((c) => c.startsWith('E_TRANSIT_UNREACHABLE:'))).toBe(true);
  });
});
