import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState, type Planet } from '../packages/shared-core/src/index';
import { TUTOR_PURSE, tutorOrders, tutorStart, tutorWorld } from './tutorialRival';

const planet = (
  id: string,
  x: number,
  links: string[],
  owner: string | null = null,
  kind = 'planet',
): Planet =>
  ({
    id,
    owner,
    kind,
    position: { x, y: 0 },
    links,
    roads: [],
    resources: {},
    buildings: [],
    garrison: [{ unit: 'militia', count: 3 }],
    traits: [],
  }) as unknown as Planet;

function world(): GameState {
  const s = createInitialState({ seed: 1, version: { data: '0.1.0', manifest: 'test' } });
  s.planets = {
    home: planet('home', 0, ['near', 'nebula'], 'p1'),
    nebula: planet('nebula', 50, ['home'], null, 'nebula'),
    near: planet('near', 300, ['home', 'rival'], 'p2'),
    far: planet('far', 120, []),
    rival: planet('rival', 900, ['near']),
  };
  for (const id of ['p1', 'p2'])
    s.players[id] = {
      id,
      name: id,
      faction: 'azure',
      status: 'active',
      resources: { credits: 100, metal: 50 },
    };
  s.fleets = {
    'p1-1': {
      id: 'p1-1',
      owner: 'p1',
      location: 'home',
      movement: null,
      traits: [],
      units: [{ unit: 'scout', count: 1 }],
    },
    'p2-1': {
      id: 'p2-1',
      owner: 'p2',
      location: 'near',
      movement: null,
      traits: [],
      units: [{ unit: 'scout', count: 3 }],
    },
    'p2-2': {
      id: 'p2-2',
      owner: 'p2',
      location: 'near',
      movement: null,
      traits: [],
      units: [{ unit: 'frigate', count: 2 }],
    },
  };
  return s;
}

describe('соперник обучения основной игры', () => {
  it('садится на ближайший СОСЕДНИЙ мир-планету, а не на ближайшую точку вообще', () => {
    // «far» ближе «near», но с домом не связан; туманность ближе всех, но это не мир.
    expect(tutorStart(world().planets, 'home')).toBe('near');
  });

  it('без соседей-планет берёт ближайшую планету; без дома — никуда', () => {
    const s = world();
    s.planets.home = { ...s.planets.home!, links: ['nebula'] };
    expect(tutorStart(s.planets, 'home')).toBe('far');
    expect(tutorStart(s.planets, 'nowhere')).toBeNull();
  });

  it('мир обучения: гарнизон бота пуст, у бота один корабль, игрок нетронут', () => {
    const before = world();
    const s = tutorWorld(before, 'p1', 'p2');
    expect(s.planets.near!.garrison).toEqual([]);
    expect(s.planets.home!.garrison).toEqual([{ unit: 'militia', count: 3 }]);
    const bot = Object.values(s.fleets).filter((f) => f.owner === 'p2');
    expect(bot).toHaveLength(1);
    expect(bot[0]!.units).toEqual([{ unit: 'scout', count: 1 }]);
    expect(s.fleets['p1-1']).toEqual(before.fleets['p1-1']);
    // вход не меняется
    expect(before.planets.near!.garrison).toHaveLength(1);
    expect(Object.keys(before.fleets)).toHaveLength(3);
  });

  it('казна игрока поднимается до пола, но не срезается, если богаче', () => {
    const s = world();
    s.players.p1!.resources = { credits: 900, metal: 10, food: 7 };
    const out = tutorWorld(s, 'p1', 'p2').players.p1!.resources;
    expect(out.credits).toBe(900);
    expect(out.metal).toBe(TUTOR_PURSE.metal);
    expect(out.food).toBe(7);
  });

  it('бот молчит, пока обучение не дошло до обороны', () => {
    expect(tutorOrders(tutorWorld(world(), 'p1', 'p2'), 'p2', 'home', false)).toEqual([]);
  });

  it('на уроке обороны — ровно один курс на дом игрока, и только раз', () => {
    const s = tutorWorld(world(), 'p1', 'p2');
    const orders = tutorOrders(s, 'p2', 'home', true);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      type: 'fleet.move',
      playerId: 'p2',
      payload: { fleetId: 'p2-1', to: 'home' },
    });
    // уже летит — приказ не повторяется каждый кадр
    s.fleets['p2-1'] = { ...s.fleets['p2-1']!, movement: { to: 'home' } as never };
    expect(tutorOrders(s, 'p2', 'home', true)).toEqual([]);
  });

  it('флот у цели, погибший флот и выбывший бот приказов не дают', () => {
    const s = tutorWorld(world(), 'p1', 'p2');
    s.fleets['p2-1'] = { ...s.fleets['p2-1']!, location: 'home' };
    expect(tutorOrders(s, 'p2', 'home', true)).toEqual([]);
    s.fleets['p2-1'] = {
      ...s.fleets['p2-1']!,
      location: 'near',
      units: [{ unit: 'scout', count: 0 }],
    };
    expect(tutorOrders(s, 'p2', 'home', true)).toEqual([]);
    const gone = tutorWorld(world(), 'p1', 'p2');
    gone.players.p2 = { ...gone.players.p2!, status: 'defeated' };
    expect(tutorOrders(gone, 'p2', 'home', true)).toEqual([]);
  });
});
