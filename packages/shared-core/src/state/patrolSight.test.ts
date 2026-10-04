/**
 * ОБЗОР В КРУГЕ ПАТРУЛЯ (SHU-6.7) — приёмка кирпича.
 *
 * Резолюция владельца 2026-10-04 (`shuttles-roadmap.md` §0.7, по образцу Conflict of
 * Nations): висящий патруль — глаза эскадры над её точкой. Он открывает владельцу миры
 * в своём круге и опознаёт чужой флот под собой по ПОЗИЦИИ: патруль висит над дорогой
 * вдали от миров, и правило «опознан узел — виден флот» не видело бы ровно того, по кому
 * он бьёт. Это глаза, а не радар: опознание и засечка совпадают.
 *
 * Карта: свой мир A(0,0); точка патруля P(300,0) с кругом 60; чужой мир G(300,40) в
 * круге; линия E(300,150)–F(300,−150) идёт через саму точку. Чужой флот «road» стоит на
 * линии ровно под патрулём (ближайший узел — E, вне круга), флот «far» — у E, вне круга.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from '../modules/shuttle';
import { visibilityModule } from '../modules/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import { pairKey } from './diplomacy';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type ShuttleStrike,
} from './gameState';
import {
  fleetsSeenByPosition,
  identifiedNodes,
  isVisibleTo,
  radarSignatures,
  sightCircles,
  visibleState,
} from './visibility';
import type { Action } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 10, defense: 8, speed: 6, hp: 400 } },
    // До точки ровно три часа лёта: 300 единиц при скорости 100.
    interceptor: {
      faction: 'x',
      traits: ['shuttle'],
      stats: {
        attack: 4,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 400,
        fuel: 3,
        rearmRounds: 2,
        shuttleDamage: 22,
        patrolHours: 4,
        patrolRadius: 60,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
    // Радар мира: засечка 500, опознание — половина, 250. До точки он не опознаёт.
    radar: { name: 'Radar', radarRange: 500 },
  },
  events: {},
});

const H = MS_PER_HOUR;
const P = { x: 300, y: 0 };

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

const planet = (id: string, owner: string | null, x: number, y: number, links: string[] = []): Planet => ({
  id,
  owner,
  position: { x, y },
  links,
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});

const cruiser = (id: string, where: Pick<Fleet, 'location' | 'edge'>): Fleet => ({
  id,
  owner: 'p2',
  movement: null,
  units: [{ unit: 'cruiser', count: 1 }],
  traits: [],
  battleId: null,
  ...where,
});

/** Висящий патруль p1 над P — собран руками, без полёта: туман читает только состояние. */
const patrolOf = (leg: ShuttleStrike['leg'] = 'patrol', owner = 'p1'): ShuttleStrike => ({
  id: 'strike:1',
  owner,
  base: { kind: 'planet', id: 'A' },
  squadronId: 'sq:i',
  units: [{ unit: 'interceptor', count: 2 }],
  target: { kind: 'point' },
  to: { ...P },
  departedAt: 3 * H,
  arrivesAt: 7 * H,
  leg,
  patrol: { hours: 4, radius: 60 },
});

function world(strikes: ShuttleStrike[] = []): GameState {
  const s = createInitialState({ seed: 'shu67', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, 0);
  home.buildings = [{ type: 'spaceport', level: 1, hp: 30 }];
  home.hangar = [{ id: 'sq:i', units: [{ unit: 'interceptor', count: 2 }] }];
  const g = planet('G', 'p2', 300, 40);
  g.garrison = [{ unit: 'cruiser', count: 3 }];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      G: g,
      E: planet('E', null, 300, 150, ['F']),
      F: planet('F', null, 300, -150, ['E']),
    },
    fleets: {
      road: cruiser('road', { location: null, edge: { from: 'E', to: 'F', t: 0.5 } }),
      far: cruiser('far', { location: 'E' }),
    },
    heroes: {},
    battles: {},
    ...(strikes.length > 0 ? { strikes } : {}),
  };
}

describe('SHU-6.7 — круг висящего патруля', () => {
  it('КРУГ ЕСТЬ ТОЛЬКО У ВИСЯЩЕГО: летящая к точке и домой эскадра карту не открывает', () => {
    const circle = sightCircles(world([patrolOf()]), 'p1', data).find((c) => c.source.kind === 'patrol');
    expect(circle).toEqual({
      owner: 'p1',
      source: { kind: 'patrol', id: 'strike:1' },
      x: 300,
      y: 0,
      identify: 60,
      signature: 60,
    });
    for (const leg of ['out', 'back'] as const) {
      const circles = sightCircles(world([patrolOf(leg)]), 'p1', data);
      expect(circles.some((c) => c.source.kind === 'patrol')).toBe(false);
    }
    // Чужой патруль — не мои глаза.
    expect(sightCircles(world([patrolOf()]), 'p2', data).some((c) => c.source.kind === 'patrol')).toBe(false);
  });

  it('ОТКРЫВАЕТ МИРЫ В СВОЁМ КРУГЕ, а дальние — нет', () => {
    expect(identifiedNodes(world(), 'p1', data).has('G')).toBe(false);
    const seen = identifiedNodes(world([patrolOf()]), 'p1', data);
    expect(seen.has('G')).toBe(true);
    expect(seen.has('E')).toBe(false);
    expect(seen.has('F')).toBe(false);
    // Опознанный мир отдаёт хозяина и гарнизон, неопознанный — пустоту.
    expect(visibleState(world([patrolOf()]), 'p1', data).planets.G?.garrison).toEqual([
      { unit: 'cruiser', count: 3 },
    ]);
    expect(visibleState(world(), 'p1', data).planets.G?.owner).toBeNull();
  });

  it('ЧУЖОЙ ФЛОТ В КРУГЕ ОПОЗНАН — даже на линии вдали от миров; вне круга — нет', () => {
    const s = world([patrolOf()]);
    const fleets = visibleState(s, 'p1', data).fleets;
    expect(fleets.road).toBeDefined(); // ближайший узел E вне круга — опознан по позиции
    expect(fleets.far).toBeUndefined();
    expect(isVisibleTo(s, 'p1', { fleetId: 'road' }, data)).toBe(true);
    expect(isVisibleTo(s, 'p1', { fleetId: 'far' }, data)).toBe(false);
    expect([...fleetsSeenByPosition(s, 'p1', data)]).toEqual(['road']);
    // Без патруля оба в тумане.
    expect(visibleState(world(), 'p1', data).fleets.road).toBeUndefined();
    expect(isVisibleTo(world(), 'p1', { fleetId: 'road' }, data)).toBe(false);
  });

  it('ОПОЗНАННЫЙ ПАТРУЛЁМ НЕ ДВОИТСЯ ОТМЕТКОЙ РАДАРА', () => {
    const withRadar = (s: GameState): GameState => {
      s.planets.A!.buildings.push({ type: 'radar', level: 1, hp: 10 });
      return s;
    };
    const onRoad = { location: 'E', size: 'S', position: { x: 300, y: 0 } };
    const atE = { location: 'E', size: 'S' };
    // Без патруля радар слышит оба флота: «road» — отметкой в пути, «far» — у E.
    expect(radarSignatures(withRadar(world()), 'p1', data)).toEqual([onRoad, atE]);
    // Патруль опознал «road» — он виден целиком, и второй значок поверх был бы лишним.
    const s = withRadar(world([patrolOf()]));
    expect(radarSignatures(s, 'p1', data)).toEqual([atE]);
    expect(visibleState(s, 'p1', data).signatures).toEqual([atE]);
  });

  it('СОЮЗНИК ВИДИТ В КРУГЕ, как в любом круге блока зрения', () => {
    const base = world([patrolOf()]);
    const s: GameState = {
      ...base,
      players: { ...base.players, p3: player('p3') },
      diplomacy: { ...base.diplomacy, [pairKey('p1', 'p3')]: 'alliance' },
    };
    expect(identifiedNodes(s, 'p3', data).has('G')).toBe(true);
    expect(visibleState(s, 'p3', data).fleets.road).toBeDefined();
  });
});

describe('SHU-6.7 — приёмка через ядро', () => {
  const kernel = createKernel([shuttleModule, visibilityModule]);
  let seq = 0;
  const act = (type: string, payload: Record<string, unknown>): Action => ({
    id: `a:${seq++}`,
    type,
    playerId: 'p1',
    payload,
    issuedAt: 0,
  });
  const run = (s: GameState, hours: number): GameState => {
    const r = kernel.advanceTo(s, { now: hours * H, data });
    if (!r.ok) throw new Error('advance failed');
    return r.state;
  };

  it('патруль над точкой открывает её и запоминается туманом; улетевший домой — уже нет', () => {
    // Мир, а не война: патруль никого не бьёт, и в обзоре видно только зрение.
    const peace: GameState = { ...world(), diplomacy: { [pairKey('p1', 'p2')]: 'peace' } };
    const r = kernel.applyAction(
      peace,
      act('shuttle.patrol', { planetId: 'A', squadronId: 'sq:i', at: P }),
      { now: 0, data },
    );
    if (!r.ok) throw new Error(r.code);

    const flying = run(r.state, 2);
    expect(flying.strikes?.[0]?.leg).toBe('out');
    expect(identifiedNodes(flying, 'p1', data).has('G')).toBe(false);
    expect(visibleState(flying, 'p1', data).fleets.road).toBeUndefined();

    const hanging = run(flying, 4);
    expect(hanging.strikes?.[0]?.leg).toBe('patrol');
    expect(identifiedNodes(hanging, 'p1', data).has('G')).toBe(true);
    expect(visibleState(hanging, 'p1', data).fleets.road).toBeDefined();
    expect(visibleState(hanging, 'p1', data).fleets.far).toBeUndefined();
    expect(hanging.fog?.p1?.G?.owner).toBe('p2'); // память тумана записала мир под патрулём

    const home = run(hanging, 8);
    expect(home.strikes?.[0]?.leg).toBe('back');
    expect(identifiedNodes(home, 'p1', data).has('G')).toBe(false);
    expect(visibleState(home, 'p1', data).fleets.road).toBeUndefined();
    expect(visibleState(home, 'p1', data).remembered).toContain('G');
  });
});
