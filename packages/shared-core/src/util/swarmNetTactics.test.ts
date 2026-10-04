import { describe, it, expect } from 'vitest';
import { swarmNetPlan } from './swarmNetTactics';
import { parseGameData, type GameData } from '../data/schemas';
import type { Fleet, GameState, Planet } from '../state/gameState';

// Тактика сети Роя: цепочка постов от центра данных к фронту, постройка недостающего,
// отделение ретранслятора со стапеля (v0) и хребет с починкой разрыва (v1, глава V). Линия
// миров v0: H(0) — улей с центром и верфью, M1(300), M2(600), F(900) — мир игрока.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    post: {
      faction: 'swarm',
      traits: ['relay', 'relay_post'],
      stats: { attack: 0, defense: 1, speed: 5, hp: 10 },
      relayRange: 200,
      cost: { metal: 10 },
    },
    spark: {
      faction: 'swarm',
      traits: ['relay'],
      stats: { attack: 0, defense: 1, speed: 5, hp: 5 },
      relayRange: 80,
    },
    frigate: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 5, hp: 10 } },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' } },
  buildings: {
    center: { name: 'Center', hp: 30, relayRange: 150, cost: { metal: 10 } },
    yard: { name: 'Yard', hp: 30, enablesShipConstruction: true },
  },
  events: {},
});

const planet = (
  id: string,
  x: number,
  owner: string | null,
  buildings: string[],
  links: string[],
): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map((type) => ({ type, level: 1, hp: 30 })),
  garrison: [],
  traits: [],
  links,
});
const fleet = (
  id: string,
  at: string,
  units: Array<[string, number]>,
  traits: string[] = [],
): Fleet => ({
  id,
  owner: 'swarm',
  location: at,
  movement: null,
  units: units.map(([unit, count]) => ({ unit, count })),
  traits,
});

function world(fleets: Fleet[], metal = 100, center = true): GameState {
  return {
    time: 0,
    scheduled: [],
    players: {
      swarm: { id: 'swarm', name: 'S', faction: 'swarm', status: 'active', resources: { metal } },
      p1: { id: 'p1', name: 'P', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      H: planet('H', 0, 'swarm', center ? ['center', 'yard'] : ['yard'], ['M1']),
      M1: planet('M1', 300, null, [], ['H', 'M2']),
      M2: planet('M2', 600, null, [], ['M1', 'F']),
      F: planet('F', 900, 'p1', [], ['M2']),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  } as unknown as GameState;
}

describe('цепочка от центра к фронту', () => {
  it('пост встаёт на самое дальнее место пути, до которого сходятся круги', () => {
    // От центра (150) пост (200) дотягивается на 350: M1 (300) — да, M2 (600) — нет.
    const plan = swarmNetPlan(world([fleet('a', 'H', [['post', 1]])]), data, 'swarm');
    expect(plan.moves).toEqual([{ fleetId: 'a', to: 'M1' }]);
    expect([...plan.held]).toEqual(['a']);
  });

  it('постов не хватает до фронта — Рой строит ещё один на верфи', () => {
    const plan = swarmNetPlan(world([fleet('a', 'M1', [['post', 1]])]), data, 'swarm');
    // От поста на M1 до фронта 600 — больше 200 + 80 (малый ретранслятор волны): нужен
    // пост на M2 (300 ≤ 200 + 200), а свободного поста для него нет.
    expect(plan.moves).toEqual([]);
    expect(plan.builds).toEqual([{ planetId: 'H', unit: 'post' }]);
  });

  it('уже заказанный ретранслятор второй раз не заказывается, неоплатный — тоже', () => {
    const queued = world([fleet('a', 'M1', [['post', 1]])]);
    queued.planets.H!.buildQueue = [
      { id: 1, kind: 'unit', playerId: 'swarm', unit: 'post', count: 1 },
    ];
    expect(swarmNetPlan(queued, data, 'swarm').builds).toEqual([]);
    expect(swarmNetPlan(world([fleet('a', 'M1', [['post', 1]])], 0), data, 'swarm').builds).toEqual(
      [],
    );
  });

  it('ретранслятор во флоте сбора с боевыми кораблями отделяется, а не воюет', () => {
    const plan = swarmNetPlan(
      world([
        fleet(
          'rally',
          'H',
          [
            ['post', 1],
            ['frigate', 5],
          ],
          ['rally'],
        ),
      ]),
      data,
      'swarm',
    );
    expect(plan.splits).toEqual([{ fleetId: 'rally', take: [{ unit: 'post', count: 1 }] }]);
    expect(plan.held.has('rally')).toBe(true);
  });

  it('центров не осталось — Рой ставит новый на верфи', () => {
    const plan = swarmNetPlan(world([], 100, false), data, 'swarm');
    expect(plan.builds).toContainEqual({ planetId: 'H', building: 'center' });
  });
});

/** Мир v1: миры на плоскости, лейны — по списку пар. */
function map2d(
  planets: Array<{ id: string; x: number; y: number; owner?: string; b?: string[] }>,
  lanes: Array<[string, string]>,
  fleets: Fleet[],
  metal = 100,
): GameState {
  const links = (id: string) =>
    lanes.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])).sort();
  return {
    time: 0,
    scheduled: [],
    pve: { waveNumber: 0, totalWaves: 1, npcPlayerId: 'swarm', home: 'H' },
    players: {
      swarm: { id: 'swarm', name: 'S', faction: 'swarm', status: 'active', resources: { metal } },
      p1: { id: 'p1', name: 'P', faction: 'x', status: 'active', resources: {} },
    },
    planets: Object.fromEntries(
      planets.map((p) => [
        p.id,
        {
          ...planet(p.id, p.x, p.owner ?? null, p.b ?? [], links(p.id)),
          position: { x: p.x, y: p.y },
        },
      ]),
    ),
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  } as unknown as GameState;
}

describe('хребет сети стоит (v1, правило 6)', () => {
  // Два центра — улей H и E — связаны постом на M; фронт игрока F — внизу, по S1 и S2.
  const worlds = [
    { id: 'H', x: 0, y: 0, owner: 'swarm', b: ['center', 'yard'] },
    { id: 'M', x: 250, y: 0 },
    { id: 'E', x: 500, y: 0, owner: 'swarm', b: ['center', 'yard'] },
    { id: 'S1', x: 0, y: 300 },
    { id: 'S2', x: 0, y: 600 },
    { id: 'F', x: 0, y: 900, owner: 'p1' },
  ];
  const lanes: Array<[string, string]> = [
    ['H', 'M'],
    ['M', 'E'],
    ['H', 'S1'],
    ['S1', 'S2'],
    ['S2', 'F'],
  ];

  it('пост, связывающий центры, к фронту не уходит — к фронту Рой строит новый', () => {
    const plan = swarmNetPlan(
      map2d(worlds, lanes, [fleet('m', 'M', [['post', 1]])]),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([]);
    expect(plan.held.has('m')).toBe(true);
    expect(plan.builds).toEqual([{ planetId: 'E', unit: 'post' }]);
  });

  it('резервная связь тоже стоит: сеть раскладки не разбирает сама себя', () => {
    const extra = { id: 'M2', x: 250, y: 60 };
    const plan = swarmNetPlan(
      map2d(
        [...worlds, extra],
        [...lanes, ['H', 'M2'], ['M2', 'E']],
        [fleet('m', 'M', [['post', 1]]), fleet('n', 'M2', [['post', 1]])],
      ),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([]);
  });

  it('резервная цепочка длиннее основной тоже стоит — но только один такой слой', () => {
    // Основная связь — пост на M; резерв — R1 и R2 дугой ниже. Пост на стапеле в улье
    // свободен и идёт к фронту, резерв стоит.
    const reserve = [...worlds, { id: 'R1', x: 100, y: -330 }, { id: 'R2', x: 400, y: -330 }];
    const plan = swarmNetPlan(
      map2d(
        reserve,
        [...lanes, ['H', 'R1'], ['R1', 'R2'], ['R2', 'E']],
        [
          fleet('m', 'M', [['post', 1]]),
          fleet('r1', 'R1', [['post', 1]]),
          fleet('r2', 'R2', [['post', 1]]),
          fleet('x', 'H', [['post', 1]]),
        ],
      ),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([{ fleetId: 'x', to: 'S1' }]);
  });

  it('пост на стапеле у центра в хребет не входит: он и идёт на место цепочки', () => {
    const plan = swarmNetPlan(
      map2d(worlds, lanes, [fleet('m', 'M', [['post', 1]]), fleet('s', 'H', [['post', 1]])]),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([{ fleetId: 's', to: 'S1' }]);
  });
});

describe('разорванную сеть Рой чинит (v1, правило 7)', () => {
  // Улей H и центр E в 700 друг от друга — без постов это две части. Пост дотягивается на
  // 200, центр — на 150: нужны посты на M1 и M2.
  const worlds = [
    { id: 'H', x: 0, y: 0, owner: 'swarm', b: ['center', 'yard'] },
    { id: 'M1', x: 250, y: 0 },
    { id: 'M2', x: 500, y: 0 },
    { id: 'E', x: 700, y: 0, owner: 'swarm', b: ['center', 'yard'] },
    { id: 'S1', x: 0, y: 300 },
    { id: 'F', x: 0, y: 2000, owner: 'p1' },
  ];
  const lanes: Array<[string, string]> = [
    ['H', 'M1'],
    ['M1', 'M2'],
    ['M2', 'E'],
    ['H', 'S1'],
  ];

  it('свободный пост идёт на ближайшее место починки, недостающий строится у разрыва', () => {
    const plan = swarmNetPlan(
      map2d(worlds, lanes, [fleet('a', 'S1', [['post', 1]])]),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([{ fleetId: 'a', to: 'M1' }]);
    // Ближайшая к разрыву (M1) верфь — улей, а не первая по id.
    expect(plan.builds).toEqual([{ planetId: 'H', unit: 'post' }]);
  });

  it('починка — за свои средства: без запаса пост не строится', () => {
    expect(swarmNetPlan(map2d(worlds, lanes, [], 0), data, 'swarm').builds).toEqual([]);
  });

  it('починка важнее цепочки к фронту', () => {
    const near = worlds.map((w) => (w.id === 'F' ? { ...w, y: 900 } : w));
    const plan = swarmNetPlan(
      map2d(near, [...lanes, ['S1', 'F']], [fleet('a', 'H', [['post', 1]])]),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([{ fleetId: 'a', to: 'M1' }]);
  });

  it('разрыв, который не дотянуть, Рой не начинает', () => {
    const far = worlds
      .filter((w) => w.id !== 'M2')
      .map((w) => (w.id === 'E' ? { ...w, x: 1200 } : w));
    const plan = swarmNetPlan(
      map2d(
        far,
        [
          ['H', 'M1'],
          ['M1', 'E'],
          ['H', 'S1'],
        ],
        [fleet('a', 'S1', [['post', 1]])],
      ),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([]);
    expect(plan.builds).toEqual([]);
  });

  it('сшитая сеть больше не чинится: пост на месте стоит', () => {
    const plan = swarmNetPlan(
      map2d(worlds, lanes, [fleet('a', 'M1', [['post', 1]]), fleet('b', 'M2', [['post', 1]])]),
      data,
      'swarm',
    );
    expect(plan.moves).toEqual([]);
    expect(plan.builds).toEqual([]);
  });
});
