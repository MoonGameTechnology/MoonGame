import { describe, it, expect } from 'vitest';
import { fleetAtOwnDock } from './repair';
import {
  createInitialState,
  type BuildingInstance,
  type Fleet,
  type GameState,
  type Planet,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';

// `fleetAtOwnDock` — «есть ли у флота док»: правило, по которому construction чинит корпус
// у дока постепенно. Случаи перенесены из тестов платного ремонта за металл (ECON-3),
// снятого по заказу владельца 2026-11-01: кнопки нет, а правило дока живёт дальше.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 40 } },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', hp: 25, shipRepair: 1 },
    warehouse: { name: 'Warehouse', hp: 25 }, // no shipRepair — not a dock
  },
  events: {},
});

const dock: BuildingInstance = { type: 'spaceport', level: 1, hp: 25 };

function planet(id: string, owner: string | null, buildings: BuildingInstance[] = [dock]): Planet {
  return { id, owner, position: { x: 0, y: 0 }, resources: {}, buildings, garrison: [], traits: [] };
}
function fleet(extra: Partial<Fleet> = {}): Fleet {
  return {
    id: 'f1',
    owner: 'p1',
    location: 'home',
    movement: null,
    units: [{ unit: 'cruiser', count: 1, hp: 10 }],
    traits: [],
    ...extra,
  };
}
function world(p: Planet): GameState {
  const s = createInitialState({ seed: 'dock', version: { data: '0.1.0', manifest: '1' } });
  return { ...s, planets: { [p.id]: p } };
}

describe('fleetAtOwnDock', () => {
  it('a parked fleet over its own world with a live repair building has a dock', () => {
    expect(fleetAtOwnDock(fleet(), world(planet('home', 'p1')), data)).toBe(true);
  });

  it('a foreign, neutral or dockless world is not a dock', () => {
    expect(fleetAtOwnDock(fleet(), world(planet('home', 'p2')), data)).toBe(false);
    expect(fleetAtOwnDock(fleet(), world(planet('home', null)), data)).toBe(false);
    const warehouse = planet('home', 'p1', [{ type: 'warehouse', level: 1, hp: 25 }]);
    expect(fleetAtOwnDock(fleet(), world(warehouse), data)).toBe(false);
  });

  it('a ruined repair building is not a dock', () => {
    expect(fleetAtOwnDock(fleet(), world(planet('home', 'p1', [{ ...dock, hp: 0 }])), data)).toBe(false);
  });

  it('a fleet in transit has no dock, even over its own world', () => {
    const moving = fleet({ movement: { from: 'home', to: 'x', departedAt: 0, arrivesAt: 1 } as Fleet['movement'] });
    expect(fleetAtOwnDock(moving, world(planet('home', 'p1')), data)).toBe(false);
  });

  it('an allied dock counts only when the caller says the owner is an ally (FORT-5.8)', () => {
    const ally = world(planet('home', 'p2'));
    expect(fleetAtOwnDock(fleet(), ally, data)).toBe(false);
    expect(fleetAtOwnDock(fleet(), ally, data, () => true)).toBe(true);
  });
});
